"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Card, CardBody, ConfirmDialog } from "@/components/ui";
import type { TestCallNotReadyReason, TestCallPanelState, TestCallStage, TestCallStatus } from "@/server/calls/test-ranch-manual";
import { useI18n } from "@/i18n/client";
import { useIsAccount } from "@/store/workspace";
import {
  TEST_CALL_STAGES, pressStage, reasonKey, shouldRenderTestCallsPanel, shouldRequestTestCallsPanel, stageStatus, stageToPlace,
} from "./testCallsPanelModel";

type PanelResponse = { ok: true; data: TestCallPanelState | null } | { ok: false; error: string };
type StatusResponse = { ok: true; data: TestCallStatus } | { ok: false; error: string };

const operations: Record<TestCallStage, string> = {
  report: "testCallReport",
  owner_summary: "testCallOwnerSummary",
  worker_instruction: "testCallWorkerInstruction",
  worker_verification: "testCallWorkerVerification",
};

/** Set once the server answers "no panel" (not a test ranch); see shouldRequestTestCallsPanel. */
let serverSaidNoPanel = false;

async function readPanel(): Promise<TestCallPanelState | null> {
  try {
    const response = await fetch("/api/account", {
      method: "POST",
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ op: "testCallsPanel" }),
    });
    if (!response.ok) return null;
    const result = await response.json() as PanelResponse;
    if (result.ok && result.data === null) serverSaidNoPanel = true;
    return result.ok ? result.data : null;
  } catch {
    return null;
  }
}

async function placeStage(stage: TestCallStage): Promise<TestCallStatus> {
  try {
    const response = await fetch("/api/account", {
      method: "POST",
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ op: operations[stage] }),
    });
    const result = await response.json() as StatusResponse;
    return response.ok && result.ok ? result.data : "unavailable";
  } catch {
    return "unavailable";
  }
}

function wallTime(value: string, format: (value: Date) => string): string {
  const time = value.slice(0, 5);
  return format(new Date(`2026-01-01T${time}:00+03:00`));
}

export function TestCallsPanel() {
  const account = useIsAccount();
  const { m, fmt } = useI18n();
  const copy = m.app.overview.testCalls;
  const [panel, setPanel] = useState<TestCallPanelState | null>(null);
  const [confirming, setConfirming] = useState<TestCallStage | null>(null);
  const [busy, setBusy] = useState<TestCallStage | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const sending = useRef(false);

  useEffect(() => {
    if (!shouldRequestTestCallsPanel(account, serverSaidNoPanel)) return;
    let active = true;
    void readPanel().then((state) => { if (active) setPanel(state); });
    return () => { active = false; };
  }, [account]);

  useEffect(() => {
    if (!account || !panel?.callLive) return;
    let active = true;
    const refresh = () => void readPanel().then((state) => { if (active) setPanel(state); });
    const timer = setInterval(refresh, 5_000);
    return () => { active = false; clearInterval(timer); };
  }, [account, panel?.callLive]);

  if (!shouldRenderTestCallsPanel(account, panel)) return null;

  const stageLabels: Record<TestCallStage, string> = {
    report: copy.report,
    owner_summary: copy.ownerSummary,
    worker_instruction: copy.instruction,
    worker_verification: copy.verification,
  };
  const statusText = (stage: TestCallStage, status: TestCallStatus | "ready") => {
    if (status === "ready") return copy.ready;
    if (status === "call_live") return copy.live;
    if (status === "cap_reached") return copy.capReached;
    if (status === "unavailable") return copy.unavailable;
    if (status.startsWith("not_ready:")) {
      const reason = status.slice("not_ready:".length) as TestCallNotReadyReason;
      return copy[reasonKey(stage, reason)] ?? copy.unavailable;
    }
    return copy.unavailable;
  };

  const scheduled = [
    panel.scheduleTimes.report ? copy.reportSchedule(wallTime(panel.scheduleTimes.report, fmt.time)) : null,
    panel.scheduleTimes.ownerSummary ? copy.ownerSchedule(wallTime(panel.scheduleTimes.ownerSummary, fmt.time)) : null,
    panel.scheduleTimes.verification ? copy.verificationSchedule(fmt.dateTime(panel.scheduleTimes.verification)) : null,
  ].filter((value): value is string => value !== null);

  async function confirmCall() {
    const stage = stageToPlace(confirming, sending.current);
    if (!stage) return;
    sending.current = true;
    setConfirming(null);
    setBusy(stage);
    setNotice(null);
    const status = await placeStage(stage);
    setNotice(status === "placed" ? copy.callPlaced : statusText(stage, status));
    const refreshed = await readPanel();
    setPanel(refreshed);
    setBusy(null);
    sending.current = false;
  }

  const dialogStage = confirming ? stageLabels[confirming] : "";
  const dialogBody = confirming
    ? copy.confirmBody(
      dialogStage,
      fmt.number(panel.remainingCalls),
      fmt.number(panel.maxCalls),
      panel.callLive ? copy.live : copy.notLive,
    )
    : "";

  return (
    <Card aria-busy={busy !== null}>
      <CardBody>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h2 className="naqah-heading text-lg text-espresso">{copy.title}</h2>
            <p className="naqah-body mt-1 text-sm text-muted">{copy.intro}</p>
          </div>
          <div className="flex flex-col gap-1 text-sm sm:items-end">
            <p className="text-espresso tabular-nums">
              {copy.remaining(fmt.number(panel.remainingCalls), fmt.number(panel.maxCalls))}
            </p>
            <p className={`inline-flex items-center gap-1.5 ${panel.callLive ? "text-warn" : "text-muted"}`} aria-live="polite">
              <span aria-hidden="true" className={`size-1.5 rounded-full ${panel.callLive ? "bg-warn" : "bg-stone"}`} />
              {panel.callLive ? copy.live : copy.notLive}
            </p>
          </div>
        </div>

        <ul className="mt-4 divide-y divide-stone/70 border-y border-stone/70">
          {TEST_CALL_STAGES.map((stage) => {
            const status = stageStatus(panel.stages[stage]);
            const canPress = pressStage(panel, stage, busy) !== null;
            return (
              <li key={stage} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-5">
                <div className="min-w-0">
                  <p className="font-semibold text-espresso">{stageLabels[stage]}</p>
                  <p className="mt-0.5 text-sm text-muted" aria-live={status === "call_live" ? "polite" : undefined}>
                    {statusText(stage, status)}
                  </p>
                </div>
                <Button
                  size="sm"
                  className="w-full shrink-0 sm:w-auto"
                  disabled={!canPress}
                  aria-label={`${copy.callNow}: ${stageLabels[stage]}`}
                  onClick={() => { setNotice(null); setConfirming(pressStage(panel, stage, busy)); }}
                >
                  {busy === stage ? copy.calling : copy.callNow}
                </Button>
              </li>
            );
          })}
        </ul>

        {notice ? <p className="mt-3 text-sm text-espresso" role="status">{notice}</p> : null}

        <div className="mt-4 space-y-1 text-sm text-muted">
          <p>{copy.scheduleInfo}</p>
          {scheduled.length ? <ul className="space-y-1">{scheduled.map((item) => <li key={item}>{item}</li>)}</ul> : null}
        </div>
      </CardBody>

      {confirming ? (
        <ConfirmDialog
          title={copy.confirmTitle(dialogStage)}
          body={dialogBody}
          confirmLabel={copy.confirmAction}
          cancelLabel={copy.cancel}
          onConfirm={() => void confirmCall()}
          onCancel={() => setConfirming(null)}
          tone="primary"
          confirmDisabled={busy !== null}
        />
      ) : null}
    </Card>
  );
}
