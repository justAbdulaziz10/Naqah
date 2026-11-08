import type { Workspace } from "@/domain/types";

/**
 * The farm as it stood when the call began, kept for the call so each answer doesn't reload it. It
 * only feeds the conversation: saving a report still goes through `applyVoiceEvent`, which reads
 * the farm afresh. A process that doesn't hold an entry simply loads the farm again.
 */
const LIFETIME_MS = 20 * 60 * 1000;
const MAX_CALLS = 100;

const calls = new Map<string, { workspace: Workspace; expires: number }>();

export function rememberCallWorkspace(callSid: string, workspace: Workspace, now: Date): void {
  for (const [sid, entry] of calls) if (entry.expires <= now.getTime()) calls.delete(sid);
  if (calls.size >= MAX_CALLS) calls.delete(calls.keys().next().value as string);
  calls.set(callSid, { workspace, expires: now.getTime() + LIFETIME_MS });
}

export function callWorkspace(callSid: string, now: Date): Workspace | null {
  const entry = calls.get(callSid);
  return entry && entry.expires > now.getTime() ? entry.workspace : null;
}

export function forgetCallWorkspace(callSid: string): void {
  calls.delete(callSid);
}
