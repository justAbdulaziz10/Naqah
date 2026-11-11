import { describe, expect, it } from "vitest";
import { countedUnit } from "./counted-unit";

describe("a unit agreeing with its count", () => {
  it.each([
    [4, "كيس", "أكياس"], [3, "اكياس", "أكياس"], [10, "كيس", "أكياس"], [20, "كيس", "كيس"], [11, "أكياس", "كيس"], [1, "أكياس", "كيس"],
    [5, "بالة", "بالات"], [25, "بالات", "بالة"], [7, "طن", "أطنان"], [4, "bag", "bags"], [1, "bags", "bag"],
    [4, "جالون", "جالون"], [4, "ربطة كبيرة", "ربطة كبيرة"],
  ])("%d %s → %s", (count, unit, expected) => {
    expect(countedUnit(count, unit)).toBe(expected);
  });
});
