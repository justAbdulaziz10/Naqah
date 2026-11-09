const WINDOW_MS = 60 * 60 * 1000;
const MAX_OPENS = 30;
const opens = new Map<string, number[]>();

/** A brake on a looping page. One server instance only: the owner allowlist is the actual gate. */
export function allowLabOpen(ownerId: string, nowMs: number): boolean {
  const recent = (opens.get(ownerId) ?? []).filter((at) => nowMs - at < WINDOW_MS);
  if (recent.length >= MAX_OPENS) return false;
  opens.set(ownerId, [...recent, nowMs]);
  return true;
}
