import { useState, useEffect, useRef } from "react";
import { useNavigate, Link } from "react-router-dom";
import { SignalingHelper, SignalingMessage } from "../hooks/useSignaling";
import { WebRTCHelper, BoardFile } from "../hooks/useWebRTC";
import { PeerApiHelper, Peer } from "../services/PeerApiHelper";
import { loadSession } from "../services/session";
import { getIceServers } from "../services/iceServers";
import { cacheFiles, loadAllCached, evict } from "../services/feedCache";

const BATCH_SIZE = 5;
const POLL_INTERVAL = 10_000;

function relativeTime(ts: number): string {
   const diff = Date.now() - ts;
   const mins = Math.floor(diff / 60_000);
   if (mins < 1) return "just now";
   if (mins < 60) return `${mins}m ago`;
   const hours = Math.floor(mins / 60);
   if (hours < 24) return `${hours}h ago`;
   const days = Math.floor(hours / 24);
   if (days < 30) return `${days}d ago`;
   return new Date(ts).toLocaleDateString();
}

interface FeedItem {
   peerId: string;
   username: string;
   file: BoardFile;
}

// synthetic peerId for cache-only items (not yet connected)
const cachedPeerId = (username: string) => `__cached__${username}`;

export default function Feed() {
   const navigate = useNavigate();
   const session = loadSession();

   const [feedItems, setFeedItems] = useState<FeedItem[]>(() => {
      const cached = loadAllCached();
      return Object.entries(cached).flatMap(([username, files]) =>
         files.map((f) => ({ peerId: cachedPeerId(username), username, file: f }))
      );
   });
   const [loading, setLoading] = useState(true);

   const signalingRef = useRef<SignalingHelper | null>(null);
   const peerHelpersRef = useRef<Map<string, WebRTCHelper>>(new Map());
   const peerUsernamesRef = useRef<Map<string, string>>(new Map());
   const peerQueueRef = useRef<Peer[]>([]);
   const iceServersRef = useRef<RTCIceServer[]>([{ urls: "stun:stun.l.google.com:19302" }]);
   const registeredRef = useRef(false);

   useEffect(() => {
      if (!session) { navigate("/login", { replace: true }); return; }

      let cancelled = false;

      function connectPeer(peer: Peer) {
         if (cancelled || peerHelpersRef.current.has(peer.peer_id)) return;
         const rtc = new WebRTCHelper(
            async () => null,
            (files) => {
               if (cancelled) return;
               const images = files.filter((f) => f.mimeType.startsWith("image/"));
               cacheFiles(peer.username, images);
               setFeedItems((prev) => [
                  ...prev.filter((item) => item.peerId !== peer.peer_id && item.username !== peer.username),
                  ...images.map((f) => ({ peerId: peer.peer_id, username: peer.username, file: f })),
               ]);
            },
            () => {}, () => {}, () => {},
            (connected) => {
               if (cancelled) return;
               if (!connected) {
                  peerHelpersRef.current.delete(peer.peer_id);
                  peerUsernamesRef.current.delete(peer.peer_id);
                  connectNext(); // fill the freed slot
               }
            },
            iceServersRef.current,
         );
         peerHelpersRef.current.set(peer.peer_id, rtc);
         peerUsernamesRef.current.set(peer.peer_id, peer.username);
         rtc.createOffer((c) =>
            signalingRef.current?.send({ type: "ice-candidate", targetId: peer.peer_id, payload: c })
         ).then((offer) =>
            signalingRef.current?.send({ type: "offer", targetId: peer.peer_id, payload: offer })
         ).catch(console.error);
      }

      function connectNext() {
         if (!registeredRef.current) return;
         const slots = BATCH_SIZE - peerHelpersRef.current.size;
         peerQueueRef.current.splice(0, slots).forEach(connectPeer);
      }

      async function setup() {
         // Fetch peers first — unblocks UI. ICE servers fetched in parallel but don't gate loading.
         let peers: Awaited<ReturnType<typeof PeerApiHelper.searchPeers>> = [];
         try {
            peers = await PeerApiHelper.searchPeers();
         } catch (ex) {
            console.error("[Feed] searchPeers failed", ex);
         }
         if (cancelled) return;

         const others = peers.filter((p) => p.username !== session!.username);
         setLoading(false);

         // Evict cached items for peers no longer online
         const onlineSet = new Set(others.map((p) => p.username));
         setFeedItems((prev) => prev.filter((item) => onlineSet.has(item.username)));
         Object.keys(loadAllCached()).forEach((u) => { if (!onlineSet.has(u)) evict(u); });

         peerQueueRef.current = [...others];

         // ICE servers in background — connectPeer uses iceServersRef at call time
         getIceServers().then((ice) => { if (!cancelled) iceServersRef.current = ice; }).catch(() => {});

         const signaling = new SignalingHelper(async (msg: SignalingMessage) => {
            if (msg.type === "registered") { registeredRef.current = true; connectNext(); }
            if (msg.type === "answer") await peerHelpersRef.current.get(msg.fromId)?.handleAnswer(msg.payload);
            if (msg.type === "ice-candidate") await peerHelpersRef.current.get(msg.fromId)?.handleIceCandidate(msg.payload);
         });
         signalingRef.current = signaling;
         signaling.connect(session!.peerId);
      }

      setup();

      const poll = setInterval(async () => {
         if (cancelled) return;
         try {
            const fresh = await PeerApiHelper.searchPeers();
            if (cancelled) return;
            const freshSet = new Set(fresh.map((p) => p.username));

            // Evict gone peers
            peerUsernamesRef.current.forEach((username, peerId) => {
               if (freshSet.has(username)) return;
               peerHelpersRef.current.get(peerId)?.destroy();
               peerHelpersRef.current.delete(peerId);
               peerUsernamesRef.current.delete(peerId);
               evict(username);
               setFeedItems((prev) => prev.filter((item) => item.username !== username));
            });
            peerQueueRef.current = peerQueueRef.current.filter((p) => freshSet.has(p.username));
            setFeedItems((prev) => prev.filter(
               (item) => !item.peerId.startsWith("__cached__") || freshSet.has(item.username)
            ));

            // Queue new peers
            const known = new Set([
               ...peerUsernamesRef.current.values(),
               ...peerQueueRef.current.map((p) => p.username),
            ]);
            fresh.filter((p) => p.username !== session!.username && !known.has(p.username))
               .forEach((p) => peerQueueRef.current.push(p));

            connectNext();
         } catch { /* keep state on network error */ }
      }, POLL_INTERVAL);

      return () => {
         cancelled = true;
         clearInterval(poll);
         signalingRef.current?.disconnect();
         peerHelpersRef.current.forEach((rtc) => rtc.destroy());
         peerHelpersRef.current.clear();
         peerUsernamesRef.current.clear();
         peerQueueRef.current = [];
         registeredRef.current = false;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
   }, []);

   return (
      <div className="feed-page">
         {loading && feedItems.length === 0 && (
            <div className="feed-connecting">
               <p className="feed-empty">Connecting to peers…</p>
            </div>
         )}

         {!loading && feedItems.length === 0 && (
            <p className="feed-empty">No content yet. Connect with peers to see their images.</p>
         )}

         <div className="profile-gallery">
            {feedItems.map((item) => (
               <Link
                  key={`${item.peerId}-${item.file.id}`}
                  to={`/feed/${item.username}`}
                  className="gallery-item feed-gallery-item"
               >
                  <div className="gallery-img-wrapper">
                     <img src={item.file.thumbnail ?? ""} alt={item.file.name} className="gallery-img" loading="lazy" />
                     <div className="gallery-overlay">
                        <div className="gallery-overlay-top">
                           <span className="gallery-overlay-user">{item.username}</span>
                           {item.file.uploadedAt && <span className="gallery-overlay-date">{relativeTime(item.file.uploadedAt)}</span>}
                        </div>
                        {item.file.caption && <span className="gallery-overlay-caption">{item.file.caption}</span>}
                     </div>
                  </div>
               </Link>
            ))}
         </div>
      </div>
   );
}
