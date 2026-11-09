"use client";

import { WEEKDAY_LABELS } from "@/domain/catalog";
import { isCompleteCallSchedule, nextScheduledCall, upcomingReportCall } from "@/domain/schedule";
import type { CallSchedule, Weekday, Workspace } from "@/domain/types";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/cn";
import { useNow } from "@/store/workspace";
import { ownerCallsBeforeWorker } from "@/components/dashboard/callStatus";
import { StepField, StepInput, StepSelect } from "@/components/setup/onboarding/WizardParts";
import { WeekStrip } from "@/components/visuals/WeekStrip";
import type { SetupFieldsProps } from "@/components/setup/types";

export { upcomingReportCall } from "@/domain/schedule";

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

/** The owner's own call in one plain sentence. null while that schedule is unfinished. */
export function useOwnerCallSentence(ws: Workspace | null): string | null {
  const { m, t, fmt } = useI18n();
  const now = useNow();
  if (!ws) return null;
  const { plan, ownerCallSchedule } = ws.settings;
  const next = nextScheduledCall(now, plan, ownerCallSchedule);
  if (!next || !ownerCallSchedule) return null;
  const time = fmt.time(next);
  return plan === "basic" && ownerCallSchedule.day !== null
    ? m.setup.call.ownerSentenceWeekly(t(WEEKDAY_LABELS[ownerCallSchedule.day]), time)
    : m.setup.call.ownerSentenceDaily(time);
}

/**
 * When NAQAH calls the primary worker and the owner. Basic: a weekday and a time. Ultimate: a time,
 * every day. Asia/Riyadh. Writes through `update`, in the demo and in an account alike. Settings
 * draws the week above these fields, so it leaves the summary out.
 */
export function ReportCallFields({ ws, onChange, showErrors = false, showSummary = true }: SetupFieldsProps & { showSummary?: boolean }) {
  const { m, t } = useI18n();
  const s = m.setup.call;
  const { plan } = ws.settings;
  const weekly = plan === "basic";
  const schedule = ws.settings.callSchedule ?? null;
  const complete = isCompleteCallSchedule(plan, schedule);
  const summary = useCallSentence(ws);
  const ownerSummary = useOwnerCallSentence(ws);
  const now = useNow();
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
      <div className="space-y-4">
      <h3 className="text-lg font-semibold text-espresso">{s.workerTitle}</h3>
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
      </div>

      <OwnerCallFields ws={ws} onChange={onChange} showErrors={showErrors} />

      {showSummary ? (
        <div className="border-t border-stone/80 pt-5">
          <WeekStrip plan={plan} schedule={schedule} now={now} className="max-w-md" />
          <div aria-live="polite">
            {complete && summary ? (
              <div className="mt-5 space-y-1">
                <p className="text-[1.1875rem] font-semibold leading-snug text-espresso">{summary.sentence}</p>
                {ownerSummary ? <p className="text-[1.1875rem] font-semibold leading-snug text-espresso">{ownerSummary}</p> : null}
                <p className="text-[0.9375rem] text-muted">{s.next(summary.when)}</p>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** When NAQAH calls the owner. This is not the worker's report time. */
function OwnerCallFields({ ws, onChange, showErrors = false }: SetupFieldsProps) {
  const { m, t } = useI18n();
  const s = m.setup.call;
  const weekly = ws.settings.plan === "basic";
  const schedule = ws.settings.ownerCallSchedule ?? null;
  const needsDay = weekly && (schedule?.day ?? null) === null && (showErrors || Boolean(schedule?.time));
  const needsTime = showErrors && !schedule?.time;

  function updateSchedule(patch: Partial<CallSchedule>) {
    onChange((current) => {
      const previous = current.settings.ownerCallSchedule;
      const next: CallSchedule = { day: previous?.day ?? null, time: previous?.time ?? "", ...patch };
      return { ...current, settings: { ...current.settings, ownerCallSchedule: next } };
    });
  }

  return (
    <div className="space-y-4 border-t border-stone/80 pt-5">
      <div>
        <h3 className="text-lg font-semibold text-espresso">{s.ownerTitle}</h3>
        <p className="mt-1 text-muted">{s.ownerLead}</p>
      </div>
      <div className={cn("grid gap-x-5 gap-y-5", weekly ? "grid-cols-2" : "sm:grid-cols-2")}>
        {weekly ? (
          <StepField label={s.ownerDay} error={needsDay && showErrors ? s.needDay : undefined}>
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
        <StepField label={s.ownerTime} hint={s.timeHint} error={needsTime ? s.needTime : undefined}>
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
      <div aria-live="polite">
        {ownerCallsBeforeWorker(ws) ? <p className="text-[0.9375rem] leading-relaxed text-muted">{s.ownerFirstNote}</p> : null}
      </div>
    </div>
  );
}
