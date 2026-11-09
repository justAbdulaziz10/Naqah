"use client";

import { ArrowUp, HandPalm, PhoneDisconnect, WarningCircle } from "@phosphor-icons/react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Badge, type Tone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import type { Locale } from "@/domain/types";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/cn";
import { estimateUsd, totalTokens } from "./usage";
import { useVoiceLab, type InspectorEntry, type LabFact, type LabMode, type LabPhase, type LabStatus, type LabView, type TranscriptEntry } from "./useVoiceLab";

type Copy = ReturnType<typeof useI18n>["m"]["voiceLab"];

const phaseTone: Record<LabPhase, Tone> = { idle: "neutral", connecting: "gold", live: "ok", ended: "neutral", failed: "danger" };

export function VoiceLabSession({ copy, status, mode, agentLocale, pageLocale, onExit }: {
  copy: Copy;
  status: LabStatus;
  mode: LabMode;
  agentLocale: Locale;
  pageLocale: Locale;
  onExit: () => void;
}) {
  const lab = useVoiceLab(agentLocale);
  const start = lab.start;
  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) void start(mode); });
    return () => { active = false; };
  }, [start, mode]);
  const inCall = lab.phase === "connecting" || lab.phase === "live";

  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
      <section aria-label={copy.transcript.title} className="min-w-0 space-y-4">
        <Conversation copy={copy} lab={lab} inCall={inCall} onReset={() => { lab.reset(); onExit(); }} />
        {lab.error ? <ErrorNote copy={copy} code={lab.error.code} onRetry={() => void lab.start(mode)} /> : null}
        {lab.phase === "live" ? <Tries copy={copy} onSend={lab.sendText} voice={lab.mode === "voice"} /> : null}
      </section>
      <aside className="min-w-0 space-y-4">
        <DraftReport copy={copy} view={lab.view} queue={status.queue} />
        <Usage copy={copy} lab={lab} model={status.model} locale={pageLocale} />
        <Inspector copy={copy} events={lab.events} />
      </aside>
    </div>
  );
}

