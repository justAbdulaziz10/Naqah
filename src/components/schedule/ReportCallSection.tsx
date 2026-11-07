"use client";

import { Info } from "@phosphor-icons/react";
import { useId } from "react";
import { Card, CardBody, CardHeader, Field, Input } from "@/components/ui";
import { SaveState } from "@/components/setup/SaveState";
import type { SetupSectionProps } from "@/components/setup/types";
import { WEEKDAY_LABELS } from "@/domain/catalog";
import { isCompleteCallSchedule, nextScheduledCall } from "@/domain/schedule";
import type { CallSchedule, Weekday } from "@/domain/types";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/cn";
import { useAccountState, useIsAccount, useNow, useSaveStatus } from "@/store/workspace";

/**
 * When NAQAH calls the worker for the farm report. Basic: one day and time a week. Ultimate: one time every day.
 * Saved with the browser workspace only; an account cannot store it yet, so the controls stay off there.
 */
export function ReportCallSection({ ws, onChange, showSaved }: SetupSectionProps) {
  const { m, t, fmt } = useI18n();
  const s = m.schedule;
  const now = useNow();
  const account = useIsAccount();
  const checking = useAccountState((state) => state.status === "checking");
  const saveFailed = useSaveStatus((state) => state.status === "failed");
  const dayGroupId = useId();

  const { plan, worker } = ws.settings;
  const basic = plan === "basic";
  const schedule = ws.settings.callSchedule ?? null;
  const next = nextScheduledCall(now, plan, schedule);
  const workerName = worker.name.trim() || s.workerFallback;
  const locked = account;
  const complete = isCompleteCallSchedule(plan, schedule);
  const missing = schedule && !complete ? (basic && schedule.day === null ? s.needDay : s.needTime) : null;

  function updateSchedule(patch: Partial<CallSchedule>) {
    onChange((current) => {
      const previous = current.settings.callSchedule;
      const nextSchedule: CallSchedule = { day: previous?.day ?? null, time: previous?.time ?? "", ...patch };
      return { ...current, settings: { ...current.settings, callSchedule: nextSchedule } };
    });
  }

  return (
    <Card>
      <CardHeader title={s.title} action={showSaved && !locked ? <SaveState /> : undefined} />
      <CardBody className="space-y-6">
        <p className="max-w-prose leading-relaxed text-muted">{basic ? s.leadBasic(workerName) : s.leadUltimate(workerName)}</p>

        <div aria-live="polite" className="border-y border-stone/70 py-4">
          <p className="text-sm font-semibold text-muted">{s.nextCall}</p>
          {checking ? (
            <p className="mt-1 text-lg text-muted">{s.loading}</p>
          ) : next && !locked ? (
            <>
              <p className="mt-1 text-xl font-semibold text-espresso">{fmt.date(next)}</p>
              <p className="mt-0.5 text-espresso">
                <bdi>{fmt.time(next)}</bdi>
                <span className="text-muted"> · {fmt.relative(next, now)}</span>
              </p>
              <p className="mt-1 text-sm text-muted">
                {basic && schedule?.day !== null && schedule ? s.everyWeekday(t(WEEKDAY_LABELS[schedule.day])) : s.everyDay}
              </p>
            </>
          ) : (
            <>
              <p className="mt-1 text-xl font-semibold text-espresso">{s.noCallYet}</p>
              {locked ? null : <p className="mt-0.5 text-sm text-muted">{basic ? s.chooseBasic : s.chooseUltimate}</p>}
            </>
          )}
        </div>

        <div className="space-y-5">
          {basic ? (
            <fieldset disabled={locked} aria-describedby={missing === s.needDay ? `${dayGroupId}-error` : undefined}>
              <legend className="text-sm font-semibold text-espresso">{s.day}</legend>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
                {WEEKDAY_LABELS.map((label, index) => {
                  const checked = schedule?.day === index;
                  return (
                    <label key={index} className="relative">
                      <input
                        type="radio"
                        name={`${dayGroupId}-day`}
                        className="peer sr-only"
                        checked={checked}
                        onChange={() => updateSchedule({ day: index as Weekday })}
                      />
                      <span
                        className={cn(
                          "flex min-h-11 cursor-pointer items-center justify-center rounded-xl border px-3 text-sm font-semibold transition",
                          "peer-focus-visible:ring-2 peer-focus-visible:ring-brown peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-cream peer-disabled:cursor-not-allowed peer-disabled:opacity-60",
                          checked ? "border-brown bg-ivory text-espresso" : "border-stone bg-white/70 text-muted hover:border-brown/50 hover:text-espresso",
                        )}
                      >
                        {t(label)}
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ) : (
            <div>
              <p className="text-sm font-semibold text-espresso">{s.frequency}</p>
              <p className="mt-1 text-espresso">{s.daily}</p>
            </div>
          )}

          <Field label={s.time} hint={s.timeHint} className="max-w-xs">
            {(id) => (
              <Input
                id={id}
                type="time"
                className="ltr-nums"
                disabled={locked}
                value={schedule?.time ?? ""}
                aria-invalid={missing === s.needTime || undefined}
                onChange={(event) => updateSchedule({ time: event.target.value })}
              />
            )}
          </Field>

          {missing && !locked ? (
            <p id={`${dayGroupId}-error`} className="text-sm text-danger" role="alert">{missing}</p>
          ) : null}
          {saveFailed && showSaved && !locked ? <p className="text-sm text-danger" role="alert">{s.saveFailed}</p> : null}
        </div>

        <div className="flex gap-3 border-t border-stone/70 pt-4">
          <Info size={20} className="mt-0.5 shrink-0 text-info" aria-hidden />
          <div className="text-sm leading-relaxed">
            <p className="font-semibold text-espresso">{s.notActiveTitle}</p>
            <p className="mt-0.5 text-muted">{locked ? s.accountUnavailable : s.notActiveBody(workerName)}</p>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
