import { generateIcs } from "@/lib/calendar/ics";
import { decodeSchedule } from "@/lib/calendar/schedule";

const subscriptionHeaders = {
  "Cache-Control": "public, max-age=3600, s-maxage=3600, stale-while-revalidate=21600",
  "Content-Type": "text/calendar; charset=utf-8",
  "Content-Disposition": 'inline; filename="naqah.ics"',
};

export async function GET(request: Request): Promise<Response> {
  const encoded = new URL(request.url).searchParams.get("s");
  const schedule = decodeSchedule(encoded);
  if (!schedule) {
    return Response.json({ error: "Invalid calendar schedule" }, { status: 400 });
  }

  return new Response(generateIcs(schedule), { headers: subscriptionHeaders });
}
