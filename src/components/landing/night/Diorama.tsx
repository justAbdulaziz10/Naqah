"use client";

import { motion, useReducedMotion } from "motion/react";
import { useState, type CSSProperties, type ReactNode } from "react";
import "./diorama.css";

export type Certainty = "reported" | "approximate" | "notReported" | "verified";
export type FixtureId = "water" | "feed" | "shade" | "room" | "heat";

/** One thing in the model and the latest fact NAQAH holds about it. Built by the server from the section's copy. */
export interface DioramaItem {
  id: FixtureId | `camel-${number}`;
  name: string;
  fact: string;
  certainty: Certainty;
  certaintyLabel: string;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Height above the ground, as a fraction of the world's size. */
  z: number;
}

/* World geometry, in percent of a 100 × 100 ground. */
const FIXTURES: Record<FixtureId, Rect> = {
  shade: { x: 8, y: 8, w: 28, h: 26, z: 0.085 },
  room: { x: 42, y: 8, w: 20, h: 24, z: 0.08 },
  feed: { x: 68, y: 8, w: 22, h: 24, z: 0.1 },
  heat: { x: 90, y: 46, w: 3.5, h: 3.5, z: 0.12 },
  water: { x: 68, y: 72, w: 26, h: 12, z: 0.02 },
};
const PEN: Rect = { x: 6, y: 44, w: 56, h: 50, z: 0.012 };
/** Where each camel stands inside the pen (percent of the pen). The first spot is Wadha's. */
const CAMEL_SPOTS: readonly (readonly [number, number])[] = [
  [12, 16],
  [34, 10],
  [58, 18],
  [78, 12],
  [20, 50],
  [48, 56],
  [74, 50],
  [40, 80],
];
const CAMEL = { w: 9, h: 8, z: 0.035 };
const GROUND_Z = 0.03;
const LIFT_PX = 14;

const COS45 = Math.SQRT1_2;
const COS55 = Math.cos((55 * Math.PI) / 180);
const SIN55 = Math.sin((55 * Math.PI) / 180);
/** The stage box, in world sizes (see .dio-stage). */
const STAGE = { w: 1.5, h: 1.05 };

const TONE: Record<Certainty, string> = {
  reported: "var(--moon)",
  approximate: "var(--warn)",
  notReported: "var(--text-faint)",
  verified: "var(--ok)",
};

function camelRect(index: number): Rect {
  const [cx, cy] = CAMEL_SPOTS[index] ?? CAMEL_SPOTS[0];
  return {
    x: PEN.x + (cx / 100) * PEN.w,
    y: PEN.y + (cy / 100) * PEN.h,
    w: (CAMEL.w / 100) * PEN.w,
    h: (CAMEL.h / 100) * PEN.h,
    z: PEN.z + CAMEL.z,
  };
}

function rectOf(id: DioramaItem["id"]): Rect {
  if (id.startsWith("camel-")) return camelRect(Number(id.slice(6)));
  return FIXTURES[id as FixtureId];
}

/** Where the top of an element lands on the stage, as percentages: the isometric projection of its centre. */
function anchorOf(rect: Rect): { x: number; y: number } {
  const u = (rect.x + rect.w / 2) / 100 - 0.5;
  const v = (rect.y + rect.h / 2) / 100 - 0.5;
  const sx = (u - v) * COS45;
  const sy = (u + v) * COS45 * COS55 - (GROUND_Z + rect.z) * SIN55;
  return { x: 50 + (sx / STAGE.w) * 100, y: 50 + (sy / STAGE.h) * 100 };
}

function Faces() {
  return (
    <>
      <span className="dio-face dio-top" />
      <span className="dio-face dio-side-y" />
      <span className="dio-face dio-side-x" />
    </>
  );
}

function Block({
  rect,
  kind,
  label,
  active,
  reduce,
  onActivate,
  children,
}: {
  rect: Rect;
  kind: string;
  label: string;
  active: boolean;
  reduce: boolean;
  onActivate: () => void;
  children?: ReactNode;
}) {
  const style = { left: `${rect.x}%`, top: `${rect.y}%`, width: `${rect.w}%`, height: `${rect.h}%`, "--z": rect.z } as CSSProperties;
  return (
    <motion.button
      type="button"
      className={`dio-block ${kind}`}
      style={style}
      aria-label={label}
      aria-pressed={active}
      onPointerEnter={onActivate}
      onFocus={onActivate}
      onClick={onActivate}
      animate={{ z: active ? LIFT_PX : 0 }}
      transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 260, damping: 22 }}
    >
      <Faces />
      {children}
    </motion.button>
  );
}

/**
 * The sample ranch at night as an isometric model. Hover, focus or tap anything to read its latest fact,
 * always with its certainty in words. Nothing here is an image: ground, pen, trough, store, shade, room and
 * weather mast are extruded faces, so the model scales with the viewport and stays crisp.
 */
