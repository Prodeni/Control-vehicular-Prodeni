const CACHE_NAME = 'prodeni-cv-v10';
const urlsToCache = [
  './',
  './index.html',
  './dashboard.html',
  './manifest.json',
  './modules/inspeccion.html',
  './modules/vehiculos.html',
  './modules/bitacora.html',
  './modules/reportes.html',
  './modules/usuarios.html',
  './modules/mantenimiento.html',
  './modules/checklist.html',
  './modules/mensajes.html'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.hostname === 'script.google.com' || 
      url.hostname.includes('googleusercontent.com') ||
      url.hostname.includes('googleapis.com')) {
    return;
  }
  event.respondWith(
    caches.match(event.request).then(response => {
      return response || fetch(event.request).then(fetchResponse => {
        if (fetchResponse && fetchResponse.status === 200) {
          const clone = fetchResponse.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return fetchResponse;
      });
    }).catch(() => {
      if (event.request.destination === 'document') return caches.match('./index.html');
    })
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});
