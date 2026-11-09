import { dayKey } from "@/domain";
import type { CallEntry, CallGroup } from "@/components/dashboard/callStories";

export const CALL_HISTORY_PAGE_DAYS = 14;

/** `entries` are newest first, as returned by `callEntries`. Only buckets in the visible window are built. */
export function pageCallEntries(
  entries: CallEntry[],
  filter: "all" | CallGroup,
  visibleDayCount: number,
): { days: [string, CallEntry[]][]; hasEarlier: boolean } {
  const filtered = filter === "all" ? entries : entries.filter((entry) => entry.group === filter);
  const visibleKeys: string[] = [];
  const visibleSet = new Set<string>();
  let hasEarlier = false;

  for (const entry of filtered) {
    const key = dayKey(new Date(entry.at));
    if (visibleSet.has(key)) continue;
    if (visibleKeys.length === visibleDayCount) {
      hasEarlier = true;
      break;
    }
    visibleKeys.push(key);
    visibleSet.add(key);
  }

  const oldestVisibleDay = visibleKeys.at(-1);
  if (!oldestVisibleDay) return { days: [], hasEarlier: false };

  const groups = new Map<string, CallEntry[]>();
  for (const entry of filtered) {
    const key = dayKey(new Date(entry.at));
    if (key < oldestVisibleDay) break;
    if (!visibleSet.has(key)) continue;
    const group = groups.get(key);
    if (group) group.push(entry);
    else groups.set(key, [entry]);
  }

  const days: [string, CallEntry[]][] = [];
  for (const key of visibleKeys) {
    const group = groups.get(key);
    if (group) days.push([key, group]);
  }
  return { days, hasEarlier };
}
