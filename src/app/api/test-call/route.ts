import { getOwner } from "@/lib/supabase/server";
import { readBoundedJson } from "@/lib/http/body";
import { hasSameOrigin } from "@/lib/http/origin";
import { createServiceClient } from "@/server/db/service-client";
import { isUuid } from "@/server/db/ids";
import { isTestCallAdmin, testCallPhone, testCallsEnabled } from "@/server/calls/test-call-config";
import { latestTestCall, startTestCall, testCallReadiness } from "@/server/calls/test-call";
import type { TestCallError, TestCallResponse } from "@/server/calls/test-call-api";

const json = (body: TestCallResponse, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const fail = (error: TestCallError, status: number) => json({ ok: false, error }, status);

async function authorize() {
  if (!testCallsEnabled()) return fail("unavailable", 404);
  const { user } = await getOwner();
  if (!user) return fail("unauthenticated", 401);
  return isTestCallAdmin(user) ? user : fail("unavailable", 404);
}

export async function GET(): Promise<Response> {
  const owner = await authorize();
  if (owner instanceof Response) return owner;
  const client = createServiceClient();
  if (!client) return json({ ok: true, ready: false, blockers: ["not_configured"], call: null });
  try {
    const ready = await testCallReadiness(client, owner.id);
    const call = await latestTestCall(client, owner.id);
    return json({ ok: true, ready: ready.blockers.length === 0, blockers: ready.blockers, call });
  } catch { return fail("failed", 503); }
}

export async function POST(request: Request): Promise<Response> {
  const owner = await authorize();
  if (owner instanceof Response) return owner;
  if (!hasSameOrigin(request)) return fail("forbidden", 403);
  const parsed = await readBoundedJson(request, 2048);
  if (!parsed.ok) return fail("invalid_request", parsed.status);
  if (!parsed.value || typeof parsed.value !== "object" || Array.isArray(parsed.value)) return fail("invalid_request", 400);
  const body = parsed.value as Record<string, unknown>;
  if (body.confirmedCharge !== true || body.consentConfirmed !== true) return fail("confirmation_required", 400);
  const phone = testCallPhone(body.phone);
  if (!phone) return fail("invalid_number", 400);
  if (typeof body.requestId !== "string" || !isUuid(body.requestId)) return fail("invalid_request", 400);
  const client = createServiceClient();
  if (!client) return fail("not_configured", 503);
  try {
    const result = await startTestCall(client, owner.id, { phone, requestId: body.requestId.toLowerCase() });
    const status = result.ok ? 200 : result.error === "busy" ? 409 : result.error === "rate_limited" ? 429 : result.error === "no_test_ranch" ? 403 : result.error === "not_configured" || result.error === "failed" ? 503 : 400;
    return json(result, status);
  } catch { return fail("failed", 503); }
}
