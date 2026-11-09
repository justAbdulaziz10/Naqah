"use client";

import { CheckCircle, PhoneOutgoing, WarningCircle } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { CamelMark } from "@/components/brand/CamelMark";
import { PhoneField } from "@/components/setup/onboarding/WizardParts";
import { formatSaudiMobile, isSaudiMobile } from "@/components/setup/phone";
import { Button, Card, ConfirmDialog } from "@/components/ui";
import { ReportFlow, type FlowStep } from "@/components/visuals/ReportFlow";
import { useI18n } from "@/i18n/client";
import type { TestCallBlocker, TestCallError, TestCallView } from "@/server/calls/test-call-api";
import { isActiveTestCall, testCallOutcome, testCallSteps, trackProgress, type TestCallProgress } from "./testCallSteps";

const ENDPOINT = "/api/test-call";
const POLL_MS = 2_000;
const PLACE_TIMEOUT_MS = 30_000;

interface Snapshot {
  ready: boolean;
  blockers: TestCallBlocker[];
  call: TestCallView | null;
}

type Loaded = { kind: "ok"; snapshot: Snapshot } | { kind: "refused" } | { kind: "unreachable" };

async function loadTestCall(signal: AbortSignal): Promise<Loaded> {
  try {
    const response = await fetch(ENDPOINT, { cache: "no-store", signal });
    if (response.status === 401 || response.status === 404) return { kind: "refused" };
    const body = response.ok ? await response.json() : null;
    return body?.ok === true ? { kind: "ok", snapshot: { ready: body.ready === true, blockers: body.blockers ?? [], call: body.call ?? null } } : { kind: "unreachable" };
  } catch {
    return { kind: "unreachable" };
  }
}

type Placed = { ok: true; call: TestCallView } | { ok: false; error: TestCallError };

async function placeTestCall(phone: string): Promise<Placed> {
  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, confirmedCharge: true, consentConfirmed: true, requestId: crypto.randomUUID() }),
      signal: AbortSignal.timeout(PLACE_TIMEOUT_MS),
    });
    const body = await response.json();
    if (body?.ok === true && body.call) return { ok: true, call: body.call };
    return { ok: false, error: body?.error ?? "failed" };
  } catch {
    return { ok: false, error: "failed" };
  }
}

/**
 * One real call to a test number, then whether it worked. The server decides who may use this and
 * whether a call goes out: a refused or failed first load leaves this page, as account owners
 * always have without test access.
 */
