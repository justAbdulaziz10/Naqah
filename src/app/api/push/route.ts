import webPush from "web-push";
import { isIP } from "node:net";
import { isAccountDataEnabled } from "@/server/farm/account-mode";
import { getOwner } from "@/lib/supabase/server";
import { MAX_JSON_BODY_BYTES, readBoundedJson } from "@/lib/http/body";
import { hasSameOrigin } from "@/lib/http/origin";
import { isPushRequestBody } from "@/lib/push/validation";
import { reserveRateLimit } from "@/server/rate-limit";

const PUSH_IP_LIMIT = 10;
const PUSH_WINDOW_SECONDS = 60;

function clientIp(request: Request): string {
  const candidate = request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim()
    || request.headers.get("x-real-ip")?.trim();
  return candidate && candidate.length <= 64 && isIP(candidate) ? candidate : "unknown";
}

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return Response.json({ ok: false, reason: "forbidden" }, { status: 403 });

  if (isAccountDataEnabled()) {
    const { user, unavailable } = await getOwner();
    if (!user) return Response.json({ ok: false, reason: unavailable ? "auth_unavailable" : "unauthenticated" }, { status: unavailable ? 503 : 401 });
  }

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) {
    return Response.json({ ok: false, reason: "push_not_configured" }, { status: 501 });
  }

  const parsed = await readBoundedJson(request, MAX_JSON_BODY_BYTES);
  if (!parsed.ok) return Response.json({ ok: false, reason: parsed.status === 413 ? "payload_too_large" : "invalid_request" }, { status: parsed.status });

  if (!isPushRequestBody(parsed.value)) {
    return Response.json({ ok: false, reason: "invalid_request" }, { status: 400 });
  }

  if (!(await reserveRateLimit(`push:ip:${clientIp(request)}`, PUSH_IP_LIMIT, PUSH_WINDOW_SECONDS))) {
    return Response.json({ ok: false, reason: "rate_limited" }, { status: 429 });
  }

  try {
    await webPush.sendNotification(parsed.value.subscription, JSON.stringify(parsed.value.payload), {
      TTL: 60,
      urgency: "high",
      vapidDetails: {
        subject: process.env.VAPID_SUBJECT || "mailto:hello@naqah.app",
        publicKey,
        privateKey,
      },
    });
    return Response.json({ ok: true });
  } catch (error) {
    const statusCode = typeof error === "object" && error !== null && "statusCode" in error
      ? Number((error as { statusCode?: unknown }).statusCode)
      : 0;
    return Response.json(
      { ok: false, reason: statusCode === 404 || statusCode === 410 ? "push_subscription_expired" : "push_send_failed" },
      { status: statusCode === 404 || statusCode === 410 ? 410 : 502 },
    );
  }
}
