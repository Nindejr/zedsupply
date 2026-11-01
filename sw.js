/* Zed Supply service worker: the store opens and browses offline, and repeat visits use less
   data. Pages and scripts: network first, so updates arrive at once, with the saved copy when
   offline. Images: the saved copy first, refreshed in the background. Orders, payments and
   anything from another site are never cached. Change VERSION with each release. */
var VERSION = 'zs-20261101';
var SHELL = ['./', 'index.html', 'help.html', 'privacy.html', '404.html', 'css/style.css', 'js/catalogue.js', 'js/couriers.js',
  'js/products.js', 'js/product-zoom.js', 'js/marketplace.js', 'js/main.js', 'assets/favicon.svg', 'assets/icon-192.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  // Scripts and pages carry ?v= versions; the saved copy is matched without it when offline
  var isImage = req.destination === 'image' || /\.(webp|png|jpe?g|svg|avif)$/.test(url.pathname);
  if (isImage) {
    e.respondWith(caches.open(VERSION).then(function (c) {
      return c.match(req).then(function (hit) {
        var fresh = fetch(req).then(function (res) { if (res.ok) c.put(req, res.clone()); return res; }).catch(function () { return hit; });
        return hit || fresh;
      });
    }));
    return;
  }
  e.respondWith(fetch(req).then(function (res) {
    if (res.ok && (req.mode === 'navigate' || /\.(js|css|html)$/.test(url.pathname))) {
      var copy = res.clone();
      caches.open(VERSION).then(function (c) { c.put(req, copy); });
    }
    return res;
  }).catch(function () {
    return caches.match(req, { ignoreSearch: true }).then(function (hit) {
      return hit || (req.mode === 'navigate' ? caches.match('index.html') : Response.error());
    });
  }));
});
