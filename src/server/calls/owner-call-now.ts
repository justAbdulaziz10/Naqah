/**
 * LOCAL DEMO ONLY: the owner's «اتصل الآن» with «المالك» chosen. NAQAH calls the owner now with the briefing it would give
 * at the owner's own time, through the same signed owner routes and realtime session as the scheduled owner call. Its
 * own path beside the worker's «اتصال حقيقي»: nothing here reads or writes a report call run. Claimed before dialling;
 * a call Twilio never placed is undone. One attempt, never retried.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { REPORT_CALL_RING_SECONDS } from "@/domain/clock";
import { abandonOwnerCallAttempt, anyCallLive, dialableOwnerPhone, openOwnerCallNow, type OwnerCallNowBlock } from "@/domain/ownerCalls";
import { DbError } from "@/server/db/errors";
import { toDbId } from "@/server/db/ids";
import { runFarmAction } from "@/server/db/service-repository";
import { voiceLocale } from "@/server/env";
import { reserveRateLimit, type RateLimitLease } from "@/server/rate-limit";
import { CALL_NOW_LIMITS, demoNoCallLimit } from "./config";
import { ACTIVE_TEST_CALLS } from "./test-call-store";
import { CALL_STALE_MS } from "./reliability";
import { signCallToken } from "./token";
import type { OutboundCaller, OutboundCallResult } from "./twilio";

export type OwnerCallNowResult =
  | { status: "placed" }
  | { status: "blocked"; reason: OwnerCallNowBlock | "not_approved" | "rate_limited" | "unavailable" }
  | { status: "failed"; reason: "not_placed"; code?: number };
type Block = Extract<OwnerCallNowResult, { status: "blocked" }>["reason"];

/** A call row the voice service still holds for this ranch (any party), or a Lab test call still going. */
async function callConnected(client: SupabaseClient, farmId: string, now: Date): Promise<boolean> {
  const since = new Date(now.getTime() - CALL_STALE_MS).toISOString();
  const sessions = await client.from("voice_call_sessions").select("call_sid").eq("farm_id", farmId).gte("created_at", since).limit(1);
  if (sessions.error) throw new DbError("unavailable");
  if (sessions.data.length) return true;
  const tests = await client.from("test_calls").select("id").eq("farm_id", farmId).in("status", ACTIVE_TEST_CALLS).gte("created_at", since).limit(1);
  // A deployment without the Lab's test-call table has no test calls to wait for.
  return !tests.error && tests.data.length > 0;
}

/** Whether the owner's saved number may be called here and whether any call is live, for the Dashboard. */
export async function ownerCallNowView(client: SupabaseClient, farmId: string, workspace: Parameters<typeof dialableOwnerPhone>[0], allowlist: string[], now: Date) {
  const phone = dialableOwnerPhone(workspace);
  const run = workspace.ownerCallRun ?? null;
  return {
    phone,
    numberApproved: phone === null ? null : allowlist.includes(phone),
    live: anyCallLive(workspace, now) || await callConnected(client, farmId, now),
    runId: run?.id ?? null,
    state: run?.state ?? null,
  };
}

/** The «اتصال حقيقي» limits (3 an hour, 10 a day) under their own owner-call keys; the demo's no-limit switch applies. */
async function withOwnerCallLimit(farmId: string, now: Date, place: () => Promise<OwnerCallNowResult>): Promise<OwnerCallNowResult> {
  if (demoNoCallLimit(farmId)) return place();
  const leases: RateLimitLease[] = [];
  const release = () => Promise.all(leases.map((lease) => lease.release()));
  for (const { window, limit, seconds } of CALL_NOW_LIMITS) {
    const lease = await reserveRateLimit(`owner-call-now:farm:${farmId}:${window}`, limit, seconds, now.getTime());
    if (!lease) {
      await release();
      return { status: "blocked", reason: "rate_limited" };
    }
    leases.push(lease);
  }
  const result = await place();
  if (result.status === "blocked") await release();
  return result;
}

export async function requestOwnerCallNow(
  client: SupabaseClient,
  caller: OutboundCaller,
  farmId: string,
  options: { baseUrl: string; now: Date; allowlist: string[] },
): Promise<OwnerCallNowResult> {
  const { baseUrl, now, allowlist } = options;
  return withOwnerCallLimit(farmId, now, async () => {
    if (await callConnected(client, farmId, now)) return { status: "blocked", reason: "call_live" };
    type Opened = { blocked: Block } | { claim: NonNullable<ReturnType<typeof openOwnerCallNow>["claim"]> };
    const { result } = await runFarmAction<Opened>(client, farmId, (ws) => {
      // Undefined until migration 20261110090000 runs: a claim could not be saved, so nothing may dial.
      if (ws.ownerCallRun === undefined) return { ws, result: { blocked: "unavailable" } };
      if (anyCallLive(ws, now)) return { ws, result: { blocked: "call_live" } };
      // Checked before a run exists, so a number that isn't approved here leaves no trace.
      const phone = dialableOwnerPhone(ws);
      if (phone && !allowlist.includes(phone)) return { ws, result: { blocked: "not_approved" } };
      const opened = openOwnerCallNow(ws, now);
      if (!opened.claim) return { ws, result: { blocked: opened.blocked ?? "call_live" } };
      return { ws: opened.ws, result: { claim: opened.claim } };
    });
    if ("blocked" in result) return { status: "blocked", reason: result.blocked };
    const { claim } = result;
    // A run opened in this pass has a domain id until saved; the database id is derived from it.
    const runId = toDbId(farmId, claim.runId);
    const reportId = claim.reportId ? toDbId(farmId, claim.reportId) : "";
    const query = `s=${encodeURIComponent(signCallToken({ k: "owner", f: farmId, o: runId, r: reportId, n: claim.attempt, l: voiceLocale(), t: now.getTime() }))}`;
    let placed: OutboundCallResult;
    try {
      placed = await caller.place({
        to: claim.phone,
        url: `${baseUrl}/api/voice/owner?${query}`,
        statusCallback: `${baseUrl}/api/voice/owner/status?${query}`,
        timeoutSeconds: REPORT_CALL_RING_SECONDS,
        statusEvents: ["completed"],
      });
    } catch {
      placed = { placed: false, reason: "network_error" };
    }
    if (placed.placed) return { status: "placed" };
    await runFarmAction(client, farmId, (ws) => ({ ws: abandonOwnerCallAttempt(ws, now, runId, claim.attempt), result: null }));
    return { status: "failed", reason: "not_placed", ...(placed.code === undefined ? {} : { code: placed.code }) };
  });
}
