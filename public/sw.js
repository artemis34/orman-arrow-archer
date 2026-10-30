const CACHE = "wildbow-shell-v4";
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) =>
        cache.addAll([
          "./",
          "./manifest.webmanifest",
          "./wildbow-icon.svg",
          "./wildbow-192.png",
          "./wildbow-512.png",
        ]),
      ),
  );
  self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("wildbow-shell-") && key !== CACHE)
            .map((key) => caches.delete(key)),
        ),
      ),
  );
  self.clients.claim();
});
self.addEventListener("message", (event) => {
  if (event.data?.type !== "CACHE_ASSETS" || !Array.isArray(event.data.urls))
    return;
  const urls = event.data.urls.slice(0, 80).filter((value) => {
    try {
      const url = new URL(value);
      return (
        url.origin === self.location.origin && url.pathname.includes("/assets/")
      );
    } catch {
      return false;
    }
  });
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => Promise.allSettled(urls.map((url) => cache.add(url)))),
  );
});
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/") ||
    url.pathname === "/health"
  )
    return;
  if (event.request.mode === "navigate") {
    const home = new URL("./", self.location.href);
    const isGame =
      url.pathname === home.pathname ||
      url.pathname === new URL("index.html", home).pathname;
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok && isGame) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put("./", copy));
          }
          return response;
        })
        .catch(() =>
          isGame
            ? caches.match("./")
            : new Response(
                "Bu sayfa internet bağlantısı gerektiriyor. Çevrimdışı antrenman için ana menüye dön.",
                {
                  status: 503,
                  headers: { "Content-Type": "text/plain; charset=utf-8" },
                },
              ),
        ),
    );
  } else if (/\.(js|css|woff2|svg)$/.test(url.pathname)) {
    if (url.pathname.endsWith(".js") && !url.pathname.includes("/assets/")) {
      event.respondWith(
        fetch(event.request)
          .then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches
                .open(CACHE)
                .then((cache) => cache.put(event.request, copy));
            }
            return response;
          })
          .catch(() => caches.match(event.request)),
      );
      return;
    }
    event.respondWith(
      caches.match(event.request).then(
        (cached) =>
          cached ||
          fetch(event.request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches
                .open(CACHE)
                .then((cache) => cache.put(event.request, copy));
            }
            return response;
          }),
      ),
    );
  }
});
