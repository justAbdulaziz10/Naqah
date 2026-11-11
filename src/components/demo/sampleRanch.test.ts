import { describe, expect, it } from "vitest";
import { stepNeedsFixing, WIZARD_STEPS } from "@/components/setup/onboarding/WizardSteps";
import { createEmptyWorkspace } from "@/domain/seed";
import { plannedQuestions } from "@/domain/rules";
import { fillSampleStep } from "./sampleRanch";

describe("demo fill for onboarding", () => {
  it.each([
    ["ar", "basic", true],
    ["en", "basic", true],
    ["ar", "basic", false],
    ["ar", "ultimate", false],
  ] as const)("fills each step so it can continue (%s, %s, plan choice %s)", (locale, plan, choosePlan) => {
    let ws = createEmptyWorkspace(plan);
    for (const step of WIZARD_STEPS) {
      ws = fillSampleStep(step, ws, { locale, choosePlan });
      expect(stepNeedsFixing(step, ws)).toBe(false);
    }
    expect(ws.settings.plan).toBe(choosePlan ? "ultimate" : plan);
    expect(ws.setupComplete).toBe(false);
  });

  it("asks the presentation's short call and adds its own question once", () => {
    const options = { locale: "ar", choosePlan: true } as const;
    const once = fillSampleStep("ready", createEmptyWorkspace("basic"), options);
    const twice = fillSampleStep("call", once, options);
    expect(twice.settings.customQuestions).toHaveLength(1);
    expect(plannedQuestions(twice).map((item) => item.question.id)).toEqual([
      "herd_health", "feed_level", "water_level", "fences_condition", twice.settings.customQuestions[0].id,
    ]);
    expect(twice.settings.callSchedule).toEqual({ day: null, time: "17:00" });
    expect(twice.settings.owner.phone).toBe("+966 50 000 0301");
  });

  it("only fills the step it is given", () => {
    const ws = createEmptyWorkspace("basic");
    const ranch = fillSampleStep("ranch", ws, { locale: "en", choosePlan: false });
    expect(ranch.settings.worker).toEqual(ws.settings.worker);
    expect(ranch.settings.callSchedule).toBeNull();
    expect(ranch.settings.farm.name).toBe("Al Wasm Ranch");
  });
});
