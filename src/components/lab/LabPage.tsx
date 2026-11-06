"use client";

import {
  ArrowRight,
  Clock,
  Phone,
  SpeakerHigh,
  WarningCircle,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field, Input } from "@/components/ui/Field";
import { Switch } from "@/components/ui/Switch";
import {
  CERTAINTY_LABELS,
  EMERGENCY_LABELS,
  HEALTH_LABELS,
  RESOURCE_LABELS,
  WORKER_LANGUAGES,
  advanceClock,
  atRiyadhTime,
  HOUR,
  MINUTE,
  nextWindowStart,
  setClockTo,
  type Workspace,
} from "@/domain";
import { isValidWindow } from "@/domain/clock";
import { start, answer, hangUp, scenarioAvailability, type AnswerInput, type CallSession, type Scenario } from "@/domain/conversation/engine";
import { makePersonalizer, personalizeTree } from "@/domain/conversation/personalize";
import { heatLevel, weatherForToday, withDemoHeat } from "@/domain/weather";
import { useI18n } from "@/i18n/client";
import { create } from "zustand";
import { useNow, useWorkspaceStore } from "@/store/workspace";
import { CamelMark } from "@/components/brand/CamelMark";
import { cn } from "@/lib/cn";
import { isLiveCallLanguage } from "@/lib/voice/liveCallLanguages";

type PickerScenario = "worker_report" | "worker_outbound" | "owner_inquiry" | "emergency";

