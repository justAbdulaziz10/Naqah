import { describe, expect, it } from "vitest";
import type { TestCallView } from "@/server/calls/test-call-api";
import { isActiveTestCall, testCallOutcome, testCallSteps, trackProgress } from "./testCallSteps";

const call = (patch: Partial<TestCallView>): TestCallView => ({
  id: "call-1",
  status: "calling",
  destination: "+966501234567",
  startedAt: "2026-11-09T14:00:00.000Z",
  endedAt: null,
  result: null,
  failure: null,
  reportSaved: false,
  ...patch,
});

const brief = (steps: ReturnType<typeof testCallSteps>) => steps.map((item) => `${item.step}:${item.state}${item.current ? "*" : ""}`);

describe("testCallSteps", () => {
  it("shows ready as current with no call, and as a ring when blocked", () => {
    expect(brief(testCallSteps(true, null, null))).toEqual(["ready:done*", "calling:waiting", "ringing:waiting", "connected:waiting", "completed:waiting"]);
    expect(testCallSteps(false, null, null)[0]).toEqual({ step: "ready", state: "waiting", current: false });
  });

  it("fills steps up to the current status and leaves the rest as rings", () => {
    expect(brief(testCallSteps(true, call({ status: "ringing" }), null))).toEqual(["ready:done", "calling:done", "ringing:done*", "connected:waiting", "completed:waiting"]);
    expect(brief(testCallSteps(true, call({ status: "connected" }), null))).toEqual(["ready:done", "calling:done", "ringing:done", "connected:done*", "completed:waiting"]);
  });

  it("fills every step when a call completes", () => {
    const steps = testCallSteps(true, call({ status: "completed", result: "report_saved", reportSaved: true }), null);
    expect(brief(steps)).toEqual(["ready:done", "calling:done", "ringing:done", "connected:done", "completed:done"]);
  });

  it("stops a failed call at the step it reached", () => {
    expect(brief(testCallSteps(true, call({ status: "failed", result: "failed", failure: "saudi_calls_disabled" }), null))).toEqual(["ready:done", "calling:done", "failed:missed"]);
    expect(brief(testCallSteps(true, call({ status: "failed", result: "no_answer" }), null))).toEqual(["ready:done", "calling:done", "ringing:done", "failed:missed"]);
    expect(brief(testCallSteps(true, call({ status: "failed", result: "busy" }), null))).toEqual(["ready:done", "calling:done", "failed:missed"]);
  });

  it("never draws a connected mark for a finished call nobody answered", () => {
    expect(brief(testCallSteps(true, call({ status: "completed", result: "no_answer" }), null))).toEqual(["ready:done", "calling:done", "ringing:done", "failed:missed"]);
  });

  it("keeps marks already seen when a watched call fails late", () => {
    let progress = trackProgress(null, call({ status: "connected" }));
    const failed = call({ status: "failed", result: "timed_out" });
    progress = trackProgress(progress, failed);
    expect(brief(testCallSteps(true, failed, progress))).toEqual(["ready:done", "calling:done", "ringing:done", "connected:done", "failed:missed"]);
  });

  it("does not carry progress over to a different call", () => {
    const progress = trackProgress(trackProgress(null, call({ status: "connected" })), call({ id: "call-2" }));
    expect(progress).toEqual({ id: "call-2", stage: 1 });
    expect(trackProgress(progress, null)).toBeNull();
  });
});

describe("testCallOutcome", () => {
  it("uses the server's result", () => {
    expect(testCallOutcome(call({ status: "completed", result: "report_saved", reportSaved: true }))).toBe("report_saved");
    expect(testCallOutcome(call({ status: "failed", result: "canceled" }))).toBe("canceled");
  });

  it("does not claim a report the saved flag doesn't confirm", () => {
    expect(testCallOutcome(call({ status: "completed", result: "report_saved", reportSaved: false }))).toBe("no_report");
  });

  it("falls back from the status when no result arrived", () => {
    expect(testCallOutcome(call({ status: "completed", reportSaved: true }))).toBe("report_saved");
    expect(testCallOutcome(call({ status: "completed" }))).toBe("no_report");
    expect(testCallOutcome(call({ status: "failed" }))).toBe("failed");
  });
});

describe("isActiveTestCall", () => {
  it("is active only while the call can still change", () => {
    expect(["calling", "ringing", "connected", "completed", "failed"].map((status) => isActiveTestCall(status as TestCallView["status"]))).toEqual([true, true, true, false, false]);
  });
});
