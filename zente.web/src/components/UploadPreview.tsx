import { useState, useEffect, useRef } from "react";

interface Props {
   file: File;
   onConfirm: (caption: string) => void;
   onCancel: () => void;
}

export function UploadPreview({ file, onConfirm, onCancel }: Props) {
   const [caption, setCaption] = useState("");
   const [previewUrl, setPreviewUrl] = useState<string | null>(null);
   const textareaRef = useRef<HTMLTextAreaElement>(null);

   useEffect(() => {
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
      return () => URL.revokeObjectURL(url);
   }, [file]);

   useEffect(() => {
      function onKey(e: KeyboardEvent) {
         if (e.key === "Escape") onCancel();
      }
      document.addEventListener("keydown", onKey);
      return () => document.removeEventListener("keydown", onKey);
   }, [onCancel]);

   const uploadedAt = new Date();
   const dateLabel = uploadedAt.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });

   return (
      <div className="upload-preview-overlay" onClick={onCancel}>
         <div className="upload-preview-modal" onClick={(e) => e.stopPropagation()}>
            <div className="upload-preview-img-wrap">
               {previewUrl && <img src={previewUrl} className="upload-preview-img" alt="" />}
            </div>
            <div className="upload-preview-body">
               <p className="upload-preview-filename">{file.name}</p>
               <p className="upload-preview-date">{dateLabel}</p>
               <textarea
                  ref={textareaRef}
                  className="upload-preview-caption"
                  placeholder="Add a caption…"
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  rows={4}
                  maxLength={280}
                  autoFocus
               />
               <p className="upload-preview-charcount">{caption.length}/280</p>
               <div className="upload-preview-actions">
                  <button className="btn btn--secondary btn--sm" onClick={onCancel}>Cancel</button>
                  <button className="btn btn--primary btn--sm" onClick={() => onConfirm(caption.trim())}>Upload</button>
               </div>
            </div>
         </div>
      </div>
   );
}
