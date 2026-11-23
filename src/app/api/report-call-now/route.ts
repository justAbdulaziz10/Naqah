import { getOwner } from "@/lib/supabase/server";
import { demoNoCallLimit, demoRepeatReports, manualCallsEnabled } from "@/server/calls/config";
import { callingFarmAllowed, testCallScope, verifyCallingOwner } from "@/server/test-ranch";
import { callingFarmForOwner } from "@/server/db/service-repository";
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
  const scope = testCallScope();
  if (scope.kind === "invalid") return json({ ok: false }, 503);
  const { user, unavailable } = await getOwner();
  if (!user) return json({ ok: false }, scope.kind === "ranch" && unavailable ? 503 : 401);
  const client = createServiceClient();
  if (!client) return json({ ok: false }, 503);
  try {
    const farmId = await callingFarmForOwner(client, user.id);
    if (!farmId || !await verifyCallingOwner(client, farmId)) return json({ ok: false }, 503);
    if (new URL(request.url).searchParams.get("preflight") === "1") {
      // The presentation ranch runs without call limits on the local demo; everyone else is capped.
      if ((scope.kind === "ranch" || !demoNoCallLimit(farmId)) && !await reserveRateLimit(`call-preflight:farm:${farmId}:day`, 10, 86400)) return json({ ok: false, ready: false, reason: "rate_limited" }, 429);
      return json({ ok: true, ...await freeCallPreflight(client, farmId) });
    }
    await cleanStaleReportCalls(client, farmId, new Date());
    const { workspace } = requireFarm(await loadFarm(client, { id: farmId }));
    const run = workspace.reportCalls?.at(-1);
    return json({ ok: true, runId: run?.id ?? null, state: run?.state ?? null, message: run && !run.reportId ? callDiagnostic(workspace, farmId, run.id) : null, repeatReports: demoRepeatReports(farmId) });
  } catch { return json({ ok: false }, 503); }
}

export async function POST(request: Request): Promise<Response> {
  const bridge = await bridgeRequest(request);
  if (bridge instanceof Response) return bridge;
  const farmId = bridge.body.farmId;
  if (typeof farmId !== "string" || !isUuid(farmId)) return json({ ok: false }, 400);
  if (!callingFarmAllowed(farmId)) return json({ ok: false }, 503);
  if (testCallScope().kind === "ranch" && !await reserveRateLimit(`call-preflight:farm:${farmId}:day`, 10, 86400)) {
    return json({ ok: false, ready: false, reason: "rate_limited" }, 429);
  }
  try { return json({ ok: true, ...await freeCallPreflight(bridge.client, farmId) }); }
  catch { return json({ ok: false }, 503); }
}
