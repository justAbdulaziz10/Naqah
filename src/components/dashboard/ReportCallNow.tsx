"use client";

import { PhoneOutgoing } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { formatSaudiMobile } from "@/components/setup/phone";
import { ConfirmDialog } from "@/components/ui";
import { dialableWorkerPhone, latestReportCall, reportCallIsLive } from "@/domain/reportCalls";
import type { Workspace } from "@/domain/types";
import { useI18n } from "@/i18n/client";
import { accountSync, reportCallNow } from "@/store/account";
import { useIsAccount } from "@/store/workspace";

/**
 * Where this deployment allows it, the owner's "Call now" for one controlled call. Real accounts
 * only: the demo's calls live in the Call Lab. How the latest call stands is in the estate header.
 */
export function ReportCallNow({ ws, worker, now }: { ws: Workspace; worker: string; now: Date }) {
  const { m } = useI18n();
  const d = m.setup.dashboard;
  const account = useIsAccount();
  const [available, setAvailable] = useState<boolean | null>(null); // null while checking
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  // Which run was latest when a call was placed, so "NAQAH is calling" ends with that call.
  const [placedAfter, setPlacedAfter] = useState<{ runId: string | null } | null>(null);
  // A double click on "Call now" must send one request; state updates arrive too late to stop the second.
  const sending = useRef(false);
  const phone = dialableWorkerPhone(ws); // Shown isolated (U+2066…U+2069) so it reads left to right in Arabic.

  const run = latestReportCall(ws);
  const active = run ? reportCallIsLive(run, now) : false;

  useEffect(() => {
    if (!account) return;
    let live = true;
    void reportCallNow.available().then((result) => { if (live) setAvailable(result.ok && result.data === true); }).catch(() => { if (live) setAvailable(false); });
    return () => { live = false; };
  }, [account]);

  // While a call is live, pick up its progress sooner than the usual 30-second refresh.
  useEffect(() => {
    if (!account || !active) return;
    const timer = setInterval(() => void accountSync.refresh(), 5_000);
    return () => clearInterval(timer);
  }, [account, active]);

  if (!account) return null;

  async function call() {
    if (sending.current) return;
    sending.current = true;
    setConfirming(false);
    setPending(true);
    setNotice(null);
    setPlacedAfter(null);
    try {
      const result = await reportCallNow.call();
      if (!result.ok) setNotice(result.error === "unauthenticated" ? d.callNowResult.signedOut : result.error === "unavailable" ? d.callNowResult.unavailable : d.callNowResult.failed);
      else if (result.data.status === "placed") setPlacedAfter({ runId: run?.id ?? null });
      else setNotice(d.callNowResult[result.data.reason]);
      void accountSync.refresh();
    } catch {
      setNotice(d.callNowResult.failed);
    } finally {
      sending.current = false;
      setPending(false);
    }
  }

  const placedNotice = placedAfter && (active || (run?.id ?? null) === placedAfter.runId) ? d.callNowResult.placed(worker) : null;
  const message = notice ?? placedNotice;
  if (!phone) return null; // The call bar offers to add the number instead.
  // Always shown in an account, so the owner can find it; it only calls where this site allows it.
  const off = available !== true;
  const reason = available === null ? m.app.overview.callBar.checking : available === false ? m.app.overview.callBar.callOff : null;
  return (
    <div className="space-y-2">
      {!active ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          disabled={pending || off}
          aria-describedby={reason ? "call-now-reason" : undefined}
          className="inline-flex min-h-11 items-center gap-2 rounded-full border border-cream/40 px-5 text-sm font-semibold text-cream transition hover:border-cream active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cream disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-cream/40 disabled:active:scale-100"
        >
          <PhoneOutgoing size={16} aria-hidden />
          {pending ? d.calling : d.callNow}
        </button>
      ) : null}
      {reason && !active ? <p id="call-now-reason" className="text-sm text-cream/75">{reason}</p> : null}
      {message ? <p className="text-sm text-cream/80" role="status">{message}</p> : null}
      {confirming && phone ? (
        <ConfirmDialog
          title={d.confirmTitle(worker)}
          body={d.confirmBody(`\u2066${formatSaudiMobile(phone)}\u2069`)}
          confirmLabel={d.confirmCall}
          cancelLabel={d.cancel}
          onConfirm={() => void call()}
          onCancel={() => setConfirming(false)}
          tone="primary"
        />
      ) : null}
    </div>
  );
}
