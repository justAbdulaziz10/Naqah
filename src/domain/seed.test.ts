import { describe, expect, it } from "vitest";
import { createDemoWorkspace, createEmptyWorkspace, SAMPLE_OWNER_PHONE, SAMPLE_WORKER_PHONE, withCurrentSampleContacts } from "./seed";

// Stands in for a number an older sample ranch saved; the real old numbers stay out of the repository.
const OLDER = "+966 50 000 0999";

describe("withCurrentSampleContacts", () => {
  it.each(["ar", "en"] as const)("gives a saved %s sample ranch today's made-up numbers", (locale) => {
    const demo = createDemoWorkspace(locale, "ultimate", new Date("2026-11-22T09:00:00Z"));
    const saved = { ...demo, settings: { ...demo.settings, owner: { ...demo.settings.owner, phone: OLDER }, worker: { ...demo.settings.worker, phone: OLDER } } };
    const next = withCurrentSampleContacts(saved);
    expect(next.settings.worker.phone).toBe(SAMPLE_WORKER_PHONE);
    expect(next.settings.owner.phone).toBe(SAMPLE_OWNER_PHONE);
    expect(next.settings.worker.name).toBe(demo.settings.worker.name);
  });

  it("leaves a current sample ranch and an owner's own ranch untouched", () => {
    const demo = createDemoWorkspace("ar", "ultimate", new Date("2026-11-22T09:00:00Z"));
    expect(withCurrentSampleContacts(demo)).toBe(demo);
    const own = createEmptyWorkspace("basic");
    own.settings.farm.name = "عزبة النخيل";
    own.settings.worker.phone = OLDER;
    expect(withCurrentSampleContacts(own)).toBe(own);
  });
});
