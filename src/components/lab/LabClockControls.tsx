"use client";

import { Clock } from "@phosphor-icons/react";
import { Button } from "@/components/ui/Button";
import { HOUR, MINUTE, type Workspace } from "@/domain";
import { heatLevel, weatherForToday } from "@/domain/weather";
import { useI18n } from "@/i18n/client";

export function LabClockControls({ ws, now, fmt, m, onAdvance, onNextDay, onSimulateHeat }: {
  ws: Workspace;
  now: Date;
  fmt: ReturnType<typeof useI18n>["fmt"];
  m: ReturnType<typeof useI18n>["m"];
  onAdvance: (milliseconds: number) => void;
  onNextDay: () => void;
  onSimulateHeat: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 border-y border-stone/70 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <Clock size={20} className="shrink-0 text-brown" aria-hidden />
        <div>
          <p className="font-semibold">{m.lab.clock.title}</p>
          <p className="text-sm text-muted"><bdi className="ltr-nums">{fmt.dateTime(now)}</bdi> <span className="mx-1 text-faint">·</span>{m.lab.clock.current}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" className="min-h-11" onClick={() => onAdvance(20 * MINUTE)}>{m.lab.clock.plus20}</Button>
        <Button variant="secondary" size="sm" className="min-h-11" onClick={() => onAdvance(HOUR)}>{m.lab.clock.plusHour}</Button>
        <Button variant="secondary" size="sm" className="min-h-11" onClick={onNextDay}>{m.lab.clock.nextDay}</Button>
        {ws.settings.farm.coords && heatLevel(weatherForToday(ws, now)?.maxTempC ?? 0) === "none" ? (
          <Button variant="secondary" size="sm" className="min-h-11" onClick={onSimulateHeat}>{m.integrations.weather.simulateHeatDay}</Button>
        ) : null}
      </div>
    </div>
  );
}
