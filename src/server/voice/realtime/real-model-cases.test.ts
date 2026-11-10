import { describe, expect, it } from "vitest";
import { callAt, finalOutcome, MODEL_CASES } from "./real-model-cases";

describe("the 37 cases, from the model's recorded decisions", () => {
  it("has all 37", () => expect(MODEL_CASES).toHaveLength(37));

  it("asks the question each case is meant for", () => {
    expect(callAt("herd").session.data.currentQuestionId).toBe("herd_health");
    expect(callAt("feed").session.data.currentQuestionId).toBe("feed_level");
  });

  it.each(MODEL_CASES.filter((item) => item.expect !== "ambiguous"))("«$heard» on $step ends as $expect", ({ step, heard, raw, expect: want }) => {
    expect(finalOutcome(step, raw, heard)).toBe(want);
  });

  it("does not record «جميع» as all well", () => {
    const item = MODEL_CASES.find((entry) => entry.heard === "جميع")!;
    expect(item.raw.args.value).toBe("yes");
    expect(finalOutcome(item.step, item.raw, item.heard)).toBe("ask");
  });
});
