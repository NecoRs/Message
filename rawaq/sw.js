/* رواق — service worker: offline app shell + notification clicks. */
const CACHE = 'rawaq-v5';
const SHELL = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'vendor/peerjs.min.js',
  'vendor/qrcode.min.js',
  'config.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('rawaq-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Same-origin: network first (so updates show up), cache when offline or slow.
// Fonts: cache first. Everything else (signalling server) is left alone.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (FONT_HOSTS.includes(url.hostname)) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      }))
    );
    return;
  }
  if (url.origin !== self.location.origin) return;

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const fromNet = fetch(req).then((res) => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    });
    const slow = new Promise((resolve) => setTimeout(resolve, 4000));
    try {
      const res = await Promise.race([fromNet, slow]);
      if (res) return res;
    } catch (_) { /* offline */ }
    const hit = await cache.match(req, { ignoreSearch: true }) ||
      (req.mode === 'navigate' ? await cache.match('index.html') : null);
    return hit || fromNet;
  })());
});

// Web Push from the push worker. It carries no content: the message itself
// waits encrypted in the mailbox and is fetched when the app opens.
self.addEventListener('push', (e) => {
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (wins.some((w) => w.visibilityState === 'visible' && w.focused)) return; // the open app shows it itself
    await self.registration.showNotification('رواق', {
      body: 'وصلتك رسالة جديدة',
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      tag: 'rawaq-inbox',
      renotify: true,
      lang: 'ar',
      dir: 'rtl',
      data: { id: '' },
    });
    if (self.navigator && self.navigator.setAppBadge) self.navigator.setAppBadge().catch(() => {});
  })());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const id = (e.notification.data && e.notification.data.id) || '';
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if ('focus' in w) {
        w.postMessage({ t: 'open', id });
        return w.focus();
      }
    }
    return self.clients.openWindow('./#open=' + encodeURIComponent(id));
  })());
});
