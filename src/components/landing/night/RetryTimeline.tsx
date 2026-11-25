import { CheckCircle, PhoneX, SquaresFour } from "@phosphor-icons/react/dist/ssr";
import type { Locale } from "@/domain/types";
import { REPORT_CALL_RETRIES, RETRY_DELAY_MS } from "@/domain/clock";
import { formatTime } from "@/i18n/format";
import type { Messages } from "@/i18n/messages";

/** The sample evening's report call starts at 5:40 PM Riyadh; the retries follow the rules in `clock.ts`. */
const SAMPLE_CALL_START = Date.parse("2026-01-01T17:40:00+03:00");

/**
 * A missed report call, read top to bottom: each call and its outcome in words, the wait between them, then
 * what the owner sees. Counts and times come from the domain rules, so the picture can never drift from them.
 */
export function RetryTimeline({ locale, copy }: { locale: Locale; copy: Messages["landing"]["night"]["reliability"]["retry"] }) {
  const attempts = REPORT_CALL_RETRIES + 1;
  const minutes = RETRY_DELAY_MS / 60_000;
  const times = Array.from({ length: attempts }, (_, index) => formatTime(new Date(SAMPLE_CALL_START + index * RETRY_DELAY_MS), locale));

  return (
    <figure className="night-glass p-6 sm:p-8">
      <figcaption className="text-lg font-semibold text-[var(--text)]">{copy.title}</figcaption>
      <p className="sr-only">{copy.summary(attempts, minutes)}</p>
      <ol aria-hidden className="mt-6">
        {times.map((time, index) => (
          <li key={time}>
            <div className="grid grid-cols-[2.75rem_minmax(0,1fr)] items-center gap-x-4">
              <span className="flex size-11 items-center justify-center rounded-full border border-[var(--line-strong)] bg-[var(--night-2)]">
                <PhoneX size={20} weight="regular" className="text-[var(--ember)]" />
              </span>
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
                <span className="text-[1.0625rem] font-semibold text-[var(--text)]">
                  {copy.call(index + 1)} <span className="ltr-nums ms-1 font-medium text-[var(--text-muted)]">{time}</span>
                </span>
                <span className="text-sm font-semibold text-[var(--warn)]">{copy.noAnswer}</span>
              </div>
            </div>
            {/* The wait before the next call, on the line that joins them. */}
            <div className="grid grid-cols-[2.75rem_minmax(0,1fr)] gap-x-4">
              <span className="flex justify-center">
                <span className="h-9 border-s-2 border-dashed border-[var(--line-strong)]" />
              </span>
              <span className="self-center text-sm text-[var(--text-faint)]">{index < times.length - 1 ? copy.wait(minutes) : copy.stops}</span>
            </div>
          </li>
        ))}
        <li className="grid grid-cols-[2.75rem_minmax(0,1fr)] items-center gap-x-4">
          <span className="flex size-11 items-center justify-center rounded-full bg-[var(--gold-bright)]">
            <SquaresFour size={20} weight="fill" className="text-[var(--night-1)]" />
          </span>
          <span className="text-[1.0625rem] font-semibold leading-snug text-[var(--gold-bright)]">{copy.result}</span>
        </li>
      </ol>
      <p className="mt-7 flex items-start gap-3 border-t border-[var(--line)] pt-5 text-[0.95rem] leading-7 text-[var(--text-muted)]">
        <CheckCircle aria-hidden size={22} weight="fill" className="mt-0.5 shrink-0 text-[var(--ok)]" />
        <span>{copy.answered}</span>
      </p>
    </figure>
  );
}
