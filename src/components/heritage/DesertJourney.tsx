import type { CSSProperties } from "react";
import { cn } from "@/lib/cn";

/*
 * Desert Journey artwork (handoff §01, §03, §08). Pure SVG, server-component safe.
 * The parent drives the walk by setting the CSS custom property `--walk` (one stride per 1.0,
 * free to keep growing) and moves the dune planes by their `data-plane` attribute.
 */

const svgProps = { "aria-hidden": true, focusable: false, xmlns: "http://www.w3.org/2000/svg" } as const;

/** Phase of the stride in turns, so `sin()`/`cos()` wrap naturally as `--walk` grows. */
const stride = (phase: string) => `calc(var(--walk, 0) * 1turn + ${phase})`;

/** Rotation about a fixed point in the camel's own 200 x 160 user space. */
const pivot = (x: number, y: number, transform: string): CSSProperties => ({
  transform,
  transformBox: "view-box",
  transformOrigin: `${x}px ${y}px`,
});

/** A tapered limb segment with rounded ends, so joints stay closed while they rotate. */
const segment = (x: number, y0: number, y1: number, w0: number, w1: number) =>
  `M${x - w0 / 2} ${y0}Q${x} ${y0 - w0 * 0.6} ${x + w0 / 2} ${y0}L${x + w1 / 2} ${y1}Q${x} ${y1 + w1 * 0.7} ${x - w1 / 2} ${y1}Z`;

/** The broad, soft pad of a camel's foot, toes forward. */
const pad = (x: number, y: number) => `M${x - 2.6} ${y}Q${x - 2.8} ${y - 3.4} ${x} ${y - 3.8}Q${x + 4.6} ${y - 3.2} ${x + 5} ${y}Z`;

type LegSpec = { x: number; top: number; knee: number; foot: number; w: number; kw: number; swing: number; flex: number; phase: string };

/*
 * Pace gait, as camels walk: both legs on one side move together, the other side half a stride
 * later. The near (left) side starts at a quarter turn so `--walk: 0` is a mid-stride stance.
 */
const NEAR = "0.25turn";
const FAR = "0.75turn";

const LEGS: { near: LegSpec[]; far: LegSpec[] } = {
  far: [
    { x: 71, top: 80, knee: 121, foot: 155, w: 15, kw: 6, swing: 14, flex: 26, phase: FAR },
    { x: 117, top: 84, knee: 121, foot: 155, w: 11, kw: 5, swing: 16, flex: 34, phase: FAR },
  ],
  near: [
    { x: 61, top: 80, knee: 121, foot: 155, w: 16, kw: 6.4, swing: 14, flex: 26, phase: NEAR },
    { x: 127, top: 84, knee: 121, foot: 155, w: 12, kw: 5.2, swing: 16, flex: 34, phase: NEAR },
  ],
};

function Leg({ x, top, knee, foot, w, kw, swing, flex, phase }: LegSpec) {
  const p = stride(phase);
  return (
    <g style={pivot(x, top, `rotate(calc(sin(${p}) * ${swing}deg))`)}>
      <path d={segment(x, top, knee, w, kw)} />
      {/* The lower leg folds back only while the leg swings forward (cos < 0). */}
      <g style={pivot(x, knee, `rotate(calc(max(0, cos(${p}) * -1) * ${flex}deg))`)}>
        <path d={segment(x, knee - 1, foot - 3, kw * 0.92, kw * 0.62)} />
        <path d={pad(x, foot)} />
      </g>
    </g>
  );
}

const BODY =
  "M46 62C52 55 60 50 68 44C76 32 85 25 94 25C103 25 109 33 115 44C118 50 120 57 124 63L134 80C134 90 130 97 122 99C112 101 104 97 94 95C84 93 76 92 70 96C65 100 62 104 57 103C51 101 48 94 46 86C44 78 44 70 46 62Z";