function Conversation({ copy, lab, inCall, onReset }: { copy: Copy; lab: ReturnType<typeof useVoiceLab>; inCall: boolean; onReset: () => void }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState("");
  useEffect(() => {
    const element = scroller.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [lab.transcript]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    lab.sendText(draft);
    setDraft("");
  };

  const phaseLabel = lab.phase === "idle" ? "" : copy.status[lab.phase];
  const activity = lab.phase !== "live" ? null : lab.workerSpeaking ? copy.workerTalking : lab.agentActive ? copy.agentTalking : copy.listening;

  return (
    <Card className="flex flex-col overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-stone/70 px-4 py-3 sm:px-5">
        <Badge dot tone={phaseTone[lab.phase]}>{phaseLabel}</Badge>
        <span aria-live="polite" className="text-sm text-muted">{activity}</span>
        {lab.mode === "voice" && lab.phase === "live" ? <MicMeter label={copy.micLevel} level={lab.micLevel} /> : null}
        {lab.secondsLeft !== null ? <span className="ltr-nums text-xs tabular-nums text-muted">{clock(lab.secondsLeft)} <span className="sr-only">{copy.timeLeft}</span></span> : null}
        <div className="ms-auto flex gap-1">
          {inCall ? <Button variant="ghost" size="sm" onClick={lab.end}><PhoneDisconnect size={18} aria-hidden />{copy.actions.end}</Button> : null}
          <Button variant="ghost" size="sm" onClick={onReset}>{copy.actions.reset}</Button>
        </div>
      </div>

      <div ref={scroller} role="log" aria-label={copy.transcript.title} className="h-[46dvh] min-h-64 space-y-3 overflow-y-auto px-4 py-4 sm:px-5 lg:h-[52dvh]">
        {lab.transcript.length === 0 ? <p className="py-10 text-center text-sm text-muted">{copy.transcript.empty}</p> : null}
        {lab.transcript.map((entry) => <Line key={entry.id} entry={entry} copy={copy} />)}
      </div>

      {lab.phase === "ended" ? <p className="border-t border-stone/70 px-5 py-3 text-sm text-muted">{copy.ended}</p> : null}
      {lab.phase === "live" ? (
        <form onSubmit={submit} className="flex items-center gap-2 border-t border-stone/70 p-3">
          <label className="sr-only" htmlFor="voice-lab-input">{copy.composer.label}</label>
          <input
            id="voice-lab-input"
            dir="auto"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={copy.composer.placeholder}
            autoComplete="off"
            className="min-h-11 w-full min-w-0 rounded-xl border border-stone bg-ivory px-3 text-base outline-none focus-visible:border-brown focus-visible:ring-2 focus-visible:ring-brown/30"
          />
          <Button type="submit" size="sm" disabled={!draft.trim()} aria-label={copy.composer.send} className="min-h-11 shrink-0">
            <ArrowUp size={18} weight="bold" aria-hidden />
          </Button>
          <Button variant="secondary" size="sm" onClick={lab.interrupt} disabled={!lab.canInterrupt} className="min-h-11 shrink-0" aria-label={copy.composer.interrupt} title={copy.composer.interrupt}>
            <HandPalm size={18} aria-hidden />
            <span className="hidden sm:inline">{copy.composer.interrupt}</span>
          </Button>
        </form>
      ) : null}
    </Card>
  );
}

function Line({ entry, copy }: { entry: TranscriptEntry; copy: Copy }) {
  if (entry.role === "tool") {
    const tools: Record<string, string> = copy.transcript.tools;
    const outcomes: Record<string, string> = copy.transcript.outcomes;
    return (
      <p className={cn("flex items-center gap-2 text-xs font-semibold", entry.clarifying ? "text-warn" : entry.refused ? "text-danger" : "text-ok")}>
        <span aria-hidden className={cn("size-1.5 rounded-full bg-current")} />
        {tools[entry.name] ?? entry.name} · {entry.refused ? `${entry.clarifying ? copy.transcript.clarifying : copy.transcript.refused} (${entry.refused})` : entry.declined ? copy.transcript.declined : outcomes[entry.name] ?? copy.transcript.accepted}
      </p>
    );
  }
  const worker = entry.role === "worker";
  return (
    <div className={cn("max-w-[88%]", worker ? "ms-auto" : "")}>
      <p className={cn("text-xs font-semibold", worker ? "text-brown" : "text-muted")}>
        {worker ? copy.transcript.you : copy.transcript.agent}
        {entry.interrupted ? <span className="ms-2 font-normal text-warn">{copy.transcript.interrupted}</span> : null}
      </p>
      <p dir="auto" className={cn("mt-1 whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-[0.95rem] leading-relaxed", worker ? "bg-sand-soft/70" : "border border-stone/70 bg-cream", entry.interrupted && "opacity-70")}>
        {verbatim(entry.text) || (entry.pending ? <span className="text-muted">{copy.transcript.hearing}…</span> : "—")}
      </p>
    </div>
  );
}

function MicMeter({ label, level }: { label: string; level: number }) {
  return (
    <span role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level * 100)} className="block h-1.5 w-20 overflow-hidden rounded-full bg-stone/60">
      <span className="block h-full origin-[inline-start] bg-brown transition-transform duration-100 motion-reduce:transition-none" style={{ transform: `scaleX(${Math.max(0.03, level)})` }} />
    </span>
  );
}

function Tries({ copy, onSend, voice }: { copy: Copy; onSend: (text: string) => void; voice: boolean }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <h2 className="text-sm font-semibold">{copy.tries.title}</h2>
        {voice ? <p className="text-xs text-muted">{copy.tries.hintVoice}</p> : null}
      </div>
      <dl className="space-y-2">
        {copy.suggestedPhrases.map((row) => (
          <div key={row.group} className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <dt className="w-28 shrink-0 text-xs text-muted">{phraseGroupLabel(copy.tries, row.group)}</dt>
            {row.texts.map((text) => (
              <dd key={text}>
                <button type="button" dir="auto" onClick={() => onSend(text)} className="min-h-11 rounded-lg border border-stone bg-cream px-3 text-sm transition hover:border-brown focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brown">
                  {text}
                </button>
              </dd>
            ))}
          </div>
        ))}
      </dl>
      <p className="text-xs text-muted">{copy.interruptHow}</p>
    </div>
  );
}