export function TestCallPanel() {
  const { m, fmt, href } = useI18n();
  const copy = m.lab.testCall;
  const router = useRouter();
  const [state, setState] = useState<(Snapshot & { progress: TestCallProgress | null }) | null>(null);
  const [phone, setPhone] = useState("");
  const [showPhoneError, setShowPhoneError] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [consent, setConsent] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<TestCallError | null>(null);
  const [pollIssue, setPollIssue] = useState<"retrying" | "lost" | null>(null);
  const sendLock = useRef(false);
  const actionRef = useRef<HTMLButtonElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const dialogWasOpen = useRef(false);

  const adopt = (snapshot: Snapshot) => setState((previous) => ({ ...snapshot, progress: trackProgress(previous?.progress ?? null, snapshot.call) }));
  const call = state?.call ?? null;
  const active = call !== null && isActiveTestCall(call.status);
  const activeId = active ? call.id : null;

  // The page behind a modal can't take focus, so it moves once the dialog is gone.
  useEffect(() => {
    if (confirming) {
      dialogWasOpen.current = true;
    } else if (dialogWasOpen.current) {
      dialogWasOpen.current = false;
      (sendLock.current ? progressRef : actionRef).current?.focus();
    }
  }, [confirming]);

  useEffect(() => {
    const controller = new AbortController();
    void loadTestCall(controller.signal).then((loaded) => {
      if (controller.signal.aborted) return;
      if (loaded.kind === "ok") adopt(loaded.snapshot);
      else router.replace(href("/app"));
    });
    return () => controller.abort();
  }, [href, router]);

  useEffect(() => {
    if (!activeId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => { timer = setTimeout(() => void poll(), POLL_MS); };
    const poll = async () => {
      const loaded = await loadTestCall(controller.signal);
      if (controller.signal.aborted) return;
      if (loaded.kind === "refused") return setPollIssue("lost");
      if (loaded.kind === "unreachable") {
        setPollIssue("retrying");
        return schedule();
      }
      setPollIssue(null);
      adopt(loaded.snapshot);
      if (loaded.snapshot.call?.id === activeId && isActiveTestCall(loaded.snapshot.call.status)) schedule();
    };
    schedule();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [activeId]);

  if (!state) {
    return (
      <div className="flex min-h-[50dvh] items-center justify-center" role="status" aria-label={copy.loading}>
        <CamelMark className="h-10 w-auto animate-pulse opacity-60" />
      </div>
    );
  }

  function askToConfirm() {
    if (!isSaudiMobile(phone)) return setShowPhoneError(true);
    setConsent(false);
    setConfirming(true);
  }

  async function confirmCall() {
    if (sendLock.current || !consent) return;
    sendLock.current = true;
    setConfirming(false);
    setSending(true);
    setError(null);
    setPollIssue(null);
    const placed = await placeTestCall(formatSaudiMobile(phone).replace(/\s/g, ""));
    if (placed.ok) {
      setState((previous) => ({
        ready: previous?.ready ?? true,
        blockers: previous?.blockers ?? [],
        call: placed.call,
        progress: trackProgress(previous?.progress ?? null, placed.call),
      }));
    } else {
      setError(placed.error);
      // A lost response may still have placed a call, and a refusal may mean readiness changed.
      const latest = await loadTestCall(AbortSignal.timeout(PLACE_TIMEOUT_MS));
      if (latest.kind === "ok") adopt(latest.snapshot);
    }
    sendLock.current = false;
    setSending(false);
  }

  const visibleError = active ? null : error;
  const shownCall = visibleError || sending ? null : call;
  const finished = shownCall !== null && !isActiveTestCall(shownCall.status);
  const outcome = finished ? testCallOutcome(shownCall) : null;
  const worked = outcome === "report_saved";
  const resultCopy = outcome ? copy.results[outcome] ?? copy.results.failed : null;
  const resultDetail = shownCall?.failure ? copy.failures[shownCall.failure] ?? resultCopy?.detail : resultCopy?.detail;
  const blockedLines = sending
    ? [copy.reason.sending]
    : active
      ? [copy.reason.active]
      : state.ready
        ? []
        : state.blockers.length
          ? state.blockers.map((blocker) => copy.blockers[blocker] ?? copy.reason.notReady)
          : [copy.reason.notReady];
  const disabled = blockedLines.length > 0;

  const stepViews = testCallSteps(state.ready, shownCall, state.progress);
  const steps: FlowStep[] = stepViews.map(({ step, state: mark, current }) => ({
    key: step,
    state: mark,
    detail: current ? copy.now : undefined,
    title: (
      <>
        {copy.steps[step]}
        <span className="sr-only"> ({mark === "done" ? copy.stepState.happened : mark === "missed" ? copy.stepState.failed : copy.stepState.upcoming})</span>
      </>
    ),
  }));

  const liveStep = stepViews.findLast((item) => item.current)?.step;
  const announcement = visibleError
    ? copy.errors[visibleError] ?? copy.errors.failed
    : finished && resultCopy
      ? `${resultCopy.title}. ${copy.reportSaved} ${shownCall.reportSaved ? copy.yes : copy.no}`
      : sending
        ? copy.reason.sending
        : shownCall && liveStep
          ? copy.steps[liveStep]
          : "";

  return (
    <div className="max-w-2xl space-y-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-[2rem] font-semibold leading-tight tracking-[-0.02em] text-espresso sm:text-[2.5rem]">{copy.title}</h1>
        <p className="text-sm leading-relaxed text-muted">{copy.subtitle}</p>
      </header>

      <Card className="p-5 sm:p-6">
        <PhoneField
          label={copy.numberLabel}
          value={phone}
          onChange={setPhone}
          autoComplete="off"
          showError={showPhoneError}
          requiredMessage={copy.numberRequired}
        />
        <Button ref={actionRef} size="lg" className="mt-4 w-full sm:w-auto" disabled={disabled} aria-describedby={disabled ? "test-call-reason" : undefined} onClick={askToConfirm}>
          <PhoneOutgoing size={20} aria-hidden />
          {sending ? copy.sending : copy.action}
        </Button>
        {disabled ? (
          <ul id="test-call-reason" className="mt-3 space-y-1 text-sm leading-relaxed text-muted">
            {blockedLines.map((line) => <li key={line}>{line}</li>)}
          </ul>
        ) : null}

        {visibleError ? (
          <div className="mt-6 border-t border-stone/70 pt-5">
            <p className="flex items-start gap-2 font-semibold leading-relaxed text-danger">
              <WarningCircle size={22} className="mt-0.5 shrink-0" aria-hidden />
              <span>{copy.errors[visibleError] ?? copy.errors.failed}</span>
            </p>
          </div>
        ) : null}

        {finished && resultCopy ? (
          <div className="mt-6 border-t border-stone/70 pt-5">
            <h2 className="flex items-start gap-2 text-xl font-semibold leading-snug text-espresso">
              {worked
                ? <CheckCircle size={24} weight="fill" className="mt-0.5 shrink-0 text-ok" aria-hidden />
                : <WarningCircle size={24} className="mt-0.5 shrink-0 text-danger" aria-hidden />}
              <span>{resultCopy.title}</span>
            </h2>
            <p className="mt-1.5 leading-relaxed text-muted">{resultDetail}</p>
            <p className="mt-3 font-semibold text-espresso">
              {copy.reportSaved} <span className={shownCall.reportSaved ? "text-ok" : undefined}>{shownCall.reportSaved ? copy.yes : copy.no}</span>
            </p>
          </div>
        ) : null}

        <div ref={progressRef} tabIndex={-1} className="mt-6 border-t border-stone/70 pt-5 focus:outline-none">
          <ReportFlow steps={steps} label={copy.stepsLabel} stack />
        </div>

        {pollIssue && active ? <p className="mt-4 text-sm leading-relaxed text-warn">{copy.poll[pollIssue]}</p> : null}

        {shownCall ? (
          <p className="mt-4 text-sm leading-relaxed text-muted">
            {copy.latestTo} <bdi className="ltr-nums">{formatSaudiMobile(shownCall.destination)}</bdi>
            {" · "}
            <bdi className="ltr-nums">{fmt.dateTime(shownCall.startedAt)}</bdi>
          </p>
        ) : null}
      </Card>

      <p role="status" aria-live="polite" className="sr-only">{announcement}</p>

      {confirming ? (
        <ConfirmDialog
          title={copy.confirm.title}
          body={copy.confirm.body}
          confirmLabel={copy.confirm.action}
          cancelLabel={copy.confirm.cancel}
          tone="primary"
          confirmDisabled={!consent}
          onConfirm={() => void confirmCall()}
          onCancel={() => setConfirming(false)}
        >
          <p className="mt-4 text-lg font-semibold text-espresso"><bdi className="ltr-nums">{formatSaudiMobile(phone)}</bdi></p>
          <label className="mt-3 flex min-h-11 cursor-pointer items-start gap-3 py-2 text-[0.95rem] leading-relaxed text-espresso">
            <input type="checkbox" required checked={consent} onChange={(event) => setConsent(event.target.checked)} className="mt-1 size-5 shrink-0 accent-brown" />
            <span>{copy.confirm.consent}</span>
          </label>
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
