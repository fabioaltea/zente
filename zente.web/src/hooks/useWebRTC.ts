const CHUNK_SIZE = 16 * 1024;

const RTC_CONFIG: RTCConfiguration = {
   iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

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
   thumbnail: string | null; // base64 data URL or null
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

   constructor(
      getFileBlob: (fileId: string) => Promise<Blob | null>,
      onRemoteManifest: (files: BoardFile[]) => void,
      onFileDownloaded: (fileId: string, url: string, name: string) => void,
      onFileDownloading: (fileId: string) => void,
      onFileProgress: (fileId: string, received: number, total: number) => void,
      onConnectionChange: (connected: boolean) => void,
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
            console.warn("[DC] sendJSON skipped — channel not open");
            return;
         }
         this.dc.send(JSON.stringify(msg));
      } catch (ex) {
         console.error("[DC] sendJSON failed", ex);
      }
   }

   private bindDataChannel(dc: RTCDataChannel): void {
      try {
         this.dc = dc;
         dc.binaryType = "arraybuffer";

         dc.onopen = () => {
            try {
               this.setConnected(true);
               this.sendJSON({ type: "manifest", files: this.localFiles });
            } catch (ex) {
               console.error("[DC] onopen error", ex);
            }
         };

         dc.onclose = () => {
            this.setConnected(false);
         };

         dc.onerror = (ev) => {
            console.error("[DC] error", ev);
         };

         dc.onmessage = async (ev) => {
            try {
               if (typeof ev.data === "string") {
                  const msg = JSON.parse(ev.data) as DCMessage;

                  if (msg.type === "manifest") {
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
         const pc = new RTCPeerConnection(RTC_CONFIG);
         this.pc = pc;
         pc.onicecandidate = (ev) => {
            try {
               if (ev.candidate) onIceCandidate(ev.candidate.toJSON());
            } catch (ex) {
               console.error("[PC] onicecandidate callback failed", ex);
            }
         };
         pc.ondatachannel = (ev) => {
            this.bindDataChannel(ev.channel);
         };
         pc.onconnectionstatechange = () => {
            if (pc.connectionState === "disconnected" || pc.connectionState === "failed" || pc.connectionState === "closed") {
               this.setConnected(false);
            }
         };
         return pc;
      } catch (ex) {
         console.error("[WebRTC] createPC failed", ex);
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

   async handleOffer(offer: RTCSessionDescriptionInit, onIceCandidate: (c: RTCIceCandidateInit) => void): Promise<RTCSessionDescriptionInit> {
      try {
         const pc = this.createPC(onIceCandidate);
         await pc.setRemoteDescription(offer);
         const answer = await pc.createAnswer();
         await pc.setLocalDescription(answer);
         return answer;
      } catch (ex) {
         console.error("[WebRTC] handleOffer failed", ex);
         throw ex;
      }
   }

   async handleAnswer(answer: RTCSessionDescriptionInit): Promise<void> {
      try {
         await this.pc?.setRemoteDescription(answer);
      } catch (ex) {
         console.error("[WebRTC] handleAnswer failed", ex);
      }
   }

   async handleIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
      try {
         await this.pc?.addIceCandidate(candidate);
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
}
