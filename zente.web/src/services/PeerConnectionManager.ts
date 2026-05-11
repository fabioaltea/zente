import { SignalingHelper, SignalingMessage } from "../hooks/useSignaling";
import { WebRTCHelper, BoardFile } from "../hooks/useWebRTC";
import type { Peer } from "./PeerApiHelper";

export interface RemoteManifestEvent {
   peerId: string;
   files: BoardFile[];
}

export interface FileProgressEvent {
   peerId: string;
   fileId: string;
   received: number;
   total: number;
}

export interface FileDownloadedEvent {
   peerId: string;
   fileId: string;
   url: string;
   name: string;
}

export interface PeerConnectionState {
   peerId: string;
   connected: boolean;
}

export interface ManagerCallbacks {
   onRemoteManifest: (ev: RemoteManifestEvent) => void;
   onFileDownloaded: (ev: FileDownloadedEvent) => void;
   onFileDownloading: (peerId: string, fileId: string) => void;
   onFileProgress: (ev: FileProgressEvent) => void;
   onViewerConnectionChange: (state: PeerConnectionState) => void;
   onHostConnectionChange: (state: PeerConnectionState) => void;
}

interface ConnectionEntry {
   helper: WebRTCHelper;
   role: "viewer" | "host";
}

export class PeerConnectionManager {
   private connections = new Map<string, ConnectionEntry>();
   private localFiles: BoardFile[] = [];
   private localBlobs = new Map<string, Blob>();
   private knownUsernames = new Map<string, string>();
   private destroyed = false;

   constructor(
      private readonly signaling: SignalingHelper,
      private readonly iceServers: RTCIceServer[],
      private readonly selfPeerId: string,
      private readonly callbacks: ManagerCallbacks,
   ) {}

   learnPeers(peers: Peer[]): void {
      peers.forEach((p) => this.knownUsernames.set(p.peer_id, p.username));
   }

   getUsername(peerId: string): string | undefined {
      return this.knownUsernames.get(peerId);
   }

   handleSignalingMessage(msg: SignalingMessage): void {
      if (this.destroyed) return;
      if (msg.type === "offer") {
         console.log(`[Manager] offer received fromId=${msg.fromId.slice(0, 8)}`);
         this.handleIncomingOffer(msg.fromId, msg.payload);
         return;
      }
      if (msg.type === "answer") {
         const entry = this.connections.get(msg.fromId);
         console.log(`[Manager] answer received fromId=${msg.fromId.slice(0, 8)} known=${!!entry}`);
         entry?.helper.handleAnswer(msg.payload).catch((ex) =>
            console.error("[Manager] handleAnswer failed", ex),
         );
         return;
      }
      if (msg.type === "ice-candidate") {
         const entry = this.connections.get(msg.fromId);
         if (!entry) console.warn(`[Manager] ICE candidate for unknown peer ${msg.fromId.slice(0, 8)}`);
         entry?.helper.handleIceCandidate(msg.payload).catch((ex) =>
            console.error("[Manager] handleIceCandidate failed", ex),
         );
         return;
      }
   }

   connectAsViewer(peer: Peer): void {
      if (this.destroyed) return;
      if (this.connections.has(peer.peer_id)) {
         console.log(`[Manager] connectAsViewer skipped — already connected to ${peer.username} (${peer.peer_id.slice(0, 8)})`);
         return;
      }
      if (this.selfPeerId >= peer.peer_id) {
         console.log(`[Manager] connectAsViewer skipped — lex order, waiting for offer from ${peer.username} (${peer.peer_id.slice(0, 8)})`);
         return;
      }

      console.log(`[Manager] connectAsViewer ${peer.username} (${peer.peer_id.slice(0, 8)})`);
      this.knownUsernames.set(peer.peer_id, peer.username);
      const helper = this.buildHelper(peer.peer_id, "viewer");
      this.connections.set(peer.peer_id, { helper, role: "viewer" });
      helper.pushManifest(this.localFiles);

      helper.createOffer((c) =>
         this.signaling.send({ type: "ice-candidate", targetId: peer.peer_id, payload: c }),
      ).then((offer) => {
         console.log(`[Manager] offer sent to ${peer.username}`);
         this.signaling.send({ type: "offer", targetId: peer.peer_id, payload: offer });
      }).catch((ex) => {
         console.error(`[Manager] createOffer failed for ${peer.username}`, ex);
         this.dropConnection(peer.peer_id);
      });
   }

   private handleIncomingOffer(fromId: string, payload: RTCSessionDescriptionInit): void {
      if (this.connections.has(fromId)) {
         console.warn("[Manager] duplicate offer from", fromId);
         return;
      }
      if (!this.knownUsernames.has(fromId)) {
         console.warn(`[Manager] incoming offer from unknown peerId=${fromId.slice(0, 8)} — username will resolve on next poll`);
      }
      const helper = this.buildHelper(fromId, "host");
      this.connections.set(fromId, { helper, role: "host" });
      helper.pushManifest(this.localFiles);

      helper.handleOffer(payload, (c) =>
         this.signaling.send({ type: "ice-candidate", targetId: fromId, payload: c }),
      ).then((answer) => {
         this.signaling.send({ type: "answer", targetId: fromId, payload: answer });
      }).catch((ex) => {
         console.error("[Manager] handleOffer failed", ex);
         this.dropConnection(fromId);
      });
   }

   private buildHelper(peerId: string, role: "viewer" | "host"): WebRTCHelper {
      const tag = `${role}:${this.knownUsernames.get(peerId) ?? peerId.slice(0, 8)}`;
      return new WebRTCHelper(
         async (fileId) => this.localBlobs.get(fileId) ?? null,
         (files) => this.callbacks.onRemoteManifest({ peerId, files }),
         (fileId, url, name) => this.callbacks.onFileDownloaded({ peerId, fileId, url, name }),
         (fileId) => this.callbacks.onFileDownloading(peerId, fileId),
         (fileId, received, total) => this.callbacks.onFileProgress({ peerId, fileId, received, total }),
         (connected) => {
            const ev: PeerConnectionState = { peerId, connected };
            if (role === "viewer") this.callbacks.onViewerConnectionChange(ev);
            else this.callbacks.onHostConnectionChange(ev);
            if (!connected) this.dropConnection(peerId);
         },
         this.iceServers,
         tag,
      );
   }

   private dropConnection(peerId: string): void {
      const entry = this.connections.get(peerId);
      if (!entry) return;
      entry.helper.destroy();
      this.connections.delete(peerId);
   }

   pushManifest(files: BoardFile[], blobs: Map<string, Blob>): void {
      this.localFiles = files;
      this.localBlobs = blobs;
      this.connections.forEach((entry) => entry.helper.pushManifest(files));
   }

   requestFile(peerId: string, fileId: string): void {
      this.connections.get(peerId)?.helper.requestFile(fileId);
   }

   disconnectPeer(peerId: string): void {
      this.dropConnection(peerId);
   }

   listConnectedPeers(): string[] {
      return Array.from(this.connections.keys());
   }

   destroy(): void {
      this.destroyed = true;
      this.connections.forEach((entry) => entry.helper.destroy());
      this.connections.clear();
   }
}
