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
