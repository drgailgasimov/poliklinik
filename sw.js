/* Poliklinik Defteri — çevrimdışı çalışma için service worker.
   Yalnızca uygulama dosyaları ve yazı tipleri önbelleğe alınır; hasta verisi asla. */
const VERSION = 'pk-v1.2.0';
const SHELL = [
  './', 'index.html', 'app.css', 'core.js', 'drive.js', 'xlsx.js', 'app.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png', 'icons/logo-tam.png', 'icons/logo-amblem.png'
];
const FONT_CACHE = 'pk-fonts';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== FONT_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Google giriş ve Drive istekleri her zaman ağdan gider, önbelleğe alınmaz.
  if (url.hostname.endsWith('googleapis.com') && url.hostname !== 'fonts.googleapis.com') return;
  if (url.hostname === 'accounts.google.com') return;

  // Yazı tipleri: önce önbellek.
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(
      caches.open(FONT_CACHE).then(async (c) => {
        const hit = await c.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok || res.type === 'opaque') c.put(req, res.clone());
        return res;
      })
    );
    return;
  }

  // Uygulama dosyaları: önce önbellek, arka planda güncelle.
  if (url.origin === self.location.origin) {
    e.respondWith(
      caches.open(VERSION).then(async (c) => {
        const hit = await c.match(req, { ignoreSearch: true });
        const net = fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => null);
        if (hit) { e.waitUntil(net); return hit; }
        const res = await net;
        if (res) return res;
        if (req.mode === 'navigate') return c.match('index.html');
        return new Response('', { status: 504 });
      })
    );
  }
});
