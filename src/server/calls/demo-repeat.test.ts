import { afterEach, describe, expect, it, vi } from "vitest";
import { fromRiyadh } from "@/domain/clock";
import { completeWorkerReport } from "@/domain/actions";
import { placeReportCallAttempt, reportCallBlock, resolveReportCallAttempt, startReportCall } from "@/domain/reportCalls";
import { createDemoWorkspace } from "@/domain/seed";
import { voiceStep } from "@/server/voice/contract";
import { demoRepeatReports } from "./config";

vi.mock("server-only", () => ({}));
const NOW = fromRiyadh(2026, 11, 11, 10, 0);
const LATER = new Date(NOW.getTime() + 10 * 60_000);
const FARM = "11111111-1111-4111-8111-111111111111";

/** A ranch whose report for today is already in. */
function reported() {
  const ws = createDemoWorkspace("ar", "ultimate", NOW);
  Object.assign(ws, { reports: [], calls: [], reportCalls: [] });
  const opened = startReportCall(ws, NOW, "manual");
  const live = resolveReportCallAttempt(placeReportCallAttempt(opened.ws, NOW, opened.run!.id).ws, NOW, opened.run!.id, true).ws;
  return completeWorkerReport(live, NOW, { answers: [{ questionId: "herd_health", question: { ar: "؟", en: "?" }, answer: "fine", certainty: "reported", followUp: false }], camelUpdates: [], resourceUpdates: [], taskConfirmations: [] } as never, opened.run!.id).ws;
}

afterEach(() => vi.unstubAllEnvs());

describe("another demo call after today's report (local presentation ranch only)", () => {
  it("keeps the one-report rule unless the ranch is the local presentation ranch", () => {
    const ws = reported();
    expect(reportCallBlock(ws, LATER)).toBe("already_reported");
    expect(startReportCall(ws, LATER, "manual").blocked).toBe("already_reported");
    expect(reportCallBlock(ws, LATER, { repeatReports: true })).toBeNull();
    const again = startReportCall(ws, LATER, "manual", LATER, { repeatReports: true });
    expect(again.run).not.toBeNull();
    expect(again.ws.reportCalls).toHaveLength(2);
  });

  it("saves the second confirmed report as its own record only for the presentation ranch", () => {
    const ws = reported();
    const opened = startReportCall(ws, LATER, "manual", LATER, { repeatReports: true });
    const live = resolveReportCallAttempt(placeReportCallAttempt(opened.ws, LATER, opened.run!.id).ws, LATER, opened.run!.id, true).ws;
    const event = { version: 1, eventId: "e2", providerCallId: "CA1", type: "worker_report", reportCallId: opened.run!.id, draft: { answers: [{ questionId: "herd_health", question: { ar: "؟", en: "?" }, answer: "fine", certainty: "reported", followUp: false }], camelUpdates: [], resourceUpdates: [], taskConfirmations: [] } } as never;
    const refused = voiceStep(live, LATER, event);
    expect(refused.result).toMatchObject({ status: "rejected", reason: "daily_done" });
    const saved = voiceStep(live, LATER, event, true);
    expect(saved.result.status).toBe("saved");
    expect(saved.ws.reports).toHaveLength(2);
    expect(saved.ws.reports[0].id).not.toBe(saved.ws.reports[1].id);
  });

  it("is on only for listed farms, on a local stack, never on Vercel", async () => {
    const { mkdtempSync, rmSync, writeFileSync } = await import("node:fs");
    const dir = mkdtempSync("/tmp/naqah-demo-repeat-");
    try {
      vi.stubEnv("NAQAH_DEMO_REPEAT_FARMS", FARM);
      expect(demoRepeatReports(FARM)).toBe(false); // no local approved-numbers file: not a local stack
      writeFileSync(`${dir}/approved.txt`, "");
      vi.stubEnv("NAQAH_CALL_ALLOWLIST_FILE", `${dir}/approved.txt`);
      expect(demoRepeatReports(FARM)).toBe(true);
      expect(demoRepeatReports("22222222-2222-4222-8222-222222222222")).toBe(false);
      vi.stubEnv("VERCEL", "1");
      expect(demoRepeatReports(FARM)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
