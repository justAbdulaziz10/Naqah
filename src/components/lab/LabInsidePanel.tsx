"use client";

import { ArrowRight, WarningCircle } from "@phosphor-icons/react";
import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { CERTAINTY_LABELS, EMERGENCY_LABELS, HEALTH_LABELS, RESOURCE_LABELS, type Workspace } from "@/domain";
import type { CallSession } from "@/domain/conversation/engine";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/cn";

const certaintyTone = { reported: "info", approximate: "gold", unknown: "neutral", verified: "ok" } as const;

function certaintyText(value: keyof typeof CERTAINTY_LABELS, m: ReturnType<typeof useI18n>["m"]) {
  return m.lab.certainty[value];
}

function healthTone(status: keyof typeof HEALTH_LABELS) {
  if (status === "sick") return "danger";
  if (status === "watch") return "warn";
  if (status === "healthy") return "ok";
  return "neutral";
}

function lineWithTimes(text: string) {
  return text.split(/(\b\d{1,2}:\d{2}\b)/g).map((part, index) =>
    /\b\d{1,2}:\d{2}\b/.test(part) ? <bdi key={index} className="ltr-nums">{part}</bdi> : part,
  );
}

export function EmergencyPanel({ ws, m, t }: { ws: Workspace; m: ReturnType<typeof useI18n>["m"]; t: (value: { ar: string; en: string }) => string }) {
  return (
    <Card className="border-warn/40 p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <WarningCircle size={22} weight="fill" className="mt-1 shrink-0 text-warn" aria-hidden />
        <div className="min-w-0">
          <h2 className="text-lg font-bold">{m.lab.emergency.title}</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">{m.lab.emergency.detail(ws.settings.owner.name)}</p>
          <p className="mt-4 text-sm font-semibold">{m.lab.panel.emergency}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {ws.settings.emergencies.map((item) => {
              const fallback = EMERGENCY_LABELS[item.kind as keyof typeof EMERGENCY_LABELS] ?? { ar: item.kind, en: item.kind };
              const label = item.label ? { ar: item.label, en: item.label } : fallback;
              return <Badge key={item.id} tone="warn">{t(label)}</Badge>;
            })}
          </div>
        </div>
      </div>
    </Card>
  );
}