function phraseGroupLabel(tries: Copy["tries"], group: string): string {
  switch (group) {
    case "clarify": return tries.clarify;
    case "ambiguous": return tries.ambiguous;
    case "unknown": return tries.unknown;
    case "numbers": return tries.numbers;
    case "confirm": return tries.confirm;
    case "boundary": return tries.boundary;
    default: return group;
  }
}

function ErrorNote({ copy, code, onRetry }: { copy: Copy; code: string; onRetry: () => void }) {
  const errors: Record<string, string> = copy.errors;
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 border-s-2 border-danger py-1 ps-3">
      <WarningCircle size={20} aria-hidden className="shrink-0 text-danger" />
      <p className="min-w-0 flex-1 text-sm font-medium">{errors[code] ?? errors.fallback}</p>
      <Button variant="secondary" size="sm" onClick={onRetry}>{copy.actions.retry}</Button>
    </div>
  );
}

function DraftReport({ copy, view, queue }: { copy: Copy; view: LabView | null; queue: string[] }) {
  const questions = view?.queue ?? queue;
  const answered = view?.answered ?? 0;
  const said = view?.facts.filter((fact) => fact.group === "said") ?? [];
  const structured = view?.facts.filter((fact) => fact.group === "report") ?? [];
  return (
    <Card className="p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-bold">{copy.report.title}</h2>
        <span className="ltr-nums text-xs tabular-nums text-muted">{answered}/{questions.length}</span>
      </div>

      {view ? (
        <p className="mt-3 text-sm">
          <span className="text-muted">{copy.report.mode}: </span>
          <span className="font-semibold">{copy.report.modes[view.mode ?? "choosing"]}</span>
        </p>
      ) : null}

      <ol aria-label={copy.report.questions} className="mt-4 space-y-2">
        {questions.map((question, index) => {
          const done = index < answered;
          const current = view?.mode === "guided" && !view.done && !view.isSummary && index === answered;
          return (
            <li key={`${index}-${question}`} className="flex gap-2.5 text-sm">
              <span aria-hidden className={cn("mt-1.5 size-2.5 shrink-0 rounded-full border-[1.5px] border-brown", done && "bg-brown", current && "ring-2 ring-brown/25")} />
              <span dir="auto" className={cn(done ? "text-muted" : current ? "font-semibold" : "text-muted/90")}>
                <span className="sr-only">{done ? copy.report.done : current ? copy.report.current : copy.report.upcoming}: </span>
                {question}
              </span>
            </li>
          );
        })}
      </ol>

      <h3 className="mt-5 border-t border-stone/70 pt-4 text-sm font-semibold">{copy.report.facts}</h3>
      {said.length ? <Facts facts={said} copy={copy} /> : <p className="mt-1 text-sm text-muted">{copy.report.noFacts}</p>}
      {structured.length ? (
        <>
          <h3 className="mt-4 text-sm font-semibold">{copy.report.structured}</h3>
          <Facts facts={structured} copy={copy} />
        </>
      ) : null}

      {view?.notReported.length ? (
        <>
          <h3 className="mt-4 text-sm font-semibold">{copy.report.notReported}</h3>
          <ul className="mt-1 list-inside list-disc space-y-1 text-sm">{view.notReported.map((topic) => <li key={topic} dir="auto">{topic}</li>)}</ul>
          <p className="mt-1 text-xs text-muted">{copy.report.notReportedNote}</p>
        </>
      ) : null}

      {view?.findings.length ? (
        <>
          <h3 className="mt-4 text-sm font-semibold">{copy.report.findings}</h3>
          <ul className="mt-1 space-y-1 rounded-lg bg-warn-soft p-3 text-sm">{view.findings.map((finding) => <li key={finding} dir="auto">{finding}</li>)}</ul>
        </>
      ) : null}

      {view?.summary ? (
        <>
          <h3 className="mt-4 text-sm font-semibold">{copy.report.summary}</h3>
          <p dir="auto" className="mt-1 text-sm leading-relaxed">{view.summary}</p>
        </>
      ) : null}

      {view ? (
        <p className="mt-4 border-t border-stone/70 pt-3 text-sm">
          {view.contract.valid
            ? <Badge dot tone="ok">{copy.report.contractOk}</Badge>
            : <Badge dot tone="danger">{copy.report.contractBad}: <span className="ltr-nums">{view.contract.field}</span></Badge>}
        </p>
      ) : null}

      {view?.verdict ? (
        <div className="mt-3 border-s-2 border-brown ps-3 text-sm" role="status">
          <p className="font-semibold">
            {copy.report.verdict[view.verdict.kind]}
            {view.verdict.kind === "would_reject" ? <span className="ms-1 font-normal text-muted ltr-nums">({view.verdict.reason})</span> : null}
          </p>
          <p className="text-muted">{copy.report.nothingSaved}</p>
        </div>
      ) : null}
    </Card>
  );
}

