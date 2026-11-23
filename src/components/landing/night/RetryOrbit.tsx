import type { CSSProperties } from "react";
import type { Locale } from "@/domain/types";
import { REPORT_CALL_RETRIES, RETRY_DELAY_MS } from "@/domain/clock";
import { formatTime } from "@/i18n/format";
import "./diorama.css";

/** The sample evening's report call starts at 5:40 PM Riyadh; the retries follow the rules in `clock.ts`. */
const SAMPLE_CALL_START = Date.parse("2026-01-01T17:40:00+03:00");

export interface OrbitCopy {
  figure: (attempts: number, minutes: number) => string;
  attempt: (n: number) => string;
  firstCall: string;
  missed: string;
  caption: string;
}

/**
 * A missed report call as an orbit: three attempts around the ring, 20 minutes apart, and the outcome
 * at its centre. Pure CSS 3D; the satellite's drift stops under reduced motion.
 */
export function RetryOrbit({ locale, copy }: { locale: Locale; copy: OrbitCopy }) {
  const attempts = REPORT_CALL_RETRIES + 1;
  const minutes = RETRY_DELAY_MS / 60_000;
  const times = Array.from({ length: attempts }, (_, index) => formatTime(new Date(SAMPLE_CALL_START + index * RETRY_DELAY_MS), locale));
  // The attempts sit on the near arc in reading order: left to right in English, right to left in Arabic.
  const spread = 120;
  const angles = times.map((_, index) => {
    const step = attempts > 1 ? spread / (attempts - 1) : 0;
    const angle = 90 + spread / 2 - index * step; // 150° → 90° → 30° (degrees, y down)
    return locale === "ar" ? 180 - angle : angle;
  });
  const nodeStyle = (angle: number, radius = 50) => {
    const rad = (angle * Math.PI) / 180;
    return { "--nx": `${50 + radius * Math.cos(rad)}%`, "--ny": `${50 + radius * Math.sin(rad)}%` } as CSSProperties;
  };

  return (
    <figure className="orbit-stage">
      <div role="img" aria-label={copy.figure(attempts, minutes)} className="orbit-ring">
        <span aria-hidden className="orbit-spin">
          <span className="orbit-sat" />
        </span>
        {times.map((time, index) => (
          <span key={time} aria-hidden className="orbit-node" style={nodeStyle(angles[index])}>
            <span className={`orbit-disc ${index === 0 ? "orbit-disc-lit" : ""}`} />
            <span className="ltr-nums mt-2 text-sm font-semibold text-[var(--text)]">{time}</span>
            <span className="mt-0.5 text-xs leading-tight text-[var(--text-muted)]">{index === 0 ? copy.firstCall : copy.attempt(index + 1)}</span>
          </span>
        ))}
        <span aria-hidden className="orbit-node" style={nodeStyle(0, 0)}>
          <span className="orbit-disc orbit-disc-gold" />
          <span className="mt-2 max-w-[9rem] text-balance text-xs font-semibold leading-tight text-[var(--gold-bright)]">{copy.missed}</span>
        </span>
      </div>
      <figcaption className="mt-6 text-center text-sm text-[var(--text-faint)]">{copy.caption}</figcaption>
    </figure>
  );
}
