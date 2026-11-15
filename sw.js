const CACHE_NAME = 'pcb-panel-v4';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/fonts.css',
  './css/tokens.css',
  './css/base.css',
  './css/components.css',
  './css/views.css',
  './js/app.js',
  './css/fonts/chakra-petch-v13-latin-regular.woff2',
  './css/fonts/chakra-petch-v13-latin-500.woff2',
  './css/fonts/chakra-petch-v13-latin-600.woff2',
  './css/fonts/chakra-petch-v13-latin-700.woff2',
  './css/fonts/rajdhani-v17-latin-regular.woff2',
  './css/fonts/rajdhani-v17-latin-500.woff2',
  './css/fonts/rajdhani-v17-latin-600.woff2',
  './css/fonts/rajdhani-v17-latin-700.woff2',
  './css/fonts/jetbrains-mono-v24-latin-regular.woff2',
  './css/fonts/jetbrains-mono-v24-latin-500.woff2',
  './css/fonts/jetbrains-mono-v24-latin-600.woff2',
  './css/fonts/jetbrains-mono-v24-latin-700.woff2'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(ASSETS);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cache => {
          if (cache !== CACHE_NAME) {
            return caches.delete(cache);
          }
        })
      );
    })
  );
});

self.addEventListener('fetch', e => {
  // Si la petición no es GET (ej. guardar en DB), no hacemos nada
  if (e.request.method !== 'GET') return;
  
  e.respondWith(
    caches.match(e.request).then(cachedResponse => {
      if (cachedResponse) return cachedResponse;
      return fetch(e.request).then(networkResponse => {
        return caches.open(CACHE_NAME).then(cache => {
          cache.put(e.request, networkResponse.clone());
          return networkResponse;
        });
      });
    })
  );
});