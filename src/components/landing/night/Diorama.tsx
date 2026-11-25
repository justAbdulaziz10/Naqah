"use client";

import { useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { CamelMarkRef } from "@/components/brand/CamelMark";
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
/** A camel's footprint on the pen (percent of the pen). The figure itself stands up from its centre. */
const CAMEL = { w: 9, h: 8 };
/** The upright camel figure, in world sizes. The height keeps the brand mark's own proportions (990 × 767). */
const CAMEL_FIG = { w: 0.11, h: (0.11 * 767) / 990 };
const GROUND_Z = 0.03;

/*
 * Phones: a wider pen and a loose two-row herd, so every figure is at least a fingertip wide and apart.
 * Spots are (u - v, u + v) in world fractions; they become percents of the phone pen below.
 */
const PHONE_PEN = { x: 4, y: 36, w: 62, h: 60 };
const PHONE_FOOT = { w: 5, h: 4 };
const PHONE_SPOTS: readonly (readonly [number, number])[] = [
  [-0.66, 0.8],
  [-0.43, 0.8],
  [-0.2, 0.8],
  [0.03, 0.8],
  [-0.545, 1.15],
  [-0.315, 1.15],
  [-0.085, 1.15],
  [0.145, 1.15],
];
function phoneCamel(index: number) {
  const [c, sum] = PHONE_SPOTS[index] ?? PHONE_SPOTS[0];
  const u = ((sum + c) / 2) * 100;
  const v = ((sum - c) / 2) * 100;
  return {
    left: ((u - PHONE_PEN.x - PHONE_FOOT.w / 2) / PHONE_PEN.w) * 100,
    top: ((v - PHONE_PEN.y - PHONE_FOOT.h / 2) / PHONE_PEN.h) * 100,
    width: (PHONE_FOOT.w / PHONE_PEN.w) * 100,
    height: (PHONE_FOOT.h / PHONE_PEN.h) * 100,
  };
}

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
    // The figure faces the reader, so its screen height equals a world height of h / sin(55°).
    z: PEN.z + CAMEL_FIG.h / SIN55,
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
  itemId,
  rect,
  kind,
  label,
  active,
  focusable,
  onSelect,
  onHover,
  faces = true,
  phone,
  children,
}: {
  itemId: DioramaItem["id"];
  rect: Rect;
  kind: string;
  label: string;
  active: boolean;
  /** One tab stop for the whole model: only the selected element is in the tab order (arrow keys move). */
  focusable: boolean;
  onSelect: () => void;
  onHover: (on: boolean) => void;
  faces?: boolean;
  /** Where the element stands on a phone (percent of its parent), when that differs. */
  phone?: { left: number; top: number; width: number; height: number };
  children?: ReactNode;
}) {
  const style = {
    left: `${rect.x}%`,
    top: `${rect.y}%`,
    width: `${rect.w}%`,
    height: `${rect.h}%`,
    "--z": rect.z,
    ...(phone ? { "--pl": `${phone.left}%`, "--pt": `${phone.top}%`, "--pw": `${phone.width}%`, "--ph": `${phone.height}%` } : {}),
  } as CSSProperties;
  return (
    <button
      type="button"
      className={`dio-block ${kind}${phone ? " dio-phone-pos" : ""}`}
      data-dio-id={itemId}
      style={style}
      aria-label={label}
      aria-pressed={active}
      tabIndex={focusable ? 0 : -1}
      // Hover only highlights. Selecting waits for a click, a tap or keyboard focus, so passing over a
      // neighbour on the way to a camel never changes the fact shown.
      onPointerEnter={(event) => event.pointerType === "mouse" && onHover(true)}
      onPointerLeave={() => onHover(false)}
      onFocus={onSelect}
      onClick={onSelect}
    >
      {faces ? <Faces /> : null}
      {children}
    </button>
  );
}

/**
 * The sample ranch at dusk as an isometric model. Click, tap or focus anything to read its latest fact,
 * always with its certainty in words. Nothing here is an image: ground, pen, trough, store, shade, room and
 * weather mast are extruded faces, so the model scales with the viewport and stays crisp.
 */
