"use client";

import { WarningCircle } from "@phosphor-icons/react";
import Link from "next/link";
import type { ReactNode } from "react";
import { CertaintyBadge, HealthBadge, noAnswerAttemptInfo } from "@/components/dashboard/DashboardPrimitives";
import type { NoAnswerTicket, Workspace } from "@/domain";
import { useI18n } from "@/i18n/client";
import { isHerdFinding, type EstateMatter, type MatterInstruction } from "./matters";

const ROW_LIMIT = 4;
const recordLink = "underline decoration-stone underline-offset-4 hover:decoration-brown focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brown";

/** One stop on a short timeline: down the page on phones, across it from md. */
export function Step({ title, detail, last = false, waiting = false }: { title: ReactNode; detail?: string | null; last?: boolean; waiting?: boolean }) {
  return (
    <li className="relative flex min-w-0 flex-1 gap-3 pb-4 last:pb-0 md:block md:pb-0 md:pe-5">
      <span className="relative flex w-3 shrink-0 flex-col items-center md:h-3 md:w-full md:flex-row">
        <span className={`z-10 mt-1.5 size-3 shrink-0 rounded-full md:mt-0 ${waiting ? "border-2 border-brown bg-cream" : "bg-brown"}`} aria-hidden />
        {last ? null : <span className="absolute inset-y-0 start-1/2 top-3 w-px -translate-x-1/2 bg-stone md:inset-x-0 md:start-3 md:top-1/2 md:h-px md:w-auto md:translate-x-0" aria-hidden />}
      </span>
      <div className="min-w-0 md:mt-3">
        <p className="font-semibold leading-snug text-espresso">{title}</p>
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

function MatterRow({ ws, matter, reportAt, worker, now }: { ws: Workspace; matter: EstateMatter; reportAt: string | null; worker: string; now: Date }) {
  const { m, t, fmt, href } = useI18n();
  const { camel, findings, instructions } = matter;
  const reported = findings[0] ? t(findings[0].text) : camel?.healthNote ?? null;
  const instruction = instructions[0] ?? null;
  const waiting = instruction ? instructionWaiting(instruction, worker, m) : null;
  const headline = camel?.name ?? (instruction && !reported ? instruction.text : reported);
  const at = camel?.updatedAt ?? reportAt;
  const taskHref = instruction?.kind === "task" ? `${href("/app/tickets")}#task-${instruction.id}` : null;
  const headlineHref = camel
    ? `${href("/app/herd")}#camel-${camel.id}`
    : findings[0] && isHerdFinding(ws, findings[0])
      ? href("/app/herd")
      : instruction && !reported ? taskHref : null;
  const instructionTitle = instruction ? m.app.overview.yourInstruction(fmt.relative(instruction.at, now)) : null;

  return (
    <li className="grid gap-x-8 gap-y-4 py-5 first:pt-0 last:pb-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
      <div className="min-w-0">
        <p className="text-xl font-semibold leading-snug text-espresso">
          {headlineHref ? <Link href={headlineHref} className={recordLink}>{headline}</Link> : headline}
        </p>
        {camel ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            <HealthBadge health={camel.health} />
            <CertaintyBadge certainty={camel.certainty} />
          </div>
        ) : null}
      </div>
      <ol className="flex min-w-0 flex-col md:flex-row">
        {reported ? <Step title={at ? m.app.overview.reportedAt(worker, fmt.relative(at, now)) : m.app.overview.reportedBy(worker)} detail={reported === headline ? null : reported} last={!instruction} /> : null}
        {instruction ? <Step title={taskHref ? <Link href={taskHref} className={recordLink}>{instructionTitle}</Link> : instructionTitle} detail={instruction.text === headline ? null : instruction.text} /> : null}
        {waiting ? <Step title={waiting.title} detail={waiting.detail} last waiting /> : null}
      </ol>
    </li>
  );
}

function UnansweredRow({ ws, ticket, worker }: { ws: Workspace; ticket: NoAnswerTicket; worker: string }) {
  const { m, fmt } = useI18n();
  const info = noAnswerAttemptInfo(ws, ticket);
  return (
    <li className="flex items-start gap-3 py-5 first:pt-0 last:pb-0">
      <WarningCircle className="mt-1 shrink-0 text-danger" size={20} weight="fill" aria-hidden />
      <div className="min-w-0">
        <p className="text-lg font-semibold leading-snug text-espresso">{m.app.overview.workerMissedAttempts(worker, fmt.number(info.count))}</p>
        <p className="mt-1 leading-relaxed text-espresso">{ticket.message}</p>
        <p className="mt-1 text-sm text-muted">{m.app.overview.workerMayCallBack}</p>
      </div>
    </li>
  );
}

/** The one question after "is the estate alright": what is happening about it. */
export function EstateMatters({ ws, matters, unanswered, reportAt, worker, now }: {
  ws: Workspace;
  matters: EstateMatter[];
  unanswered: NoAnswerTicket[];
  reportAt: string | null;
  worker: string;
  now: Date;
}) {
  const { m, fmt, href } = useI18n();
  const shownUnanswered = unanswered.slice(0, ROW_LIMIT);
  const shownMatters = matters.slice(0, ROW_LIMIT - shownUnanswered.length);
  const hidden = unanswered.length + matters.length - shownUnanswered.length - shownMatters.length;
  // A calm day has no section at all: the estate header has already said so.
  if (!shownUnanswered.length && !shownMatters.length) return null;
  return (
    <section aria-labelledby="estate-matters" className="naqah-rise rounded-[var(--radius-card)] border border-stone/70 bg-cream px-5 py-5 sm:px-8 sm:py-6">
      <h2 id="estate-matters" className="text-lg font-semibold text-espresso">{m.app.overview.attention}</h2>
      <ul className="mt-4 divide-y divide-stone/70">
        {shownUnanswered.map((ticket) => <UnansweredRow key={ticket.id} ws={ws} ticket={ticket} worker={worker} />)}
        {shownMatters.map((matter) => <MatterRow key={matter.id} ws={ws} matter={matter} reportAt={reportAt} worker={worker} now={now} />)}
      </ul>
      {hidden > 0 ? (
        <Link href={href("/app/tickets")} className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-brown underline decoration-stone underline-offset-4 hover:decoration-brown">
          {m.app.overview.moreMatters(fmt.number(hidden))}
        </Link>
      ) : null}
    </section>
  );
}
