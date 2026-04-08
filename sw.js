const CACHE = 'gw-checker-v3';

// App shell files - always try network first
const APP_SHELL = [
  '/checker/',
  '/checker/index.html',
  '/checker/app.js',
  '/checker/manifest.json',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = e.request.url;

  // External - network only
  if (url.includes('googleapis.com') || url.includes('fonts.google') || url.includes('unpkg.com')) {
    e.respondWith(fetch(e.request).catch(() => new Response('')));
    return;
  }

  // App shell - network first, fallback to cache
  const isAppShell = url.includes('/checker/index.html') || url.includes('/checker/app.js') || url.includes('/checker/sw.js') || url.endsWith('/checker/') || url.endsWith('/checker');
  if (isAppShell) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // Everything else - cache first
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
