"use client";

import { ArrowRight, Phone } from "@phosphor-icons/react";
import Link from "next/link";
import type { ReactNode } from "react";
import { formatSaudiMobile } from "@/components/setup/phone";
import type { Workspace } from "@/domain";
import { useI18n } from "@/i18n/client";
import { useIsAccount } from "@/store/workspace";
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

function CallColumn({ label, who, next, detail, status, actions }: { label: string; who?: ReactNode; next: Date | null; detail: ReactNode; status: string | null; actions?: ReactNode }) {
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
      {who}
      {status ? <p role="status" className="naqah-name mt-1.5 text-sm font-medium leading-snug text-cream">{status}</p> : null}
      {actions ? <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-3">{actions}</div> : null}
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
  const account = useIsAccount();
  const when = (at: Date) => <>{fmt.dateTime(at, dayMonth)} · <span className="font-semibold text-cream">{fmt.relative(at, now)}</span></>;
  const settings = href("/app/settings");
  const phone = ws.settings.worker.phone.trim();
  // Who NAQAH calls, and the one place to change it: the workers in Settings.
  const who = (
    <p className="flex flex-wrap items-center gap-x-2 text-sm text-cream/75">
      {phone ? <span dir="ltr" className="ltr-nums">{formatSaudiMobile(phone)}</span> : <span>{d.noWorkerPhone}</span>}
      <span aria-hidden>·</span>
      <Link href={`${settings}#settings-team`} className="inline-flex min-h-11 items-center font-semibold text-cream underline decoration-cream/40 underline-offset-4 transition hover:decoration-cream focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cream">
        {d.changeWorker}
      </Link>
    </p>
  );
  // The demo's calls are simulations in the Call Lab; a real account uses "Call now" where it is available.
  const demoCall = !account && nextWorker ? (
    <Link href={href("/app/lab")} prefetch={false} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-cream px-5 text-sm font-semibold text-espresso transition hover:bg-ivory active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cream">
      <Phone size={16} weight="fill" aria-hidden />
      {d.simulateWith(worker)}
    </Link>
  ) : null;

  const actions = (
    <>
      {!nextWorker ? (
        <Link href={`${settings}#settings-report-call`} className="naqah-nudge inline-flex min-h-11 items-center gap-1.5 rounded-full bg-cream px-5 text-sm font-semibold text-espresso transition hover:bg-ivory active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cream">
          {o.setCallTime}
          <ArrowRight size={15} className="naqah-nudge-icon rtl:-scale-x-100" aria-hidden />
        </Link>
      ) : (
        <>
          {demoCall}
          {callNow}
          <Link href={`${settings}#settings-report-call`} className="naqah-nudge inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-cream underline decoration-cream/40 underline-offset-4 transition hover:decoration-cream focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cream">
            {d.callTimes}
            <ArrowRight size={14} className="naqah-nudge-icon rtl:-scale-x-100" aria-hidden />
          </Link>
        </>
      )}
    </>
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
        <CallColumn
          label={!nextWorker ? d.nextCall : scheduledOff ? d.plannedCall : hasReport ? o.callsWorker(worker) : o.firstCallsWorker(worker)}
          who={who}
          actions={actions}
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
    </div>
  );
}