function Facts({ facts, copy }: { facts: LabFact[]; copy: Copy }) {
  return (
    <dl className="mt-2 divide-y divide-stone/50">
      {facts.map((fact) => (
        <div key={fact.id} className="py-2">
          <dt dir="auto" className="text-xs text-muted">{fact.label}</dt>
          <dd dir="auto" className="text-sm font-semibold">
            {fact.value}
            {fact.certainty ? <span className="ms-2 text-xs font-normal text-muted">{copy.report.certainty[fact.certainty]}</span> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Usage({ copy, lab, model, locale }: { copy: Copy; lab: ReturnType<typeof useVoiceLab>; model: string; locale: Locale }) {
  const tokens = totalTokens(lab.usage);
  const number = new Intl.NumberFormat(locale === "ar" ? "ar-SA-u-nu-latn" : "en-US");
  return (
    <Card className="p-5">
      <h2 className="text-sm font-semibold">{copy.usage.title}</h2>
      {tokens === 0 ? <p className="mt-1 text-sm text-muted">{copy.usage.none}</p> : (
        <dl className="mt-2 space-y-1 text-sm">
          <div className="flex justify-between gap-3"><dt className="text-muted">{copy.usage.tokens}</dt><dd className="ltr-nums font-semibold tabular-nums">{number.format(tokens)}</dd></div>
          {lab.pricing ? <div className="flex justify-between gap-3"><dt className="text-muted">{copy.usage.cost}</dt><dd className="ltr-nums font-semibold tabular-nums">${estimateUsd(lab.usage, lab.pricing).toFixed(4)}</dd></div> : null}
        </dl>
      )}
      <p className="mt-2 text-xs text-muted">
        <span className="ltr-nums">{copy.usage.model}: {model}</span>
        {tokens > 0 ? <span className="block">{lab.pricing ? copy.usage.costNote : copy.usage.noPrice}</span> : null}
      </p>
    </Card>
  );
}

function Inspector({ copy, events }: { copy: Copy; events: InspectorEntry[] }) {
  const [copied, setCopied] = useState(false);
  const errors = events.filter((event) => event.error).length;
  return (
    <details className="group rounded-2xl border border-stone/80 bg-cream p-5" open={errors > 0 || undefined}>
      <summary className="flex min-h-6 cursor-pointer items-center justify-between gap-3 text-sm font-semibold">
        {copy.inspector.title}
        <span className="ltr-nums text-xs font-normal tabular-nums text-muted">{events.length}{errors ? ` · ${errors} !` : ""}</span>
      </summary>
      {events.length === 0 ? <p className="mt-2 text-sm text-muted">{copy.inspector.empty}</p> : (
        <>
          <ol className="mt-3 max-h-72 space-y-1 overflow-y-auto" dir="ltr">
            {events.map((event) => (
              <li key={event.id} className={cn("break-words font-mono text-[0.72rem] leading-relaxed", event.error ? "text-danger" : "text-muted")}>
                <span className="text-faint">{new Date(event.at).toISOString().slice(11, 19)}</span> {event.kind}{event.detail ? ` ${event.detail}` : ""}
              </li>
            ))}
          </ol>
          <Button variant="ghost" size="sm" className="mt-2" onClick={() => {
            void navigator.clipboard.writeText(events.map((event) => `${new Date(event.at).toISOString()} ${event.kind} ${event.detail ?? ""}`).join("\n")).then(() => setCopied(true));
          }}>{copied ? copy.inspector.copied : copy.inspector.copy}</Button>
        </>
      )}
    </details>
  );
}

/** The verbatim-line instruction quotes its text as JSON, and in text mode the model repeats the quotes. */
const verbatim = (text: string) => text.replace(/^"([\s\S]*)"$/, "$1");

function clock(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
