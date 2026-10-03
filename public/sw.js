const CACHE = "duetrack-shell-v2";
self.addEventListener("install", (event) =>
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll([
        "/",
        "/manifest.webmanifest",
        "/icon-192.png",
        "/icon-512.png",
      ]);
      const html = await (await cache.match("/")).text();
      const assets = [
        ...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g),
      ].map((match) => match[1]);
      await cache.addAll(assets);
    })(),
  ),
);
// Do not skipWaiting: existing clients keep their shell and pending edits until closed.
self.addEventListener("activate", (e) =>
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  ),
);
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== self.location.origin) return;
  if (u.pathname.startsWith("/assets/"))
    e.respondWith(
      caches.open(CACHE).then(async (c) => {
        const hit = await c.match(e.request, { ignoreVary: true });
        if (hit) return hit;
        const r = await fetch(e.request);
        if (r.ok) c.put(e.request, r.clone());
        return r;
      }),
    );
  else if (e.request.mode === "navigate")
    e.respondWith(fetch(e.request).catch(() => caches.match("/")));
});
