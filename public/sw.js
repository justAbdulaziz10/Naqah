/* Hand-written NAQAH service worker. Bump the version to replace cached shells. */
const CACHE_PREFIX = "naqah-pwa-";
const CACHE_NAME = "naqah-pwa-v3";
const IMAGE_CACHE_NAME = "naqah-pwa-images-v1";
const IMAGE_CACHE_LIMIT = 60;
const OFFLINE_COPY_KEY = "/__naqah/offline-copy-v1";
const AUTH_ROUTE = /^\/(ar|en)\/(login|signup)(\/|$)/;
const OFFLINE_DEFAULTS = {
  ar: {
    title: "لا يوجد اتصال بالإنترنت",
    body: "الصفحة المطلوبة غير محفوظة على هذا الجهاز بعد. اتصل بالإنترنت وحاول مرة أخرى.",
  },
  en: {
    title: "You’re offline",
    body: "This page has not been saved on this device yet. Connect to the internet and try again.",
  },
};

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && ![CACHE_NAME, IMAGE_CACHE_NAME].includes(key)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (isRuntimeImage(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request, event));
    return;
  }

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

  // Account pages depend on the live session, so a saved copy would show a stale state.
  if (AUTH_ROUTE.test(url.pathname)) {
    event.respondWith(fetch(request).catch(() => offlineResponse(url.pathname.startsWith("/ar"))));
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const response = await fetch(request);
        if (response.ok && !/no-store/i.test(response.headers.get("Cache-Control") || "")) await cache.put(request, response.clone());
        return response;
      } catch {
        const cached = await cache.match(request);
        return cached || offlineResponse(url.pathname.startsWith("/ar"));
      }
    })(),
  );
});

self.addEventListener("message", (event) => {
  const copy = normalizeOfflineCopy(event.data);
  if (!copy) return;
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.put(
        offlineCopyRequest(),
        new Response(JSON.stringify(copy), { headers: { "Content-Type": "application/json" } }),
      ),
    ),
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

function isRuntimeImage(pathname) {
  return pathname.startsWith("/_next/image") || pathname.startsWith("/images/");
}

async function staleWhileRevalidate(request, event) {
  const cache = await caches.open(IMAGE_CACHE_NAME);
  const cached = await cache.match(request);
  const update = fetch(request).then(async (response) => {
    if (response.ok) {
      try {
        await cache.put(request, response.clone());
        await trimImageCache(cache);
      } catch {
        // Keep the network response even when the browser cannot cache another image.
      }
    }
    return response;
  });

  if (cached) {
    event.waitUntil(update.catch(() => undefined));
    return cached;
  }
  return update;
}

async function trimImageCache(cache) {
  const imageRequests = (await cache.keys()).filter((request) => {
    const url = new URL(request.url);
    return url.origin === self.location.origin && isRuntimeImage(url.pathname);
  });
  const excess = imageRequests.length - IMAGE_CACHE_LIMIT;
  if (excess > 0) await Promise.all(imageRequests.slice(0, excess).map((request) => cache.delete(request)));
}

function offlineCopyRequest() {
  return new Request(new URL(OFFLINE_COPY_KEY, self.location.origin));
}

function normalizeOfflineCopy(value) {
  if (!value || value.type !== "naqah:offline-copy" || !["ar", "en"].includes(value.activeLocale)) return null;
  const copies = {};
  for (const locale of ["ar", "en"]) {
    const copy = value.copies && value.copies[locale];
    if (!copy || typeof copy.title !== "string" || typeof copy.body !== "string") return null;
    if (copy.title.length > 300 || copy.body.length > 500) return null;
    copies[locale] = { title: copy.title, body: copy.body };
  }
  return { activeLocale: value.activeLocale, copies };
}

async function readOfflineCopy() {
  try {
    const cache = await caches.open(CACHE_NAME);
    const response = await cache.match(offlineCopyRequest());
    return response ? await response.json() : null;
  } catch {
    return null;
  }
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

async function offlineResponse(arabicFirst) {
  const locale = arabicFirst ? "ar" : "en";
  const otherLocale = arabicFirst ? "en" : "ar";
  const saved = await readOfflineCopy();
  const primary = saved && saved.copies[locale] ? saved.copies[locale] : OFFLINE_DEFAULTS[locale];
  const secondary = saved && saved.copies[otherLocale] ? saved.copies[otherLocale] : OFFLINE_DEFAULTS[otherLocale];
  const dir = locale === "ar" ? "rtl" : "ltr";
  const otherDir = otherLocale === "ar" ? "rtl" : "ltr";

  return new Response(
    `<!doctype html><html lang="${locale}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#29241f"><title>${escapeHtml(primary.title)} | NAQAH</title><style>body{margin:0;min-height:100vh;background:#fdfaf3;color:#29241f;font-family:system-ui,sans-serif;display:grid;place-items:center}main{box-sizing:border-box;max-width:36rem;padding:2rem;line-height:1.7}h1{font-size:1.6rem}p{color:#6e6359}hr{border:0;border-top:1px solid #ddd3c5;margin:2rem 0}</style></head><body><main><section lang="${locale}" dir="${dir}"><h1>${escapeHtml(primary.title)}</h1><p>${escapeHtml(primary.body)}</p></section><hr><section lang="${otherLocale}" dir="${otherDir}"><h2>${escapeHtml(secondary.title)}</h2><p>${escapeHtml(secondary.body)}</p></section></main></body></html>`,
    { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}
