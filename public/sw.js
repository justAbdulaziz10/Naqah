/* Hand-written NAQAH service worker. Bump the version to replace cached shells. */
const CACHE_PREFIX = "naqah-pwa-";
const CACHE_NAME = "naqah-pwa-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/brand/")) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok) await cache.put(request, response.clone());
        return response;
      }),
    );
    return;
  }

  if (request.mode !== "navigate" || !/^\/(ar|en)(\/|$)/.test(url.pathname)) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const response = await fetch(request);
        if (response.ok) await cache.put(request, response.clone());
        return response;
      } catch {
        const cached = await cache.match(request);
        return cached || offlineResponse(url.pathname.startsWith("/ar"));
      }
    })(),
  );
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    const data = event.data ? event.data.json() : {};
    payload = data && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch {
    payload = {};
  }

  const locale = typeof payload.url === "string" && payload.url.startsWith("/en") ? "en" : "ar";
  const title = typeof payload.title === "string" ? payload.title : locale === "ar" ? "ناقة" : "NAQAH";
  const body = typeof payload.body === "string" ? payload.body : "";
  const url = safeLocalUrl(payload.url);
  const tag = typeof payload.tag === "string" ? payload.tag : "naqah-notification";

  if (typeof self.registration.showNotification === "function") {
    event.waitUntil(
      self.registration.showNotification(title, {
        body,
        tag,
        icon: "/pwa-icons/192.png",
        data: { url },
      }),
    );
  }
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = safeLocalUrl(event.notification.data && event.notification.data.url);
  const targetUrl = new URL(target, self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (clients) => {
      for (const client of clients) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        if ("navigate" in client) {
          try {
            await client.navigate(targetUrl);
          } catch {
            // Keep the existing page focused if navigation cannot be updated.
          }
        }
        await client.focus();
        return;
      }
      if (self.clients.openWindow) await self.clients.openWindow(targetUrl);
    }),
  );
});

function safeLocalUrl(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/ar/app";
  return value;
}

function offlineResponse(arabicFirst) {
  const copy = arabicFirst
    ? {
        lang: "ar",
        title: "لا يوجد اتصال بالإنترنت",
        body: "الصفحة المطلوبة غير محفوظة على هذا الجهاز بعد. اتصل بالإنترنت وحاول مرة أخرى.",
        englishTitle: "You’re offline",
        englishBody: "This page has not been saved on this device yet. Connect to the internet and try again.",
      }
    : {
        lang: "en",
        title: "You’re offline",
        body: "This page has not been saved on this device yet. Connect to the internet and try again.",
        englishTitle: "لا يوجد اتصال بالإنترنت",
        englishBody: "الصفحة المطلوبة غير محفوظة على هذا الجهاز بعد. اتصل بالإنترنت وحاول مرة أخرى.",
      };
  const otherLang = arabicFirst ? "en" : "ar";
  const otherDir = arabicFirst ? "ltr" : "rtl";

  return new Response(
    `<!doctype html><html lang="${copy.lang}" dir="${copy.lang === "ar" ? "rtl" : "ltr"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#29241f"><title>${copy.title} | NAQAH</title><style>body{margin:0;min-height:100vh;background:#f5f0e8;color:#29241f;font-family:system-ui,sans-serif;display:grid;place-items:center}main{box-sizing:border-box;max-width:36rem;padding:2rem;line-height:1.7}h1{font-size:1.6rem}p{color:#6e6359}hr{border:0;border-top:1px solid #ddd3c5;margin:2rem 0}</style></head><body><main><section lang="${copy.lang}" dir="${copy.lang === "ar" ? "rtl" : "ltr"}"><h1>${copy.title}</h1><p>${copy.body}</p></section><hr><section lang="${otherLang}" dir="${otherDir}"><h2>${copy.englishTitle}</h2><p>${copy.englishBody}</p></section></main></body></html>`,
    { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}
