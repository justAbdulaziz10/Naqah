import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { placeReportCallAttempt, startReportCall } from "@/domain/reportCalls";
import { createDemoWorkspace } from "@/domain/seed";
import { applyVoiceEvent, type VoiceEvent } from "./contract";

const mock = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/server/db/service-repository", () => ({ runFarmAction: mock.run }));

const client = {} as SupabaseClient;
const now = new Date("2026-11-08T15:16:27Z");
const makeFarm = () => {
  const started = startReportCall(createDemoWorkspace("ar", "ultimate", now), now, "manual");
  return { workspace: placeReportCallAttempt(started.ws, now, started.run!.id).ws, runId: started.run!.id };
};
const eventFor = (runId: string): VoiceEvent => ({ version: 1, eventId: "call:answered", providerCallId: "call", type: "report_call_attempt", reportCallId: runId, attempt: 1, answered: true });

beforeEach(() => vi.resetAllMocks());

describe("committed voice workspace", () => {
  it("exposes the answered workspace only after persistence completes", async () => {
    const { workspace, runId } = makeFarm();
    const observed = vi.fn();
    mock.run.mockImplementation(async (_client, _farmId, action) => {
      const applied = action(workspace);
      expect(applied.ws.reportCalls.find((run: { id: string }) => run.id === runId).state).toBe("answered");
      expect(observed).not.toHaveBeenCalled();
      return { status: "saved", result: applied.result };
    });
    await applyVoiceEvent(client, "farm", { party: "system" }, eventFor(runId), now, observed);
    expect(observed).toHaveBeenCalledTimes(1);
    expect(observed.mock.calls[0][0].reportCalls.find((run: { id: string }) => run.id === runId).state).toBe("answered");
  });

  it("never exposes an uncommitted snapshot when a conflict replays another request's result", async () => {
    const { workspace, runId } = makeFarm();
    const observed = vi.fn();
    mock.run.mockImplementation(async (_client, _farmId, action) => {
      action(workspace);
      return { status: "replayed", result: { status: "saved" } };
    });
    expect(await applyVoiceEvent(client, "farm", { party: "system" }, eventFor(runId), now, observed)).toEqual({ status: "saved" });
    expect(observed).not.toHaveBeenCalled();
  });

  it("never exposes a snapshot when persistence fails", async () => {
    const { workspace, runId } = makeFarm();
    const observed = vi.fn();
    mock.run.mockImplementation(async (_client, _farmId, action) => {
      action(workspace);
      throw new Error("database unavailable");
    });
    await expect(applyVoiceEvent(client, "farm", { party: "system" }, eventFor(runId), now, observed)).rejects.toThrow("database unavailable");
    expect(observed).not.toHaveBeenCalled();
  });
});
