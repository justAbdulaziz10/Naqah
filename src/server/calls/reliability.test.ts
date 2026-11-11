import { describe, expect, it, vi } from "vitest";
import { createDemoWorkspace } from "@/domain/seed";
import { placeReportCallAttempt, resolveReportCallAttempt, startReportCall } from "@/domain/reportCalls";
import { callDiagnostic, CALL_STALE_MS, expireReportRuns, withCallDiagnostic } from "./reliability";

vi.mock("server-only", () => ({}));
const FARM = "11111111-1111-4111-8111-111111111111";
const now = new Date("2026-11-10T11:00:00Z");

function pending(trigger: "manual" | "schedule" = "manual") {
  const initial = createDemoWorkspace("ar", "ultimate", now);
  initial.reports = [];
  initial.lastUpdateAt = null;
  initial.reportCalls = [];
  const opened = startReportCall(initial, now, trigger);
  return { ws: placeReportCallAttempt(opened.ws, now, opened.run!.id).ws, id: opened.run!.id };
}

describe("bounded report-call cleanup", () => {
  it.each([false, true])("closes a stale manual run and never schedules a redial (answered=%s)", (answered) => {
    const run = pending();
    const ws = answered ? resolveReportCallAttempt(run.ws, now, run.id, true).ws : run.ws;
    expect(expireReportRuns(ws, FARM, new Date(now.getTime() + CALL_STALE_MS - 1))).toBe(ws);
    const closed = expireReportRuns(ws, FARM, new Date(now.getTime() + CALL_STALE_MS));
    expect(closed.reportCalls?.at(-1)).toMatchObject({ state: "missed", nextAttemptAt: null });
    expect(callDiagnostic(closed, FARM, run.id)?.en).toContain("deadline");
    expect(expireReportRuns(closed, FARM, new Date(now.getTime() + CALL_STALE_MS * 2))).toBe(closed);
  });
  it("keeps scheduled retry policy and never expires a run waiting for its retry", () => {
    const run = pending("schedule");
    const cutoff = new Date(now.getTime() + CALL_STALE_MS);
    const expired = expireReportRuns(run.ws, FARM, cutoff);
    expect(expired.reportCalls?.at(-1)).toMatchObject({ state: "calling", nextAttemptAt: new Date(cutoff.getTime() + 20 * 60_000).toISOString() });
    expect(expireReportRuns(expired, FARM, new Date(cutoff.getTime() + CALL_STALE_MS))).toBe(expired);
  });
  it("preserves the first actionable failure and never labels a saved report failed", () => {
    const run = pending();
    const ws = withCallDiagnostic(run.ws, FARM, run.id, "openai_auth", now);
    expect(withCallDiagnostic(ws, FARM, run.id, "not_saved", now)).toBe(ws);
    expect(callDiagnostic(ws, FARM, run.id)?.en).toContain("OpenAI");
    run.ws.reportCalls![0].reportId = "saved-report";
    run.ws.reportCalls![0].state = "completed";
    expect(withCallDiagnostic(run.ws, FARM, run.id, "not_saved", now)).toBe(run.ws);
  });
});
