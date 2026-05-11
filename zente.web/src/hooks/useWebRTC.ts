const CHUNK_SIZE = 16 * 1024;

function formatBytes(bytes: number): string {
   if (bytes < 1024) return `${bytes.toFixed(0)} B`;
   if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
   return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export interface BoardFile {
   id: string;
   name: string;
   size: number;
   mimeType: string;
   thumbnail: string | null;
   caption?: string;
   uploadedAt?: number; // ms timestamp
}

export interface RemoteFile extends BoardFile {
   downloading: boolean;
   progress: number; // 0–1 during download, 1 when done
   url: string | null;
}

type DCMessage = { type: "manifest"; files: BoardFile[] } | { type: "request"; fileId: string } | { type: "file-start"; fileId: string; name: string; size: number; mimeType: string } | { type: "file-end"; fileId: string };

export class WebRTCHelper {
   private pc: RTCPeerConnection | null = null;
   private dc: RTCDataChannel | null = null;
   private _isConnected = false;
   private localFiles: BoardFile[] = [];
   private iceCandidateQueue: RTCIceCandidateInit[] = [];
   private incoming: {
      fileId: string;
      name: string;
      size: number;
      mimeType: string;
      chunks: ArrayBuffer[];
      received: number;
      startTime: number;
   } | null = null;

   private readonly getFileBlob: (fileId: string) => Promise<Blob | null>;
   private readonly onRemoteManifest: (files: BoardFile[]) => void;
   private readonly onFileDownloaded: (fileId: string, url: string, name: string) => void;
   private readonly onFileDownloading: (fileId: string) => void;
   private readonly onFileProgress: (fileId: string, received: number, total: number) => void;
   private readonly onConnectionChange: (connected: boolean) => void;
   private iceCandidateCounts = { host: 0, srflx: 0, relay: 0, prflx: 0, other: 0 };

   constructor(
      getFileBlob: (fileId: string) => Promise<Blob | null>,
      onRemoteManifest: (files: BoardFile[]) => void,
      onFileDownloaded: (fileId: string, url: string, name: string) => void,
      onFileDownloading: (fileId: string) => void,
      onFileProgress: (fileId: string, received: number, total: number) => void,
      onConnectionChange: (connected: boolean) => void,
      private readonly iceServers: RTCIceServer[],
      private readonly tag: string = "?",
   ) {
      this.getFileBlob = getFileBlob;
      this.onRemoteManifest = onRemoteManifest;
      this.onFileDownloaded = onFileDownloaded;
      this.onFileDownloading = onFileDownloading;
      this.onFileProgress = onFileProgress;
      this.onConnectionChange = onConnectionChange;
   }

   get isConnected(): boolean {
      return this._isConnected;
   }

   private setConnected(value: boolean): void {
      this._isConnected = value;
      try {
         this.onConnectionChange(value);
      } catch (ex) {
         console.error("[WebRTC] onConnectionChange callback failed", ex);
      }
   }

   private sendJSON(msg: DCMessage): void {
      try {
         if (!this.dc || this.dc.readyState !== "open") {
            console.warn(`[DC ${this.tag}] sendJSON skipped — channel not open`);
            return;
         }
         const json = JSON.stringify(msg);
         const max = (this.pc as RTCPeerConnection & { sctp?: { maxMessageSize?: number } }).sctp?.maxMessageSize;
         console.log(`[DC ${this.tag}] send type=${msg.type} size=${json.length}${max ? ` maxMessageSize=${max}` : ""}`);
         if (max && json.length > max) {
            console.error(`[DC ${this.tag}] message size ${json.length} exceeds maxMessageSize ${max} — drop`);
            return;
         }
         this.dc.send(json);
      } catch (ex) {
         console.error(`[DC ${this.tag}] sendJSON failed`, ex);
      }
   }

   private bindDataChannel(dc: RTCDataChannel): void {
      try {
         this.dc = dc;
         dc.binaryType = "arraybuffer";

         dc.onopen = () => {
            try {
               console.log(`[DC ${this.tag}] open — sending manifest (files=${this.localFiles.length})`);
               this.setConnected(true);
               this.sendJSON({ type: "manifest", files: this.localFiles });
            } catch (ex) {
               console.error(`[DC ${this.tag}] onopen error`, ex);
            }
         };

         dc.onclose = () => {
            console.log(`[DC ${this.tag}] close`);
            this.setConnected(false);
         };

         dc.onerror = (ev) => {
            console.error(`[DC ${this.tag}] error`, ev);
         };

         dc.onmessage = async (ev) => {
            try {
               if (typeof ev.data === "string") {
                  const msg = JSON.parse(ev.data) as DCMessage;
                  console.log(`[DC ${this.tag}] msg type=${msg.type}`);

                  if (msg.type === "manifest") {
                     console.log(`[DC ${this.tag}] manifest received files=${msg.files.length}`);
                     this.onRemoteManifest(msg.files);
                  } else if (msg.type === "request") {
                     await this.handleFileRequest(msg.fileId, dc);
                  } else if (msg.type === "file-start") {
                     this.incoming = {
                        fileId: msg.fileId,
                        name: msg.name,
                        size: msg.size,
                        mimeType: msg.mimeType,
                        chunks: [],
                        received: 0,
                        startTime: performance.now(),
                     };
                     this.onFileDownloading(msg.fileId);
                  } else if (msg.type === "file-end") {
                     this.assembleFile();
                  }
               } else {
                  this.receiveChunk(ev.data as ArrayBuffer);
               }
            } catch (ex) {
               console.error("[DC] onmessage error", ex);
            }
         };
      } catch (ex) {
         console.error("[WebRTC] bindDataChannel failed", ex);
      }
   }

   private async handleFileRequest(fileId: string, dc: RTCDataChannel): Promise<void> {
      try {
         const blob = await this.getFileBlob(fileId);
         if (!blob) {
            console.warn("[DC] blob not found for", fileId);
            return;
         }
         const localFile = this.localFiles.find((f) => f.id === fileId);
         if (!localFile) {
            console.warn("[DC] localFile not found for", fileId);
            return;
         }

         this.sendJSON({ type: "file-start", fileId, name: localFile.name, size: localFile.size, mimeType: localFile.mimeType });

         let offset = 0;
         const ab = await blob.arrayBuffer();
         while (offset < ab.byteLength) {
            const chunk = ab.slice(offset, offset + CHUNK_SIZE);
            while (dc.bufferedAmount > 1024 * 1024) {
               await new Promise<void>((r) => setTimeout(r, 20));
            }
            dc.send(chunk);
            offset += chunk.byteLength;
         }

         this.sendJSON({ type: "file-end", fileId });
      } catch (ex) {
         console.error("[DC] handleFileRequest failed for", fileId, ex);
      }
   }

   private assembleFile(): void {
      try {
         const inc = this.incoming;
         if (!inc) {
            console.warn("[DC] file-end but no incoming");
            return;
         }
         const elapsedMs = performance.now() - inc.startTime;
         const elapsedSec = elapsedMs / 1000;
         const speedBps = elapsedSec > 0 ? inc.received / elapsedSec : 0;
         console.log(`[Download] ${inc.name} | ${formatBytes(inc.received)} in ${elapsedSec.toFixed(2)}s | speed: ${formatBytes(speedBps)}/s`);
         const blob = new Blob(inc.chunks, { type: inc.mimeType });
         const url = URL.createObjectURL(blob);
         this.onFileDownloaded(inc.fileId, url, inc.name);
         this.incoming = null;
      } catch (ex) {
         console.error("[DC] assembleFile failed", ex);
      }
   }

   private receiveChunk(data: ArrayBuffer): void {
      try {
         if (!this.incoming) {
            console.warn("[DC] binary chunk but no incoming");
            return;
         }
         this.incoming.chunks.push(data);
         this.incoming.received += data.byteLength;
         this.onFileProgress(this.incoming.fileId, this.incoming.received, this.incoming.size);
      } catch (ex) {
         console.error("[DC] receiveChunk failed", ex);
      }
   }

   private createPC(onIceCandidate: (c: RTCIceCandidateInit) => void): RTCPeerConnection {
      try {
         console.log(`[PC ${this.tag}] new RTCPeerConnection iceServers=${this.iceServers.length}`);
         const pc = new RTCPeerConnection({ iceServers: this.iceServers });
         this.pc = pc;
         pc.onicecandidate = (ev) => {
            try {
               if (!ev.candidate) {
                  console.log(`[PC ${this.tag}] ICE gathering complete (host=${this.iceCandidateCounts.host} srflx=${this.iceCandidateCounts.srflx} relay=${this.iceCandidateCounts.relay} prflx=${this.iceCandidateCounts.prflx})`);
                  return;
               }
               const type = ev.candidate.type ?? "other";
               if (type in this.iceCandidateCounts) (this.iceCandidateCounts as Record<string, number>)[type]++;
               else this.iceCandidateCounts.other++;
               onIceCandidate(ev.candidate.toJSON());
            } catch (ex) {
               console.error(`[PC ${this.tag}] onicecandidate callback failed`, ex);
            }
         };
         pc.ondatachannel = (ev) => {
            console.log(`[PC ${this.tag}] ondatachannel label=${ev.channel.label}`);
            this.bindDataChannel(ev.channel);
         };
         pc.oniceconnectionstatechange = () => {
            console.log(`[PC ${this.tag}] iceConnectionState=${pc.iceConnectionState}`);
            if (pc.iceConnectionState === "failed") {
               console.error(`[PC ${this.tag}] ICE FAILED — no working candidate pair. host=${this.iceCandidateCounts.host} srflx=${this.iceCandidateCounts.srflx} relay=${this.iceCandidateCounts.relay}. If both peers have relay=0 → TURN not reachable.`);
            }
         };
         pc.onicegatheringstatechange = () => {
            console.log(`[PC ${this.tag}] iceGatheringState=${pc.iceGatheringState}`);
         };
         pc.onsignalingstatechange = () => {
            console.log(`[PC ${this.tag}] signalingState=${pc.signalingState}`);
         };
         pc.onconnectionstatechange = () => {
            console.log(`[PC ${this.tag}] connectionState=${pc.connectionState}`);
            if (pc.connectionState === "disconnected" || pc.connectionState === "failed" || pc.connectionState === "closed") {
               this.setConnected(false);
            }
         };
         return pc;
      } catch (ex) {
         console.error(`[WebRTC ${this.tag}] createPC failed`, ex);
         throw ex;
      }
   }

   async createOffer(onIceCandidate: (c: RTCIceCandidateInit) => void): Promise<RTCSessionDescriptionInit> {
      try {
         const pc = this.createPC(onIceCandidate);
         const dc = pc.createDataChannel("board");
         this.bindDataChannel(dc);
         const offer = await pc.createOffer();
         await pc.setLocalDescription(offer);
         return offer;
      } catch (ex) {
         console.error("[WebRTC] createOffer failed", ex);
         throw ex;
      }
   }

   async handleAnswer(answer: RTCSessionDescriptionInit): Promise<void> {
      try {
         await this.pc?.setRemoteDescription(answer);
         await this.drainIceCandidateQueue();
      } catch (ex) {
         console.error("[WebRTC] handleAnswer failed", ex);
      }
   }

   async handleOffer(offer: RTCSessionDescriptionInit, onIceCandidate: (c: RTCIceCandidateInit) => void): Promise<RTCSessionDescriptionInit> {
      try {
         const pc = this.createPC(onIceCandidate);
         await pc.setRemoteDescription(offer);
         await this.drainIceCandidateQueue();
         const answer = await pc.createAnswer();
         await pc.setLocalDescription(answer);
         return answer;
      } catch (ex) {
         console.error("[WebRTC] handleOffer failed", ex);
         throw ex;
      }
   }

   private async drainIceCandidateQueue(): Promise<void> {
      while (this.iceCandidateQueue.length > 0) {
         const c = this.iceCandidateQueue.shift()!;
         await this.pc?.addIceCandidate(c).catch((ex) => console.error("[WebRTC] queued ICE failed", ex));
      }
   }

   async handleIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
      try {
         if (!this.pc?.remoteDescription) {
            this.iceCandidateQueue.push(candidate);
            return;
         }
         await this.pc.addIceCandidate(candidate);
      } catch (ex) {
         console.error("[WebRTC] handleIceCandidate failed", ex);
      }
   }

   requestFile(fileId: string): void {
      try {
         this.sendJSON({ type: "request", fileId });
      } catch (ex) {
         console.error("[WebRTC] requestFile failed", ex);
      }
   }

   pushManifest(files: BoardFile[]): void {
      try {
         this.localFiles = files;
         if (this.dc?.readyState === "open") {
            this.sendJSON({ type: "manifest", files });
         }
      } catch (ex) {
         console.error("[WebRTC] pushManifest failed", ex);
      }
   }

   destroy(): void {
      try {
         this.dc?.close();
         this.pc?.close();
         this.dc = null;
         this.pc = null;
      } catch (ex) {
         console.error("[WebRTC] destroy failed", ex);
      }
   }
}
