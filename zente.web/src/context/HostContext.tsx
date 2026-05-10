import { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import { SignalingHelper, SignalingMessage } from "../hooks/useSignaling";
import { WebRTCHelper, BoardFile } from "../hooks/useWebRTC";
import { loadFiles } from "../services/fileStore";
import { getIceServers } from "../services/iceServers";

interface HostContextValue {
   viewerCount: number;
   isActive: boolean;
   activate: (username: string, peerId: string) => Promise<void>;
   pushManifest: (files: BoardFile[], blobs: Map<string, Blob>) => void;
}

const HostContext = createContext<HostContextValue>({
   viewerCount: 0,
   isActive: false,
   activate: async () => {},
   pushManifest: () => {},
});

export function HostProvider({ children }: { children: React.ReactNode }) {
   const [viewerCount, setViewerCount] = useState(0);
   const [isActive, setIsActive] = useState(false);

   const signalingRef = useRef<SignalingHelper | null>(null);
   const peersRef = useRef<Map<string, WebRTCHelper>>(new Map());
   const localFilesRef = useRef<BoardFile[]>([]);
   const blobMapRef = useRef<Map<string, Blob>>(new Map());
   const iceServersRef = useRef<RTCIceServer[]>([{ urls: "stun:stun.l.google.com:19302" }]);
   const activatedRef = useRef(false);

   const pushManifest = useCallback((files: BoardFile[], blobs: Map<string, Blob>) => {
      localFilesRef.current = files;
      blobs.forEach((blob, id) => blobMapRef.current.set(id, blob));
      peersRef.current.forEach((rtc) => rtc.pushManifest(files));
   }, []);

   const activate = useCallback(async (username: string, peerId: string) => {
      if (activatedRef.current) return;
      activatedRef.current = true;

      getIceServers().then((ice) => { iceServersRef.current = ice; }).catch(() => {});

      try {
         const stored = await loadFiles(username);
         stored.forEach(({ file, blob }) => blobMapRef.current.set(file.id, blob));
         localFilesRef.current = stored.map(({ file }) => file);
      } catch (ex) {
         console.error("[Host] loadFiles failed", ex);
      }

      const signaling = new SignalingHelper(async (msg: SignalingMessage) => {
         if (msg.type === "offer") {
            if (peersRef.current.has(msg.fromId)) return;
            const rtc = new WebRTCHelper(
               async (fileId) => blobMapRef.current.get(fileId) ?? null,
               () => {}, () => {}, () => {}, () => {},
               (connected) => {
                  setViewerCount((n) => connected ? n + 1 : Math.max(0, n - 1));
                  if (!connected) { peersRef.current.delete(msg.fromId); rtc.destroy(); }
               },
               iceServersRef.current,
            );
            rtc.pushManifest(localFilesRef.current);
            peersRef.current.set(msg.fromId, rtc);
            const answer = await rtc.handleOffer(msg.payload, (c) =>
               signaling.send({ type: "ice-candidate", targetId: msg.fromId, payload: c })
            );
            signaling.send({ type: "answer", targetId: msg.fromId, payload: answer });
         }
         if (msg.type === "ice-candidate") {
            await peersRef.current.get(msg.fromId)?.handleIceCandidate(msg.payload);
         }
      });

      signalingRef.current = signaling;
      signaling.connect(peerId);
      setIsActive(true);
   }, []);

   useEffect(() => {
      return () => {
         signalingRef.current?.disconnect();
         peersRef.current.forEach((rtc) => rtc.destroy());
         peersRef.current.clear();
      };
   }, []);

   return (
      <HostContext.Provider value={{ viewerCount, isActive, activate, pushManifest }}>
         {children}
      </HostContext.Provider>
   );
}

export const useHost = () => useContext(HostContext);
