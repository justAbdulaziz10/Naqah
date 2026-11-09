"use client";

import { ArrowRight } from "@phosphor-icons/react";
import Link from "next/link";
import type { ReactNode } from "react";
import type { Workspace } from "@/domain";
import { useI18n } from "@/i18n/client";
import { nextOwnerCall, ownerCallStatus, type OwnerCallStatus, type WorkerCallStatus } from "./callStatus";

// formatDateTime fills in every field it is not told to leave out.
const dayTime = { weekday: "long", day: undefined, month: undefined } as const;
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

function CallColumn({ label, next, detail, status }: { label: string; next: Date | null; detail: ReactNode; status: string | null }) {
  const { m, fmt } = useI18n();
  return (
    <div className="min-w-0">
      <p className="naqah-name text-sm text-cream/70">{label}</p>
      {next ? (
        <p className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <span className="text-[1.25rem] font-semibold leading-tight sm:text-[1.5rem]">
            <time className="ltr-nums" dateTime={next.toISOString()}>{fmt.dateTime(next, dayTime)}</time>
          </span>
          <span className="text-[0.9375rem] text-cream/75">{detail}</span>
        </p>
      ) : (
        <p className="mt-1 text-[1.25rem] font-semibold leading-tight sm:text-[1.5rem]">{m.app.overview.noCallTimeYet}</p>
      )}
      {status ? <p role="status" className="naqah-name mt-1.5 text-sm font-medium leading-snug text-cream">{status}</p> : null}
    </div>
  );
}

/**
 * The header's calls, side by side: the next call to the worker and to the owner, each with how its
 * latest attempt stands. A column shows only what is true now; an old run says nothing here.
 */
export function EstateCalls({ ws, now, worker, hasReport, scheduledOff, nextWorker, workerStatus, callNow }: {
  ws: Workspace;
  now: Date;
  worker: string;
  hasReport: boolean;
  scheduledOff: boolean;
  nextWorker: Date | null;
  workerStatus: WorkerCallStatus | null;
  callNow: ReactNode;
}) {
  const { m, fmt, href } = useI18n();
  const o = m.app.overview;
  const d = m.setup.dashboard;
  const nextOwner = nextOwnerCall(ws, now);
  const when = (at: Date) => <>{fmt.dateTime(at, dayMonth)} · <span className="font-semibold text-cream">{fmt.relative(at, now)}</span></>;

  return (
    <div className="space-y-4">
      <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
        <CallColumn
          label={!nextWorker ? d.nextCall : scheduledOff ? d.plannedCall : hasReport ? o.callsWorker(worker) : o.firstCallsWorker(worker)}
          next={nextWorker}
          detail={nextWorker ? (scheduledOff ? o.callingInactive : when(nextWorker)) : null}
          status={workerLine(workerStatus, worker, m, fmt)}
        />
        {nextOwner ? (
          <CallColumn
            label={scheduledOff ? o.plannedForYou : o.callsYou}
            next={nextOwner}
            detail={scheduledOff ? fmt.dateTime(nextOwner, dayMonth) : when(nextOwner)}
            status={ownerLine(ownerCallStatus(ws, now), m, fmt)}
          />
        ) : null}
      </div>
      {!nextWorker ? (
        <Link href={`${href("/app/settings")}#settings-report-call`} className="naqah-nudge inline-flex min-h-11 items-center gap-1.5 rounded-full border border-cream/35 px-5 text-sm font-semibold text-cream transition hover:bg-cream/10 active:scale-[0.98]">
          {o.setCallTime}
          <ArrowRight size={15} className="naqah-nudge-icon rtl:-scale-x-100" aria-hidden />
        </Link>
      ) : null}
      {callNow}
    </div>
  );
}
