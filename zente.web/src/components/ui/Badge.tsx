import type { ReactNode } from "react";

type Variant = "default" | "success" | "warning" | "error" | "info";

interface BadgeProps {
   variant?: Variant;
   children: ReactNode;
   className?: string;
}

export function Badge({ variant = "default", children, className = "" }: BadgeProps) {
   return <span className={`badge badge--${variant} ${className}`}>{children}</span>;
}
