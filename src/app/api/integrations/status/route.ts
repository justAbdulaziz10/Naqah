import { integrationsStatus } from "@/server/env";
import { connection } from "next/server";
import { getOwner } from "@/lib/supabase/server";

export async function GET(): Promise<Response> {
  await connection();
  const { user } = await getOwner();
  if (!user) return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  const commit = process.env.NEXT_PUBLIC_NAQAH_BUILD_COMMIT;
  return Response.json({
    ...integrationsStatus(),
    version: { commit: commit && /^[a-f0-9]{40}$/i.test(commit) ? commit : null },
  }, { headers: { "Cache-Control": "no-store" } });
}
