import { riyadhParts } from "@/domain/clock";

/** Riyadh calendar date as a sortable number, so "tomorrow" means the next date whatever the hour. */
function dateKey(date: Date) {
  const { year, month, day } = riyadhParts(date);
  return Date.UTC(year, month - 1, day);
}

/**
 * The one name for a day across the header: Today, Tomorrow, otherwise its weekday. The rail and
 * the next-call line call the same moment the same thing.
 */
export function dayWord(at: Date, now: Date, words: { today: string; tomorrow: string }, weekday: () => string) {
  const diff = Math.round((dateKey(at) - dateKey(now)) / 86_400_000);
  if (diff === 0) return words.today;
  if (diff === 1) return words.tomorrow;
  return weekday();
}
