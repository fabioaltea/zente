import { SignalingHelper, SignalingMessage } from "../hooks/useSignaling";
import { WebRTCHelper, BoardFile } from "../hooks/useWebRTC";
import type { Peer } from "./PeerApiHelper";

export interface RemoteManifestEvent {
   peerId: string;
   username: string;
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
   username: string;
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
   username: string;
   role: "viewer" | "host";
}

export class PeerConnectionManager {
   private connections = new Map<string, ConnectionEntry>();
   private localFiles: BoardFile[] = [];
   private localBlobs = new Map<string, Blob>();
   private destroyed = false;

   constructor(
      private readonly signaling: SignalingHelper,
      private readonly iceServers: RTCIceServer[],
      private readonly callbacks: ManagerCallbacks,
   ) {}

   handleSignalingMessage(msg: SignalingMessage): void {
      if (this.destroyed) return;
      if (msg.type === "offer") {
         this.handleIncomingOffer(msg.fromId, msg.payload);
         return;
      }
      if (msg.type === "answer") {
         this.connections.get(msg.fromId)?.helper.handleAnswer(msg.payload).catch((ex) =>
            console.error("[Manager] handleAnswer failed", ex),
         );
         return;
      }
      if (msg.type === "ice-candidate") {
         this.connections.get(msg.fromId)?.helper.handleIceCandidate(msg.payload).catch((ex) =>
            console.error("[Manager] handleIceCandidate failed", ex),
         );
         return;
      }
   }

   connectAsViewer(peer: Peer): void {
      if (this.destroyed) return;
      if (this.connections.has(peer.peer_id)) return;

      const helper = this.buildHelper(peer.peer_id, peer.username, "viewer");
      this.connections.set(peer.peer_id, { helper, username: peer.username, role: "viewer" });

      helper.createOffer((c) =>
         this.signaling.send({ type: "ice-candidate", targetId: peer.peer_id, payload: c }),
      ).then((offer) => {
         this.signaling.send({ type: "offer", targetId: peer.peer_id, payload: offer });
      }).catch((ex) => {
         console.error("[Manager] createOffer failed", ex);
         this.dropConnection(peer.peer_id);
      });
   }

   private handleIncomingOffer(fromId: string, payload: RTCSessionDescriptionInit): void {
      if (this.connections.has(fromId)) {
         console.warn("[Manager] duplicate offer from", fromId);
         return;
      }
      const username = `peer:${fromId.slice(0, 8)}`;
      const helper = this.buildHelper(fromId, username, "host");
      this.connections.set(fromId, { helper, username, role: "host" });
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

   private buildHelper(peerId: string, username: string, role: "viewer" | "host"): WebRTCHelper {
      return new WebRTCHelper(
         async (fileId) => this.localBlobs.get(fileId) ?? null,
         (files) => this.callbacks.onRemoteManifest({ peerId, username, files }),
         (fileId, url, name) => this.callbacks.onFileDownloaded({ peerId, fileId, url, name }),
         (fileId) => this.callbacks.onFileDownloading(peerId, fileId),
         (fileId, received, total) => this.callbacks.onFileProgress({ peerId, fileId, received, total }),
         (connected) => {
            const ev: PeerConnectionState = { peerId, username, connected };
            if (role === "viewer") this.callbacks.onViewerConnectionChange(ev);
            else this.callbacks.onHostConnectionChange(ev);
            if (!connected) this.dropConnection(peerId);
         },
         this.iceServers,
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
