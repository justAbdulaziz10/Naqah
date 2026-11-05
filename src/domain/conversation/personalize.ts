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
  const owner = ws.settings.owner.name.trim().split(/\s+/)[0] ?? "";
  const pairs: [string, string][] = [];
  if (worker && !(SAMPLE_NAMES.worker as readonly string[]).includes(worker)) {
    for (const sample of SAMPLE_NAMES.worker) pairs.push([sample, worker]);
  }
  if (owner && !(SAMPLE_NAMES.owner as readonly string[]).includes(owner)) {
    for (const sample of SAMPLE_NAMES.owner) pairs.push([sample, owner]);
  }
  if (!pairs.length) return (text) => text;
  return (text) => pairs.reduce((acc, [from, to]) => acc.split(from).join(to), text);
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
