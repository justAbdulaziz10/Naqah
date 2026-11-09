import { describe, expect, it } from "vitest";
import { CALL_HISTORY_PAGE_DAYS, pageCallEntries } from "./paging";
import type { CallEntry } from "@/components/dashboard/callStories";

function entry(day: number, id: string, group: "reports" | "followUps" | "yours"): CallEntry {
  return {
    type: "chain",
    id,
    at: new Date(Date.UTC(2026, 0, day, 12)).toISOString(),
    group,
    calls: [],
  };
}

describe("calls history paging", () => {
  it("shows the newest 14 days first and marks when earlier days remain", () => {
    const entries = Array.from({ length: 20 }, (_, index) => entry(20 - index, `call-${index}`, "yours"));
    const page = pageCallEntries(entries, "all", CALL_HISTORY_PAGE_DAYS);

    expect(page.days).toHaveLength(CALL_HISTORY_PAGE_DAYS);
    expect(page.days[0][0]).toBe("2026-01-20");
    expect(page.days.at(-1)?.[0]).toBe("2026-01-07");
    expect(page.hasEarlier).toBe(true);
  });

  it("applies the active filter before paging by day", () => {
    const entries = Array.from({ length: 20 }, (_, index) =>
      entry(20 - index, `call-${index}`, index % 2 === 0 ? "reports" : "yours"),
    );
    const page = pageCallEntries(entries, "reports", CALL_HISTORY_PAGE_DAYS);

    expect(page.days.every(([, dayEntries]) => dayEntries.every((item) => item.group === "reports"))).toBe(true);
    expect(page.days).toHaveLength(10);
    expect(page.hasEarlier).toBe(false);
  });

  it("groups only entries in the visible date window", () => {
    const newestDayEntries = [entry(20, "first", "reports"), entry(20, "second", "yours")];
    const olderEntries = Array.from({ length: 19 }, (_, index) => entry(19 - index, `older-${index}`, "followUps"));
    const page = pageCallEntries([...newestDayEntries, ...olderEntries], "all", 1);

    expect(page.days).toEqual([["2026-01-20", newestDayEntries]]);
    expect(page.hasEarlier).toBe(true);
  });
});
