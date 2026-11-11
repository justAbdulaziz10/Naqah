"use client";

import { PhoneOutgoing } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { formatSaudiMobile } from "@/components/setup/phone";
import { ConfirmDialog } from "@/components/ui";
import { dialableOwnerPhone } from "@/domain/ownerCalls";
import type { Workspace } from "@/domain/types";
import { useI18n } from "@/i18n/client";
import { accountSync, reportCallNow } from "@/store/account";

/** LOCAL DEMO build only (the runner's --owner-call-now): «العامل / المالك» above «اتصال حقيقي». */
export const OWNER_CALL_DEMO = process.env.NEXT_PUBLIC_NAQAH_DEMO_OWNER_CALL === "1";

export type CallTarget = "worker" | "owner";

type Detail = { enabled: boolean; numberApproved: boolean | null; live: boolean; runId: string | null; state: string | null };

/** Whether this ranch may take «المالك»: asked once; the switch only shows when the server says yes. */
export function useOwnerCallDemo(account: boolean): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    if (!OWNER_CALL_DEMO || !account) return;
    let live = true;
    void fetch("/api/owner-call-now", { cache: "no-store", signal: AbortSignal.timeout(10_000) })
      .then((response) => (response.ok ? response.json() : null))
      .then((detail) => { if (live) setEnabled(detail?.ok === true && detail.enabled === true); })
      .catch(() => {});
    return () => { live = false; };
  }, [account]);
  return enabled;
}

/** Two options, worker first and chosen by default. Sits on its own row above the call button. */
export function CallTargetSwitch({ value, onChange }: { value: CallTarget; onChange: (value: CallTarget) => void }) {
  const { m } = useI18n();
  const c = m.setup.dashboard.ownerCall;
  const options: CallTarget[] = ["worker", "owner"];
  return (
    <div role="radiogroup" aria-label={c.who} className="order-first inline-flex basis-full sm:justify-end">
      <div className="inline-flex rounded-full border border-cream/30 p-0.5 max-sm:w-full">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={value === option}
            onClick={() => onChange(option)}
            className={`min-h-11 min-w-24 rounded-full px-4 text-sm font-semibold transition max-sm:flex-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cream ${value === option ? "bg-cream text-espresso" : "text-cream/80 hover:text-cream"}`}
          >
            {option === "worker" ? c.worker : c.owner}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * «اتصال حقيقي» with «المالك» chosen: NAQAH calls the owner's own saved number now with the briefing. The confirmation
 * names the owner and the number; every refusal says why. The server applies the same rules again.
 */
export function OwnerCallNowButton({ ws, available, primary }: { ws: Workspace; available: boolean | null; primary: boolean }) {
  const { m, t } = useI18n();
  const d = m.setup.dashboard;
  const c = d.ownerCall;
  const owner = ws.settings.owner.name.trim() || c.owner;
  const phone = dialableOwnerPhone(ws);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // The run that was latest when the call was placed, so "NAQAH is calling" ends with that call.
  const [placed, setPlaced] = useState<{ before: string | null } | null>(null);
  const sending = useRef(false);

  useEffect(() => {
    let live = true;
    const ask = () => fetch("/api/owner-call-now", { cache: "no-store", signal: AbortSignal.timeout(10_000) })
      .then((response) => (response.ok ? response.json() : null))
      .then((next: (Detail & { ok?: boolean }) | null) => {
        if (!live || !next?.ok || !next.enabled) return;
        setDetail(next);
        // The placed call has ended: say how, and pick up its outcome on the Dashboard.
        if (placed && next.runId !== placed.before && !next.live && (next.state === "completed" || next.state === "missed")) {
          setPlaced(null);
          setNotice(next.state === "completed" ? c.done(owner) : c.missed(owner));
          void accountSync.refresh();
        }
      })
      .catch(() => {});
    void ask();
    const timer = setInterval(() => void ask(), placed ? 3_000 : 10_000);
    return () => { live = false; clearInterval(timer); };
  }, [phone, placed, c, owner]);

  async function call() {
    if (sending.current) return;
    sending.current = true;
    setConfirming(false);
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch("/api/owner-call-now?preflight=1", { cache: "no-store", signal: AbortSignal.timeout(15_000) });
      const ready = response.ok ? await response.json() : null;
      if (!ready?.ready) {
        setNotice(ready?.message ? t(ready.message) : d.callNowResult.failed);
        return;
      }
      const before = detail?.runId ?? null;
      const result = await reportCallNow.callOwner();
      if (!result.ok) setNotice(result.error === "unauthenticated" ? d.callNowResult.signedOut : result.error === "unavailable" ? c.unavailable : d.callNowResult.failed);
      else if (result.data.status === "placed") setPlaced({ before });
      else setNotice(c[result.data.reason]);
      void accountSync.refresh();
    } catch {
      setNotice(d.callNowResult.failed);
    } finally {
      sending.current = false;
      setPending(false);
    }
  }

  const live = detail?.live === true;
  const reason = available === null ? m.app.overview.callBar.checking
    : available === false ? m.app.overview.callBar.callOff
    : !phone ? c.noPhone
    : detail?.numberApproved === false ? c.notApproved
    : live && !placed ? c.call_live
    : null;
  const off = available !== true || !phone || detail === null || detail.numberApproved !== true || live;
  const message = notice ?? (placed ? c.placed(owner) : null);
  return (
    <>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        disabled={pending || off || placed !== null}
        aria-describedby={reason ? "owner-call-now-reason" : undefined}
        className={primary
          ? "inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-cream px-5 max-sm:w-full text-sm font-semibold text-espresso transition hover:bg-ivory active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cream disabled:cursor-not-allowed disabled:bg-cream/40 disabled:text-espresso/70 disabled:active:scale-100"
          : "inline-flex min-h-11 items-center gap-2 rounded-full border border-cream/40 px-5 text-sm font-semibold text-cream transition hover:border-cream active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cream disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-cream/40 disabled:active:scale-100"}
      >
        <PhoneOutgoing size={16} aria-hidden />
        {pending ? d.calling : d.callNow}
      </button>
      {reason ? <p id="owner-call-now-reason" className="order-last basis-full text-[0.8125rem] leading-snug text-cream/70">{reason}</p> : null}
      {message ? <p className="order-last basis-full text-sm text-cream/80" role="status">{message}</p> : null}
      {confirming && phone ? (
        <ConfirmDialog
          title={c.confirmTitle(owner)}
          body={c.confirmBody(`⁦${formatSaudiMobile(phone)}⁩`)}
          confirmLabel={d.confirmCall}
          cancelLabel={d.cancel}
          onConfirm={() => void call()}
          onCancel={() => setConfirming(false)}
          tone="primary"
        />
      ) : null}
    </>
  );
}
