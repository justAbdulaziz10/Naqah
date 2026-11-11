"use client";

import { PhoneOutgoing } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { formatSaudiMobile } from "@/components/setup/phone";
import { ConfirmDialog } from "@/components/ui";
import { dialableWorkerPhone, latestReportCall, reportCallBlock, reportCallIsLive } from "@/domain/reportCalls";
import type { Workspace } from "@/domain/types";
import { useI18n } from "@/i18n/client";
import { accountSync, reportCallNow } from "@/store/account";
import { useIsAccount } from "@/store/workspace";

/**
 * Where this deployment allows it, the owner's "Call now" for one controlled call. Real accounts
 * only: the demo's calls live in the Call Lab. How the latest call stands is in the estate header.
 */
export function ReportCallNow({ ws, worker, now, primary = false }: { ws: Workspace; worker: string; now: Date; primary?: boolean }) {
  const { m, t } = useI18n();
  const d = m.setup.dashboard;
  const account = useIsAccount();
  const [available, setAvailable] = useState<boolean | null>(null); // null while checking
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  // Which run was latest when a call was placed, so "NAQAH is calling" ends with that call.
  const [placedAfter, setPlacedAfter] = useState<{ runId: string | null } | null>(null);
  // Whether the saved number may be called on this computer; checked again whenever the saved number changes.
  const [approval, setApproval] = useState<{ approved: boolean | null; numbers: string[]; repeat: boolean } | null>(null);
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

  useEffect(() => {
    if (!account || available !== true) return;
    let live = true;
    // A just-saved number may still be on its way to the database: ask once now and once shortly after.
    const ask = () => fetch("/api/report-call-now", { cache: "no-store", signal: AbortSignal.timeout(10_000) })
      .then((response) => (response.ok ? response.json() : null))
      .then((detail) => { if (live && detail?.ok) setApproval({ approved: detail.numberApproved ?? null, numbers: detail.approvedNumbers ?? [], repeat: detail.repeatReports === true }); })
      .catch(() => {});
    void ask();
    const again = setTimeout(() => void ask(), 2_000);
    return () => { live = false; clearTimeout(again); };
  }, [account, available, phone]);

  // While a call is live, pick up its progress sooner than the usual 30-second refresh.
  useEffect(() => {
    if (!account || !active) return;
    const timer = setInterval(() => void accountSync.refresh(), 5_000);
    return () => clearInterval(timer);
  }, [account, active]);

  useEffect(() => {
    if (!account || available !== true) return;
    let live = true;
    const refresh = async () => {
      try {
        const response = await fetch("/api/report-call-now", { cache: "no-store", signal: AbortSignal.timeout(10_000) });
        const detail = response.ok ? await response.json() : null;
        if (!live || !detail?.ok) return;
        if (detail.message) setNotice(t(detail.message));
        if (detail.state === "completed" || detail.state === "missed") setPlacedAfter(null);
        if (detail.state === "completed") setNotice(null);
        if (detail.state !== run?.state) void accountSync.refresh();
      } catch {}
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 5_000);
    return () => { live = false; clearInterval(timer); };
  }, [account, available, run?.state, run?.id, t]);

  if (!account) return null;

  async function call() {
    if (sending.current) return;
    sending.current = true;
    setConfirming(false);
    setPending(true);
    setNotice(null);
    setPlacedAfter(null);
    try {
      const response = await fetch("/api/report-call-now?preflight=1", { cache: "no-store", signal: AbortSignal.timeout(15_000) });
      const ready = response.ok ? await response.json() : null;
      if (!ready?.ready) {
        setNotice(ready?.message ? t(ready.message) : d.callNowResult.failed);
        void accountSync.refresh();
        return;
      }
      const result = await reportCallNow.call();
      if (!result.ok) setNotice(result.error === "unauthenticated" ? d.callNowResult.signedOut : result.error === "unavailable" ? d.callNowResult.unavailable : d.callNowResult.failed);
      else if (result.data.status === "placed") setPlacedAfter({ runId: run?.id ?? null });
      else if (result.data.status === "failed") {
        const status = await fetch("/api/report-call-now", { cache: "no-store", signal: AbortSignal.timeout(10_000) });
        const detail = status.ok ? await status.json() : null;
        setNotice(detail?.message ? t(detail.message) : d.callNowResult.failed);
      } else setNotice(d.callNowResult[result.data.reason]);
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
  // The same rule the server applies (e.g. this period's report is already in) is shown before the
  // press, so the owner never confirms a call that will be refused.
  // The local presentation ranch may call again after today's report; the server applies the same rule.
  const block = reportCallBlock(ws, now, { repeatReports: approval?.repeat === true });
  const notApproved = approval?.approved === false;
  const off = available !== true || (block !== null && block !== "no_worker_phone") || notApproved;
  const reason = available === null ? m.app.overview.callBar.checking
    : available === false ? m.app.overview.callBar.callOff
    : block && block !== "no_worker_phone" ? d.callNowResult[block]
    : notApproved ? d.callNowResult.notApproved(approval!.numbers.map((number) => `\u2066${number}\u2069`).join("، "))
    : null;
  return (
    <div className="space-y-2">
      {!active ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          disabled={pending || off}
          aria-describedby={reason ? "call-now-reason" : undefined}
          className={primary
            ? "inline-flex min-h-11 items-center gap-2 rounded-full bg-cream px-5 text-sm font-semibold text-espresso transition hover:bg-ivory active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cream disabled:cursor-not-allowed disabled:bg-cream/40 disabled:text-espresso/70 disabled:active:scale-100"
            : "inline-flex min-h-11 items-center gap-2 rounded-full border border-cream/40 px-5 text-sm font-semibold text-cream transition hover:border-cream active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cream disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-cream/40 disabled:active:scale-100"}
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
