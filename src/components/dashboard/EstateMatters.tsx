"use client";

import { ArrowRight, WarningCircle } from "@phosphor-icons/react";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { CertaintyBadge, HealthBadge } from "@/components/dashboard/DashboardPrimitives";
import type { Workspace } from "@/domain";
import type { UndeliveredCall } from "@/domain/alerts";
import { useI18n } from "@/i18n/client";
import { AttemptDots } from "@/components/visuals/AttemptDots";
import { isHerdFinding, type EstateMatter, type MatterInstruction } from "./matters";

const ROW_LIMIT = 4;
const recordLink = "underline decoration-stone underline-offset-4 transition-colors hover:decoration-brown focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brown";
/** Record links keep their text size but get a 44px tall target. */
const target = "naqah-name -my-2.5 inline-block py-2.5";

/** One stop on a short timeline: down the page on phones, across it from md unless `stack`. */
export function Step({ title, detail, last = false, waiting = false, missed = false, stack = false }: { title: ReactNode; detail?: string | null; last?: boolean; waiting?: boolean; missed?: boolean; stack?: boolean }) {
  if (stack) {
    return (
      <li className="relative flex min-w-0 gap-3 pb-3 last:pb-0">
        <span className={`z-10 mt-[0.4375rem] size-2.5 shrink-0 rounded-full ${missed ? "border-2 border-warn bg-cream" : waiting ? "border-2 border-brown bg-cream" : "bg-brown"}`} aria-hidden />
        {last ? null : <span className="absolute bottom-0 start-[0.3125rem] top-5 w-px bg-stone" aria-hidden />}
        <div className="min-w-0">
          <p className={`naqah-name leading-snug ${missed ? "font-semibold text-warn" : "text-espresso"}`}>{title}</p>
          {detail ? <p className="mt-0.5 text-sm leading-relaxed text-muted">{detail}</p> : null}
        </div>
      </li>
    );
  }
  return (
    <li className="relative flex min-w-0 flex-1 gap-3 pb-4 last:pb-0 md:block md:pb-0 md:pe-5">
      <span className="relative flex w-3 shrink-0 flex-col items-center md:h-3 md:w-full md:flex-row">
        <span className={`z-10 mt-1.5 size-3 shrink-0 rounded-full md:mt-0 ${missed ? "border-2 border-warn bg-cream" : waiting ? "border-2 border-brown bg-cream" : "bg-brown"}`} aria-hidden />
        {last ? null : <span className="absolute inset-y-0 start-1/2 top-3 w-px -translate-x-1/2 bg-stone md:inset-x-0 md:start-3 md:top-1/2 md:h-px md:w-auto md:translate-x-0" aria-hidden />}
      </span>
      <div className="min-w-0 md:mt-3">
        <p className={`naqah-name font-medium leading-snug ${missed ? "text-warn" : "text-espresso"}`}>{title}</p>
        {detail ? <p className="mt-1 text-sm leading-relaxed text-muted">{detail}</p> : null}
      </div>
    </li>
  );
}

function instructionWaiting(item: MatterInstruction, worker: string, m: ReturnType<typeof useI18n>["m"]) {
  if (item.kind === "relay") return { title: m.app.tickets.notDelivered, detail: m.app.overview.relayWaiting(worker) };
  return {
    title: m.app.overview.waitingFor(worker),
    detail: item.ticket.scheduledFor ? m.app.overview.waitingScheduled : m.app.overview.waitingAnyTime,
  };
}

function undeliveredDetail(call: UndeliveredCall, m: ReturnType<typeof useI18n>["m"], fmt: ReturnType<typeof useI18n>["fmt"]) {
  const o = m.app.overview;
  const count = fmt.number(call.attempts);
  return [call.purpose === "instruction" ? o.calledTimes(count) : o.calledToCheck(count), call.taskIds.length ? o.taskStaysOpen : null].filter(Boolean).join(" ");
}

