import { describe, expect, it } from "vitest";
import { createDemoWorkspace, createEmptyWorkspace } from "@/domain/seed";
import { getCallSetupGaps } from "./CallSetupStatus";
import { createOnboardingSample, hasOwnSetupData } from "./draft";
import { formatSaudiMobile, fromLocalSaudiPart, isSaudiMobile, localSaudiPart, phoneNeedsFixing } from "./phone";

describe("Saudi mobile numbers", () => {
  it.each([
    "0501234567",
    "501234567",
    "966501234567",
    "+966501234567",
    "00966501234567",
    "+966 50 123 4567",
    "+966 (0)50 123 4567",
    "+966 050 123 4567",
    "050-123-4567",
    "050.123.4567",
    "٠٥٠١٢٣٤٥٦٧",
    "‪+966 50 123 4567‬",
  ])("accepts and tidies %s", (input) => {
    expect(isSaudiMobile(input)).toBe(true);
    expect(formatSaudiMobile(input)).toBe("+966 50 123 4567");
  });

  it.each(["0112345678", "05012345", "05012345678", "+971501234567", "phone", "05a0123456"])("rejects %s and keeps it as typed", (input) => {
    expect(isSaudiMobile(input)).toBe(false);
    expect(formatSaudiMobile(input)).toBe(input);
  });

  it("does not flag an empty optional field", () => {
    expect(phoneNeedsFixing("  ")).toBe(false);
    expect(phoneNeedsFixing("123")).toBe(true);
  });
});

describe("the +966 phone field", () => {
  it("adds the country code to a local number and keeps full numbers as typed", () => {
    expect(fromLocalSaudiPart("50 123 4567")).toBe("+966 50 123 4567");
    expect(fromLocalSaudiPart("٥٠١٢٣٤٥٦٧")).toBe("+966 501234567");
    expect(fromLocalSaudiPart("0501234567")).toBe("0501234567");
    expect(fromLocalSaudiPart("+966501234567")).toBe("+966501234567");
    expect(fromLocalSaudiPart("  ")).toBe("");
  });

  it("shows only the part after +966", () => {
    expect(localSaudiPart("+966 50 123 4567")).toBe("50 123 4567");
    expect(localSaudiPart("0501234567")).toBe("50 123 4567");
    expect(localSaudiPart("+966 50 12")).toBe("50 12");
    expect(localSaudiPart("")).toBe("");
  });

  it("round-trips: what is shown and typed back stores the same number", () => {
    const stored = formatSaudiMobile(fromLocalSaudiPart("501234567"));
    expect(stored).toBe("+966 50 123 4567");
    expect(formatSaudiMobile(fromLocalSaudiPart(localSaudiPart(stored)))).toBe(stored);
    expect(phoneNeedsFixing(fromLocalSaudiPart("40 123 4567"))).toBe(true);
  });
});

describe("call setup gaps", () => {
  it("counts a wrong number or an unfinished call time as missing", () => {
    const ws = createDemoWorkspace("en", "basic");
    expect(getCallSetupGaps(ws)).toEqual([]);
    ws.settings.worker.phone = "123";
    ws.settings.callSchedule = { day: null, time: "18:00" };
    expect(getCallSetupGaps(ws)).toEqual(["worker", "schedule"]);
  });

  it("Ultimate needs only a time, never a day", () => {
    const ws = createDemoWorkspace("en", "ultimate");
    ws.settings.callSchedule = { day: null, time: "18:00" };
    expect(getCallSetupGaps(ws)).toEqual([]);
    ws.settings.callSchedule = { day: null, time: "" };
    expect(getCallSetupGaps(ws)).toEqual(["schedule"]);
  });

  it("ignores the retired window", () => {
    const ws = createDemoWorkspace("en", "basic");
    ws.settings.window = null;
    expect(getCallSetupGaps(ws)).toEqual([]);
  });
});

describe("loading sample data", () => {
  it("needs no confirmation over a blank setup or an untouched sample", () => {
    expect(hasOwnSetupData(null)).toBe(false);
    expect(hasOwnSetupData(createEmptyWorkspace("basic"))).toBe(false);
    expect(hasOwnSetupData(createDemoWorkspace("ar", "basic"))).toBe(false);
    expect(hasOwnSetupData(createDemoWorkspace("en", "ultimate"))).toBe(false);
    expect(hasOwnSetupData(createOnboardingSample("ar", "ultimate"))).toBe(false);
  });

  it.each([
    ["a typed name", (ws: ReturnType<typeof createEmptyWorkspace>) => { ws.settings.owner.name = "Sara"; }],
    ["a call day with no time", (ws: ReturnType<typeof createEmptyWorkspace>) => { ws.settings.callSchedule = { day: 2, time: "" }; }],
    ["a herd count", (ws: ReturnType<typeof createEmptyWorkspace>) => { ws.settings.herdCount = 40; }],
    ["an unticked resource", (ws: ReturnType<typeof createEmptyWorkspace>) => { ws.resources[0].present = false; }],
  ])("asks before replacing %s", (_label, edit) => {
    const ws = createEmptyWorkspace("basic");
    edit(ws);
    expect(hasOwnSetupData(ws)).toBe(true);
  });

  it("asks when a supplier or call history would be lost", () => {
    const supplier = createEmptyWorkspace("basic");
    supplier.settings.integrations = { supplierName: "Al-Rajhi Feed" };
    expect(hasOwnSetupData(supplier)).toBe(true);
    const played = createOnboardingSample("en", "basic");
    played.calls = createDemoWorkspace("en", "basic").calls.slice(0, 1);
    expect(hasOwnSetupData(played)).toBe(true);
  });

  it("asks once a sample has been edited", () => {
    const ws = createDemoWorkspace("en", "basic");
    ws.settings.worker.name = "Yusuf";
    expect(hasOwnSetupData(ws)).toBe(true);
  });
});
