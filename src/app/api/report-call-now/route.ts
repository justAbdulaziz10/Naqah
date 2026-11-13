import { getOwner } from "@/lib/supabase/server";
import { demoRepeatReports, manualCallsEnabled } from "@/server/calls/config";
import { callDiagnostic, cleanStaleReportCalls } from "@/server/calls/reliability";
import { createServiceClient } from "@/server/db/service-client";
import { isUuid } from "@/server/db/ids";
import { loadFarm, requireFarm } from "@/server/db/queries";
import { freeCallPreflight } from "@/server/voice/preflight";
import { bridgeRequest } from "@/server/voice/realtime/internal";
import { reserveRateLimit } from "@/server/rate-limit";

export const maxDuration = 20;
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(request: Request): Promise<Response> {
  if (!manualCallsEnabled()) return json({ ok: false }, 404);
  const { user } = await getOwner();
  if (!user) return json({ ok: false }, 401);
  const client = createServiceClient();
  if (!client) return json({ ok: false }, 503);
  try {
    const { data, error } = await client.from("farms").select("id").eq("owner_id", user.id).maybeSingle();
    if (error || !data) return json({ ok: false }, 503);
    if (new URL(request.url).searchParams.get("preflight") === "1") {
      if (!await reserveRateLimit(`call-preflight:farm:${data.id}:day`, 10, 86400)) return json({ ok: false, ready: false, reason: "rate_limited" }, 429);
      return json({ ok: true, ...await freeCallPreflight(client, data.id) });
    }
    await cleanStaleReportCalls(client, data.id, new Date());
    const { workspace } = requireFarm(await loadFarm(client, { id: data.id }));
    const run = workspace.reportCalls?.at(-1);
    return json({ ok: true, runId: run?.id ?? null, state: run?.state ?? null, message: run && !run.reportId ? callDiagnostic(workspace, data.id, run.id) : null, repeatReports: demoRepeatReports(data.id) });
  } catch { return json({ ok: false }, 503); }
}

export async function POST(request: Request): Promise<Response> {
  const bridge = await bridgeRequest(request);
  if (bridge instanceof Response) return bridge;
  const farmId = bridge.body.farmId;
  if (typeof farmId !== "string" || !isUuid(farmId)) return json({ ok: false }, 400);
  try { return json({ ok: true, ...await freeCallPreflight(bridge.client, farmId) }); }
  catch { return json({ ok: false }, 503); }
}