function MatterRow({ ws, matter, reportAt, worker, now, undelivered, index }: { ws: Workspace; matter: EstateMatter; reportAt: string | null; worker: string; now: Date; undelivered: UndeliveredCall[]; index: number }) {
  const { m, t, fmt, href } = useI18n();
  const { camel, findings, instructions } = matter;
  const reported = findings[0] ? t(findings[0].text) : camel?.healthNote ?? null;
  const instruction = instructions[0] ?? null;
  // NAQAH gave up reaching the worker about this: that is where it stands, so it is said here.
  const stopped = instruction ? undelivered.find((call) => call.taskIds.includes(instruction.id) || call.relayId === instruction.id) ?? null : null;
  const waiting = stopped
    ? { title: m.app.overview.notDeliveredTo(worker), detail: undeliveredDetail(stopped, m, fmt) }
    : instruction ? instructionWaiting(instruction, worker, m) : null;
  const headline = camel?.name ?? (instruction && !reported ? instruction.text : reported);
  const at = camel?.updatedAt ?? reportAt;
  const taskHref = instruction?.kind === "task" ? `${href("/app/tickets")}#task-${instruction.id}` : null;
  const headlineHref = camel
    ? `${href("/app/herd")}#camel-${camel.id}`
    : findings[0] && isHerdFinding(ws, findings[0])
      ? href("/app/herd")
      : instruction && !reported ? taskHref : null;
  const instructionTitle = instruction ? m.app.overview.yourInstruction(fmt.relative(instruction.at, now)) : null;

  const reportedTitle = reported && reported !== headline ? reported : m.app.overview.workerReported(worker);
  // The section says once that this is the worker's report; a row adds provenance only when its time differs.
  const reportedDetail = reported && reported !== headline && at && at !== reportAt ? m.app.overview.reportedAt(worker, fmt.relative(at, now)) : null;
  // A headline that is the report itself needs no "reported" step unless something follows it.
  const showReported = Boolean(reported) && (reported !== headline || Boolean(instruction));
  const instructionText = instruction && instruction.text !== headline ? instruction.text : instructionTitle;

  return (
    <li className="py-5 first:pt-0 last:pb-0" style={{ "--i": index } as CSSProperties}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="naqah-name text-lg font-semibold leading-snug text-espresso">
          {headlineHref ? <Link href={headlineHref} className={`${recordLink} ${target}`}>{headline}</Link> : headline}
        </p>
        {camel ? <HealthBadge health={camel.health} /> : null}
        {/* Reported by the worker is what the step below says; only other provenance shows here. */}
        {camel && camel.certainty !== "reported" ? <CertaintyBadge certainty={camel.certainty} /> : null}
      </div>
      {showReported || instruction ? (
        <ol className="mt-2.5 flex min-w-0 flex-col">
          {showReported ? <Step stack title={reportedTitle} detail={reportedDetail} last={!instruction} /> : null}
          {instruction ? (
            <Step
              stack
              title={taskHref ? <Link href={taskHref} className={`${recordLink} ${target}`}>{instructionText}</Link> : instructionText}
              detail={instructionText === instructionTitle ? null : instructionTitle}
            />
          ) : null}
          {waiting ? <Step stack title={waiting.title} detail={waiting.detail} last waiting missed={Boolean(stopped)} /> : null}
        </ol>
      ) : null}
    </li>
  );
}

function UndeliveredRow({ call, worker, index }: { call: UndeliveredCall; worker: string; index: number }) {
  const { m, fmt } = useI18n();
  return (
    <li className="flex items-start gap-3 py-5 first:pt-0 last:pb-0" style={{ "--i": index } as CSSProperties}>
      <WarningCircle size={22} weight="fill" className="mt-0.5 shrink-0 text-danger" aria-hidden />
      <div className="min-w-0">
        <p className="naqah-name text-lg font-semibold leading-snug text-espresso">{m.app.overview.notDeliveredTo(worker)}</p>
        <p className="mt-1 leading-relaxed text-espresso">{call.message}</p>
        <AttemptDots count={call.attempts} label={m.visual.tasks.attempts(fmt.number(call.attempts))} className="mt-2" />
        <p className="mt-1 text-sm text-muted">{undeliveredDetail(call, m, fmt)}</p>
      </div>
    </li>
  );
}

/** The one question after "is the estate alright": what is happening about it. */
export function EstateMatters({ ws, matters, undelivered, reportAt, worker, now }: {
  ws: Workspace;
  matters: EstateMatter[];
  undelivered: UndeliveredCall[];
  reportAt: string | null;
  worker: string;
  now: Date;
}) {
  const { m, href } = useI18n();
  const folded = new Set(matters.flatMap((matter) => matter.instructions.map((item) => item.id)));
  const standalone = undelivered.filter((call) => !call.taskIds.some((id) => folded.has(id)) && !(call.relayId && folded.has(call.relayId)));
  const shownUndelivered = standalone.slice(0, ROW_LIMIT);
  const shownMatters = matters.slice(0, ROW_LIMIT - shownUndelivered.length);
  const hidden = standalone.length + matters.length - shownUndelivered.length - shownMatters.length;
  // A calm day has no section at all: the estate header has already said so.
  if (!shownUndelivered.length && !shownMatters.length) return null;
  return (
    <section aria-labelledby="estate-matters" className="rounded-[var(--radius-card)] border border-stone/70 bg-cream px-5 py-5 sm:px-8 sm:py-7">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h2 id="estate-matters" className="text-xl font-semibold leading-tight tracking-[-0.01em] text-espresso">{m.app.overview.attention}</h2>
        {shownMatters.length ? <p className="naqah-name text-sm text-muted">{m.app.overview.reportedBy(worker)}</p> : null}
      </div>
      <ul className="naqah-stagger mt-5 divide-y divide-stone/70">
        {shownUndelivered.map((call, index) => <UndeliveredRow key={call.id} call={call} worker={worker} index={index} />)}
        {shownMatters.map((matter, index) => <MatterRow key={matter.id} ws={ws} matter={matter} reportAt={reportAt} worker={worker} now={now} undelivered={undelivered} index={shownUndelivered.length + index} />)}
      </ul>
      {hidden > 0 ? (
        <Link href={href("/app/tickets")} className="naqah-nudge mt-3 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-brown underline decoration-stone underline-offset-4 hover:decoration-brown">
          {m.app.overview.moreMatters(hidden)}
          <ArrowRight size={14} className="naqah-nudge-icon rtl:-scale-x-100" aria-hidden />
        </Link>
      ) : null}
    </section>
  );
}
