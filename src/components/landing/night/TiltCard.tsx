"use client";

import { motion, useMotionTemplate, useMotionValue, useReducedMotion, useSpring, useTransform } from "motion/react";
import type { CSSProperties, PointerEvent, ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * A glass card standing in perspective. It leans toward the pointer (at most `maxTilt` degrees) and a
 * faint gold sheen follows the hand. Under reduced motion it stands still and the sheen rests centred.
 */
export function TiltCard({
  children,
  className,
  style,
  maxTilt = 8,
  labelledBy,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  maxTilt?: number;
  /** The id of the card's heading. */
  labelledBy?: string;
}) {
  const reduce = useReducedMotion();
  // Pointer position within the card, 0..1 on each axis; centred when the hand is away.
  const px = useMotionValue(0.5);
  const py = useMotionValue(0.5);
  const springs = { stiffness: 170, damping: 22, mass: 0.7 };
  const sx = useSpring(px, springs);
  const sy = useSpring(py, springs);
  const rotateX = useTransform(sy, [0, 1], [maxTilt, -maxTilt]);
  const rotateY = useTransform(sx, [0, 1], [-maxTilt, maxTilt]);
  const sheenX = useTransform(sx, (v) => `${Math.round(v * 100)}%`);
  const sheenY = useTransform(sy, (v) => `${Math.round(v * 100)}%`);
  const sheen = useMotionTemplate`radial-gradient(440px circle at ${sheenX} ${sheenY}, rgba(216, 173, 108, 0.16), rgba(216, 173, 108, 0) 62%)`;

  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    if (reduce || event.pointerType === "touch") return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    px.set(Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)));
    py.set(Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)));
  };
  const rest = () => {
    px.set(0.5);
    py.set(0.5);
  };

  return (
    <div className="[perspective:1200px]">
      <motion.article
        aria-labelledby={labelledBy}
        onPointerMove={onPointerMove}
        onPointerLeave={rest}
        onPointerCancel={rest}
        style={reduce ? style : { ...style, rotateX, rotateY, transformStyle: "preserve-3d" }}
        className={cn("night-glass relative h-full will-change-transform", className)}
      >
        <motion.span aria-hidden className="pointer-events-none absolute inset-0 rounded-[inherit]" style={{ background: sheen }} />
        <div className="relative flex h-full flex-col">{children}</div>
      </motion.article>
    </div>
  );
}
