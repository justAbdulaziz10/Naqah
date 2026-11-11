"use client";

import { Phone, PhoneOutgoing } from "@phosphor-icons/react";
import Link from "next/link";
import { ACCOUNT_DATA } from "@/components/entry/paths";
import { formatSaudiMobile } from "@/components/setup/phone";
import type { Workspace } from "@/domain";
import { useI18n } from "@/i18n/client";
import { useLabCall } from "@/components/lab/labStore";
import { useIsAccount } from "@/store/workspace";
import { ReportCallNow } from "./ReportCallNow";

const simClass = "inline-flex min-h-11 items-center gap-2 rounded-full bg-cream px-5 text-sm font-semibold text-espresso transition hover:bg-ivory active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cream";
const realClass = "inline-flex min-h-11 items-center gap-2 rounded-full border border-cream/40 px-5 text-sm font-semibold text-cream transition hover:border-cream focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cream";
const linkClass = "inline-flex min-h-11 items-center font-semibold text-cream underline decoration-cream/40 underline-offset-4 transition hover:decoration-cream focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cream";

/**
 * The one place to call the worker: who NAQAH calls, their number and where to change it, and the
 * call button. A real account uses the existing "Call now" with its confirmation; the demo opens the
 * Call Lab, where every call is a simulation, and shows the real call beside it: a way to sign in where
 * accounts exist, otherwise disabled with the reason, so the two are never mistaken for each other.
 */
export function CallBar({ ws, worker, now }: { ws: Workspace; worker: string; now: Date }) {
  const { m, href } = useI18n();
  const o = m.app.overview;
  const d = m.setup.dashboard;
  const account = useIsAccount();
  const phone = ws.settings.worker.phone.trim();
  const team = `${href("/app/settings")}#settings-team`;

  return (
    <div className="flex flex-col gap-3 border-t border-cream/15 pt-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:pt-6">
      <div className="min-w-0">
        <p className="naqah-name text-[1.125rem] font-semibold leading-snug text-cream">{o.callsWorker(worker)}</p>
        <p className="flex flex-wrap items-center gap-x-2 text-sm text-cream/80">
          {phone ? (
            <>
              <span className="ltr-nums">{formatSaudiMobile(phone)}</span>
              <span aria-hidden>·</span>
              <Link href={team} className={linkClass}>{o.callBar.changeNumber}</Link>
            </>
          ) : (
            <Link href={team} className={linkClass}>{o.callBar.addNumber(worker)}</Link>
          )}
        </p>
      </div>
      <div className="min-w-0 sm:max-w-sm">
        {account ? (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-2 sm:justify-end sm:text-end">
            {/* The real call is the main action; the simulation sits beside it as the quieter one. */}
            <ReportCallNow ws={ws} worker={worker} now={now} primary />
            <Link href={href("/app/simulate")} prefetch={false} aria-describedby="call-sim-note" className={`${realClass} justify-center max-sm:w-full`}>
              <Phone size={16} weight="fill" aria-hidden />
              {d.simulateWith}
            </Link>
            {/* What the simulation is stays with screen readers; the button already says it. */}
            <p id="call-sim-note" className="sr-only">{o.callBar.practice}</p>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2 sm:justify-end sm:text-end">
            <Link href={href("/app/lab")} prefetch={false} onClick={() => { if (!useLabCall.getState().session) useLabCall.getState().patch({ selected: "report_call" }); }} aria-describedby="call-sim-note" className={simClass}>
              <Phone size={16} weight="fill" aria-hidden />
              {d.simulateWith}
            </Link>
            {ACCOUNT_DATA ? (
              <Link href={href("/login")} aria-describedby="call-real-note" className={realClass}>
                <PhoneOutgoing size={16} aria-hidden />
                {d.callNow}
              </Link>
            ) : (
              <button type="button" disabled aria-describedby="call-real-note" className={`${realClass} cursor-not-allowed opacity-60`}>
                <PhoneOutgoing size={16} aria-hidden />
                {d.callNow}
              </button>
            )}
            <p id="call-sim-note" className="sr-only">{o.callBar.simulated}</p>
            <p id="call-real-note" className="basis-full text-[0.8125rem] leading-snug text-cream/70">{d.callNow}: {ACCOUNT_DATA ? o.callBar.signIn : o.callBar.realDemo}</p>
          </div>
        )}
      </div>
    </div>
  );
}