const PICKER_SCENARIOS: PickerScenario[] = ["worker_report", "worker_outbound", "owner_inquiry", "emergency"];
const subscribeNothing = () => () => {};
const voiceAvailable = () => typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
const reducedMotionPreference = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function subscribeReducedMotion(onChange: () => void) {
  if (typeof window === "undefined") return () => {};
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

const certaintyTone = {
  reported: "info",
  approximate: "gold",
  unknown: "neutral",
  verified: "ok",
} as const;

function certaintyText(value: keyof typeof CERTAINTY_LABELS, m: ReturnType<typeof useI18n>["m"]) {
  return m.lab.certainty[value];
}

function healthTone(status: keyof typeof HEALTH_LABELS) {
  if (status === "sick") return "danger";
  if (status === "watch") return "warn";
  if (status === "healthy") return "ok";
  return "neutral";
}

function scenarioMessageKey(scenario: PickerScenario) {
  switch (scenario) {
    case "worker_report":
      return "workerReport";
    case "worker_outbound":
      return "workerOutbound";
    case "owner_inquiry":
      return "ownerInquiry";
    case "emergency":
      return "emergency";
  }
}

function availabilityCopy(
  scenario: PickerScenario,
  ws: Workspace,
  now: Date,
  availability: ReturnType<typeof scenarioAvailability>,
  fmt: ReturnType<typeof useI18n>["fmt"],
  m: ReturnType<typeof useI18n>["m"],
): { text: string; tone: "ok" | "warn" | "danger" | "info" | "neutral"; jump: boolean; enabled: boolean; time?: string } {
  if (scenario === "worker_report") {
    const route = availability.workerReport;
    if (route.kind === "callback") {
      return { text: m.lab.availability.callbackFirst, tone: "info", jump: false, enabled: true };
    }
    if (route.kind === "report") {
      return {
        text: ws.settings.plan === "basic" ? m.lab.availability.insideWindow : m.lab.availability.ready,
        tone: "ok",
        jump: false,
        enabled: true,
      };
    }
    if (route.reason === "outside_window" && ws.settings.window) {
      const next = nextWindowStart(now, ws.settings.window);
      return {
        text: m.lab.availability.outsideWindow,
        tone: "warn",
        jump: true,
        enabled: true,
        time: fmt.dateTime(next),
      };
    }
    return {
      text: route.reason === "weekly_done"
        ? m.lab.availability.weekComplete
        : route.reason === "daily_done"
          ? m.lab.availability.dayComplete
          : m.lab.availability.noWindow,
      tone: "warn",
      jump: false,
      enabled: true,
    };
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

function callerFor(session: CallSession | null, selected: PickerScenario, ws: Workspace, m: ReturnType<typeof useI18n>["m"]) {
  const scenario = session?.scenario ?? selected;
  if (scenario === "worker_report" || scenario === "worker_callback") {
    return { name: ws.settings.worker.name, subtitle: ws.settings.worker.phone, naqah: false };
  }
  if (scenario === "owner_inquiry") {
    return { name: ws.settings.owner.name, subtitle: ws.settings.owner.phone, naqah: false };
  }
  return { name: m.lab.phone.agentName, subtitle: m.lab.phone.assistant, naqah: true };
}

function formatDuration(started: number | null, current: number): string {
  const seconds = started === null ? 0 : Math.max(0, Math.floor((current - started) / 1000));
  const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
  const remainder = (seconds % 60).toString().padStart(2, "0");
  return minutes + ":" + remainder;
}

function speakerLabel(speaker: CallSession["turns"][number]["speaker"], m: ReturnType<typeof useI18n>["m"]) {
  if (speaker === "agent") return m.lab.phone.speakerAgent;
  if (speaker === "worker") return m.lab.phone.speakerWorker;
  if (speaker === "owner") return m.lab.phone.speakerOwner;
  return m.lab.phone.speakerSystem;
}

function lineWithTimes(text: string) {
  return text.split(/(\b\d{1,2}:\d{2}\b)/g).map((part, index) =>
    /\b\d{1,2}:\d{2}\b/.test(part) ? <bdi key={index} className="ltr-nums">{part}</bdi> : part,
  );
}

function ChatTurn({
  turn,
  m,
  t,
}: {
  turn: CallSession["turns"][number];
  m: ReturnType<typeof useI18n>["m"];
  t: (value: { ar: string; en: string }) => string;
}) {
  const agent = turn.speaker === "agent" || turn.speaker === "system";
  return (
    <div className={cn("max-w-[88%] space-y-1.5", agent ? "me-auto" : "ms-auto")}>
      <p className={cn("px-1 text-xs font-semibold", agent ? "text-muted" : "text-end text-muted")}>
        {speakerLabel(turn.speaker, m)}
      </p>
      <div
        className={cn(
          "rounded-2xl px-4 py-3 text-[0.93rem] leading-relaxed shadow-soft",
          agent ? "rounded-ss-md bg-ivory text-espresso" : "rounded-se-md bg-brown text-cream",
        )}
      >
        {lineWithTimes(t(turn.text))}
      </div>
    </div>
  );
}

function PhoneStage({
  session,
  selected,
  ws,
  timerStarted,
  m,
  locale,
  t,
  blockedReason,
  onStart,
  onAnswer,
  onEnd,
}: {
  session: CallSession | null;
  selected: PickerScenario;
  ws: Workspace;
  timerStarted: number | null;
  m: ReturnType<typeof useI18n>["m"];
  locale: "ar" | "en";
  t: (value: { ar: string; en: string }) => string;
  blockedReason: string | null;
  onStart: () => void;
  onAnswer: (input: AnswerInput) => void;
  onEnd: () => void;
}) {
  const caller = callerFor(session, selected, ws, m);
  const [timerNow, setTimerNow] = useState(() => Date.now());
  const [revealed, setRevealed] = useState({ key: timerStarted ?? 0, count: session?.turns.length ?? 0 });
  const revealedCount = timerStarted !== null && revealed.key === timerStarted ? revealed.count : 0;
  const turnCount = session?.turns.length ?? 0;
  const latestSpeaker = session?.turns[turnCount - 1]?.speaker;
  const reducedMotion = useSyncExternalStore(subscribeReducedMotion, reducedMotionPreference, () => false);
  const voiceSupported = useSyncExternalStore(subscribeNothing, voiceAvailable, () => false);
  const [speakLines, setSpeakLines] = useState(false);
  const [input, setInput] = useState("");
  const [inputError, setInputError] = useState(false);
  const transcriptRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setTimerNow(Date.now()), 1000);
    return () => {
      window.clearInterval(timer);
      window.speechSynthesis?.cancel();
    };
  }, []);

  useEffect(() => {
    const target = turnCount;
    if (!target) return;
    if (timerStarted === null) return;
    if (revealed.key === timerStarted && target <= revealedCount) return;
    const delay = latestSpeaker === "agent" && !reducedMotion ? 600 : 0;
    const key = timerStarted;
    const timer = window.setTimeout(() => setRevealed({ key, count: target }), delay);
    return () => window.clearTimeout(timer);
  }, [turnCount, latestSpeaker, timerStarted, revealed.key, revealedCount, reducedMotion]);

  useEffect(() => {
    transcriptRef.current?.scrollTo({
      top: transcriptRef.current.scrollHeight,
      behavior: reducedMotion ? "auto" : "smooth",
    });
  }, [revealedCount, session?.turns.length, reducedMotion]);

  const spokenTurn = session?.turns[revealedCount - 1];
  useEffect(() => {
    if (!speakLines || !voiceSupported || !spokenTurn) return;
    const utterance = new SpeechSynthesisUtterance(t(spokenTurn.text));
    utterance.lang = locale === "ar" ? "ar-SA" : "en-US";
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
    return () => window.speechSynthesis.cancel();
  }, [spokenTurn, speakLines, voiceSupported, locale, t]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!input.trim()) {
      setInputError(true);
      return;
    }
    setInputError(false);
    onAnswer({ text: input.trim() });
    setInput("");
  }

  const conversationActive = Boolean(session && !session.done && session.scenario !== "emergency");
  const inputMode = session?.inputMode ?? "none";
  const typing = Boolean(session && session.turns.length > revealedCount);
  const interactionReady = conversationActive && !typing;
  const showTextInput = interactionReady && (inputMode === "text" || inputMode === "number" || inputMode === "time");
  const timer = formatDuration(timerStarted, timerNow);

  return (
    <Card className="min-w-0 overflow-hidden">
      <div className="bg-espresso px-5 py-5 text-cream sm:px-6">
        <div className="flex items-center gap-4">
          <div className="relative flex size-14 shrink-0 items-center justify-center rounded-full bg-brown-deep">
            {conversationActive ? <span className="absolute inset-0 animate-pulse-ring rounded-full ring-1 ring-gold/80" aria-hidden /> : null}
            {caller.naqah ? (
              <CamelMark className="relative h-7 w-auto" />
            ) : (
              <span className="relative text-lg font-semibold">{caller.name.slice(0, 1)}</span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-cream/65">{m.lab.phone.caller}</p>
            <p className="truncate text-lg font-bold">{caller.name}</p>
            <p className={cn("truncate text-sm text-cream/70", !caller.naqah && "ltr-nums")}>{caller.subtitle}</p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-cream/75">
              <span className={cn("size-1.5 rounded-full", conversationActive ? "bg-ok" : session?.done ? "bg-faint" : "bg-gold")} />
              {conversationActive ? m.lab.phone.calling : session?.done ? m.lab.phone.callEnded : m.lab.phone.callReady}
            </span>
            {session ? <span className="ltr-nums text-sm font-semibold tabular-nums">{timer}</span> : null}
          </div>
        </div>
        <div className="mt-4 flex items-center justify-between border-t border-cream/15 pt-3">
          <div className="inline-flex items-center gap-2 text-xs text-cream/70">
            <Phone size={16} aria-hidden />
            <span>{session ? m.lab.phone.duration(timer) : m.lab.phone.previewReady}</span>
          </div>
          {voiceSupported ? (
            <div className="flex items-center gap-2">
              <SpeakerHigh size={16} className="text-cream/75" aria-hidden />
              <span className="text-xs font-semibold text-cream/80">{m.lab.phone.speakLines}</span>
              <Switch checked={speakLines} onChange={setSpeakLines} label={m.lab.phone.speakLines} className="h-11 w-16" />
            </div>
          ) : null}
        </div>
      </div>

      <div
        ref={transcriptRef}
        aria-live="polite"
        aria-relevant="additions text"
        className="flex max-h-[490px] min-h-[270px] flex-col gap-4 overflow-y-auto bg-cream px-4 py-5 sm:px-5"
      >
        {session ? (
          session.turns.slice(0, revealedCount).map((item, index) => (
            <ChatTurn key={item.at + "-" + index} turn={item} m={m} t={t} />
          ))
        ) : (
          <div className="m-auto max-w-xs py-8 text-center">
            <p className="font-semibold text-espresso">{m.lab.phone.previewReady}</p>
            <p className="mt-1 text-sm text-muted">{blockedReason ?? m.lab.phone.noConversation}</p>
          </div>
        )}
        {typing ? (
          <div role="status" className="me-auto flex items-center gap-2 rounded-full bg-ivory px-3 py-2 text-xs font-semibold text-muted">
            <span className="flex gap-1" aria-hidden>
              <span className="size-1 rounded-full bg-faint" />
              <span className="size-1 rounded-full bg-faint" />
              <span className="size-1 rounded-full bg-faint" />
            </span>
            {m.lab.phone.typing}
          </div>
        ) : null}
      </div>

      <div className="border-t border-stone/70 bg-ivory/70 px-4 py-4 sm:px-5">
        {session?.replies.length && interactionReady ? (
          <div className="flex flex-wrap gap-2">
            {session.replies.map((item) => (
              <Button
                key={item.id}
                variant="secondary"
                size="md"
                className="min-h-11 max-w-full whitespace-normal text-start"
                onClick={() => {
                  setInputError(false);
                  onAnswer({ value: item.value });
                }}
              >
                {t(item.label)}
              </Button>
            ))}
          </div>
        ) : null}

        {showTextInput && session ? (
          <form className="mt-3 flex items-end gap-2" onSubmit={submit}>
            <Field label={m.lab.phone.inputLabel} className="min-w-0 flex-1">
              {(id) => (
                <Input
                  id={id}
                  type={inputMode === "number" ? "number" : inputMode === "time" ? "time" : "text"}
                  inputMode={inputMode === "number" ? "decimal" : undefined}
                  step={inputMode === "number" ? "any" : undefined}
                  value={input}
                  onChange={(event) => {
                    setInput(event.target.value);
                    setInputError(false);
                  }}
                  placeholder={
                    inputMode === "number"
                      ? m.lab.phone.numberPlaceholder
                      : inputMode === "time"
                        ? m.lab.phone.timePlaceholder
                        : m.lab.phone.inputPlaceholder
                  }
                  className={cn((inputMode === "number" || inputMode === "time") && "ltr-nums")}
                  aria-invalid={inputError}
                  aria-describedby={inputError ? "lab-response-error" : undefined}
                />
              )}
            </Field>
            <Button size="md" className="h-12 shrink-0" type="submit">
              {m.lab.phone.send}
            </Button>
          </form>
        ) : null}
        {inputError ? <p id="lab-response-error" role="alert" className="mt-2 text-sm text-danger">{m.lab.phone.emptyInput}</p> : null}

        <div className={cn("flex flex-wrap items-center gap-2", session?.replies.length || showTextInput ? "mt-4" : "")}>
          {!session ? (
            <Button onClick={onStart} size="lg" className="w-full" disabled={Boolean(blockedReason)}>
              {m.lab.phone.start}
            </Button>
          ) : !session.done && session.scenario !== "emergency" ? (
            <Button variant="danger" onClick={onEnd} className="w-full sm:w-auto">
              {m.lab.phone.end}
            </Button>
          ) : session.done && !session.next ? (
            <Button variant="secondary" onClick={onEnd} className="w-full sm:w-auto">
              {m.lab.phone.cancel}
            </Button>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

function EmergencyPanel({ ws, m, t }: { ws: Workspace; m: ReturnType<typeof useI18n>["m"]; t: (value: { ar: string; en: string }) => string }) {
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

function InsidePanel({
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
  const openTickets = ws.noAnswerTickets.filter((ticket) => ticket.status === "open");
  const closedTickets = ws.noAnswerTickets.filter((ticket) => ticket.status === "closed");

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
          {openTickets.length || closedTickets.length ? (
            <div className="mt-6 border-t border-stone/70 pt-4">
              <h3 className="mb-3 text-sm font-bold">{m.lab.panel.ticket}</h3>
              <ul className="space-y-2">
                {[...openTickets, ...closedTickets].slice(0, 4).map((ticket) => (
                  <li key={ticket.id} className="flex items-start justify-between gap-3 rounded-xl bg-ivory px-3.5 py-3 text-sm">
                    <span className="min-w-0 break-words">{ticket.message}</span>
                    <Badge tone={ticket.status === "open" ? "warn" : "ok"}>{ticket.status === "open" ? m.lab.panel.ticketOpen : m.lab.panel.ticketClosed}</Badge>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
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

/**
 * The call in progress lives outside the page so switching language (a route change that
 * remounts this page) keeps the conversation. In memory only: a reload starts fresh.
 */
interface LabCallState {
  selected: PickerScenario;
  session: CallSession | null;
  workspaceKey: string | null;
  baseline: string[];
  callStartedAt: number | null;
  patch: (value: Partial<Omit<LabCallState, "patch">>) => void;
}

const useLabCall = create<LabCallState>()((set) => ({
  selected: "worker_report",
  session: null,
  workspaceKey: null,
  baseline: [],
  callStartedAt: null,
  patch: (value) => set(value),
}));

export function LabPage() {
  const { m: baseMessages, t: baseT, locale, fmt, href } = useI18n();
  const ws = useWorkspaceStore((state) => state.workspace);
  // Script + copy are written around the sample farm's names; show the real farm's names instead.
  const personalize = useMemo(() => makePersonalizer(ws), [ws]);
  const m = useMemo(() => ({ ...baseMessages, lab: personalizeTree(baseMessages.lab, personalize) }), [baseMessages, personalize]);
  const t = useCallback((value: { ar: string; en: string }) => personalize(baseT(value)), [baseT, personalize]);
  const update = useWorkspaceStore((state) => state.update);
  const now = useNow();
  const lab = useLabCall();
  // Ignore a call left over from a different (reset or replaced) workspace.
  const session = lab.session && lab.workspaceKey === ws?.createdAt ? lab.session : null;
  const { selected, baseline, callStartedAt } = lab;
  const setSelected = (value: PickerScenario) => lab.patch({ selected: value });
  const setSession = (value: CallSession | null) => lab.patch({ session: value, workspaceKey: useWorkspaceStore.getState().workspace?.createdAt ?? null });
  const setBaseline = (value: string[]) => lab.patch({ baseline: value });
  const setCallStartedAt = (value: number | null) => lab.patch({ callStartedAt: value });

  const availability = useMemo(() => ws ? scenarioAvailability(ws, now) : null, [ws, now]);

  if (!ws || !availability) return null;

  const selectedAvailability = availabilityCopy(selected, ws, now, availability, fmt, m);
  const workerLanguageNotice = !isLiveCallLanguage(ws.settings.worker.language);
  const sessionActive = Boolean(session && !session.done);

  function begin(scenario: Scenario, reportId?: string) {
    const current = useWorkspaceStore.getState().workspace;
    if (!current) return;
    setBaseline(current.events.map((event) => event.id));
    const result = start(current, now, scenario, reportId ? { reportId } : {});
    setSession(result.session);
    setCallStartedAt(Date.now());
    if (result.commit) update(() => result.commit!(current));
  }

  function respond(input: AnswerInput) {
    const current = useWorkspaceStore.getState().workspace;
    if (!current || !session) return;
    const result = answer(session, current, now, input);
    setSession(result.session);
    if (result.commit) update(() => result.commit!(current));
  }

  /** Ends the call. An unfinished call goes through the engine so abandoned state is undone. */
  function finish() {
    const current = useWorkspaceStore.getState().workspace;
    if (current && session && !session.done) {
      const result = hangUp(session, current, now);
      if (result.commit) update(() => result.commit!(current));
    }
    setSession(null);
    setCallStartedAt(null);
  }

  function advance(ms: number) {
    update((current) => advanceClock(current, ms));
  }

  function jumpNextDay() {
    const target = atRiyadhTime(now, 17, 0, 1);
    update((current) => setClockTo(current, target));
  }

  function jumpToWindow() {
    const current = useWorkspaceStore.getState().workspace;
    if (!current?.settings.window || !isValidWindow(current.settings.window)) return;
    const startAt = nextWindowStart(now, current.settings.window);
    const target = new Date(startAt.getTime() + 5 * MINUTE);
    update((current) => setClockTo(current, target));
  }

  const availabilityTone = selectedAvailability.tone;
  const isEmergency = session ? session.scenario === "emergency" : selected === "emergency";

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-[-0.025em] text-espresso">{m.lab.title}</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-muted sm:text-base">{m.lab.subtitle}</p>
        <div className="max-w-2xl text-sm leading-relaxed text-muted">
          <p>{m.lab.planNote[ws.settings.plan]}</p>
          <Link href={`${href("/app/settings")}#settings-plan`} className="inline-flex min-h-11 items-center font-semibold text-brown underline decoration-stone underline-offset-4 hover:decoration-brown">
            {m.lab.comparePlans}
          </Link>
        </div>
      </header>

      <section aria-label={m.lab.title} className="space-y-3">
        {/* Every call type stays in view: a 2×2 choice on phones, the underlined row on wide screens. */}
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4 lg:gap-6 lg:border-b lg:border-stone">
          {PICKER_SCENARIOS.map((scenario) => {
            const key = scenarioMessageKey(scenario);
            const current = selected === scenario;
            const disabled = sessionActive && !current;
            return (
              <button
                key={scenario}
                type="button"
                aria-pressed={current}
                disabled={disabled}
                onClick={() => setSelected(scenario)}
                className={cn(
                  "min-h-16 rounded-xl border px-3 py-2.5 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brown lg:-mb-px lg:min-h-0 lg:rounded-none lg:border-0 lg:border-b-2 lg:px-0 lg:pb-3.5 lg:pt-1",
                  current ? "border-brown bg-cream text-espresso lg:bg-transparent" : "border-stone text-muted hover:text-espresso lg:border-transparent",
                  disabled && "cursor-not-allowed opacity-50",
                )}
              >
                <span className="block text-sm font-semibold leading-snug lg:text-base">{m.lab.scenarios[key].title}</span>
                <span className="mt-1 hidden text-xs leading-relaxed text-muted lg:block">{m.lab.scenarios[key].detail}</span>
              </button>
            );
          })}
        </div>

        <p className="text-sm leading-relaxed text-muted lg:hidden">{m.lab.scenarios[scenarioMessageKey(selected)].detail}</p>

        <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2.5">
            <Badge tone={availabilityTone} dot>{m.lab.availability.label}</Badge>
            <p className="pt-0.5 text-sm leading-relaxed text-muted">
              {selectedAvailability.text}
              {selectedAvailability.time ? <> <bdi className="ltr-nums">{selectedAvailability.time}</bdi></> : null}
            </p>
          </div>
          {selectedAvailability.jump ? (
            <Button variant="secondary" size="sm" onClick={jumpToWindow} className="min-h-11">
              {m.lab.availability.jumpToWindow}
            </Button>
          ) : null}
        </div>
      </section>

      <div className="flex flex-col gap-3 border-y border-stone/70 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Clock size={20} className="shrink-0 text-brown" aria-hidden />
          <div>
            <p className="font-semibold">{m.lab.clock.title}</p>
            <p className="text-sm text-muted"><bdi className="ltr-nums">{fmt.dateTime(now)}</bdi> <span className="mx-1 text-faint">·</span>{m.lab.clock.current}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" className="min-h-11" onClick={() => advance(20 * MINUTE)}>{m.lab.clock.plus20}</Button>
          <Button variant="secondary" size="sm" className="min-h-11" onClick={() => advance(HOUR)}>{m.lab.clock.plusHour}</Button>
          <Button variant="secondary" size="sm" className="min-h-11" onClick={jumpNextDay}>{m.lab.clock.nextDay}</Button>
          {ws.settings.plan === "basic" && ws.settings.window && isValidWindow(ws.settings.window) ? (
            <Button variant="secondary" size="sm" className="min-h-11" onClick={jumpToWindow}>{m.lab.clock.jumpWindow}</Button>
          ) : null}
          {ws.settings.farm.coords && heatLevel(weatherForToday(ws, now)?.maxTempC ?? 0) === "none" ? (
            <Button variant="secondary" size="sm" className="min-h-11" onClick={() => update((current) => withDemoHeat(current, now))}>{m.integrations.weather.simulateHeatDay}</Button>
          ) : null}
        </div>
      </div>

      {workerLanguageNotice ? (
        <p className="text-sm leading-relaxed text-info">{m.lab.languageNote(t(WORKER_LANGUAGES.find((item) => item.id === ws.settings.worker.language)?.label ?? { ar: "", en: "" }))}</p>
      ) : null}

      <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,460px)_minmax(0,1fr)] lg:items-start">
        <div className="min-w-0 space-y-4">
          {isEmergency ? (
            <EmergencyPanel ws={ws} m={m} t={t} />
          ) : (
            <PhoneStage
              session={session}
              selected={selected}
              ws={ws}
              timerStarted={callStartedAt}
              m={m}
              locale={locale}
              t={t}
              blockedReason={selectedAvailability.enabled ? null : selectedAvailability.text}
              onStart={() => begin(selected)}
              onAnswer={respond}
              onEnd={finish}
            />
          )}
          {session?.next && session.scenario === "worker_report" ? (
            <Card className="flex flex-col gap-3 border-brown/30 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <h2 className="font-bold">{m.lab.transition.title}</h2>
                <p className="mt-1 text-sm leading-relaxed text-muted">{m.lab.transition.detail}</p>
              </div>
              <Button className="min-h-11 shrink-0" onClick={() => begin("owner_notification", session.next?.reportId)}>
                {m.lab.transition.start}
              </Button>
            </Card>
          ) : session?.scenario === "owner_notification" && session.done && ws.pendingWorkerCalls.some((call) => call.state === "pending") ? (
            <Card className="flex flex-col gap-3 border-brown/30 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <h2 className="font-bold">{m.lab.toWorker.title}</h2>
                <p className="mt-1 text-sm leading-relaxed text-muted">{m.lab.toWorker.detail}</p>
              </div>
              <Button
                className="min-h-11 shrink-0"
                onClick={() => {
                  setSelected("worker_outbound");
                  begin("worker_outbound");
                }}
              >
                {m.lab.toWorker.start}
              </Button>
            </Card>
          ) : null}
          {isEmergency && session ? (
            <Button variant="secondary" className="min-h-11" onClick={finish}>{m.lab.phone.cancel}</Button>
          ) : null}
        </div>
        <InsidePanel ws={ws} session={session} baseline={baseline} m={m} t={t} />
      </div>
    </div>
  );
}
