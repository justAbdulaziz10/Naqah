import { connection } from "next/server";
import { getOwner } from "@/lib/supabase/server";
import { callAllowlist, demoOwnerCallNow, demoOwnerCallNowEnabled } from "@/server/calls/config";
import { testCallScope, verifyCallingOwner } from "@/server/test-ranch";
import { callingFarmForOwner } from "@/server/db/service-repository";
import { reserveRateLimit } from "@/server/rate-limit";
import { ownerCallNowView } from "@/server/calls/owner-call-now";
import { callFailureMessages } from "@/server/calls/reliability";
import { createServiceClient } from "@/server/db/service-client";
import { loadFarm, requireFarm } from "@/server/db/queries";
import { freeCallPreflight } from "@/server/voice/preflight";

export const maxDuration = 20;
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });

/**
 * LOCAL DEMO ONLY. Whether the signed-in owner's ranch may take «المالك» on the Dashboard, whether their saved number
 * is approved on this computer and whether a call is live. `?preflight=1` runs the free checks the worker's call runs
 * (bridge, OpenAI, Twilio account), leaving out the worker's number. Places no call.
 */
export async function GET(request: Request): Promise<Response> {
  await connection(); // read at request time: the runner's flag is not in the build
  if (!demoOwnerCallNowEnabled()) return json({ ok: false }, 404);
  const scope = testCallScope();
  if (scope.kind === "invalid") return json({ ok: false }, 503);
  const { user, unavailable } = await getOwner();
  if (!user) return json({ ok: false }, scope.kind === "ranch" && unavailable ? 503 : 401);
  const client = createServiceClient();
  if (!client) return json({ ok: false }, 503);
  try {
    const farmId = await callingFarmForOwner(client, user.id);
    if (!farmId || !await verifyCallingOwner(client, farmId)) return json({ ok: false }, 503);
    if (!demoOwnerCallNow(farmId)) return json({ ok: true, enabled: false });
    if (new URL(request.url).searchParams.get("preflight") === "1") {
      if (scope.kind === "ranch" && !await reserveRateLimit(`call-preflight:farm:${farmId}:day`, 10, 86400)) return json({ ok: false, ready: false, reason: "rate_limited" }, 429);
      const result = await freeCallPreflight(client, farmId);
      const failed = result.checks.find((entry) => !entry.passed && entry.name !== "worker_allowlisted" && entry.name !== "no_active_run");
      return json({ ok: true, ready: !failed, message: failed ? callFailureMessages[failed.reason] : null });
    }
    const { workspace } = requireFarm(await loadFarm(client, { id: farmId }));
    const view = await ownerCallNowView(client, farmId, workspace, callAllowlist(), new Date());
    return json({ ok: true, enabled: true, numberApproved: view.numberApproved, live: view.live, runId: view.runId, state: view.state });
  } catch { return json({ ok: false }, 503); }
}
