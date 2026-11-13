"use client";

import { ArrowRight } from "@phosphor-icons/react";
import Link from "next/link";
import type { ReactNode } from "react";
import type { Workspace } from "@/domain";
import { useI18n } from "@/i18n/client";
import { nextOwnerCall, ownerCallStatus, type OwnerCallStatus, type WorkerCallStatus } from "./callStatus";
import { dayWord } from "./dayWord";

// formatDateTime fills in every field it is not told to leave out.
const weekdayOnly = { weekday: "long", day: undefined, month: undefined, hour: undefined, minute: undefined } as const;
const timeOnly = { weekday: undefined, day: undefined, month: undefined } as const;
const dayMonth = { weekday: undefined, hour: undefined, minute: undefined } as const;

type M = ReturnType<typeof useI18n>["m"];
type Fmt = ReturnType<typeof useI18n>["fmt"];

function workerLine(status: WorkerCallStatus | null, worker: string, m: M, fmt: Fmt): string | null {
  const run = m.setup.dashboard.run;
  if (!status) return null;
  if (status.kind === "ringing") return run.ringing(worker);
  if (status.kind === "on_call") return run.answered(worker);
  if (status.kind === "retry") return (status.connected ? run.retryCut : run.retry)(fmt.time(status.at), status.attempt, status.of);
  return status.connected ? run.unsaved(worker) : run.missed(worker, status.attempts);
}

function ownerLine(status: OwnerCallStatus | null, m: M, fmt: Fmt): string | null {
  const owner = m.setup.dashboard.owner;
  if (!status) return null;
  if (status.kind === "ringing") return owner.ringing;
  if (status.kind === "on_call") return owner.onCall;
  if (status.kind === "retry") return (status.connected ? owner.retryCut : owner.retry)(fmt.time(status.at), status.attempt, status.of);
  if (status.kind === "completed") return (status.reportId ? owner.told : owner.toldNoReport)(fmt.time(status.at));
  return owner.missed(status.attempts);
}

/**
 * One call. On a phone it is a tight pair of lines, label and time on the first, the date and how
 * far off on the second; on a wide screen it stands as a column with the time large.
 */
function CallColumn({ label, next, now, detail, status }: { label: string; next: Date | null; now: Date; detail: ReactNode; status: string | null }) {
  const { m, fmt } = useI18n();
  // The same day word as the rail above: Today, Tomorrow, then the weekday.
  const day = next ? dayWord(next, now, m.visual.rhythm, () => fmt.dateTime(next, weekdayOnly)) : null;
  return (
    <div className="min-w-0">
      <p className="flex flex-col items-start gap-y-0.5">
        <span className="naqah-name text-[0.8125rem] text-cream/70 sm:text-sm">{label}</span>
        {next ? (
          <span className="text-base font-semibold leading-tight sm:mt-1 sm:text-[1.5rem]">
            {day} <time className="ltr-nums" dateTime={next.toISOString()}>{fmt.dateTime(next, timeOnly)}</time>
          </span>
        ) : (
          <span className="text-base font-semibold leading-tight sm:mt-1 sm:text-[1.5rem]">{m.app.overview.noCallTimeYet}</span>
        )}
      </p>
      {detail ? <p className="mt-0.5 text-[0.875rem] leading-snug text-cream/75 sm:mt-1 sm:text-[0.9375rem]">{detail}</p> : null}
      {status ? <p role="status" className="naqah-name mt-1 text-sm font-medium leading-snug text-cream sm:mt-1.5">{status}</p> : null}
    </div>
  );
}

/**
 * The header's calls, side by side: the next call to the worker and to the owner, each with how its
 * latest attempt stands. A column shows only what is true now; an old run says nothing here.
 */
