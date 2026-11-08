"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useScheduledCallsOn } from "@/components/schedule/useScheduledCalls";
import { isCompleteCallSchedule } from "@/domain/schedule";
import type { Workspace } from "@/domain/types";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/cn";
import { reportCallNow } from "@/store/account";
import { useIsAccount } from "@/store/workspace";

/**
 * Where a real account's report call stands, told apart honestly:
 * - `noSchedule`: no complete call time yet;
 * - `scheduled`: the time is saved and this deployment places scheduled calls;
 * - `manual`: scheduled calls are off, but the dashboard's "Call now" is available;
 * - `inactive`: the time is saved and no call of either kind is switched on yet.
 * null while it is still being checked (or in the demo, which never calls).
 */
export type CallingState = "noSchedule" | "scheduled" | "manual" | "inactive";

export function useCallingState(ws: Workspace): CallingState | null {
  const account = useIsAccount();
  const scheduled = useScheduledCallsOn();
  const [manual, setManual] = useState<boolean | null>(null);
  const complete = isCompleteCallSchedule(ws.settings.plan, ws.settings.callSchedule);

  useEffect(() => {
    if (!account || scheduled !== false) return;
    let live = true;
    void reportCallNow
      .available()
      .then((result) => { if (live) setManual(result.ok && result.data === true); })
      .catch(() => { if (live) setManual(false); });
    return () => { live = false; };
  }, [account, scheduled]);

  if (!account) return null;
  if (!complete) return "noSchedule";
  if (scheduled === null) return null;
  if (scheduled) return "scheduled";
  return manual === null ? null : manual ? "manual" : "inactive";
}

/** One honest line about the report call, with an action only when that action really exists. */
export function CallingStateNote({ ws, className, skipMissing = false }: { ws: Workspace; className?: string; /** Where a missing time is already listed. */ skipMissing?: boolean }) {
  const { m, href } = useI18n();
  const state = useCallingState(ws);
  const c = m.setup.call.state;
  const worker = ws.settings.worker.name.trim() || m.setup.call.workerFallback;
  if (!state || state === "scheduled" || (skipMissing && state === "noSchedule")) return null;
  return (
    <p role="status" className={cn("text-[0.9375rem] leading-relaxed text-espresso", className)}>
      {state === "noSchedule" ? c.noSchedule(worker) : state === "inactive" ? c.inactive : c.manual(worker)}
      {state === "manual" ? (
        <>
          {" "}
          <Link href={href("/app")} className="inline-flex min-h-11 items-center font-semibold text-brown underline decoration-sand underline-offset-4 hover:decoration-brown">
            {c.manualAction}
          </Link>
        </>
      ) : null}
    </p>
  );
}
