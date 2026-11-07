/* Zed Supply service worker: the store opens and browses offline, and repeat visits use less
   data. Pages and scripts: network first, so updates arrive at once, with the saved copy when
   offline. Images: the saved copy first; one older than a week is refreshed in the background.
   With Data saver on (the store's switch, or the browser's Save-Data setting) images are never
   downloaded in the background or saved, and at most IMAGE_LIMIT images are kept. Orders,
   payments and anything from another site are never cached. Change VERSION with each release
   (scripts/release.cjs does it with the pages). */
var VERSION = 'zs-20261107-r25';
var SHELL = ['./', 'index.html', 'help.html', 'privacy.html', '404.html', 'css/style.css', 'js/catalogue.js', 'js/couriers.js', 'js/delivery.js', 'js/receipt-pdf.js',
  'js/products.js', 'js/product-zoom.js', 'js/backend.js', 'js/marketplace.js', 'js/backend-ui.js', 'js/checkout.js', 'js/listing-form.js', 'js/main.js', 'assets/favicon.svg', 'assets/icon-192.png'];

var IMAGE_LIMIT = 150, IMAGE_FRESH_MS = 7 * 24 * 60 * 60 * 1000;
var IMAGE_PATH = /\.(webp|png|jpe?g|svg|avif)$/;
// Data saver as the page last reported it, also kept in the cache so a restarted worker knows
var SETTINGS = 'zs-settings.json', saver = null;
function saverOn(req) {
  if (req.headers && typeof req.headers.get === 'function' && req.headers.get('save-data') === 'on') return Promise.resolve(true);
  if (saver !== null) return Promise.resolve(saver);
  return caches.open(VERSION).then(function (c) { return c.match(SETTINGS); })
    .then(function (r) { return r ? r.json() : {}; }).then(function (x) { saver = !!x.datasaver; return saver; }).catch(function () { return false; });
}
self.addEventListener('message', function (e) {
  if (!e.data || e.data.type !== 'datasaver') return;
  saver = !!e.data.on;
  var save = caches.open(VERSION).then(function (c) {
    return c.put(SETTINGS, new Response(JSON.stringify({ datasaver: saver }), { headers: { 'content-type': 'application/json' } }));
  }).catch(function () {});
  if (e.waitUntil) e.waitUntil(save);
});
// Keep the newest IMAGE_LIMIT images; the store's own files don't count
function trimImages(c) {
  return c.keys().then(function (keys) {
    var images = keys.filter(function (k) { return IMAGE_PATH.test(new URL(k.url || k).pathname); });
    return Promise.all(images.slice(0, Math.max(0, images.length - IMAGE_LIMIT)).map(function (k) { return c.delete(k); }));
  });
}

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('zs-') === 0 && k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || !url.href.startsWith(self.registration.scope)) return;
  // Scripts and pages carry ?v= versions; the saved copy is matched without it when offline
  var isImage = req.destination === 'image' || IMAGE_PATH.test(url.pathname);
  if (isImage) {
    var done;
    e.waitUntil(new Promise(function (resolve) { done = resolve; }));
    e.respondWith(Promise.all([caches.open(VERSION), saverOn(req)]).then(function (x) {
      var c = x[0], dataSaver = x[1];
      return c.match(req).then(function (hit) {
        var age = hit ? Date.now() - Date.parse(hit.headers.get('date') || '') : Infinity;
        // A saved copy is used as it is with Data saver on, or while it's less than a week old
        if (hit && (dataSaver || age < IMAGE_FRESH_MS)) { done(); return hit; }
        var net = fetch(req).then(function (res) {
          if (!res.ok || dataSaver) return res;
          return c.put(req, res.clone()).then(function () { return trimImages(c); }).catch(function () {}).then(function () { return res; });
        });
        net.then(done, done);
        // An old saved copy shows straight away while the new one downloads
        return hit || net.catch(function () { return Response.error(); });
      });
    }).catch(function (err) { done(); throw err; }));
    return;
  }
  var network = fetch(req).then(function (res) {
    if (res.ok && (req.mode === 'navigate' || /\.(js|css|html)$/.test(url.pathname))) {
      var copy = res.clone();
      return caches.open(VERSION).then(function (c) { return c.put(req, copy); }).catch(function () {}).then(function () { return res; });
    }
    return res;
  });
  e.waitUntil(network.catch(function () {}));
  e.respondWith(network.catch(function () {
    return caches.open(VERSION).then(function (c) { return c.match(req, { ignoreSearch: true }).then(function (hit) {
      return hit || (req.mode === 'navigate' ? c.match('index.html').then(function (shell) { return shell || Response.error(); }) : Response.error());
    });
    });
  }));
});
