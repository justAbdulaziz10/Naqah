import type { CSSProperties } from "react";
import { CamelMarkRef } from "@/components/brand/CamelMark";
import "./naqah3d.css";

/** How many copies of the mark stack into its depth. The front one is the approved mark, unchanged. */
const DEPTH = 14;

/**
 * The NAQAH camel standing in three dimensions: the approved mark, untouched, with depth built from stacked
 * copies behind it. Pure CSS: it turns once into place on arrival, eases a little toward the reader on hover,
 * and otherwise stands still, so it costs nothing after the first second.
 */
export function NaqahMark3D({ className = "" }: { className?: string }) {
  return (
    <div aria-hidden className={`naqah3d ${className}`}>
      <span className="naqah3d-halo" />
      <span className="naqah3d-ground" />
      <div className="naqah3d-body">
        {Array.from({ length: DEPTH }, (_, index) => {
          const depth = DEPTH - 1 - index; // Back copies first, the face last.
          return (
            <span key={depth} className="naqah3d-layer" style={{ "--d": depth } as CSSProperties} data-face={depth === 0 ? "" : undefined}>
              <CamelMarkRef className="h-full w-full" />
            </span>
          );
        })}
      </div>
    </div>
  );
}