export function Diorama({ items, modelLabel, initial = "camel-0" }: { items: DioramaItem[]; modelLabel: string; initial?: DioramaItem["id"] }) {
  const reduce = useReducedMotion() ?? false;
  const [activeId, setActiveId] = useState<DioramaItem["id"]>(initial);
  const byId = new Map(items.map((item) => [item.id, item] as const));
  const active = byId.get(activeId) ?? items[0];
  const anchor = active ? anchorOf(rectOf(active.id)) : { x: 50, y: 50 };
  const labelFor = (id: DioramaItem["id"]) => {
    const item = byId.get(id);
    return item ? `${item.name}: ${item.fact} (${item.certaintyLabel})` : id;
  };
  const camels = items.filter((item) => item.id.startsWith("camel-"));

  return (
    <div className="relative sm:pt-16">
      <div className="dio-stage" role="group" aria-label={modelLabel}>
        <motion.div
          className="dio-float"
          animate={reduce ? undefined : { y: [0, -7, 0] }}
          transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
        >
          <div className="dio-world">
            <span className="dio-face dio-top dio-ground-top">
              {/* The pen, with the herd on its slab. */}
              <span className="dio-block dio-pen" style={{ left: `${PEN.x}%`, top: `${PEN.y}%`, width: `${PEN.w}%`, height: `${PEN.h}%`, "--z": PEN.z } as CSSProperties}>
                <span className="dio-face dio-side-y" />
                <span className="dio-face dio-side-x" />
                <span className="dio-face dio-top">
                  {camels.map((camel, index) => {
                    const [cx, cy] = CAMEL_SPOTS[index] ?? CAMEL_SPOTS[0];
                    return (
                      <Block
                        key={camel.id}
                        rect={{ x: cx, y: cy, w: CAMEL.w, h: CAMEL.h, z: CAMEL.z }}
                        kind={index === 0 ? "dio-camel dio-camel-watch" : "dio-camel"}
                        label={labelFor(camel.id)}
                        active={activeId === camel.id}
                        reduce={reduce}
                        onActivate={() => setActiveId(camel.id)}
                      />
                    );
                  })}
                </span>
              </span>

              <Block rect={FIXTURES.shade} kind="dio-shade" label={labelFor("shade")} active={activeId === "shade"} reduce={reduce} onActivate={() => setActiveId("shade")}>
                {(["0%", "93%"] as const).flatMap((left) =>
                  (["0%", "93%"] as const).map((top) => (
                    <span key={`${left}-${top}`} className="dio-post" style={{ left, top }}>
                      <span className="dio-face dio-side-y" />
                      <span className="dio-face dio-side-x" />
                    </span>
                  )),
                )}
              </Block>
              <Block rect={FIXTURES.room} kind="dio-room" label={labelFor("room")} active={activeId === "room"} reduce={reduce} onActivate={() => setActiveId("room")}>
                <span className="dio-window" />
              </Block>
              <Block rect={FIXTURES.feed} kind="dio-feed" label={labelFor("feed")} active={activeId === "feed"} reduce={reduce} onActivate={() => setActiveId("feed")} />
              <Block rect={FIXTURES.heat} kind="dio-heat" label={labelFor("heat")} active={activeId === "heat"} reduce={reduce} onActivate={() => setActiveId("heat")} />
              <Block rect={FIXTURES.water} kind="dio-water" label={labelFor("water")} active={activeId === "water"} reduce={reduce} onActivate={() => setActiveId("water")} />
            </span>
            <span className="dio-face dio-side-y" style={{ "--face-front": "#1f1611" } as CSSProperties} />
            <span className="dio-face dio-side-x" style={{ "--face-side": "#170f0b" } as CSSProperties} />
          </div>
        </motion.div>
      </div>

      {/* The fact label, announced as it changes. Pinned to its element from the sm breakpoint, stacked below on phones. */}
      {active ? (
        <div
          className="dio-label-slot"
          data-below={anchor.y < 32 ? "" : undefined}
          style={{ left: `${anchor.x}%`, top: `${anchor.y}%` }}
          aria-live="polite"
        >
          <motion.div
            key={active.id}
            className="night-glass night-glass-strong px-3.5 py-2.5"
            initial={reduce ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28, ease: "easeOut" }}
          >
            <span className="block text-xs text-[var(--text-muted)]">{active.name}</span>
            <strong className="mt-0.5 block text-[0.95rem] font-semibold leading-snug text-[var(--text)]">{active.fact}</strong>
            <span className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-medium" style={{ color: TONE[active.certainty] }}>
              <span aria-hidden className="size-1.5 rounded-full bg-current" />
              {active.certaintyLabel}
            </span>
          </motion.div>
        </div>
      ) : null}
    </div>
  );
}
