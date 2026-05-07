const WS_URL = import.meta.env.VITE_WS_URL as string;

export type SignalingMessage =
   | { type: "registered"; peerId: string }
   | { type: "offer"; fromId: string; payload: RTCSessionDescriptionInit }
   | { type: "answer"; fromId: string; payload: RTCSessionDescriptionInit }
   | { type: "ice-candidate"; fromId: string; payload: RTCIceCandidateInit }
   | { type: "error"; code: string; message: string };

export class SignalingHelper {
   private ws: WebSocket | null = null;
   private readonly onMessage: (msg: SignalingMessage) => void;

   constructor(onMessage: (msg: SignalingMessage) => void) {
      this.onMessage = onMessage;
   }

   connect(peerId: string): void {
      try {
         const ws = new WebSocket(WS_URL);
         this.ws = ws;

         ws.onopen = () => {
            try {
               ws.send(JSON.stringify({ type: "register", peerId }));
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
      try {
         this.ws?.close();
         this.ws = null;
      } catch (ex) {
         console.error("[Signaling] disconnect failed", ex);
      }
   }
}
