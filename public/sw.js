/*
 * ITop Med service worker.
 *
 * PRIVACY RULE: only immutable, non-personal static assets are cached
 * (hashed Next.js bundles, icons, the manifest). HTML pages, API responses,
 * server actions and documents are NEVER cached, because they can contain
 * personal or medical data that must not persist on a shared device.
 */
const CACHE = "itm-static-v1";
const STATIC = /^\/(_next\/static\/|icons\/|manifest\.webmanifest$)/;

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !STATIC.test(url.pathname)) return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    }),
  );
});
