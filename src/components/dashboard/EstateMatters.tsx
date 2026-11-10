"use client";

import { WarningCircle } from "@phosphor-icons/react";
import Link from "next/link";
import type { ReactNode } from "react";
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

/** One stop on a short timeline: down the page on phones, across it from md. */
export function Step({ title, detail, last = false, waiting = false, missed = false }: { title: ReactNode; detail?: string | null; last?: boolean; waiting?: boolean; missed?: boolean }) {
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

function MatterRow({ ws, matter, reportAt, worker, now, undelivered }: { ws: Workspace; matter: EstateMatter; reportAt: string | null; worker: string; now: Date; undelivered: UndeliveredCall[] }) {
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
  const reportedDetail = reported && reported !== headline
    ? at && at !== reportAt ? m.app.overview.reportedAt(worker, fmt.relative(at, now)) : m.app.overview.reportedBy(worker)
    : null;
  const instructionText = instruction && instruction.text !== headline ? instruction.text : instructionTitle;

  return (
    <li className="py-5 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="naqah-name text-lg font-semibold leading-snug text-espresso">
          {headlineHref ? <Link href={headlineHref} className={`${recordLink} ${target}`}>{headline}</Link> : headline}
        </p>
        {camel ? <HealthBadge health={camel.health} /> : null}
        {/* Reported by the worker is what the step below says; only other provenance shows here. */}
        {camel && camel.certainty !== "reported" ? <CertaintyBadge certainty={camel.certainty} /> : null}
      </div>
      <ol className="mt-4 flex min-w-0 flex-col md:flex-row">
        {reported ? <Step title={reportedTitle} detail={reportedDetail} last={!instruction} /> : null}
        {instruction ? (
          <Step
            title={taskHref ? <Link href={taskHref} className={`${recordLink} ${target}`}>{instructionText}</Link> : instructionText}
            detail={instructionText === instructionTitle ? null : instructionTitle}
          />
        ) : null}
        {waiting ? <Step title={waiting.title} detail={waiting.detail} last waiting missed={Boolean(stopped)} /> : null}
      </ol>
    </li>
  );
}

function UndeliveredRow({ call, worker }: { call: UndeliveredCall; worker: string }) {
  const { m, fmt } = useI18n();
  return (
    <li className="flex items-start gap-3 py-5 first:pt-0 last:pb-0">
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
  const { m, fmt, href } = useI18n();
  const folded = new Set(matters.flatMap((matter) => matter.instructions.map((item) => item.id)));
  const standalone = undelivered.filter((call) => !call.taskIds.some((id) => folded.has(id)) && !(call.relayId && folded.has(call.relayId)));
  const shownUndelivered = standalone.slice(0, ROW_LIMIT);
  const shownMatters = matters.slice(0, ROW_LIMIT - shownUndelivered.length);
  const hidden = standalone.length + matters.length - shownUndelivered.length - shownMatters.length;
  // A calm day has no section at all: the estate header has already said so.
  if (!shownUndelivered.length && !shownMatters.length) return null;
  return (
    <section aria-labelledby="estate-matters" className="naqah-rise rounded-[var(--radius-card)] border border-stone/70 bg-cream px-5 py-5 sm:px-8 sm:py-7">
      <h2 id="estate-matters" className="text-xl font-semibold leading-tight tracking-[-0.01em] text-espresso">{m.app.overview.attention}</h2>
      <ul className="mt-5 divide-y divide-stone/70">
        {shownUndelivered.map((call) => <UndeliveredRow key={call.id} call={call} worker={worker} />)}
        {shownMatters.map((matter) => <MatterRow key={matter.id} ws={ws} matter={matter} reportAt={reportAt} worker={worker} now={now} undelivered={undelivered} />)}
      </ul>
      {hidden > 0 ? (
        <Link href={href("/app/tickets")} className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-brown underline decoration-stone underline-offset-4 hover:decoration-brown">
          {m.app.overview.moreMatters(fmt.number(hidden))}
        </Link>
      ) : null}
    </section>
  );
}
