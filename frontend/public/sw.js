const APP_VERSION = '__APP_VERSION__';
const BUILD_ID = '__BUILD_ID__';
const CACHE_PREFIX = 'comfyforge-v';
const CACHE_NAME = `${CACHE_PREFIX}${APP_VERSION}-${BUILD_ID}`;
const IS_PRODUCTION_BUILD = !APP_VERSION.startsWith('__') && !BUILD_ID.startsWith('__');
const ASSETS_TO_CACHE = [
  '/manifest.json',
  '/favicon.svg',
  '/icons.svg'
];

// Install event: cache core assets
self.addEventListener('install', (event) => {
  if (!IS_PRODUCTION_BUILD) {
    event.waitUntil(self.skipWaiting());
    return;
  }

  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS_TO_CACHE))
      .then(() => self.skipWaiting())
  );
});

// Activate event: cleanup old caches
self.addEventListener('activate', (event) => {
  if (!IS_PRODUCTION_BUILD) {
    event.waitUntil(
      caches.keys()
        .then((cacheNames) => Promise.all(
          cacheNames.filter((cacheName) => cacheName.startsWith(CACHE_PREFIX)).map((cacheName) => caches.delete(cacheName))
        ))
        .then(() => self.registration.unregister())
        .then(() => self.clients.claim())
    );
    return;
  }

  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName.startsWith(CACHE_PREFIX) && cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: 'window', includeUncontrolled: true }))
      .then((clients) => {
        clients.forEach((client) => {
          client.postMessage({
            type: 'COMFYFORGE_UPDATE_READY',
            version: APP_VERSION,
            buildId: BUILD_ID
          });
        });
      })
  );
});

// Fetch event: never intercept API, network-first for app assets.
self.addEventListener('fetch', (event) => {
  if (!IS_PRODUCTION_BUILD) return;

  const url = new URL(event.request.url);

  if (
    event.request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith('/api/') ||
    url.pathname === '/sw.js'
  ) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((fetchResponse) => {
        if (fetchResponse.status === 200) {
          const cacheCopy = fetchResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, cacheCopy));
        }
        return fetchResponse;
      })
      .catch(() => caches.match(event.request))
  );
});