export interface DioramaModes {
  label: string;
  report: string;
  none: string;
  /** What every element says when no verified report arrived. */
  missingFact: string;
  missingCertainty: string;
  /** One line under the switch for each mode. */
  reportNote: string;
  noneNote: string;
  listLabel: string;
  /** One line telling people they can pick anything. */
  hint: string;
}

export function Diorama({
  items: reportItems,
  modelLabel,
  modes,
  initial = "camel-0",
}: {
  items: DioramaItem[];
  modelLabel: string;
  modes: DioramaModes;
  initial?: DioramaItem["id"];
}) {
  const [activeId, setActiveId] = useState<DioramaItem["id"]>(initial);
  const [hoverId, setHoverId] = useState<DioramaItem["id"] | null>(null);
  const [mode, setMode] = useState<"report" | "none">("report");
  const rootRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<SVGLineElement>(null);
  // Without a verified report nothing is shown as fine: every element says so, in the same words.
  const items =
    mode === "report"
      ? reportItems
      : reportItems.map((item) => ({ ...item, fact: modes.missingFact, certainty: "notReported" as Certainty, certaintyLabel: modes.missingCertainty }));
  const byId = new Map(items.map((item) => [item.id, item] as const));
  const active = byId.get(activeId) ?? items[0];
  const hovered = hoverId && hoverId !== active?.id ? byId.get(hoverId) : undefined;
  const hoverAnchor = hovered ? anchorOf(rectOf(hovered.id)) : null;
  const labelFor = (id: DioramaItem["id"]) => {
    const item = byId.get(id);
    return item ? `${item.name}: ${item.fact} (${item.certaintyLabel})` : id;
  };
  const camels = items.filter((item) => item.id.startsWith("camel-"));
  const fixture = (id: FixtureId) => ({
    itemId: id,
    rect: FIXTURES[id],
    label: labelFor(id),
    active: activeId === id,
    focusable: activeId === id,
    onSelect: () => setActiveId(id),
    onHover: (on: boolean) => setHoverId(on ? id : null),
  });

  // Beside the model (from the sm breakpoint): the card sits in its own column, level with its element and
  // clamped to the model's height, and a thin line joins the card to the element. Phones stack it below.
  useLayoutEffect(() => {
    const label = labelRef.current;
    const slot = label?.parentElement;
    const anchorBox = anchorRef.current;
    const stage = stageRef.current;
    const line = lineRef.current;
    if (!label || !slot || !anchorBox || !stage || !line) return;
    const place = () => {
      line.removeAttribute("x1");
      if (getComputedStyle(slot).position !== "absolute") {
        slot.style.removeProperty("top");
        return;
      }
      const box = anchorBox.getBoundingClientRect();
      const st = stage.getBoundingClientRect();
      const a = anchorOf(rectOf(activeId));
      const px = st.left - box.left + (a.x / 100) * st.width;
      const py = st.top - box.top + (a.y / 100) * st.height;
      const h = label.getBoundingClientRect().height;
      const top = Math.max(0, Math.min(box.height - h, py - h / 2));
      slot.style.top = `${Math.round(top)}px`;
      const card = label.getBoundingClientRect();
      const toEnd = card.left + card.width / 2 > box.left + px;
      const ex = (toEnd ? card.left : card.right) - box.left;
      const ey = Math.max(top + 14, Math.min(top + h - 14, py));
      line.setAttribute("x1", String(Math.round(px)));
      line.setAttribute("y1", String(Math.round(py)));
      line.setAttribute("x2", String(Math.round(ex)));
      line.setAttribute("y2", String(Math.round(ey)));
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [activeId, mode]);

  // A tap on empty ground near a camel picks the nearest camel (within 28px). On a phone the camels are
  // smaller than a fingertip, so this widens each one to its own patch without ever overriding a direct hit.
  // Fixtures are large enough to press directly.
  const onStageClick = (event: MouseEvent<HTMLDivElement>) => {
    if ((event.target as Element).closest("button")) return;
    let best: { id: DioramaItem["id"]; d: number } | null = null;
    for (const button of event.currentTarget.querySelectorAll<HTMLButtonElement>("button.dio-camel")) {
      const r = (button.querySelector(".dio-camel-fig") ?? button).getBoundingClientRect();
      const dx = Math.max(r.left - event.clientX, 0, event.clientX - r.right);
      const dy = Math.max(r.top - event.clientY, 0, event.clientY - r.bottom);
      const d = Math.hypot(dx, dy);
      if (d <= 28 && (!best || d < best.d)) best = { id: button.dataset.dioId as DioramaItem["id"], d };
    }
    if (best) setActiveId(best.id);
  };

  // Arrow keys move through the model and the list in the same order; Home and End jump to the ends.
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    // Up and Down stay with the page scroll; only the row keys move between items.
    const keys = ["ArrowRight", "ArrowLeft", "Home", "End"];
    if (!keys.includes(event.key)) return;
    const container = event.currentTarget;
    const buttons = items.map((item) => container.querySelector<HTMLButtonElement>(`button[data-dio-id="${item.id}"]`));
    const at = items.findIndex((item) => item.id === activeId);
    const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
    const forward = event.key === (rtl ? "ArrowLeft" : "ArrowRight");
    const next =
      event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (at + (forward ? 1 : -1) + buttons.length) % buttons.length;
    event.preventDefault();
    buttons[next]?.focus();
  };

  return (
    <div ref={rootRef}>
      <div ref={anchorRef} className="dio-anchor">
        <div ref={stageRef} className="dio-stage" role="group" aria-label={modelLabel} data-mode={mode} onKeyDown={onKeyDown} onClick={onStageClick}>
          <div className="dio-float">
            <div className="dio-world">
              <span className="dio-face dio-top dio-ground-top">
                {/* The pen, with the herd on its slab. */}
                <span
                  className="dio-block dio-pen dio-phone-pos"
                  style={
                    {
                      left: `${PEN.x}%`,
                      top: `${PEN.y}%`,
                      width: `${PEN.w}%`,
                      height: `${PEN.h}%`,
                      "--z": PEN.z,
                      "--pl": `${PHONE_PEN.x}%`,
                      "--pt": `${PHONE_PEN.y}%`,
                      "--pw": `${PHONE_PEN.w}%`,
                      "--ph": `${PHONE_PEN.h}%`,
                    } as CSSProperties
                  }
                >
                  <span className="dio-face dio-side-y" />
                  <span className="dio-face dio-side-x" />
                  <span className="dio-face dio-top">
                    {camels.map((camel, index) => {
                      const [cx, cy] = CAMEL_SPOTS[index] ?? CAMEL_SPOTS[0];
                      return (
                        <Block
                          key={camel.id}
                          itemId={camel.id}
                          rect={{ x: cx, y: cy, w: CAMEL.w, h: CAMEL.h, z: 0 }}
                          kind={index === 0 ? "dio-camel dio-camel-watch" : "dio-camel"}
                          label={labelFor(camel.id)}
                          active={activeId === camel.id}
                          focusable={activeId === camel.id}
                          faces={false}
                          phone={phoneCamel(index)}
                          onSelect={() => setActiveId(camel.id)}
                          onHover={(on) => setHoverId(on ? camel.id : null)}
                        >
                          {/* A ring on the pen marks the chosen camel; a soft contact shadow; the brand mark standing upright. */}
                          <span className="dio-camel-ring" />
                          <span className="dio-camel-shadow" />
                          <span
                            className="dio-camel-fig"
                            style={{
                              width: "calc(var(--dio-size) * var(--fw))",
                              height: `calc(var(--dio-size) * var(--fw) * ${(CAMEL_FIG.h / CAMEL_FIG.w).toFixed(4)})`,
                              marginLeft: "calc(var(--dio-size) * var(--fw) * -0.5)",
                            }}
                          >
                            <CamelMarkRef className="dio-camel-edge" />
                            <CamelMarkRef className="dio-camel-face" />
                          </span>
                        </Block>
                      );
                    })}
                  </span>
                </span>

                <Block {...fixture("shade")} kind="dio-shade">
                  {(["0%", "93%"] as const).flatMap((left) =>
                    (["0%", "93%"] as const).map((top) => (
                      <span key={`${left}-${top}`} className="dio-post" style={{ left, top }}>
                        <span className="dio-face dio-side-y" />
                        <span className="dio-face dio-side-x" />
                      </span>
                    )),
                  )}
                </Block>
                <Block {...fixture("room")} kind="dio-room">
                  <span className="dio-window" />
                </Block>
                <Block {...fixture("feed")} kind="dio-feed" />
                <Block {...fixture("heat")} kind="dio-heat" />
                <Block {...fixture("water")} kind="dio-water" />
              </span>
              <span className="dio-face dio-side-y dio-ground-front" />
              <span className="dio-face dio-side-x dio-ground-side" />
            </div>
          </div>
          {/* On a mouse, the name of what is under the pointer; it never changes the fact shown. */}
          {hovered && hoverAnchor ? (
            <span aria-hidden className="dio-hover-tag" style={{ left: `${hoverAnchor.x.toFixed(2)}%`, top: `${hoverAnchor.y.toFixed(2)}%` }}>
              {hovered.name}
            </span>
          ) : null}
        </div>

        <svg aria-hidden className="dio-leader">
          <line ref={lineRef} />
        </svg>

        {/* The fact label, announced as it changes. Beside the model from the sm breakpoint, stacked below on phones. */}
        {active ? (
          <div
            className="dio-label-slot"
            aria-live="polite"
          >
            <div ref={labelRef} key={active.id} className="dio-label night-glass night-glass-strong px-3.5 py-2.5">
              <span className="block text-xs text-[var(--text-muted)]">{active.name}</span>
              <strong className="mt-0.5 block text-[0.95rem] font-semibold leading-snug text-[var(--text)]">{active.fact}</strong>
              <span className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-medium" style={{ color: TONE[active.certainty] }}>
                <span aria-hidden className="size-1.5 rounded-full bg-current" />
                {active.certaintyLabel}
              </span>
            </div>
          </div>
        ) : null}
      </div>

      {/* The switch: the same ranch with and without a verified report. */}
      <p className="mt-6 text-center text-sm text-[var(--text-faint)]">{modes.hint}</p>
      <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-3">
        <div role="group" aria-label={modes.label} className="inline-flex rounded-full border border-[var(--line-strong)] p-1">
          {(["report", "none"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={mode === value}
              onClick={() => setMode(value)}
              className={`min-h-11 rounded-full px-4 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--gold-bright)] ${
                mode === value ? "bg-[var(--gold-bright)] text-[var(--night-1)]" : "text-[var(--text-muted)] hover:text-[var(--text)]"
              }`}
            >
              {value === "report" ? modes.report : modes.none}
            </button>
          ))}
        </div>
        <p className="max-w-[22rem] text-pretty text-sm leading-6 text-[var(--text-muted)]" aria-live="polite">
          {mode === "report" ? modes.reportNote : modes.noneNote}
        </p>
      </div>

      {/* The same elements as a list, kept in step with the model: pick here or there. */}
      <ul aria-label={modes.listLabel} onKeyDown={onKeyDown} className="mx-auto mt-5 flex max-w-[40rem] flex-wrap justify-center gap-x-1 gap-y-0">
        {items.map((item) => {
          const selected = item.id === active?.id;
          return (
            <li key={item.id}>
              <button
                type="button"
                data-dio-id={item.id}
                aria-pressed={selected}
                onClick={() => setActiveId(item.id)}
                onFocus={() => setActiveId(item.id)}
                className={`inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-[var(--gold-bright)] ${
                  selected ? "font-semibold text-[var(--text)] underline decoration-[var(--gold-bright)] decoration-2 underline-offset-[6px]" : "text-[var(--text-muted)] hover:text-[var(--text)]"
                }`}
              >
                <span aria-hidden className="size-1.5 rounded-full" style={{ background: TONE[item.certainty] }} />
                {item.name}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
