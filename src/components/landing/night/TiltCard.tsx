import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/cn";

/** A still plan card on the night ground. (It used to tilt toward the pointer; removed for performance.) */
export function TiltCard({
  children,
  className,
  style,
  labelledBy,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** The id of the card's heading. */
  labelledBy?: string;
}) {
  return (
    <article aria-labelledby={labelledBy} style={style} className={cn("night-glass relative flex h-full flex-col", className)}>
      {children}
    </article>
  );
}
