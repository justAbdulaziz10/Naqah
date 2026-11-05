# Installable app, offline pages, and notifications

## What it does

NAQAH exposes a standalone web app manifest, generated install icons, three home-screen shortcuts, and a root-scoped service worker. The worker caches same-origin Next.js static assets and brand assets, then uses a network-first cache for visited Arabic and English pages. When an uncached page cannot load, it renders a small bilingual offline page. The service worker can display local system notifications and Web Push notifications.

The Settings → Connections → App and notifications card provides the browser install prompt where available, the Safari Add to Home Screen steps on iOS, a notification permission switch, and a test notification. Important farm findings, No Answer tickets, and owner-call summaries can notify after the card is enabled. Events present when the app shell mounts are treated as history and are not sent.

## Environment variables

| Variable | Use |
| --- | --- |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Enables PushManager subscription in the browser. Without it, granted permissions use local service worker notifications. |
| `VAPID_PRIVATE_KEY` | Server-only VAPID key for `POST /api/push`. |
| `VAPID_SUBJECT` | Optional VAPID contact URL or `mailto:` address. Defaults to `mailto:hello@naqah.app`. |

The public key and private key must be from the same VAPID pair. Keep `VAPID_PRIVATE_KEY` in the deployment environment only; never place it in client code or commit it. The push route returns `501 push_not_configured` if either key is unset or the optional `web-push` runtime dependency is unavailable.

## How to test

1. Run a production build and start it with `npm run start` (the service worker intentionally does not register in development).
2. Visit `/ar/app` and `/en/app`, then request notification permission in Settings → Connections. Use “Send a test notification” to check the system notification surface.
3. With `NEXT_PUBLIC_VAPID_PUBLIC_KEY` configured, enable notifications to create a PushManager subscription. The client posts that subscription and a payload to `/api/push`; the server sends it with the VAPID environment values. Without keys, the test uses `ServiceWorkerRegistration.showNotification` locally.
4. Visit a dashboard route online, then use the browser’s offline mode and reload it. The cached HTML or the bilingual offline page should render.
5. Inspect `/manifest.webmanifest` and open `/pwa-icons/192.png`, `/pwa-icons/512.png`, and `/pwa-icons/512.png?purpose=maskable`. Each should return a PNG. Check that Call Lab, Tickets, and Herd shortcuts point to the Arabic app routes.

## Limits

- The demo keeps farm state in the browser. Events created while a page is open can notify that browser; there is no remote farm event source to wake a closed app. Web Push is ready for a server event source but does not add one.
- Web Push subscriptions live in the browser and are sent only when a notification is delivered. There is no account or subscription database in this investor demo.
- iOS notifications require an installed web app and a supported iOS version. The card gives the Safari install steps; browser support and permission are controlled by the operating system.
- Offline behavior covers previously cached HTML and static assets, not every uncached route, API request, or future deployment. The worker version should be bumped when cache behavior or asset strategy changes.
