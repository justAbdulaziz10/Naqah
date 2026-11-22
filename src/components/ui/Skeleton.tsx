import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

/**
 * A quiet placeholder for text or a block that is still loading. Size it with width/height
 * utilities; wrap a group in an element with role="status" and a visually hidden label.
 */
export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return <div aria-hidden className={cn("naqah-skeleton h-4 w-full", className)} {...props} />;
}

/** Three lines of placeholder text, the last one shorter, as a paragraph would be. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div aria-hidden className={cn("flex flex-col gap-2.5", className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={i === lines - 1 ? "w-3/5" : i === 0 ? "w-11/12" : "w-full"} />
      ))}
    </div>
  );
}
