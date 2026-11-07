import { describe, expect, it } from "vitest";
import { signVoiceState, verifyVoiceState, VOICE_STATE_MAX_AGE_MS, type VoiceState } from "./state";

const state: VoiceState = {
  v: 1,
  sc: "report_call",
  l: "ar",
  t: 1_000_000,
  a: [{ value: "yes" }, { text: "عشرون" }],
};

describe("signed voice state", () => {
  it("round trips the exact supported conversation state", () => {
    const token = signVoiceState(state, "test-secret");
    expect(verifyVoiceState(token, "test-secret", state.t + 1)).toEqual(state);
  });

  it("rejects a tampered payload and a changed signature", () => {
    const token = signVoiceState(state, "test-secret");
    const [payload, signature] = token.split(".");
    const replacement = payload[0] === "A" ? "B" : "A";
    expect(verifyVoiceState(`${replacement}${payload.slice(1)}.${signature}`, "test-secret", state.t + 1)).toBeNull();
    expect(verifyVoiceState(`${payload}.${signature.slice(0, -1)}A`, "test-secret", state.t + 1)).toBeNull();
  });

  it("rejects a wrong key, expired state, and future state", () => {
    const token = signVoiceState(state, "test-secret");
    expect(verifyVoiceState(token, "wrong-secret", state.t + 1)).toBeNull();
    expect(verifyVoiceState(token, "test-secret", state.t + VOICE_STATE_MAX_AGE_MS + 1)).toBeNull();
    expect(verifyVoiceState(token, "test-secret", state.t - 60_001)).toBeNull();
    expect(verifyVoiceState(token, "test-secret", state.t - 60_000)).toEqual(state);
  });

  it("rejects malformed states and oversized answer arrays", () => {
    const malformed = signVoiceState({ ...state, sc: "emergency" } as unknown as VoiceState, "test-secret");
    expect(verifyVoiceState(malformed, "test-secret", state.t)).toBeNull();
    const tooMany = signVoiceState({ ...state, a: Array.from({ length: 46 }, () => ({ value: "yes" })) }, "test-secret");
    expect(verifyVoiceState(tooMany, "test-secret", state.t)).toBeNull();
    expect(verifyVoiceState(null, "test-secret", state.t)).toBeNull();
  });
});
