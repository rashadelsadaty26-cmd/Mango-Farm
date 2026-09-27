const SHELL_CACHE = 'mango-farm-shell-v2';
const RUNTIME_CACHE = 'mango-farm-runtime-v2';
const STATIC_DESTINATIONS = new Set(['script', 'style', 'font', 'image', 'worker']);

async function precacheAppShell() {
  const cache = await caches.open(SHELL_CACHE);
  const indexResponse = await fetch('/index.html', { cache: 'no-store' });
  await cache.put('/index.html', indexResponse.clone());

  const html = await indexResponse.text();
  const assetUrls = new Set(['/manifest.webmanifest', '/icon.svg']);

  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const assetUrl = match[1];
    if (!assetUrl.startsWith('/') || assetUrl.startsWith('//')) continue;
    const url = new URL(assetUrl, self.location.origin);
    if (url.origin === self.location.origin) {
      assetUrls.add(url.pathname + url.search);
    }
  }

  await Promise.all(
    Array.from(assetUrls).map(async (url) => {
      try {
        const response = await fetch(url, { cache: 'no-store' });
        if (response.ok) await cache.put(url, response);
      } catch {
        // A single optional asset should not prevent the app shell from installing.
      }
    })
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    precacheAppShell().then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => ![SHELL_CACHE, RUNTIME_CACHE].includes(key))
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Never intercept Firebase/Auth/network APIs or other cross-origin requests.
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put('/index.html', copy));
          return response;
        })
        .catch(() => caches.match('/index.html').then((cached) => cached || caches.match('/')))
    );
    return;
  }

  if (STATIC_DESTINATIONS.has(request.destination)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        });
      })
    );
  }
});
