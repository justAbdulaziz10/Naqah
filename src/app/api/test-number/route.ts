import { getOwner } from "@/lib/supabase/server";
import { hasSameOrigin } from "@/lib/http/origin";
import { approveTestNumber, ownerApprovesTestNumbers } from "@/server/calls/config";
import { createServiceClient } from "@/server/db/service-client";

const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });

/**
 * LOCAL DEMO ONLY. The signed-in owner approves the worker number they are saving, after confirming its owner agreed
 * to test calls. It places no call and changes no saved number: Settings saves the number, «اتصال حقيقي» calls it.
 */
export async function POST(request: Request): Promise<Response> {
  if (!ownerApprovesTestNumbers()) return json({ ok: false, reason: "not_local" }, 404);
  if (!hasSameOrigin(request)) return json({ ok: false, reason: "forbidden" }, 403);
  const { user } = await getOwner();
  if (!user) return json({ ok: false, reason: "unauthenticated" }, 401);
  const text = await request.text();
  if (text.length > 512) return json({ ok: false, reason: "invalid" }, 400);
  let body: unknown;
  try { body = JSON.parse(text); } catch { return json({ ok: false, reason: "invalid" }, 400); }
  const { phone, consent } = (body ?? {}) as { phone?: unknown; consent?: unknown };
  if (typeof phone !== "string" || consent !== true) return json({ ok: false, reason: "consent_required" }, 400);
  const client = createServiceClient();
  if (!client) return json({ ok: false, reason: "unavailable" }, 503);
  const { data, error } = await client.from("farms").select("id").eq("owner_id", user.id).maybeSingle();
  if (error || !data) return json({ ok: false, reason: "unavailable" }, 503);
  const result = approveTestNumber(phone, { farmId: data.id, ownerId: user.id, at: new Date() });
  return result.ok ? json({ ok: true }) : json({ ok: false, reason: result.reason }, result.reason === "limit" ? 409 : 400);
}