const NECK =
  "M109 38C118 50 136 71 151 70C159 69 163 52 167 40C169 33 172 30 175 29L176.5 23.5L179.5 28.4C187 28 194 30 197 33C199.5 35.5 199 39.5 195.5 41C191 42.5 186 42.8 182 44C178 45.5 175.5 48.5 174.5 53C172 67 166 86 154 92C147 95 140 95 131 94L124 70Z";
const TAIL = "M47 63C42 70 40 82 41.5 96C42 98.5 44.5 98.5 45 96C45 84 47 74 50.5 66Z";

/**
 * Walking dromedary in side profile, facing right (inline start to end in LTR; mirror it for RTL).
 * Provisional artwork pending owner review (handoff §13). Drawn independently of the official
 * `CamelMark` logo: longer neck carried high, head forward, slimmer legs, a calm pace.
 * Set `--walk` (a number, 1.0 = one stride, may keep increasing) on this SVG or an ancestor.
 */
export function WalkingCamel({ className }: { className?: string }) {
  const p = stride("0turn");
  // Feet stay planted: the body dips as the legs reach the ends of the stride (sin² of the phase).
  const bob = `translateY(calc(sin(${stride(NEAR)}) * sin(${stride(NEAR)}) * 2.4px))`;
  return (
    <svg {...svgProps} viewBox="0 0 200 160" fill="currentColor" className={cn("block h-auto w-40", className)}>
      <g style={{ transform: bob }}>
        <g opacity={0.55}>
          {LEGS.far.map((leg) => (
            <Leg key={leg.x} {...leg} />
          ))}
        </g>
        <path d={TAIL} style={pivot(48, 64, `rotate(calc(sin(${p}) * 4deg))`)} />
        <path d={BODY} />
        {/* The neck and head counter the bob slightly, twice per stride. */}
        <path d={NECK} style={pivot(128, 72, `rotate(calc(sin(calc(var(--walk, 0) * 2turn)) * -1.6deg))`)} />
        {LEGS.near.map((leg) => (
          <Leg key={leg.x} {...leg} />
        ))}
      </g>
    </svg>
  );
}

/**
 * Where the near dune's crest sits, as a fraction of the viewBox height (y ≈ 271 of 360) across
 * the middle of the scene. The SVG slices from the bottom (`xMidYMax`), so the crest sits
 * `(1 - DUNE_RIDGE_Y)` of the rendered viewBox height above the SVG's bottom edge.
 */
export const DUNE_RIDGE_Y = 0.753;

const DUNES = {
  far: "M-130 214C80 186 250 168 430 182C600 195 700 222 880 208C1060 194 1180 160 1370 168C1530 175 1640 196 1730 206V360H-130Z",
  mid: "M-130 262C60 244 200 226 380 236C540 245 650 262 820 252C1000 241 1110 220 1290 226C1460 232 1610 252 1730 258V360H-130Z",
  near: "M-130 298C40 288 220 274 420 271C620 268 760 272 900 271C1080 269 1260 272 1420 282C1560 290 1660 296 1730 298V360H-130Z",
};

/**
 * Three flat dune planes, back to front, each tagged `data-plane="far|mid|near"` for parallax.
 * Each plane runs from x = -130 to 1730 so small horizontal shifts never reveal an edge.
 * Provisional artwork pending owner review (handoff §13); independent of the official logo.
 */
export function DuneLayers({ className }: { className?: string }) {
  return (
    <svg
      {...svgProps}
      viewBox="0 0 1600 360"
      preserveAspectRatio="xMidYMax slice"
      className={cn("block h-auto w-full", className)}
    >
      <g data-plane="far" className="fill-sand-soft">
        <path d={DUNES.far} />
      </g>
      <g data-plane="mid" className="fill-sand">
        <path d={DUNES.mid} />
      </g>
      <g data-plane="near" className="fill-gold">
        <path d={DUNES.near} />
      </g>
    </svg>
  );
}
