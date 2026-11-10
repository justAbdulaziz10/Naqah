import type { FlowState } from "@/components/visuals/ReportFlow";
import type { TestCallResult, TestCallStatus, TestCallView } from "@/server/calls/test-call-api";

export type TestCallStep = "ready" | "calling" | "ringing" | "connected" | "completed" | "failed";

export interface TestCallStepView {
  step: TestCallStep;
  state: FlowState;
  /** The step a live call is on right now. A finished call has none. */
  current: boolean;
}

/** How far a call is known to have got, kept while watching it so a late failure doesn't erase marks already shown. */
export interface TestCallProgress {
  id: string;
  stage: number;
}

const STAGES: Partial<Record<TestCallStatus, number>> = { calling: 1, ringing: 2, connected: 3 };
const SEQUENCE = ["calling", "ringing", "connected"] as const;

export const isActiveTestCall = (status: TestCallStatus) => status in STAGES;

export function trackProgress(previous: TestCallProgress | null, call: TestCallView | null): TestCallProgress | null {
  if (!call) return null;
  const seen = previous?.id === call.id ? previous.stage : 0;
  return { id: call.id, stage: Math.max(seen, STAGES[call.status] ?? 0) };
}

/** The outcome to describe. A result that claims more than the saved flag confirms is not repeated. */
export function testCallOutcome(call: TestCallView): TestCallResult {
  if (call.result === "report_saved" && !call.reportSaved) return "no_report";
  if (call.result) return call.result;
  if (call.status !== "completed") return "failed";
  return call.reportSaved ? "report_saved" : "no_report";
}

const answered = (outcome: TestCallResult) => outcome === "report_saved" || outcome === "no_report";

/** Only what the call itself proves: nobody answering rang the phone, any other failure may not have. */
function reachedStage(call: TestCallView, outcome: TestCallResult, progress: TestCallProgress | null) {
  const proven = outcome === "no_answer" && !call.failure ? 2 : 1;
  return Math.max(proven, progress?.id === call.id ? progress.stage : 0);
}

/**
 * The timeline for a call. Marks fill as steps happen and stay rings until they do. A failed call
 * stops at the step it reached, so steps it never got to aren't drawn as still to come.
 */
export function testCallSteps(ready: boolean, call: TestCallView | null, progress: TestCallProgress | null): TestCallStepView[] {
  const waiting = (step: TestCallStep): TestCallStepView => ({ step, state: "waiting", current: false });
  const done = (step: TestCallStep, current = false): TestCallStepView => ({ step, state: "done", current });

  if (!call) return [ready ? done("ready", true) : waiting("ready"), ...SEQUENCE.map(waiting), waiting("completed")];

  const stage = STAGES[call.status];
  if (stage) {
    return [
      done("ready"),
      ...SEQUENCE.map((step, index) => (index + 1 < stage ? done(step) : index + 1 === stage ? done(step, true) : waiting(step))),
      waiting("completed"),
    ];
  }

  const outcome = testCallOutcome(call);
  if (call.status === "completed" && answered(outcome)) return [done("ready"), ...SEQUENCE.map((step) => done(step)), done("completed")];
  const reached = SEQUENCE.slice(0, reachedStage(call, outcome, progress));
  return [done("ready"), ...reached.map((step) => done(step)), { step: "failed", state: "missed", current: false }];
}
