import { useState, useEffect, useRef } from "react";
import { useNavigate, Link } from "react-router-dom";
import { SignalingHelper, SignalingMessage } from "../hooks/useSignaling";
import { WebRTCHelper, BoardFile } from "../hooks/useWebRTC";
import { PeerApiHelper } from "../services/PeerApiHelper";
import { loadSession } from "../services/session";
import { getIceServers } from "../services/iceServers";

interface FeedItem {
   peerId: string;
   username: string;
   file: BoardFile;
}

export default function Feed() {
   const navigate = useNavigate();
   const session = loadSession();

   const [feedItems, setFeedItems] = useState<FeedItem[]>([]);
   const [connectedCount, setConnectedCount] = useState(0);
   const [loading, setLoading] = useState(true);

   const signalingRef = useRef<SignalingHelper | null>(null);
   const peerHelpersRef = useRef<Map<string, WebRTCHelper>>(new Map());
   // peerId → username lookup
   const peerUsernamesRef = useRef<Map<string, string>>(new Map());

   useEffect(() => {
      if (!session) { navigate("/login", { replace: true }); return; }

      let cancelled = false;

      async function setup() {
         const [peers, iceServers] = await Promise.all([
            PeerApiHelper.searchPeers(),
            getIceServers(),
         ]);
         if (cancelled) return;

         const others = peers.filter((p) => p.username !== session!.username);
         setLoading(false);

         if (others.length === 0) return;

         others.forEach((p) => peerUsernamesRef.current.set(p.peer_id, p.username));

         const signaling = new SignalingHelper(async (msg: SignalingMessage) => {
            if (msg.type === "registered") {
               for (const peer of others) {
                  if (cancelled) return;
                  const rtc = new WebRTCHelper(
                     async () => null,
                     (files) => {
                        if (cancelled) return;
                        const images = files.filter((f) => f.mimeType.startsWith("image/"));
                        setFeedItems((prev) => [
                           ...prev.filter((item) => item.peerId !== peer.peer_id),
                           ...images.map((f) => ({ peerId: peer.peer_id, username: peer.username, file: f })),
                        ]);
                     },
                     () => {},
                     () => {},
                     () => {},
                     (connected) => {
                        if (cancelled) return;
                        setConnectedCount((n) => connected ? n + 1 : Math.max(0, n - 1));
                        if (!connected) {
                           setFeedItems((prev) => prev.filter((item) => item.peerId !== peer.peer_id));
                        }
                     },
                     iceServers,
                  );
                  peerHelpersRef.current.set(peer.peer_id, rtc);

                  const offer = await rtc.createOffer((c) => {
                     signaling.send({ type: "ice-candidate", targetId: peer.peer_id, payload: c });
                  });
                  signaling.send({ type: "offer", targetId: peer.peer_id, payload: offer });
               }
            }
            if (msg.type === "answer") {
               await peerHelpersRef.current.get(msg.fromId)?.handleAnswer(msg.payload);
            }
            if (msg.type === "ice-candidate") {
               await peerHelpersRef.current.get(msg.fromId)?.handleIceCandidate(msg.payload);
            }
         });

         signalingRef.current = signaling;
         signaling.connect(session!.peerId);
      }

      setup().catch(console.error);

      return () => {
         cancelled = true;
         signalingRef.current?.disconnect();
         peerHelpersRef.current.forEach((rtc) => rtc.destroy());
         peerHelpersRef.current.clear();
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
   }, []);

   return (
      <div className="feed-page">
         {!loading && (
            <div style={{ display: "flex", justifyContent: "center", padding: "0.5rem 0" }}>
               <span className={`badge ${connectedCount > 0 ? "badge--success" : "badge--default"}`}>
                  {connectedCount} connected
               </span>
            </div>
         )}

         {loading && (
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
                     <div className="feed-item-user">
                        <span className="online-dot" aria-hidden />
                        {item.username}
                     </div>
                  </div>
               </Link>
            ))}
         </div>
      </div>
   );
}
