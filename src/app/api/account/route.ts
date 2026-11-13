import { loadWorkspace, openAccount, saveOwnerEdits } from "@/server/farm/actions";

const NO_STORE = { "Cache-Control": "no-store" };

/** Cookies ride along on a cross-site POST, so only this site's own pages may call this. */
function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * The dashboard's data path. Not a Server Action: Next queues those behind navigation and drops
 * one in flight when a page changes, which would lose the save that finishes setup.
 */
export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return Response.json({ ok: false, error: "forbidden" }, { status: 403, headers: NO_STORE });
  const body = (await request.json().catch(() => null)) as { op?: unknown; changes?: unknown; farm?: unknown } | null;
  const result =
    body?.op === "open" ? await openAccount()
    : body?.op === "load" ? await loadWorkspace()
    : body?.op === "save" ? await saveOwnerEdits(body.changes, body.farm)
    : null;
  if (!result) return Response.json({ ok: false, error: "invalid_input" }, { status: 400, headers: NO_STORE });
  return Response.json(result, { headers: NO_STORE });
}
