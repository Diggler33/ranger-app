// Keeps the Ranger App working with no signal: the app files are cached on the phone.
// Bump VERSION whenever any app file changes so phones pick up the new copy.
const VERSION = 'ranger-v3';
const LOCAL = ['./', 'index.html', 'app.css?v=3', 'osgrid.js?v=3', 'locations.js?v=3', 'app.js?v=3', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];
const CDN = ['https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(async c => {
    await c.addAll(LOCAL);
    await Promise.all(CDN.map(u => fetch(u, { mode: 'no-cors' }).then(r => c.put(u, r)).catch(() => {})));
  }).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET') return;
  const isApp = url.origin === location.origin, isCdn = CDN.includes(req.url);
  if (!isApp && !isCdn) return; // Google Sheet calls and map tiles always go to the network
  e.respondWith(caches.open(VERSION).then(async c => {
    const hit = await c.match(req, { ignoreSearch: false }) || (isApp && req.mode === 'navigate' ? await c.match('index.html') : null);
    const net = fetch(req).then(r => { if (r && (r.ok || r.type === 'opaque')) c.put(req, r.clone()); return r; });
    return hit ? (e.waitUntil(net.catch(() => {})), hit) : net;
  }));
});