export function EstateCalls({ ws, now, worker, hasReport, scheduledOff, nextWorker, workerStatus, stacked = false }: {
  ws: Workspace;
  now: Date;
  worker: string;
  hasReport: boolean;
  scheduledOff: boolean;
  nextWorker: Date | null;
  workerStatus: WorkerCallStatus | null;
  /** In the header's side column on wide screens the two calls sit one under the other. */
  stacked?: boolean;
}) {
  const { m, fmt, href } = useI18n();
  const o = m.app.overview;
  const d = m.setup.dashboard;
  const nextOwner = nextOwnerCall(ws, now);
  const when = (at: Date) => <>{fmt.dateTime(at, dayMonth)} · <span className="font-semibold text-cream">{fmt.relative(at, now)}</span></>;
  const settings = href("/app/settings");
  const actions = (
    <>
      {!nextWorker ? (
        <Link href={`${settings}#settings-report-call`} className="naqah-nudge inline-flex min-h-11 items-center gap-1.5 rounded-full border border-cream/35 px-5 text-sm font-semibold text-cream transition hover:bg-cream/10 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cream">
          {o.setCallTime}
          <ArrowRight size={15} className="naqah-nudge-icon rtl:-scale-x-100" aria-hidden />
        </Link>
      ) : (
        <Link href={`${settings}#settings-report-call`} className="naqah-nudge inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-cream underline decoration-cream/40 underline-offset-4 transition hover:decoration-cream focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cream">
          {d.callTimes}
          <ArrowRight size={14} className="naqah-nudge-icon rtl:-scale-x-100" aria-hidden />
        </Link>
      )}
    </>
  );

  return (
    <div className="space-y-2.5 sm:space-y-4">
      <div className={stacked ? "grid grid-cols-2 gap-x-4 gap-y-2.5 sm:gap-x-8 sm:gap-y-4 lg:grid-cols-1 lg:gap-y-6" : "grid grid-cols-2 gap-x-4 gap-y-2.5 sm:gap-x-8 sm:gap-y-4"}>
        <CallColumn
          label={!nextWorker ? d.nextCall : scheduledOff ? d.plannedCall : hasReport ? o.callsWorker(worker) : o.firstCallsWorker(worker)}
          next={nextWorker}
          now={now}
          detail={nextWorker ? (scheduledOff ? o.callingInactive : when(nextWorker)) : null}
          status={workerLine(workerStatus, worker, m, fmt)}
        />
        {nextOwner ? (
          <CallColumn
            label={scheduledOff ? o.plannedForYou : o.callsYou}
            next={nextOwner}
            now={now}
            detail={scheduledOff ? fmt.dateTime(nextOwner, dayMonth) : when(nextOwner)}
            status={ownerLine(ownerCallStatus(ws, now), m, fmt)}
          />
        ) : null}
      </div>
      {/* After both calls, so on a phone it never sits between them. */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">{actions}</div>
    </div>
  );
}

/**
 * The same two calls in one line, for the phone's first screen: the next call to the worker and to
 * the owner, each as a day word and a time. A live attempt (ringing, retry) replaces the time, so
 * the line never promises a call that is already under way.
 */
export function NextCallsLine({ ws, now, worker, nextWorker, workerStatus }: {
  ws: Workspace;
  now: Date;
  worker: string;
  nextWorker: Date | null;
  workerStatus: WorkerCallStatus | null;
}) {
  const { m, fmt } = useI18n();
  const c = m.app.overview.compact;
  const nextOwner = nextOwnerCall(ws, now);
  const live = workerLine(workerStatus, worker, m, fmt);
  const at = (date: Date) => (
    <>
      {dayWord(date, now, m.visual.rhythm, () => fmt.dateTime(date, weekdayOnly))} <time className="ltr-nums" dateTime={date.toISOString()}>{fmt.dateTime(date, timeOnly)}</time>
    </>
  );
  if (live) return <span className="naqah-name font-medium text-cream">{live}</span>;
  if (!nextWorker) return <span className="font-medium text-cream">{m.app.overview.noCallTimeYet}</span>;
  return (
    <>
      <span className="text-cream/70">{c.next} </span>
      <span className="naqah-name font-semibold text-cream">{at(nextWorker)}</span>
      <span className="text-cream/70"> · {worker}</span>
      {nextOwner ? (
        <>
          <span className="text-cream/50" aria-hidden> | </span>
          <span className="naqah-name font-semibold text-cream">{at(nextOwner)}</span>
          <span className="text-cream/70"> · {c.you}</span>
        </>
      ) : null}
    </>
  );
}
