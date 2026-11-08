/**
 * Call Lab copy and the scripted engine were written around the sample farm's
 * names (worker "Ahmed" / «أحمد», owner "Abdullah" / «عبدالله»). When someone sets up
 * their own farm, swap those names for the workspace's real ones at render time.
 *
 * Sample names are left alone so the demo reads naturally in either language.
 * TODO(production): pass names into the engine/messages explicitly instead.
 */
import type { Workspace } from "../types";

export const SAMPLE_NAMES = {
  worker: ["Ahmed", "أحمد"],
  owner: ["Abdullah", "عبدالله"],
} as const;

export type Personalizer = (text: string) => string;

export function makePersonalizer(ws: Pick<Workspace, "settings"> | null): Personalizer {
  if (!ws) return (text) => text;
  const worker = ws.settings.worker.name.trim();
  const ownerFull = ws.settings.owner.name.trim();
  const owner = ownerFull.split(/\s+/)[0] ?? "";
  // A real name that already contains a sample name ("Ahmed Saleh", "محمد بن عبدالله") would
  // otherwise double up or swap the wrong word, so leave that role alone.
  const mentionsSample = (name: string, samples: readonly string[]) => samples.some((sample) => name.includes(sample));
  const names = new Map<string, string>();
  if (worker && !mentionsSample(worker, SAMPLE_NAMES.worker)) for (const sample of SAMPLE_NAMES.worker) names.set(sample, worker);
  if (owner && !mentionsSample(ownerFull, SAMPLE_NAMES.owner)) for (const sample of SAMPLE_NAMES.owner) names.set(sample, owner);
  if (!names.size) return (text) => text;
  // One pass: a worker named Abdullah must not then be renamed as the owner.
  const samples = new RegExp([...names.keys()].join("|"), "g");
  return (text) => text.replace(samples, (sample) => names.get(sample) ?? sample);
}

/** Apply a personalizer to every string (and string-returning function) in a message tree. */
export function personalizeTree<T>(value: T, fn: Personalizer): T {
  if (typeof value === "string") return fn(value) as T;
  if (typeof value === "function") {
    return ((...args: unknown[]) => personalizeTree((value as (...a: unknown[]) => unknown)(...args), fn)) as T;
  }
  if (Array.isArray(value)) return value.map((item) => personalizeTree(item, fn)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, personalizeTree(item, fn)])) as T;
  }
  return value;
}
