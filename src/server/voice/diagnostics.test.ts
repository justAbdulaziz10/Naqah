import { afterEach, describe, expect, it, vi } from "vitest";
import { logVoiceTurn } from "./diagnostics";

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

  it.each([
    ["الو  السلام عليكم", "words=3 script=arabic"],
    ["hello there", "words=2 script=latin"],
    ["الو hello", "words=2 script=mixed"],
    ["123", "words=1 script=other"],
  ])("describes unmapped speech by shape, not by its words", (speech, expected) => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    logVoiceTurn({ ...turn, speech }, null, { step: "herd_health", inputMode: "choices" });
    const line = String(log.mock.calls[0][0]);
    expect(line).toContain(`step=herd_health mode=choices ${expected}`);
    expect(line).not.toContain(speech);
  });

  it("leaves shape out of silent turns and unsafe step names out of the log", () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    logVoiceTurn({ ...turn, speech: "", confidence: null }, null, { step: "private secret", inputMode: "number" });
    expect(log).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/step=invalid mode=number$/));
  });
});