function FactList({ session, ws, m, t }: { session: CallSession | null; ws: Workspace; m: ReturnType<typeof useI18n>["m"]; t: (value: { ar: string; en: string }) => string }) {
  const answers = session?.draft.answers ?? [];
  const camelUpdates = session?.draft.camelUpdates ?? [];
  const resourceUpdates = session?.draft.resourceUpdates ?? [];
  const confirmations = session?.draft.taskConfirmations ?? [];
  const hasFacts = answers.length + camelUpdates.length + resourceUpdates.length + confirmations.length > 0;
  if (!hasFacts) return <p className="text-sm text-muted">{m.lab.panel.noFacts}</p>;

  return (
    <ul className="space-y-3">
      {answers.map((item, index) => (
        <li key={item.questionId + "-" + index} className="rounded-xl bg-ivory px-3.5 py-3">
          <p className="text-sm font-semibold leading-relaxed">{t(item.question)}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="break-words text-sm text-muted">
              {item.certainty === "unknown" ? m.lab.facts.unknownAnswer : item.answerText ? t(item.answerText) : item.answer}
            </span>
            <Badge tone={certaintyTone[item.certainty]}>{certaintyText(item.certainty, m)}</Badge>
          </div>
        </li>
      ))}
      {camelUpdates.map((item) => {
        const camel = ws.camels.find((entry) => entry.id === item.camelId);
        return (
          <li key={item.camelId} className="rounded-xl bg-ivory px-3.5 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={healthTone(item.health)}>{t(HEALTH_LABELS[item.health])}</Badge>
              <span className="font-semibold">{camel?.name}</span>
              <Badge tone={certaintyTone[item.certainty]}>{certaintyText(item.certainty, m)}</Badge>
            </div>
            {item.note ? <p className="mt-2 break-words text-sm text-muted">{item.note}</p> : null}
          </li>
        );
      })}
      {resourceUpdates.map((item) => (
        <li key={item.kind} className="rounded-xl bg-ivory px-3.5 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{t(RESOURCE_LABELS[item.kind])}</span>
            <Badge tone={item.level === "critical" || item.level === "low" ? "warn" : "neutral"}>
              {m.lab.levels[item.level]}
            </Badge>
            <Badge tone={certaintyTone[item.certainty]}>{certaintyText(item.certainty, m)}</Badge>
          </div>
          {item.quantity ? <p className="mt-2 text-sm text-muted"><bdi className="ltr-nums">{item.quantity}</bdi></p> : null}
        </li>
      ))}
      {confirmations.map((item) => {
        const task = ws.taskTickets.find((entry) => entry.id === item.taskId);
        return (
          <li key={item.taskId} className="rounded-xl bg-ivory px-3.5 py-3">
            <p className="break-words text-sm font-semibold">{task?.instruction}</p>
            <div className="mt-2 flex items-center gap-2">
              <Badge tone={item.done ? "ok" : "neutral"}>{item.done ? m.lab.facts.taskDone : m.lab.facts.taskNotDone}</Badge>
              {item.done ? <Badge tone="ok">{certaintyText("verified", m)}</Badge> : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function InsidePanel({
  ws,
  session,
  baseline,
  m,
  t,
}: {
  ws: Workspace;
  session: CallSession | null;
  baseline: string[];
  m: ReturnType<typeof useI18n>["m"];
  t: (value: { ar: string; en: string }) => string;
}) {
  const [expanded, setExpanded] = useState(false);
  const events = ws.events.filter((event) => !baseline.includes(event.id)).slice().reverse();
  const callouts = session?.notices ?? [];

  return (
    <section className="min-w-0">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        className="flex min-h-11 w-full items-center justify-between rounded-xl border border-stone/80 bg-cream px-4 text-start font-bold lg:hidden"
      >
        <span>{m.lab.panel.toggle}</span>
        <ArrowRight size={18} className={cn("transition-transform rtl:-scale-x-100", expanded && "rotate-90")} aria-hidden />
      </button>

      <div className={cn("space-y-4", expanded ? "mt-4 block" : "mt-4 hidden lg:block")}>
        <Card className="p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-bold">{m.lab.panel.title}</h2>
            <Badge tone="dark">{m.common.plans[ws.settings.plan]}</Badge>
          </div>
          <div className="mt-5">
            <h3 className="mb-3 text-sm font-bold">{m.lab.panel.facts}</h3>
            <FactList session={session} ws={ws} m={m} t={t} />
          </div>
          <div className="mt-6 border-t border-stone/70 pt-4">
            <h3 className="mb-3 text-sm font-bold">{m.lab.panel.events}</h3>
            {events.length ? (
              <ul className="space-y-2">
                {events.map((event) => (
                  <li key={event.id} className="flex items-start gap-2 text-sm leading-relaxed">
                    <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", event.tone === "success" ? "bg-ok" : event.tone === "attention" ? "bg-warn" : event.tone === "danger" ? "bg-danger" : "bg-faint")} />
                    <span>{t(event.text)}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted">{m.lab.panel.noEvents}</p>}
          </div>
          <div className="mt-6 border-t border-stone/70 pt-4">
            <h3 className="mb-3 text-sm font-bold">{m.lab.panel.rules}</h3>
            {session?.scenario === "worker_callback" ? (
              <p className="rounded-xl bg-info-soft px-3.5 py-3 text-sm leading-relaxed text-info">{m.lab.panel.callbackNote}</p>
            ) : null}
            {callouts.length ? (
              <ul className="space-y-2">
                {callouts.map((notice, index) => (
                  <li key={index} className="rounded-xl bg-warn-soft/70 px-3.5 py-3 text-sm leading-relaxed text-warn">{lineWithTimes(t(notice))}</li>
                ))}
              </ul>
            ) : session?.scenario !== "worker_callback" ? (
              <p className="text-sm text-muted">{m.lab.panel.noRules}</p>
            ) : null}
          </div>
          {session?.scenario === "emergency" ? (
            <div className="mt-6 border-t border-stone/70 pt-4">
              <h3 className="mb-3 text-sm font-bold">{m.lab.panel.emergency}</h3>
              <div className="flex flex-wrap gap-2">
                {ws.settings.emergencies.map((item) => {
                  const fallback = EMERGENCY_LABELS[item.kind as keyof typeof EMERGENCY_LABELS] ?? { ar: item.kind, en: item.kind };
                  return <Badge key={item.id} tone="warn">{item.label ?? t(fallback)}</Badge>;
                })}
              </div>
            </div>
          ) : null}
        </Card>
      </div>
    </section>
  );
}

