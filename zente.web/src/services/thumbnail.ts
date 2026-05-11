export function makeThumbnail(file: File): Promise<string | null> {
   return new Promise((resolve) => {
      if (!file.type.startsWith("image/")) { resolve(null); return; }
      const reader = new FileReader();
      reader.onerror = () => resolve(null);
      reader.onload = (ev) => {
         const img = new Image();
         img.onerror = () => resolve(null);
         img.onload = () => {
            try {
               const canvas = document.createElement("canvas");
               const MAX = 240;
               const ratio = Math.min(MAX / img.width, MAX / img.height, 1);
               canvas.width = Math.round(img.width * ratio);
               canvas.height = Math.round(img.height * ratio);
               const ctx = canvas.getContext("2d");
               if (!ctx) { resolve(null); return; }
               ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
               const dataUrl = canvas.toDataURL("image/webp", 0.7);
               console.log(`[thumb] generated ${dataUrl.length} bytes (${canvas.width}x${canvas.height})`);
               resolve(dataUrl);
            } catch {
               resolve(null);
            }
         };
         img.src = ev.target!.result as string;
      };
      reader.readAsDataURL(file);
   });
}
