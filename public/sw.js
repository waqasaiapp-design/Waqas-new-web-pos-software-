// Service Worker for WAQAS MART Supermarket POS
const CACHE_NAME = 'waqas-mart-cache-v20';
const STATIC_ASSETS = [
  '/manifest.json',
  '/manifest.webmanifest',
  '/favicon.ico',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-512.png',
  '/waqas_owner_real.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('Pre-cache partial failure:', err);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

function isValidAppShellResponse(request, response) {
  if (!response || response.status !== 200 || response.type !== 'basic') {
    return Promise.resolve(false);
  }
  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  if (!contentType.includes('text/html') && request.mode !== 'navigate') {
    return Promise.resolve(true);
  }
  return response
    .clone()
    .text()
    .then((html) => {
      if (!html) return false;
      if (
        html.includes('Please wait while your application starts') ||
        html.includes('issue during the build process')
      ) {
        return false;
      }
      return html.includes('id="root"') || html.includes("id='root'");
    })
    .catch(() => false);
}

self.addEventListener('fetch', (event) => {
  if (event.request.cache === 'only-if-cached' && event.request.mode !== 'same-origin') {
    return;
  }
  if (
    event.request.method !== 'GET' ||
    event.request.url.includes('/api/')
  ) {
    return;
  }

  const reqUrl = new URL(event.request.url);
  const isAppShellOrScript =
    event.request.mode === 'navigate' ||
    reqUrl.pathname === '/' ||
    /\.(html|js|mjs|tsx|ts|css|json)$/i.test(reqUrl.pathname);

  if (isAppShellOrScript) {
    // Network-first with cache: 'no-store' and interstitial HTML guard
    event.respondWith(
      fetch(event.request, { cache: 'no-store' })
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
            const copy = networkResponse.clone();
            isValidAppShellResponse(event.request, copy).then((valid) => {
              if (!valid) return;
              caches
                .open(CACHE_NAME)
                .then((cache) => cache.put(event.request, copy).catch(() => {}))
                .catch(() => {});
            });
          }
          return networkResponse;
        })
        .catch(() => {
          return caches.match(event.request).then((cached) => {
            if (cached) return cached;
            if (event.request.mode === 'navigate') {
              return caches.match('/index.html');
            }
            return new Response('Offline', { status: 503 });
          });
        })
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request)
        .then((networkResponse) => {
          if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
            return networkResponse;
          }
          const responseToCache = networkResponse.clone();
          caches
            .open(CACHE_NAME)
            .then((cache) => cache.put(event.request, responseToCache).catch(() => {}))
            .catch(() => {});
          return networkResponse;
        })
        .catch(() => new Response('Offline', { status: 503 }));
    })
  );
});
