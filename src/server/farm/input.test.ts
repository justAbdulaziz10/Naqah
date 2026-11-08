import { describe, expect, it } from "vitest";
import { normalizePhone, parseCamelPatch, parseCriterion, parseFarmProfile, parseNewCamel, parseResource, parseWorker } from "./input";

describe("owner input", () => {
  it("normalizes Saudi numbers and keeps other E.164", () => {
    expect(normalizePhone("0501234567")).toBe("+966501234567");
    expect(normalizePhone("+971 50 123 4567")).toBe("+971501234567");
    expect(normalizePhone("12345")).toBeNull();
  });
  it("writes only what was sent, so a partial save cannot blank a field", () => {
    expect(parseFarmProfile({ name: "Al Nakheel" })).toEqual({ name: "Al Nakheel" });
    expect(parseWorker({ language: "ur" })).toEqual({ language: "ur" });
    expect(parseCamelPatch({ name: "Wadha" })).toEqual({ name: "Wadha" });
    expect(parseResource({ kind: "feed", level: "low" })).toEqual({ kind: "feed", level: "low" });
    expect(parseCriterion({ kind: "low_feed" })).toEqual({ kind: "low_feed", label: null });
  });
  it("never accepts plan or bookkeeping from an owner", () => {
    const parsed = parseFarmProfile({ plan: "ultimate", revision: 9, last_update_at: "x", owner_id: "y", name: "n" });
    expect(parsed).toEqual({ name: "n" });
  });
  it("stores an empty phone but refuses a malformed one", () => {
    expect(parseWorker({ phone: "" })).toEqual({ phone: "" });
    expect(() => parseWorker({ phone: "call me" })).toThrow();
  });
  it("clears the window and coordinates only on an explicit null", () => {
    expect(parseFarmProfile({ window: null, coords: null })).toEqual({ window_day: null, window_start: null, window_end: null, latitude: null, longitude: null });
  });
  it("saves a window draft, and refuses an end before the start", () => {
    expect(parseFarmProfile({ window: { day: 4, start: "", end: "" } })).toMatchObject({ window_day: 4, window_start: null });
    expect(() => parseFarmProfile({ window: { day: 4, start: "18:00", end: "17:00" } })).toThrow();
    expect(() => parseFarmProfile({ window: { day: 9, start: "", end: "" } })).toThrow();
  });
  it("needs a name for a new camel", () => {
    expect(() => parseNewCamel({ sex: "female" })).toThrow();
    expect(() => parseCamelPatch({ ageYears: 70 })).toThrow();
  });
  it("needs a label on a custom criterion", () => {
    expect(() => parseCriterion({ kind: "custom", enabled: true })).toThrow();
    expect(parseCriterion({ kind: "low_feed", enabled: false })).toEqual({ kind: "low_feed", label: null, enabled: false });
  });
  it("rejects non-object input", () => {
    expect(() => parseFarmProfile(null)).toThrow();
    expect(() => parseFarmProfile([])).toThrow();
  });
});
