"use client";

import { lazy, Suspense, useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  WORKER_LANGUAGES,
  advanceClock,
  atRiyadhTime,
  setClockTo,
  type Workspace,
} from "@/domain";
import { scenarioAvailability } from "@/domain/conversation/availability";
import { makePersonalizer, personalizeTree } from "@/domain/conversation/personalize";
import { withDemoHeat } from "@/domain/weather";
import { useI18n } from "@/i18n/client";
import { useIsAccount, useNow, useWorkspaceStore } from "@/store/workspace";
import { isLiveCallLanguage } from "@/lib/voice/liveCallLanguages";
import { EmergencyPanel, InsidePanel } from "./LabInsidePanel";
import { LabCallPreview } from "./LabCallPreview";
import { LabClockControls } from "./LabClockControls";
import { LabScenarioPicker } from "./LabScenarioPicker";
import { useLabCall, type PickerScenario } from "./labStore";
import type { LabLaunch } from "./LabSimulator";

const LabSimulator = lazy(() => import("./LabSimulator").then((module) => ({ default: module.LabSimulator })));
const TestCallPanel = lazy(() => import("./TestCallPanel").then((module) => ({ default: module.TestCallPanel })));

function availabilityCopy(
  scenario: PickerScenario,
  ws: Workspace,
  now: Date,
  availability: ReturnType<typeof scenarioAvailability>,
  fmt: ReturnType<typeof useI18n>["fmt"],
  m: ReturnType<typeof useI18n>["m"],
): { text: string; tone: "ok" | "warn" | "danger" | "info" | "neutral"; jump: boolean; enabled: boolean; time?: string } {
  if (scenario === "report_call") {
    const { block, active, due, next } = availability.reportCall;
    if (active?.state === "answered") return { text: m.lab.availability.reportInConversation, tone: "info", jump: false, enabled: true };
    if (active) {
      const retryAt = active.attempts.at(-1)?.result === "pending" || !active.nextAttemptAt ? null : new Date(active.nextAttemptAt);
      return retryAt && retryAt.getTime() > now.getTime()
        ? { text: m.lab.availability.reportRetry, tone: "warn", jump: false, enabled: true, time: fmt.dateTime(retryAt) }
        : { text: m.lab.availability.reportRinging, tone: "info", jump: false, enabled: true };
    }
    if (block === "no_worker_phone") return { text: m.lab.availability.noWorkerPhone, tone: "warn", jump: false, enabled: false };
    if (block === "no_questions") return { text: m.lab.availability.noQuestions, tone: "warn", jump: false, enabled: false };
    if (block === "already_reported") {
      return {
        text: ws.settings.plan === "basic" ? m.lab.availability.weekComplete : m.lab.availability.dayComplete,
        tone: "neutral",
        jump: false,
        enabled: false,
      };
    }
    if (due) return { text: m.lab.availability.reportDue, tone: "ok", jump: false, enabled: true };
    if (next) return { text: m.lab.availability.reportNext, tone: "info", jump: true, enabled: true, time: fmt.dateTime(next) };
    return { text: m.lab.availability.reportNoSchedule, tone: "neutral", jump: false, enabled: true };
  }
  if (scenario === "worker_inbound") {
    const route = availability.workerInbound;
    if (route.kind === "callback") return { text: m.lab.availability.callbackFirst, tone: "info", jump: false, enabled: true };
    if (route.kind === "report") return { text: m.lab.availability.returningMissed, tone: "ok", jump: false, enabled: true };
    if (route.reason === "weekly_done" || route.reason === "daily_done") {
      return { text: route.reason === "weekly_done" ? m.lab.availability.weekComplete : m.lab.availability.dayComplete, tone: "neutral", jump: false, enabled: true };
    }
    const next = availability.reportCall.next;
    return next
      ? { text: m.lab.availability.waitForCall, tone: "neutral", jump: false, enabled: true, time: fmt.dateTime(next) }
      : { text: m.lab.availability.waitNoSchedule, tone: "neutral", jump: false, enabled: true };
  }
  if (scenario === "owner_inquiry") {
    return availability.ownerInquiry.kind === "inquiry"
      ? { text: m.lab.availability.ownerReady, tone: "ok", jump: false, enabled: true }
      : { text: m.lab.availability.ownerUsed, tone: "warn", jump: false, enabled: true };
  }
  if (scenario === "worker_outbound") {
    const count = availability.pendingWorkerCallCount + availability.dueTaskVerificationCount;
    if (!count) {
      return {
        text: ws.settings.plan === "basic" ? m.lab.availability.noCallsBasic : m.lab.availability.noCallsUltimate,
        tone: "neutral",
        jump: false,
        enabled: false,
      };
    }
    const due = availability.dueWorkerCallCount + availability.dueTaskVerificationCount;
    return {
      text: due
        ? m.lab.availability.callsReady(due) + " · " + m.lab.availability.callsWaiting(count)
        : m.lab.availability.callsScheduled(count),
      tone: due ? "info" : "warn",
      jump: false,
      enabled: true,
    };
  }
  return { text: m.lab.availability.directOwner, tone: "neutral", jump: false, enabled: true };
}

