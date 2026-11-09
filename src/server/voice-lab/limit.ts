import { reserveRateLimit } from "@/server/rate-limit";

const WINDOW_SECONDS = 60 * 60;
const MAX_OWNER_OPENS = 30;
const MAX_GLOBAL_OPENS = 300;

/** Quotas are shared when the database RPC is available and instance-local while it is unavailable. */
export async function allowLabOpen(ownerId: string, nowMs: number): Promise<boolean> {
  const owner = await reserveRateLimit(`voice-lab:owner:${ownerId}`, MAX_OWNER_OPENS, WINDOW_SECONDS, nowMs);
  if (!owner) return false;

  const global = await reserveRateLimit("voice-lab:global", MAX_GLOBAL_OPENS, WINDOW_SECONDS, nowMs);
  if (!global) {
    await owner.release();
    return false;
  }
  return true;
}
