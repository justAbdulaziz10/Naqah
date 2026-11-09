"use client";

import { Phone, SpeakerHigh } from "@phosphor-icons/react";
import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field, Input } from "@/components/ui/Field";
import { Switch } from "@/components/ui/Switch";
import type { Workspace } from "@/domain";
import type { AnswerInput, CallSession } from "@/domain/conversation/engine";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/cn";
import { CamelMark } from "@/components/brand/CamelMark";
import { scenarioMessageKey, type PickerScenario } from "./labStore";

function subscribeNothing() { return () => {}; }
const voiceAvailable = () => typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
const reducedMotionPreference = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function subscribeReducedMotion(onChange: () => void) {
  if (typeof window === "undefined") return () => {};
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function callerFor(session: CallSession | null, selected: PickerScenario, ws: Workspace, m: ReturnType<typeof useI18n>["m"]) {
  const scenario = session?.scenario ?? selected;
  if (scenario === "report_call") {
    return { name: m.lab.phone.agentName, subtitle: m.lab.phone.simulation + " · " + m.lab.phone.callingWorker(ws.settings.worker.name), naqah: true };
  }
  if (scenario === "worker_inbound" || scenario === "worker_callback") {
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

export function PhoneStage({
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
            <p className="naqah-name text-lg font-bold">{caller.name}</p>
            <p className={cn("naqah-name text-sm text-cream/70", !caller.naqah && "ltr-nums")}>{caller.subtitle}</p>
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
            <span>{session ? m.lab.phone.duration(timer) : m.lab.scenarios[scenarioMessageKey(selected)].title}</span>
          </div>
          {voiceSupported ? (
            <div className="flex items-center gap-2">
              <SpeakerHigh size={16} className="text-cream/75" aria-hidden />
              <span className="text-xs font-semibold text-cream/80">{m.lab.phone.speakLines}</span>
              <Switch checked={speakLines} onChange={setSpeakLines} label={m.lab.phone.speakLines} />
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
            <p className="font-semibold text-espresso">{m.lab.scenarios[scenarioMessageKey(selected)].title}</p>
            <p className="mt-1 text-sm text-muted">{blockedReason ?? m.lab.scenarios[scenarioMessageKey(selected)].detail}</p>
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
              {selected === "report_call" ? m.lab.phone.startReportCall + " · " + m.lab.phone.simulation : m.lab.phone.start}
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

