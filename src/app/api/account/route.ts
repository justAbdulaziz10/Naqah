import { callNowAvailable, callWorkerNow, retryUndelivered, loadWorkspace, openAccount, saveOwnerEdits } from "@/server/farm/actions";
import { isAccountDataEnabled } from "@/server/farm/account-mode";
import { MAX_JSON_BODY_BYTES, readBoundedJson } from "@/lib/http/body";
import { hasSameOrigin } from "@/lib/http/origin";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * The dashboard's data path. Not a Server Action: Next queues those behind navigation and drops
 * one in flight when a page changes, which would lose the save that finishes setup.
 */
export async function POST(request: Request): Promise<Response> {
  if (!isAccountDataEnabled()) return Response.json({ ok: false, error: "unavailable" }, { status: 404, headers: NO_STORE });
  if (!hasSameOrigin(request)) return Response.json({ ok: false, error: "forbidden" }, { status: 403, headers: NO_STORE });
  const parsed = await readBoundedJson(request, MAX_JSON_BODY_BYTES);
  if (!parsed.ok) return Response.json({ ok: false, error: parsed.status === 413 ? "payload_too_large" : "invalid_input" }, { status: parsed.status, headers: NO_STORE });
  const body = typeof parsed.value === "object" && parsed.value !== null && !Array.isArray(parsed.value)
    ? parsed.value as { op?: unknown; changes?: unknown; farm?: unknown; id?: unknown }
    : null;
  const result =
    body?.op === "open" ? await openAccount()
    : body?.op === "load" ? await loadWorkspace()
    : body?.op === "save" ? await saveOwnerEdits(body.changes, body.farm)
    : body?.op === "callNowAvailable" ? await callNowAvailable()
    // One real report call to this owner's own saved primary worker; see callWorkerNow.
    : body?.op === "callNow" ? await callWorkerNow()
    : body?.op === "retryUndelivered" ? await retryUndelivered(body.id)
    : null;
  if (!result) return Response.json({ ok: false, error: "invalid_input" }, { status: 400, headers: NO_STORE });
  return Response.json(result, { headers: NO_STORE });
}
