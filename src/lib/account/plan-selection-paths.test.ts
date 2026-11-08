import { describe, expect, it } from "vitest";
import { planSelectionGatePath, planSelectionResumePath } from "./plan-selection-paths";

describe("plan selection return paths", () => {
  it("keeps safe deep-link query data behind the plan gate and drops external destinations", () => {
    expect(planSelectionGatePath("ar", "/ar/app/calls?tab=week")).toBe("/ar/choose-plan?next=%2Far%2Fapp%2Fcalls%3Ftab%3Dweek");
    expect(planSelectionGatePath("en", "https://evil.example")).toBe("/en/choose-plan");
  });

  it("always sends an incomplete owner through setup before a deep link", () => {
    expect(planSelectionResumePath("ar", false, "/ar/app/herd?view=all")).toBe("/ar/start?returnTo=%2Far%2Fapp%2Fherd%3Fview%3Dall");
  });

  it("does not preserve a start deep link that could skip the first step", () => {
    expect(planSelectionResumePath("en", false, "/en/start?step=3")).toBe("/en/start");
  });

  it("honors a valid destination for completed accounts and rejects external paths", () => {
    expect(planSelectionResumePath("en", true, "/en/app/settings")).toBe("/en/app/settings");
    expect(planSelectionResumePath("ar", true, "https://evil.example")).toBe("/ar/app");
  });
});
