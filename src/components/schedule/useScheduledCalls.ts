"use client";

import { useEffect, useState } from "react";

let cached: Promise<boolean | null> | null = null;

/** Whether this deployment places scheduled report calls. null while unknown or unreachable. Flags only. */
function fetchScheduledCalls(): Promise<boolean | null> {
  cached ??= fetch("/api/integrations/status", { cache: "no-store" })
    .then((response) => (response.ok ? response.json() : null))
    .then((status) => (typeof status?.outbound?.scheduledCalls === "boolean" ? status.outbound.scheduledCalls : null))
    .catch(() => null);
  return cached;
}

export function useScheduledCallsOn(): boolean | null {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    void fetchScheduledCalls().then((value) => { if (live) setOn(value); });
    return () => { live = false; };
  }, []);
  return on;
}
