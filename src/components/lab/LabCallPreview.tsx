"use client";

import { Phone } from "@phosphor-icons/react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { CamelMark } from "@/components/brand/CamelMark";
import type { Workspace } from "@/domain";
import { useI18n } from "@/i18n/client";
import { scenarioMessageKey, type PickerScenario } from "./labStore";

export function LabCallPreview({ selected, ws, m, availability, onStart }: {
  selected: PickerScenario;
  ws: Workspace;
  m: ReturnType<typeof useI18n>["m"];
  availability: { text: string; enabled: boolean; time?: string };
  onStart: () => void;
}) {
  const caller = selected === "worker_inbound"
    ? { name: ws.settings.worker.name, subtitle: ws.settings.worker.phone, naqah: false }
    : selected === "owner_inquiry"
      ? { name: ws.settings.owner.name, subtitle: ws.settings.owner.phone, naqah: false }
      : { name: m.lab.phone.agentName, subtitle: selected === "report_call" ? m.lab.phone.simulation + " · " + m.lab.phone.callingWorker(ws.settings.worker.name) : m.lab.phone.assistant, naqah: true };
  const title = m.lab.scenarios[scenarioMessageKey(selected)].title;

  return (
    <Card className="min-w-0 overflow-hidden">
      <div className="bg-espresso px-5 py-5 text-cream sm:px-6">
        <div className="flex items-center gap-4">
          <div className="flex size-14 shrink-0 items-center justify-center rounded-full bg-brown-deep">
            {caller.naqah ? <CamelMark className="relative h-7 w-auto" /> : <span className="text-lg font-semibold">{caller.name.slice(0, 1)}</span>}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-cream/65">{m.lab.phone.caller}</p>
            <p className="naqah-name text-lg font-bold">{caller.name}</p>
            <p className={caller.naqah ? "naqah-name text-sm text-cream/70" : "naqah-name text-sm text-cream/70 ltr-nums"}>{caller.subtitle}</p>
          </div>
        </div>
        {/* "Call ready" is said once, with the moment it refers to. */}
        <div className="mt-4 flex items-center justify-between border-t border-cream/15 pt-3 text-xs text-cream/70">
          <span className="inline-flex items-center gap-2"><span className="size-1.5 rounded-full bg-gold" aria-hidden /><Phone size={16} aria-hidden />{m.lab.phone.callReady}</span>
          <span>{m.lab.availability.label}</span>
        </div>
      </div>
      <div className="flex min-h-[150px] flex-col items-center justify-center bg-cream px-5 py-6 text-center">
        <h2 className="font-semibold text-espresso">{title}</h2>
        <p className="mt-1 max-w-sm text-sm leading-relaxed text-muted">
          {availability.text}
          {availability.time ? <> <span className="ltr-nums inline-block font-semibold text-espresso">{availability.time}</span></> : null}
        </p>
        <Button onClick={onStart} size="lg" className="mt-5 w-full sm:w-auto" disabled={!availability.enabled}>
          {selected === "report_call" ? m.lab.phone.startReportCall + " · " + m.lab.phone.simulation : m.lab.phone.start}
        </Button>
      </div>
    </Card>
  );
}
