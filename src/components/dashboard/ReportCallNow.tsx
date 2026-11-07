"use client";

import { useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/ui";
import { dialableWorkerPhone, latestReportCall } from "@/domain/reportCalls";
import { REPORT_CALL_RETRIES } from "@/domain/clock";
import type { Workspace } from "@/domain/types";
import { useI18n } from "@/i18n/client";
import { accountSync, reportCallNow } from "@/store/account";
import { useIsAccount } from "@/store/workspace";

const RECENT_MS = 24 * 60 * 60 * 1000;
const time = { hour: "numeric", minute: "2-digit" } as const;

/**
 * The latest report call, as it really stands, and, where this deployment allows it, the owner's
 * "Call now" for one controlled call. Real accounts only: the demo's calls live in the Call Lab.
 */
export function ReportCallNow({ ws, worker, now }: { ws: Workspace; worker: string; now: Date }) {
  const { m, fmt } = useI18n();
  const d = m.setup.dashboard;
  const account = useIsAccount();
  const [available, setAvailable] = useState(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  // A double click on "Call now" must send one request; state updates arrive too late to stop the second.
  const sending = useRef(false);
  const phone = dialableWorkerPhone(ws); // Shown isolated (U+2066…U+2069) so it reads left to right in Arabic.

  const run = latestReportCall(ws);
  const active = run?.state === "calling" || run?.state === "answered";

  useEffect(() => {
    if (!account) return;
    let live = true;
    void reportCallNow.available().then((result) => { if (live) setAvailable(result.ok && result.data === true); }).catch(() => undefined);
    return () => { live = false; };
  }, [account]);

  // While a call is live, pick up its progress sooner than the usual 30-second refresh.
  useEffect(() => {
    if (!account || !active) return;
    const timer = setInterval(() => void accountSync.refresh(), 5_000);
    return () => clearInterval(timer);
  }, [account, active]);

  if (!account) return null;

  let status: string | null = null;
  if (run && now.getTime() - new Date(run.occurrence).getTime() < RECENT_MS) {
    const last = run.attempts.at(-1);
    if (run.state === "answered") status = d.run.answered(worker);
    else if (run.state === "calling" && last?.result === "pending") status = d.run.ringing(worker);
    else if (run.state === "calling" && run.nextAttemptAt) status = d.run.retry(fmt.dateTime(run.nextAttemptAt, time), run.attempts.length + 1, REPORT_CALL_RETRIES + 1);
    else if (run.state === "missed") status = d.run.missed(worker);
  }

  async function call() {
    if (sending.current) return;
    sending.current = true;
    setConfirming(false);
    setPending(true);
    setNotice(null);
    try {
      const result = await reportCallNow.call();
      if (!result.ok) setNotice(result.error === "unauthenticated" ? d.callNowResult.signedOut : result.error === "unavailable" ? d.callNowResult.unavailable : d.callNowResult.failed);
      else if (result.data.status === "placed") setNotice(d.callNowResult.placed(worker));
      else setNotice(d.callNowResult[result.data.reason]);
      void accountSync.refresh();
    } catch {
      setNotice(d.callNowResult.failed);
    } finally {
      sending.current = false;
      setPending(false);
    }
  }

  if (!status && !available && !notice) return null;
  return (
    <div className="mt-3 space-y-2">
      {status ? <p className="text-sm font-medium text-cream" role="status">{status}</p> : null}
      {available && !active && phone ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          disabled={pending}
          className="min-h-11 rounded-full border border-cream/40 px-4 text-sm font-semibold text-cream transition hover:bg-cream/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cream disabled:opacity-60"
        >
          {pending ? d.calling : d.callNow(worker)}
        </button>
      ) : null}
      {notice ? <p className="text-sm text-cream/80" role="status">{notice}</p> : null}
      {confirming && phone ? (
        <ConfirmDialog
          title={d.confirmTitle(worker)}
          body={d.confirmBody(`\u2066${phone}\u2069`)}
          confirmLabel={d.confirmCall}
          cancelLabel={d.cancel}
          onConfirm={() => void call()}
          onCancel={() => setConfirming(false)}
        />
      ) : null}
    </div>
  );
}
