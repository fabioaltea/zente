const WS_URL = (import.meta.env.VITE_WS_URL as string | undefined) ?? "ws://localhost:3000/ws";

export type SignalingMessage =
   | { type: "registered"; peerId: string }
   | { type: "offer"; fromId: string; payload: RTCSessionDescriptionInit }
   | { type: "answer"; fromId: string; payload: RTCSessionDescriptionInit }
   | { type: "ice-candidate"; fromId: string; payload: RTCIceCandidateInit }
   | { type: "error"; code: string; message: string };

export class SignalingHelper {
   private ws: WebSocket | null = null;
   private peerId: string | null = null;
   private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
   private reconnectDelay = 1_000;
   private destroyed = false;
   private readonly onMessage: (msg: SignalingMessage) => void;

   constructor(onMessage: (msg: SignalingMessage) => void) {
      this.onMessage = onMessage;
   }

   connect(peerId: string): void {
      this.peerId = peerId;
      this.reconnectDelay = 1_000;
      this._connect();
   }

   private _connect(): void {
      if (this.destroyed || !this.peerId) return;
      try {
         console.log(`[Signaling] connecting to ${WS_URL} as peerId=${this.peerId}`);
         const ws = new WebSocket(WS_URL);
         this.ws = ws;

         ws.onopen = () => {
            console.log(`[Signaling] WebSocket open — sending register peerId=${this.peerId}`);
            this.reconnectDelay = 1_000;
            try {
               ws.send(JSON.stringify({ type: "register", peerId: this.peerId }));
            } catch (ex) {
               console.error("[Signaling] register failed", ex);
            }
         };

         ws.onmessage = (ev) => {
            try {
               const msg = JSON.parse(ev.data) as SignalingMessage;
               this.onMessage(msg);
            } catch (ex) {
               console.error("[Signaling] message parse failed", ex);
            }
         };

         ws.onerror = (ev) => {
            console.error("[Signaling] WebSocket error", ev);
         };

         ws.onclose = () => {
            if (this.destroyed) return;
            console.warn(`[Signaling] closed, reconnecting in ${this.reconnectDelay}ms`);
            this.reconnectTimer = setTimeout(() => this._connect(), this.reconnectDelay);
            this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30_000);
         };
      } catch (ex) {
         console.error("[Signaling] connect failed", ex);
      }
   }

   send(msg: object): void {
      try {
         if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            console.warn("[Signaling] send skipped — WebSocket not open");
            return;
         }
         this.ws.send(JSON.stringify(msg));
      } catch (ex) {
         console.error("[Signaling] send failed", ex);
      }
   }

   disconnect(): void {
      this.destroyed = true;
      if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
      try {
         this.ws?.close();
         this.ws = null;
      } catch (ex) {
         console.error("[Signaling] disconnect failed", ex);
      }
   }
}
