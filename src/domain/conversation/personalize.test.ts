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

  it("doesn't rename a worker who shares the owner's sample name", () => {
    const ws = createDemoWorkspace("ar", "ultimate");
    ws.settings.worker.name = "عبدالله";
    ws.settings.owner.name = "خالد";
    expect(makePersonalizer(ws)("هلا أحمد، ناقة تتصل بعبدالله")).toBe("هلا عبدالله، ناقة تتصل بخالد");
  });

  it("never doubles a real name that already contains a sample name", () => {
    const ws = createDemoWorkspace("ar", "ultimate");
    ws.settings.worker.name = "أحمد الشمري";
    ws.settings.owner.name = "محمد بن عبدالله";
    const p = makePersonalizer(ws);
    expect(p("حُفظ تحديث المزرعة من أحمد الشمري")).toBe("حُفظ تحديث المزرعة من أحمد الشمري");
    expect(p("ناقة تتصل بعبدالله")).toBe("ناقة تتصل بعبدالله");
  });
});
