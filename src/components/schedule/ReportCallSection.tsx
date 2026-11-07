"use client";

import { WEEKDAY_LABELS } from "@/domain/catalog";
import { sameDay, sameWeek } from "@/domain/clock";
import { reportDoneThisPeriod } from "@/domain/rules";
import { isCompleteCallSchedule, nextScheduledCall } from "@/domain/schedule";
import type { CallSchedule, Weekday, Workspace } from "@/domain/types";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/cn";
import { useNow } from "@/store/workspace";
import { StepField, StepInput, StepSelect } from "@/components/setup/onboarding/WizardParts";
import type { SetupFieldsProps } from "@/components/setup/types";

/**
 * The next report call NAQAH will actually place. A period whose report is already in is not called
 * again, so its remaining slot is skipped.
 */
export function upcomingReportCall(ws: Workspace, now: Date): Date | null {
  const { plan, callSchedule } = ws.settings;
  const next = nextScheduledCall(now, plan, callSchedule);
  if (!next || !reportDoneThisPeriod(ws, now)) return next;
  const samePeriod = plan === "basic" ? sameWeek(next, now) : sameDay(next, now);
  return samePeriod ? nextScheduledCall(next, plan, callSchedule) : next;
}

/**
 * The scheduled report call in one plain sentence, e.g. "NAQAH will call Ahmed every Thursday at 5:00 PM."
 * null while the schedule is unfinished. Used by setup, Settings and the dashboard.
 */
export function useCallSentence(ws: Workspace | null): { sentence: string; next: Date; worker: string; when: string } | null {
  const { m, t, fmt, locale } = useI18n();
  const now = useNow();
  if (!ws) return null;
  const { plan, worker, callSchedule } = ws.settings;
  const next = upcomingReportCall(ws, now);
  if (!next || !callSchedule) return null;
  const name = worker.name.trim() || m.setup.call.workerFallback;
  const time = fmt.time(next);
  const sentence = plan === "basic" && callSchedule.day !== null
    ? m.setup.call.sentenceWeekly(name, t(WEEKDAY_LABELS[callSchedule.day]), time)
    : m.setup.call.sentenceDaily(name, time);
  return { sentence, next, worker: name, when: `${fmt.date(next)}${locale === "ar" ? "، " : ", "}${fmt.relative(next, now)}` };
}

/**
 * When NAQAH calls the primary worker. Basic: a weekday and a time. Ultimate: a time, every day.
 * Asia/Riyadh. Writes `settings.callSchedule` through `update`, in the demo and in an account alike.
 */
export function ReportCallFields({ ws, onChange, showErrors = false }: SetupFieldsProps) {
  const { m, t } = useI18n();
  const s = m.setup.call;
  const { plan } = ws.settings;
  const weekly = plan === "basic";
  const schedule = ws.settings.callSchedule ?? null;
  const complete = isCompleteCallSchedule(plan, schedule);
  const summary = useCallSentence(ws);
  // Shown once the owner tries to continue (or has started choosing and left the day out).
  const needsDay = weekly && (schedule?.day ?? null) === null && (showErrors || Boolean(schedule?.time));
  const needsTime = showErrors && !schedule?.time;

  function updateSchedule(patch: Partial<CallSchedule>) {
    onChange((current) => {
      const previous = current.settings.callSchedule;
      const next: CallSchedule = { day: previous?.day ?? null, time: previous?.time ?? "", ...patch };
      return { ...current, settings: { ...current.settings, callSchedule: next } };
    });
  }

  return (
    <div className="space-y-6">
      <p className="text-[1.0625rem] leading-relaxed text-muted">{m.setup.plans.cadence(m.common.plans[plan], weekly)}</p>
      <div className={cn("grid gap-x-5 gap-y-5", weekly ? "grid-cols-2" : "sm:grid-cols-2")}>
        {weekly ? (
          <StepField label={s.day} error={needsDay && showErrors ? s.needDay : undefined}>
            {({ id, describedBy }) => (
              <StepSelect
                id={id}
                aria-describedby={describedBy}
                aria-invalid={(needsDay && showErrors) || undefined}
                value={schedule?.day ?? ""}
                onChange={(event) => updateSchedule({ day: Number(event.target.value) as Weekday })}
              >
                <option value="" disabled>{s.chooseDay}</option>
                {WEEKDAY_LABELS.map((label, index) => <option key={index} value={index}>{t(label)}</option>)}
              </StepSelect>
            )}
          </StepField>
        ) : null}
        <StepField label={s.time} hint={s.timeHint} error={needsTime ? s.needTime : undefined}>
          {({ id, describedBy }) => (
            <StepInput
              id={id}
              type="time"
              dir="ltr"
              required
              className={cn("ltr-nums", needsTime && "border-danger")}
              aria-invalid={needsTime || undefined}
              aria-describedby={describedBy}
              value={schedule?.time ?? ""}
              onChange={(event) => updateSchedule({ time: event.target.value })}
            />
          )}
        </StepField>
      </div>

      <div aria-live="polite" className={complete && summary ? "border-t border-stone/80 pt-5" : undefined}>
        {complete && summary ? (
          <>
            <p className="text-[1.1875rem] font-semibold leading-snug text-espresso">{summary.sentence}</p>
            <p className="mt-1 text-[0.9375rem] text-muted">{s.next(summary.when)}</p>
          </>
        ) : null}
      </div>
    </div>
  );
}
