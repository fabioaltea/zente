import type { InputHTMLAttributes } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
   label?: string;
   error?: string;
   helper?: string;
}

export function Input({ label, error, helper, id, className = "", ...props }: InputProps) {
   const inputId = id ?? label?.toLowerCase().replace(/\s+/g, "-");

   return (
      <div className="input-group">
         {label && (
            <label className="input-label" htmlFor={inputId}>
               {label}
            </label>
         )}
         <input
            id={inputId}
            className={["text-input", error ? "text-input--error" : "", className].filter(Boolean).join(" ")}
            {...props}
         />
         {error && <span className="input-error">{error}</span>}
         {!error && helper && <span className="input-helper">{helper}</span>}
      </div>
   );
}
