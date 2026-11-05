"use client";

import { Card, CardBody, CardHeader, Field, Input, Select } from "@/components/ui";
import { WEEKDAY_LABELS } from "@/domain/catalog";
import { isValidWindow } from "@/domain/clock";
import type { ReportingWindow, Weekday } from "@/domain/types";
import { useI18n } from "@/i18n/client";
import type { SetupSectionProps } from "../types";

export function ScheduleSection({ ws, onChange, showSaved, showErrors, optional = false }: SetupSectionProps & { optional?: boolean }) {
  const { m, t } = useI18n();
  const window = ws.settings.window;
  const hasCompleteTimes = Boolean(window?.start && window.end);
  const windowValid = Boolean(window && hasCompleteTimes && isValidWindow(window));

  function updateWindow(patch: Partial<ReportingWindow>) {
    onChange((current) => {
      const previous = current.settings.window;
      const next: ReportingWindow = {
        day: previous?.day ?? 0,
        start: previous?.start ?? "",
        end: previous?.end ?? "",
        ...patch,
      };
      return { ...current, settings: { ...current.settings, window: next } };
    });
  }

  return (
    <Card>
      <CardHeader
        title={m.onboarding.sectionTitles.schedule}
        action={showSaved ? <span className="text-xs font-medium text-muted">{m.common.actions.saved}</span> : undefined}
      />
      <CardBody>
        {ws.settings.plan === "ultimate" ? (
          <p className="max-w-prose leading-relaxed text-muted">{m.onboarding.ultimateSchedule}</p>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted">{optional ? m.onboarding.scheduleCanBeSetLater : m.onboarding.basicSchedule}</p>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={m.onboarding.weekday}>
                {(id) => (
                  <Select
                    id={id}
                    required={!optional}
                    value={window ? String(window.day) : ""}
                    onChange={(event) => {
                      if (!event.target.value) {
                        onChange((current) => ({ ...current, settings: { ...current.settings, window: null } }));
                      } else {
                        updateWindow({ day: Number(event.target.value) as Weekday });
                      }
                    }}
                  >
                    <option value="">{m.onboarding.chooseWeekday}</option>
                    {WEEKDAY_LABELS.map((day, index) => (
                      <option key={index} value={index}>{t(day)}</option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label={m.onboarding.startTime}>
                {(id) => (
                  <Input
                    id={id}
                    type="time"
                    required={!optional}
                    className="ltr-nums"
                    value={window?.start ?? ""}
                    disabled={!window}
                    onChange={(event) => updateWindow({ start: event.target.value })}
                  />
                )}
              </Field>
              <Field label={m.onboarding.endTime}>
                {(id) => (
                  <Input
                    id={id}
                    type="time"
                    required={!optional}
                    className="ltr-nums"
                    value={window?.end ?? ""}
                    disabled={!window}
                    onChange={(event) => updateWindow({ end: event.target.value })}
                  />
                )}
              </Field>
            </div>
            {!optional && (showErrors || ws.settings.plan === "basic") && !windowValid ? (
              <p className="text-sm text-danger" role="alert">
                {window && hasCompleteTimes ? m.onboarding.windowEndAfterStart : m.onboarding.windowRequired}
              </p>
            ) : null}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
