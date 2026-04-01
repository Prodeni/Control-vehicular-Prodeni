// ============================================================
// PRODENI Fleet · Service Worker
// Modo offline + caché de archivos
// ============================================================

const CACHE_NAME = 'prodeni-fleet-v1.0';
const SYNC_TAG = 'prodeni-fleet-sync';

const ARCHIVOS_CACHE = [
  './',
  './index.html',
  './tecnico.html',
  './admin.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
];

// INSTALACIÓN: guardar archivos en caché
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return Promise.allSettled(
        ARCHIVOS_CACHE.map(url => cache.add(url).catch(() => {}))
      );
    }).then(() => self.skipWaiting())
  );
});

// ACTIVACIÓN: limpiar cachés antiguas
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// FETCH: servir desde caché si está disponible
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  
  // Apps Script siempre va a la red (no se puede cachear)
  if (url.hostname.includes('script.google.com')) {
    event.respondWith(
      fetch(event.request).catch(() => {
        return new Response(JSON.stringify({ status: 'error', message: 'Sin conexión' }), {
          headers: { 'Content-Type': 'application/json' }
        });
      })
    );
    return;
  }
  
  // Estrategia: caché primero, red después (stale-while-revalidate)
  event.respondWith(
    caches.match(event.request).then(cached => {
      const fetchPromise = fetch(event.request).then(response => {
        if (response.ok && event.request.method === 'GET') {
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, response.clone());
          });
        }
        return response;
      }).catch(() => null);
      
      return cached || fetchPromise || caches.match('./index.html');
    })
  );
});

// BACKGROUND SYNC: sincronizar datos pendientes
self.addEventListener('sync', event => {
  if (event.tag === SYNC_TAG) {
    event.waitUntil(sincronizarPendientes());
  }
});

async function sincronizarPendientes() {
  const pendientes = await obtenerPendientesDeDB();
  if (!pendientes.length) return;
  
  const scriptUrl = await obtenerScriptUrl();
  if (!scriptUrl) return;
  
  for (const item of pendientes) {
    try {
      const params = new URLSearchParams({ ...item.data, action: 'saveData' }).toString();
      const url = scriptUrl + '?' + params;
      
      if (url.length <= 2000) {
        await fetch(url, { method: 'GET', mode: 'no-cors' });
      } else {
        await fetch(scriptUrl, {
          method: 'POST',
          mode: 'no-cors',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...item.data, action: 'saveData' })
        });
      }
      await eliminarPendienteDeDB(item.id);
      
      // Notificar a los clientes que se sincronizó
      const clients = await self.clients.matchAll();
      clients.forEach(client => {
        client.postMessage({ type: 'SYNCED', id: item.id });
      });
    } catch(e) {}
  }
}

// IndexedDB helpers
function abrirDB() {
  return new Promise((res, rej) => {
    const request = indexedDB.open('prodeni-fleet-db', 1);
    request.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('pendientes')) {
        db.createObjectStore('pendientes', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('config')) {
        db.createObjectStore('config', { keyPath: 'key' });
      }
    };
    request.onsuccess = e => res(e.target.result);
    request.onerror = e => rej(e.target.error);
  });
}

async function obtenerPendientesDeDB() {
  try {
    const db = await abrirDB();
    return new Promise(res => {
      const tx = db.transaction('pendientes', 'readonly');
      const store = tx.objectStore('pendientes');
      const request = store.getAll();
      request.onsuccess = () => res(request.result || []);
      request.onerror = () => res([]);
    });
  } catch(e) { return []; }
}

async function eliminarPendienteDeDB(id) {
  try {
    const db = await abrirDB();
    return new Promise(res => {
      const tx = db.transaction('pendientes', 'readwrite');
      tx.objectStore('pendientes').delete(id);
      tx.oncomplete = () => res();
      tx.onerror = () => res();
    });
  } catch(e) {}
}

async function obtenerScriptUrl() {
  try {
    const db = await abrirDB();
    return new Promise(res => {
      const tx = db.transaction('config', 'readonly');
      const store = tx.objectStore('config');
      const request = store.get('scriptUrl');
      request.onsuccess = () => res(request.result?.value || null);
      request.onerror = () => res(null);
    });
  } catch(e) { return null; }
}

// Guardar configuración desde la app
self.addEventListener('message', event => {
  if (event.data?.type === 'SAVE_CONFIG') {
    abrirDB().then(db => {
      const tx = db.transaction('config', 'readwrite');
      Object.entries(event.data.config).forEach(([key, value]) => {
        tx.objectStore('config').put({ key, value });
      });
    }).catch(() => {});
  }
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});