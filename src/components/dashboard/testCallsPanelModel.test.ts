import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getMessages } from "@/i18n/messages";
import type { TestCallPanelState, TestCallStage } from "@/server/calls/test-ranch-manual";
import {
  TEST_CALL_STAGES, canOpenConfirmation, pressStage, reasonKey, shouldRenderTestCallsPanel, shouldRequestTestCallsPanel,
  stageStatus, stageToPlace,
} from "./testCallsPanelModel";

const panel = (overrides: Partial<TestCallPanelState> = {}): TestCallPanelState => ({
  visible: true,
  remainingCalls: 4,
  maxCalls: 4,
  callLive: false,
  stages: {
    report: { status: "ready" },
    owner_summary: { status: "ready" },
    worker_instruction: { status: "ready" },
    worker_verification: { status: "ready" },
  },
  scheduleTimes: { report: null, ownerSummary: null, verification: null },
  ...overrides,
});

describe("test-call panel visibility", () => {
  it.each([
    [false, panel(), false],
    [true, null, false],
    [true, panel(), true],
  ])("renders only for an account with server-authorized visibility (account %s)", (account, state, expected) => {
    expect(shouldRenderTestCallsPanel(account, state)).toBe(expected);
  });

  it("never asks the server outside account mode, and stops asking once the server said no panel", () => {
    expect(shouldRequestTestCallsPanel(false, false)).toBe(false);
    expect(shouldRequestTestCallsPanel(true, true)).toBe(false);
    expect(shouldRequestTestCallsPanel(true, false)).toBe(true);
  });
});

describe("test-call panel confirmation", () => {
  it("opens the confirmation only for a ready stage while no call is live or sending", () => {
    for (const stage of TEST_CALL_STAGES) {
      expect(pressStage(panel(), stage, null)).toBe(stage);
      expect(pressStage(panel({ callLive: true }), stage, null)).toBeNull();
      expect(pressStage(panel(), stage, "report")).toBeNull();
    }
    const blocked = panel({ stages: { ...panel().stages, owner_summary: { status: "cap_reached" }, report: { status: "not_ready", reason: "no_worker" } } });
    expect(canOpenConfirmation(blocked, "owner_summary", null)).toBe(false);
    expect(canOpenConfirmation(blocked, "report", null)).toBe(false);
    expect(canOpenConfirmation(blocked, "worker_instruction", null)).toBe(true);
  });

  it("places only the confirmed stage, and never while a placement is sending", () => {
    expect(stageToPlace(null, false)).toBeNull();
    expect(stageToPlace("worker_instruction", true)).toBeNull();
    expect(stageToPlace("worker_instruction", false)).toBe("worker_instruction");
  });

  it("wires the button to the confirmation and places a call only from the confirmed dialog", () => {
    const source = readFileSync(new URL("./TestCallsPanel.tsx", import.meta.url), "utf8");
    const onClick = /onClick=\{([^}]*\}?)\}/.exec(source)?.[1] ?? "";
    expect(onClick).toContain("setConfirming(pressStage(");
    expect(onClick).not.toContain("placeStage");
    expect(source.match(/placeStage\(/g)).toHaveLength(2); // its definition and the one call in confirmCall
    expect(source).toMatch(/async function confirmCall\(\) \{\s+const stage = stageToPlace\(confirming, sending\.current\);/);
    expect(source).not.toMatch(/rounded-full[^"`]*\bpx-/);
  });
});

describe("test-call panel copy", () => {
  it("names the worker's number on worker stages and the owner's on the owner summary", () => {
    const worker: TestCallStage[] = ["report", "worker_instruction", "worker_verification"];
    for (const stage of worker) expect(reasonKey(stage, "number_not_allowlisted")).toBe("workerNumberNotAllowlisted");
    expect(reasonKey("owner_summary", "number_not_allowlisted")).toBe("numberNotAllowlisted");
    for (const locale of ["en", "ar"] as const) {
      const copy = getMessages(locale).app.overview.testCalls;
      expect(copy.workerNumberNotAllowlisted).not.toBe(copy.numberNotAllowlisted);
    }
    expect(stageStatus({ status: "not_ready", reason: "no_worker" })).toBe("not_ready:no_worker");
    expect(stageStatus({ status: "call_live" })).toBe("call_live");
  });
});
