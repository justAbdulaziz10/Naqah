import { useId } from "react";
import { cn } from "@/lib/cn";

/*
 * Original heritage geometry for NAQAH, inspired by the bands of Al Sadu weaving
 * (teeth, diamonds, stepped lozenges). Not a copy of any published artwork.
 * Each strip uses a very long viewBox with `slice`, so the pattern keeps its
 * proportions at any width and is cropped (never squashed). All shapes are
 * symmetric along the reading axis, so nothing needs RTL mirroring.
 */

type Tone = "light" | "dark";

const TONES = {
  light: { rail: "fill-brown", ground: "fill-sand", tooth: "fill-brown", gem: "fill-cream", core: "fill-crimson-editorial" },
  dark: { rail: "fill-gold", ground: "fill-brown", tooth: "fill-gold", gem: "fill-sand-soft", core: "fill-crimson-editorial" },
} as const;

/** React ids may contain characters that break inside `url(#...)`; keep only safe ones. */
const patternId = (raw: string) => `woven-${raw.replace(/[^a-zA-Z0-9_-]/g, "")}`;

const svgProps = { "aria-hidden": true, focusable: false, xmlns: "http://www.w3.org/2000/svg" } as const;

/** Rows of a stepped (pixel-woven) diamond of radius r cells, as one path. */
function steppedDiamond(cx: number, cy: number, r: number, cell: number) {
  let d = "";
  for (let i = -r; i <= r; i++) {
    const half = (r - Math.abs(i)) * cell + cell / 2;
    d += `M${cx - half} ${cy + i * cell - cell / 2}h${half * 2}v${cell}h${-half * 2}z`;
  }
  return d;
}

const SPAN = 6000; // long axis of the strip viewBox, in px at the default thickness

/**
 * Woven Signature: horizontal band divider. Provisional pending owner approval of the bespoke artwork (handoff §13);
 * public/editorial surfaces only, never on the dashboard (§06).
 */
export function WovenSignature({ className, tone = "light" }: { className?: string; tone?: Tone }) {
  const id = patternId(useId());
  const c = TONES[tone];
  // Tile 32 x 14: rails at top/bottom, a band of upward teeth, every fourth tooth woven as a diamond.
  return (
    <svg
      {...svgProps}
      viewBox={`0 0 ${SPAN} 14`}
      preserveAspectRatio="xMidYMid slice"
      className={cn("block h-3.5 w-full", className)}
    >
      <defs>
        <pattern id={id} width="32" height="14" x={SPAN / 2 - 28} patternUnits="userSpaceOnUse">
          <rect width="32" height="1" className={c.rail} shapeRendering="crispEdges" />
          <rect y="13" width="32" height="1" className={c.rail} shapeRendering="crispEdges" />
          <rect y="2" width="32" height="10" className={c.ground} shapeRendering="crispEdges" />
          <path d="M0 12 4 2 8 12zM8 12 12 2 16 12zM16 12 20 2 24 12z" className={c.tooth} />
          <path d="M28 2 32 7 28 12 24 7z" className={c.tooth} />
          <path d="M28 4 30.4 7 28 10 25.6 7z" className={c.gem} />
          <path d="M28 5.4 29.3 7 28 8.6 26.7 7z" className={c.core} />
        </pattern>
      </defs>
      <rect width={SPAN} height="14" fill={`url(#${id})`} />
    </svg>
  );
}

/**
 * Woven Frame: thin edge strip beside a photograph or editorial block. Provisional pending owner approval of the
 * bespoke artwork (handoff §13); public/editorial surfaces only, never on the dashboard (§06).
 */
export function WovenFrame({
  className,
  tone = "light",
  orientation = "vertical",
}: {
  className?: string;
  tone?: Tone;
  orientation?: "vertical" | "horizontal";
}) {
  const id = patternId(useId());
  const c = TONES[tone];
  const vertical = orientation === "vertical";
  // Tile 10 x 14 drawn vertically: side rails with a chain of diamonds, every other one hollowed.
  const tile = (
    <>
      <rect width="1" height="14" className={c.rail} shapeRendering="crispEdges" />
      <rect x="9" width="1" height="14" className={c.rail} shapeRendering="crispEdges" />
      <path d="M5 1 8 7 5 13 2 7z" className={c.tooth} />
      <path d="M5 4 6.5 7 5 10 3.5 7z" className={c.ground} />
    </>
  );
  return (
    <svg
      {...svgProps}
      viewBox={vertical ? `0 0 10 ${SPAN}` : `0 0 ${SPAN} 10`}
      preserveAspectRatio="xMidYMid slice"
      className={cn("block", vertical ? "h-full w-2.5" : "h-2.5 w-full", className)}
    >
      <defs>
        <pattern
          id={id}
          width={vertical ? 10 : 14}
          height={vertical ? 14 : 10}
          patternUnits="userSpaceOnUse"
          {...(vertical ? { y: SPAN / 2 - 7 } : { x: SPAN / 2 - 7 })}
        >
          {vertical ? tile : <g transform="matrix(0 1 1 0 0 0)">{tile}</g>}
        </pattern>
      </defs>
      <rect width={vertical ? 10 : SPAN} height={vertical ? SPAN : 10} fill={`url(#${id})`} />
    </svg>
  );
}

/**
 * Woven Fragment: a single stepped lozenge for rare accents. Provisional pending owner approval of the bespoke
 * artwork (handoff §13); public/editorial surfaces only, never on the dashboard (§06).
 */
export function WovenFragment({ className, tone = "light" }: { className?: string; tone?: Tone }) {
  const c = TONES[tone];
  // 13 x 13 cell grid (2 units per cell): nested stepped diamonds, a crimson heart, four corner teeth.
  return (
    <svg {...svgProps} viewBox="0 0 26 26" shapeRendering="crispEdges" className={cn("block size-10", className)}>
      <path d={steppedDiamond(13, 13, 6, 2)} className={c.tooth} />
      <path d={steppedDiamond(13, 13, 4, 2)} className={c.ground} />
      <path d={steppedDiamond(13, 13, 3, 2)} className={c.tooth} />
      <path d={steppedDiamond(13, 13, 1, 2)} className={c.core} />
      <path d="M0 0h4v2H2v2H0zM26 0h-4v2h2v2h2zM0 26h4v-2H2v-2H0zM26 26h-4v-2h2v-2h2z" className={c.rail} />
    </svg>
  );
}
