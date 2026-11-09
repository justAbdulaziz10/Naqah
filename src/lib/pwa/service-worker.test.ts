import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const ORIGIN = "https://naqah.test";
const workerSource = readFileSync(new URL("../../../public/sw.js", import.meta.url), "utf8");

type WorkerEvent = {
  request?: { method: string; url: string; mode: string };
  data?: unknown;
  waitUntil?: (promise: Promise<unknown>) => void;
  respondWith?: (response: Promise<Response> | Response) => void;
};
type Listener = (event: WorkerEvent) => void;

function createWorker(network: (request: { url: string }) => Promise<Response>) {
  const listeners = new Map<string, Listener>();
  const cacheMap = new Map<string, Map<string, Response>>();
  const cacheStorage = {
    keys: async () => [...cacheMap.keys()],
    delete: async (name: string) => cacheMap.delete(name),
    open: async (name: string) => {
      let entries = cacheMap.get(name);
      if (!entries) {
        entries = new Map();
        cacheMap.set(name, entries);
      }
      return {
        match: async (request: string | { url: string }) => entries?.get(new URL(typeof request === "string" ? request : request.url, ORIGIN).href)?.clone(),
        put: async (request: string | { url: string }, response: Response) => {
          entries?.set(new URL(typeof request === "string" ? request : request.url, ORIGIN).href, response.clone());
        },
        keys: async () => [...(entries?.keys() ?? [])].map((url) => new Request(url)),
        delete: async (request: string | { url: string }) => entries?.delete(new URL(typeof request === "string" ? request : request.url, ORIGIN).href) ?? false,
      };
    },
  };
  const self = {
    location: new URL(ORIGIN),
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
    skipWaiting: vi.fn(async () => undefined),
    clients: { claim: vi.fn(async () => undefined) },
    registration: { showNotification: vi.fn(async () => undefined) },
  };
  runInNewContext(workerSource, { self, caches: cacheStorage, fetch: network, URL, Request, Response });

  async function dispatchFetch(request: WorkerEvent["request"]) {
    const waiters: Promise<unknown>[] = [];
    const responseHolder: { promise?: Promise<Response> } = {};
    listeners.get("fetch")?.({
      request,
      respondWith: (response) => { responseHolder.promise = Promise.resolve(response); },
      waitUntil: (promise) => { waiters.push(Promise.resolve(promise)); },
    });
    if (!responseHolder.promise) throw new Error("The service worker did not respond to the request");
    const response = await responseHolder.promise;
    return { response, finish: () => Promise.all(waiters) };
  }

  async function dispatch(type: string, event: WorkerEvent) {
    const waiters: Promise<unknown>[] = [];
    listeners.get(type)?.({ ...event, waitUntil: (promise) => { waiters.push(Promise.resolve(promise)); } });
    await Promise.all(waiters);
  }

  return { cacheStorage, dispatch, dispatchFetch };
}

describe("service worker runtime data", () => {
  it("serves a cached image while refreshing it in the background", async () => {
    let revision = 0;
    const worker = createWorker(async () => new Response(`image-${++revision}`));
    const request = new Request(`${ORIGIN}/_next/image?url=%2Fimages%2Fherd.jpg&w=640&q=75`);
    const first = await worker.dispatchFetch(request);
    expect(await first.response.text()).toBe("image-1");
    await first.finish();

    const second = await worker.dispatchFetch(request);
    expect(await second.response.text()).toBe("image-1");
    await second.finish();
    const imageCache = await worker.cacheStorage.open("naqah-pwa-images-v1");
    const refreshed = await imageCache.match(request);

    expect(await refreshed?.text()).toBe("image-2");
  });

  it("evicts oldest runtime images after the cache exceeds 60 entries", async () => {
    const worker = createWorker(async () => new Response("new image"));
    const imageCache = await worker.cacheStorage.open("naqah-pwa-images-v1");
    for (let index = 1; index <= 60; index += 1) {
      await imageCache.put(new Request(`${ORIGIN}/images/${index}.jpg`), new Response(`image-${index}`));
    }

    const result = await worker.dispatchFetch(new Request(`${ORIGIN}/images/61.jpg`));
    await result.finish();
    const keys = await imageCache.keys();
    const urls = keys.map((request) => request.url);

    expect(keys).toHaveLength(60);
    expect(urls).not.toContain(`${ORIGIN}/images/1.jpg`);
    expect(urls).toContain(`${ORIGIN}/images/61.jpg`);
  });

  it("stores bilingual offline copy from the client and uses it in the fallback", async () => {
    const worker = createWorker(async () => { throw new TypeError("offline"); });
    await worker.dispatch("message", {
      data: {
        type: "naqah:offline-copy",
        activeLocale: "ar",
        copies: {
          ar: { title: "نسخة عربية", body: "تفاصيل عربية" },
          en: { title: "English copy", body: "English details" },
        },
      },
    });

    const navigation = await worker.dispatchFetch({ method: "GET", mode: "navigate", url: `${ORIGIN}/ar/app` });
    const html = await navigation.response.text();

    expect(navigation.response.status).toBe(503);
    expect(html).toContain("نسخة عربية");
    expect(html).toContain("تفاصيل عربية");
    expect(html).toContain("English copy");
    expect(html).toContain("English details");
  });

  it("cleans old PWA caches while retaining the current shell and image caches", async () => {
    const worker = createWorker(async () => new Response("ok"));
    await worker.cacheStorage.open("naqah-pwa-v2");
    await worker.cacheStorage.open("naqah-pwa-images-v0");
    await worker.cacheStorage.open("naqah-pwa-v3");
    await worker.cacheStorage.open("naqah-pwa-images-v1");

    await worker.dispatch("activate", {});

    expect(await worker.cacheStorage.keys()).toEqual(["naqah-pwa-v3", "naqah-pwa-images-v1"]);
  });
});
