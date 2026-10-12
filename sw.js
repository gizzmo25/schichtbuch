/*
 * Service Worker fuer Schichtbuch.
 * Strategie: Network-first fuer die App-Dateien (eigener Origin), Cache nur als Offline-Fallback.
 * -> Updates aus dem Repository kommen ohne Versionsnummer-Pflege an.
 * Anfragen an Supabase (fremder Origin) werden nie abgefangen oder gecacht.
 */
const CACHE = "schichtbuch-shell";
const SHELL = [
  "./", "./index.html", "./manifest.json", "./icon-192.png", "./icon-512.png",
  "./vendor/supabase.js", "./js/config.js", "./js/domain.js", "./js/aufgebot.js", "./js/repository.js", "./js/app.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match("./index.html")))
  );
});
