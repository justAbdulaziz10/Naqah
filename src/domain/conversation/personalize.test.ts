import { describe, expect, it } from "vitest";
import { createDemoWorkspace } from "../seed";
import { makePersonalizer, personalizeTree } from "./personalize";

describe("Call Lab personalization", () => {
  it("leaves the sample farm's names untouched in both languages", () => {
    const p = makePersonalizer(createDemoWorkspace("ar", "ultimate"));
    expect(p("NAQAH calls Ahmed")).toBe("NAQAH calls Ahmed");
    expect(p("ناقة تتصل بعبدالله")).toBe("ناقة تتصل بعبدالله");
  });

  it("swaps in a real farm's worker and owner first name", () => {
    const ws = createDemoWorkspace("en", "basic");
    ws.settings.worker.name = "Salem";
    ws.settings.owner.name = "Faisal Al-Otaibi";
    const p = makePersonalizer(ws);
    expect(p("NAQAH is calling Abdullah after Ahmed’s update.")).toBe("NAQAH is calling Faisal after Salem’s update.");
    expect(p("عندك أي تعليمات لأحمد؟")).toBe("عندك أي تعليمات لSalem؟");
    const tree = personalizeTree({ a: "Hi Ahmed", f: (x: string) => `Ahmed calls ${x}`, n: 3 }, p);
    expect(tree.a).toBe("Hi Salem");
    expect(tree.f("Abdullah")).toBe("Salem calls Faisal");
    expect(tree.n).toBe(3);
  });
});
