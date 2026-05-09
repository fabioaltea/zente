import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
   variant?: Variant;
   size?: Size;
   loading?: boolean;
   children: ReactNode;
}

export function Button({
   variant = "primary",
   size = "md",
   loading = false,
   disabled,
   className = "",
   children,
   ...props
}: ButtonProps) {
   const cls = ["btn", `btn--${variant}`, `btn--${size}`, className]
      .filter(Boolean)
      .join(" ");

   return (
      <button className={cls} disabled={disabled || loading} {...props}>
         {loading && <span className="btn__spinner" aria-hidden />}
         <span className={loading ? "btn__label btn__label--hidden" : "btn__label"}>{children}</span>
      </button>
   );
}
