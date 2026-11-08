import { afterEach, describe, expect, it, vi } from "vitest";
import { logCallProgress, logVoiceTurn } from "./diagnostics";

afterEach(() => vi.restoreAllMocks());

describe("private turn diagnostics", () => {
  const turn = { callSid: `CA${"a".repeat(32)}`, seq: 4, speech: "private answer", digits: null, confidence: "0.8972015" };

  it("logs one line without the answer, full sid or selected value", () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    logVoiceTurn(turn, { value: "private-choice" });
    expect(log).toHaveBeenCalledExactlyOnceWith("[NAQAH] voice turn call=aaaaaa turn=4 input=speech confidence=0.8972015 speech_empty=false parse=choice");
  });

  it.each([
    [{ speech: "", digits: null, confidence: null }, "input=empty confidence=absent speech_empty=true parse=empty"],
    [{ confidence: "0.0" }, "input=speech confidence=0 speech_empty=false parse=unmapped"],
    [{ confidence: "private-secret" }, "input=speech confidence=invalid speech_empty=false parse=unmapped"],
    [{ confidence: "0.9" }, "input=speech confidence=0.9 speech_empty=false parse=unmapped"],
    [{ speech: "", digits: "120", confidence: null }, "input=dtmf confidence=absent speech_empty=true parse=unmapped"],
  ])("classifies the turn without exposing input", (overrides, expected) => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    logVoiceTurn({ ...turn, ...overrides }, null);
    expect(log).toHaveBeenCalledExactlyOnceWith(expect.stringContaining(expected));
  });

  it("never logs unvalidated identifiers", () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    logVoiceTurn({ ...turn, callSid: "private-secret", seq: Number.NaN }, "stale");
    expect(log).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("call=invalid turn=invalid"));
  });
});

describe("call progress diagnostics", () => {
  const event = { callSid: `CA${"a".repeat(32)}`, status: "ringing", sequence: "1", timestamp: "Sun, 08 Nov 2026 14:59:12 +0000", sip: null };

  it("logs Twilio and receipt times in Riyadh time without the full sid", () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    logCallProgress(event, new Date("2026-11-08T14:59:13.250Z"));
    expect(log).toHaveBeenCalledExactlyOnceWith("[NAQAH] call progress call=aaaaaa status=ringing seq=1 sip=absent twilio_riyadh=17:59:12.000 received_riyadh=17:59:13.250");
  });

  it("marks unexpected values instead of logging them", () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    logCallProgress({ callSid: "+966500000000", status: "+966500000000", sequence: "x", timestamp: "nope", sip: "private" }, new Date("2026-11-08T14:59:13Z"));
    expect(log.mock.calls[0][0]).not.toContain("966500000000");
    expect(log.mock.calls[0][0]).toContain("call=invalid status=invalid seq=absent sip=absent twilio_riyadh=absent");
  });
});
