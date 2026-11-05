import { createRequire } from "node:module";
import { isPushRequestBody, type PushSubscriptionInput } from "@/lib/push/validation";

interface WebPushModule {
  sendNotification: (
    subscription: PushSubscriptionInput,
    payload: string,
    options: {
      TTL: number;
      urgency: "high";
      vapidDetails: { subject: string; publicKey: string; privateKey: string };
    },
  ) => Promise<unknown>;
}

function loadWebPush(): WebPushModule {
  // Keep the optional dependency out of the client bundle. Install web-push
  // when enabling VAPID in a deployment; the demo path works without it.
  const packageName = ["web", "-push"].join("");
  return createRequire(import.meta.url)(packageName) as WebPushModule;
}

export async function POST(request: Request) {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) {
    return Response.json({ ok: false, reason: "push_not_configured" }, { status: 501 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, reason: "invalid_request" }, { status: 400 });
  }

  if (!isPushRequestBody(body)) {
    return Response.json({ ok: false, reason: "invalid_request" }, { status: 400 });
  }

  try {
    const webPush = loadWebPush();
    await webPush.sendNotification(body.subscription, JSON.stringify(body.payload), {
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
    if (typeof error === "object" && error !== null && "code" in error && error.code === "MODULE_NOT_FOUND") {
      return Response.json({ ok: false, reason: "push_not_configured" }, { status: 501 });
    }
    const statusCode = typeof error === "object" && error !== null && "statusCode" in error
      ? Number((error as { statusCode?: unknown }).statusCode)
      : 0;
    return Response.json(
      { ok: false, reason: statusCode === 404 || statusCode === 410 ? "push_subscription_expired" : "push_send_failed" },
      { status: statusCode === 404 || statusCode === 410 ? 410 : 502 },
    );
  }
}