/** The simulator is demo-only. A signed-in owner gets the test call, or is sent on if the server refuses it. */
export function LabPage() {
  const account = useIsAccount();
  if (!account) return <DemoLab />;
  return (
    <Suspense fallback={null}>
      <TestCallPanel />
    </Suspense>
  );
}

function DemoLab() {
  const { m: baseMessages, t: baseT, locale, fmt, href } = useI18n();
  const ws = useWorkspaceStore((state) => state.workspace);
  const update = useWorkspaceStore((state) => state.update);
  const personalize = useMemo(() => makePersonalizer(ws), [ws]);
  const m = useMemo(() => ({ ...baseMessages, lab: personalizeTree(baseMessages.lab, personalize) }), [baseMessages, personalize]);
  const t = useCallback((value: { ar: string; en: string }) => personalize(baseT(value)), [baseT, personalize]);
  const now = useNow();
  const lab = useLabCall();
  const session = lab.session && lab.workspaceKey === ws?.createdAt ? lab.session : null;
  const selected = lab.selected;
  const baseline = lab.baseline;
  const availability = useMemo(() => ws ? scenarioAvailability(ws, now) : null, [ws, now]);
  const [simulatorOpen, setSimulatorOpen] = useState(Boolean(session));
  const [launch, setLaunch] = useState<LabLaunch | null>(null);
  const clearLaunch = useCallback(() => setLaunch(null), []);

  if (!ws || !availability) return null;

  const selectedAvailability = availabilityCopy(selected, ws, now, availability, fmt, m);
  const reportCallAvailability = availability.reportCall;
  const workerLanguageNotice = !isLiveCallLanguage(ws.settings.worker.language);
  const sessionActive = Boolean(session && !session.done);

  function advance(ms: number) {
    update((current) => advanceClock(current, ms));
  }

  function jumpNextDay() {
    const target = atRiyadhTime(now, 17, 0, 1);
    update((current) => setClockTo(current, target));
  }

  function jumpToCall() {
    const next = reportCallAvailability.next;
    if (next) update((current) => setClockTo(current, next));
  }

  function simulateHeat() {
    update((current) => withDemoHeat(current, now));
  }

  function openSimulator() {
    setLaunch({ scenario: selected, now });
    setSimulatorOpen(true);
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-[2rem] font-semibold leading-tight tracking-[-0.02em] text-espresso sm:text-[2.5rem]">{m.lab.title}</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-muted">
          {m.lab.subtitle}{" "}
          <Link href={`${href("/app/settings")}#settings-plan`} className="inline-flex min-h-11 items-center font-semibold text-brown underline decoration-stone underline-offset-4 hover:decoration-brown">
            {m.lab.comparePlans}
          </Link>
        </p>
      </header>

      <LabScenarioPicker plan={ws.settings.plan} selected={selected} sessionActive={sessionActive || Boolean(launch)} onSelect={(value) => lab.patch({ selected: value })} m={m} />

      <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2.5">
          <span className="shrink-0 whitespace-nowrap"><Badge tone={selectedAvailability.tone} dot>{m.lab.availability.label}</Badge></span>
          <p className="pt-0.5 text-sm leading-relaxed text-muted">
            {selectedAvailability.text}
            {selectedAvailability.time ? <> <bdi className="ltr-nums">{selectedAvailability.time}</bdi></> : null}
          </p>
        </div>
        {selectedAvailability.jump ? (
          <Button variant="secondary" size="sm" onClick={jumpToCall} className="min-h-11">
            {m.lab.availability.jumpToCall}
          </Button>
        ) : null}
      </div>

      <LabClockControls
        ws={ws}
        now={now}
        fmt={fmt}
        m={m}
        onAdvance={advance}
        onNextDay={jumpNextDay}
        onSimulateHeat={simulateHeat}
      />

      {workerLanguageNotice ? (
        <p className="text-sm leading-relaxed text-info">{m.lab.languageNote(t(WORKER_LANGUAGES.find((item) => item.id === ws.settings.worker.language)?.label ?? { ar: "", en: "" }))}</p>
      ) : null}

      <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,460px)_minmax(0,1fr)] lg:items-start">
        <div className="min-w-0 space-y-4">
          {simulatorOpen ? (
            <Suspense fallback={<div className="min-h-[390px] rounded-2xl border border-stone/70 bg-cream" role="status" aria-label={m.lab.phone.callReady} />}>
              <LabSimulator
                ws={ws}
                now={now}
                m={m}
                locale={locale}
                t={t}
                blockedReason={selectedAvailability.enabled ? null : selectedAvailability.text}
                launch={launch}
                onLaunchHandled={clearLaunch}
              />
            </Suspense>
          ) : (
            <>
              <LabCallPreview selected={selected} ws={ws} m={m} availability={selectedAvailability} onStart={openSimulator} />
              {selected === "emergency" ? <EmergencyPanel ws={ws} m={m} t={t} /> : null}
            </>
          )}
        </div>
        <InsidePanel ws={ws} session={session} baseline={baseline} m={m} t={t} />
      </div>
    </div>
  );
}
