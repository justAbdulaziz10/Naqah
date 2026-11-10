import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { farmVoiceMissing, realtimeVoiceConfig, voiceMode } from "@/server/env";
import { reserveRateLimit, type RateLimitLease } from "@/server/rate-limit";
import { callAllowlist, outboundConfig } from "./config";
import { requestReportCallNow } from "./scheduler";
import { createTwilioCaller, type OutboundCaller } from "./twilio";
import type { TestCallBlocker, TestCallError, TestCallFailure, TestCallView } from "./test-call-api";
import { ACTIVE_TEST_CALLS, closeTestCallRun, expireTestCalls, isTestRanch, requireTestCallData, TEST_CALL_COLUMNS, testCallView, type TestCallRow } from "./test-call-store";

export async function testCallReadiness(client: SupabaseClient, actorId: string) {
  const farm = requireTestCallData(await client.from("farms").select("id").eq("owner_id", actorId).maybeSingle());
  const farmId: string | null = farm && await isTestRanch(client, farm.id) ? farm.id : null;
  const config = outboundConfig();
  const allowlist = callAllowlist();
  const blockers: TestCallBlocker[] = [];
  if (!farmId) blockers.push("no_test_ranch");
  if (voiceMode() !== "farm" || !realtimeVoiceConfig() || farmVoiceMissing().length || !config) blockers.push("not_configured");
  if (!allowlist.length) blockers.push("no_allowlist");
  return { farmId, config, allowlist, blockers };
}

export async function latestTestCall(client: SupabaseClient, actorId: string): Promise<TestCallView | null> {
  await expireTestCalls(client, new Date(), actorId);
  const row = requireTestCallData(await client.from("test_calls").select(TEST_CALL_COLUMNS).eq("actor_id", actorId).order("created_at", { ascending: false }).limit(1).maybeSingle()) as TestCallRow | null;
  return row ? testCallView(client, row) : null;
}

export function testCallFailure(code?: number, reason?: string): TestCallFailure {
  if (code === 21215 || code === 13227) return "saudi_calls_disabled";
  if (code !== undefined && [21201, 21202, 21205, 21211, 21212, 21214, 21614].includes(code)) return "number_rejected";
  if (reason === "invalid_number" || reason === "not_allowed") return "number_rejected";
  if (reason === "network_error") return "network_error";
  return reason === "rejected" || code !== undefined ? "provider_rejected" : "not_placed";
}

type StartResult = { ok: true; call: TestCallView } | { ok: false; error: TestCallError };

export async function startTestCall(
  client: SupabaseClient,
  actorId: string,
  input: { phone: string; requestId: string },
  options: { now?: Date; caller?: OutboundCaller } = {},
): Promise<StartResult> {
  const now = options.now ?? new Date();
  await expireTestCalls(client, now, actorId);
  const existing = requireTestCallData(await client.from("test_calls").select(TEST_CALL_COLUMNS).eq("request_id", input.requestId).maybeSingle()) as TestCallRow | null;
  if (existing) return existing.actor_id === actorId ? { ok: true, call: await testCallView(client, existing) } : { ok: false, error: "invalid_request" };
  const ready = await testCallReadiness(client, actorId);
  if (!ready.farmId) return { ok: false, error: "no_test_ranch" };
  if (!ready.allowlist.includes(input.phone)) return { ok: false, error: "number_not_allowed" };
  if (!ready.config || ready.blockers.includes("not_configured")) return { ok: false, error: "not_configured" };
  await expireTestCalls(client, now);

  const leases: RateLimitLease[] = [];
  let placed = false;
  let row: TestCallRow | null = null;
  let runId: string | null = null;
  const release = () => Promise.all(leases.map((lease) => lease.release()));
  try {
    for (const [key, limit, seconds] of [
      [`test-call:actor:${actorId}:hour`, 3, 3600],
      [`test-call:actor:${actorId}:day`, 10, 86400],
      ["test-call:global:day", 20, 86400],
    ] as const) {
      const lease = await reserveRateLimit(key, limit, seconds, now.getTime());
      if (!lease) return { ok: false, error: "rate_limited" };
      leases.push(lease);
    }
    const inserted = await client.from("test_calls").insert({
      request_id: input.requestId, actor_id: actorId, farm_id: ready.farmId,
      destination_masked: `+9665******${input.phone.slice(-2)}`,
      charge_confirmed: true, consent_confirmed: true, status: "calling",
      created_at: now.toISOString(), updated_at: now.toISOString(),
    }).select(TEST_CALL_COLUMNS).single();
    if (inserted.error?.code === "23505") {
      const replay = requireTestCallData(await client.from("test_calls").select(TEST_CALL_COLUMNS).eq("request_id", input.requestId).maybeSingle()) as TestCallRow | null;
      if (replay) return replay.actor_id === actorId ? { ok: true, call: await testCallView(client, replay) } : { ok: false, error: "invalid_request" };
      return { ok: false, error: "busy" };
    }
    row = requireTestCallData(inserted) as TestCallRow;
    requireTestCallData(await client.rpc("reset_test_call_ranch", { p_test_call_id: row.id }));
    const result = await requestReportCallNow(client, options.caller ?? createTwilioCaller(), ready.farmId, {
      baseUrl: ready.config.baseUrl, now, allowlist: ready.allowlist, to: input.phone,
      onRunOpened: async (openedId) => {
        runId = openedId;
        const linked = requireTestCallData(await client.from("test_calls").update({ run_id: openedId, updated_at: now.toISOString() })
          .eq("id", row!.id).in("status", ACTIVE_TEST_CALLS).select("id").single());
        if (!linked) throw new Error("Test call no longer active");
      },
    });
    placed = result.status === "placed";
    if (!placed) {
      await closeTestCallRun(client, ready.farmId, runId);
      requireTestCallData(await client.from("test_calls").update({
        status: "failed", result: "failed",
        failure: result.status === "failed" ? testCallFailure(result.code, result.failureReason) : "not_placed",
        updated_at: now.toISOString(), ended_at: now.toISOString(),
      }).eq("id", row.id).in("status", ACTIVE_TEST_CALLS));
    }
    const saved = requireTestCallData(await client.from("test_calls").select(TEST_CALL_COLUMNS).eq("id", row.id).single()) as TestCallRow;
    return { ok: true, call: await testCallView(client, saved) };
  } catch {
    if (row && !placed) {
      await closeTestCallRun(client, ready.farmId, runId);
      requireTestCallData(await client.from("test_calls").update({
        status: "failed", result: "failed", failure: "not_placed",
        updated_at: now.toISOString(), ended_at: now.toISOString(),
      }).eq("id", row.id).in("status", ACTIVE_TEST_CALLS));
      const saved = requireTestCallData(await client.from("test_calls").select(TEST_CALL_COLUMNS).eq("id", row.id).single()) as TestCallRow;
      return { ok: true, call: await testCallView(client, saved) };
    }
    return { ok: false, error: "failed" };
  } finally {
    if (!placed) await release();
  }
}
