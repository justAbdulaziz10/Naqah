import { integrationsStatus } from "@/server/env";
import { connection } from "next/server";

export async function GET(): Promise<Response> {
  await connection();
  return Response.json(integrationsStatus(), { headers: { "Cache-Control": "no-store" } });
}
