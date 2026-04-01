// ============================================================
// PRODENI Fleet · Service Worker v2.0
// Offline completo + Background Sync + POST support
// ============================================================

const CACHE_NAME = 'prodeni-fleet-v2.0';
const SYNC_TAG   = 'prodeni-sync-v2';

const STATIC_CACHE = [
  './', './index.html', './tecnico.html', './admin.html',
  './manifest.json', './logo_prodeni.png',
  'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
];

// ── INSTALL ──────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.allSettled(STATIC_CACHE.map(url =>
        cache.add(url).catch(() => { /* ignora recursos externos que fallen */ })
      ))
    ).then(() => self.skipWaiting())
  );
});

// ── ACTIVATE: limpiar cachés viejas ──────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── FETCH ────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Apps Script: siempre red, nunca cache
  if (url.hostname.includes('script.google.com')) {
    event.respondWith(
      fetch(event.request.clone()).catch(() =>
        new Response(JSON.stringify({ status: 'error', message: 'Sin conexión al servidor' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        })
      )
    );
    return;
  }

  // Archivos estáticos: cache-first con actualización en background
  if (event.request.method === 'GET') {
    event.respondWith(
      caches.open(CACHE_NAME).then(cache =>
        cache.match(event.request).then(cached => {
          const networkFetch = fetch(event.request).then(res => {
            if (res.ok) cache.put(event.request, res.clone());
            return res;
          }).catch(() => null);
          return cached || networkFetch || caches.match('./index.html');
        })
      )
    );
  }
});

// ── BACKGROUND SYNC ──────────────────────────────────────────
self.addEventListener('sync', event => {
  if (event.tag === SYNC_TAG) {
    event.waitUntil(procesarPendientes());
  }
});

async function procesarPendientes() {
  const pendientes = await getPendientes();
  if (!pendientes.length) return;

  const scriptUrl = await getConfig('scriptUrl');
  if (!scriptUrl) return;

  for (const item of pendientes) {
    try {
      // Separar fotos del payload para no superar límites
      const { fotos, ...datosSinFotos } = item.data;
      datosSinFotos.action = 'saveData';

      // Intentar POST JSON primero
      const res = await fetch(scriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...datosSinFotos, fotos: fotos || [] })
      });

      if (res.ok) {
        await deletePendiente(item.id);
        notifyClients({ type: 'SYNCED', id: item.id, folio: item.data.folio });
      }
    } catch(e) {
      // Dejar para el próximo sync
    }
  }
}

// ── MESSAGES desde la app ────────────────────────────────────
self.addEventListener('message', event => {
  const d = event.data;
  if (!d) return;

  if (d.type === 'SAVE_CONFIG') {
    // Guardar scriptUrl en IndexedDB para background sync
    getDB().then(db => {
      const tx = db.transaction('config', 'readwrite');
      Object.entries(d.config || {}).forEach(([k, v]) => {
        tx.objectStore('config').put({ key: k, value: v });
      });
    }).catch(() => {});
  }

  if (d.type === 'SKIP_WAITING') self.skipWaiting();

  if (d.type === 'QUEUE_PENDING') {
    // La app nos pide que registremos un registro pendiente
    getDB().then(db => {
      const tx = db.transaction('pendientes', 'readwrite');
      tx.objectStore('pendientes').add({ data: d.data, ts: Date.now() });
    }).then(() => {
      if (self.registration.sync) {
        self.registration.sync.register(SYNC_TAG).catch(() => {});
      }
    }).catch(() => {});
  }
});

// ── NOTIFICAR A CLIENTES ─────────────────────────────────────
async function notifyClients(msg) {
  const clients = await self.clients.matchAll({ includeUncontrolled: true });
  clients.forEach(c => c.postMessage(msg));
}

// ── INDEXEDDB ────────────────────────────────────────────────
function getDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open('prodeni-sw-db', 2);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('pendientes')) {
        db.createObjectStore('pendientes', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('config')) {
        db.createObjectStore('config', { keyPath: 'key' });
      }
    };
    req.onsuccess = e => res(e.target.result);
    req.onerror = e => rej(e.target.error);
  });
}

async function getPendientes() {
  try {
    const db = await getDB();
    return new Promise(res => {
      const tx = db.transaction('pendientes', 'readonly');
      const req = tx.objectStore('pendientes').getAll();
      req.onsuccess = () => res(req.result || []);
      req.onerror = () => res([]);
    });
  } catch(e) { return []; }
}

async function deletePendiente(id) {
  try {
    const db = await getDB();
    return new Promise(res => {
      const tx = db.transaction('pendientes', 'readwrite');
      tx.objectStore('pendientes').delete(id);
      tx.oncomplete = res;
      tx.onerror = res;
    });
  } catch(e) {}
}

async function getConfig(key) {
  try {
    const db = await getDB();
    return new Promise(res => {
      const tx = db.transaction('config', 'readonly');
      const req = tx.objectStore('config').get(key);
      req.onsuccess = () => res(req.result?.value || null);
      req.onerror = () => res(null);
    });
  } catch(e) { return null; }
}
