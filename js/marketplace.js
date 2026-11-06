/* Zed Supply — marketplace features: seller trust, bulk prices, buyer protection, lay-by, pickup
   points, pay-on-delivery limits, stock and price alerts, saved searches, sharing, questions and
   answers, review photos, "bought together", seller tools, the staff back office, the
   installable app and the language menu. Settings are in js/catalogue.js ("Marketplace features").

   Loads before js/main.js and registers hooks in window.ZSExt; main.js calls them while drawing
   pages and gives access to the store through window.ZS. Until accounts and data move to the
   server (settings.api), everything here keeps to this browser, like the rest of the prototype. */
(function () {
  'use strict';
  var EXT = window.ZSExt = window.ZSExt || { hooks: {}, views: {} };
  function on(name, fn) { EXT.hooks[name] = fn; }
  function Z() { return window.ZS; }
  function S() { return Z().S; }
  function esc(t) { return Z().esc(t); }
  function kw(n) { return Z().kwacha(n); }
  // A feature setting is on when enabled, or in demo mode when it allows a preview
  function onOff(x) { return !!x && (x === true || x.enabled || (x.preview && S().isSample)); }
  function get(k, d) { return Z().store.get(k, d); }
  function set(k, v) { return Z().store.set(k, v); }
  function signedIn() { return !!Z().user(); }
  function needSignIn(what) { Z().toast('Sign in to ' + what + '. <a href="#/account">Sign in</a>', 'warn'); }
  function pageUrl(hash) { return location.href.split('#')[0].split('?')[0] + hash; }

  /* ---------- Seller trust signals ---------- */
  // Rating across the seller's products, orders delivered, typical reply time and how long
  // they've sold here. Sample stores carry sample figures; real ones come from seller_trust().
  function trustOf(s) {
    var Zs = Z(), mine = Zs.products().filter(function (p) { return p.seller === s.id; }), sum = 0, n = 0;
    mine.forEach(function (p) { var r = Zs.ratingOf(p); if (r) { sum += r.avg * r.count; n += r.count; } });
    var t = s.trust || {};
    return { rating: n ? Math.round(sum / n * 10) / 10 : 0, reviews: n, delivered: t.delivered || 0, replyHours: t.replyHours || 0, since: t.since || '' };
  }
  on('productSeller', function (p, s) {
    if (!s) return '';
    var t = trustOf(s), bits = [];
    if (t.reviews) bits.push('<span class="trust__item"><span aria-hidden="true">★</span> ' + t.rating.toFixed(1) + ' seller rating <span class="pmeta">(' + t.reviews + ')</span></span>');
    if (t.delivered) bits.push('<span class="trust__item">' + t.delivered + ' orders delivered</span>');
    if (t.replyHours) bits.push('<span class="trust__item">Usually replies within ' + (t.replyHours <= 1 ? 'an hour' : t.replyHours + ' hours') + '</span>');
    if (t.since) bits.push('<span class="trust__item">Selling since ' + esc(new Date(t.since + 'T00:00:00').toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })) + '</span>');
    return bits.length ? '<p class="trust" aria-label="About this seller">' + bits.join('') + (s.sample ? ' <span class="tag-sample">Sample figures</span>' : '') + '</p>' : '';
  });

  /* ---------- Buy box: bulk prices, buyer protection, alerts, sharing ---------- */
  function tiersHTML(p) {
    var tiers = p.priceTiers || [];
    if (!tiers.length) return '';
    return '<div class="tiers" data-tiers="' + esc(p.id) + '"><p class="tiers__head">Buy more, pay less</p><ul>' + tiers.map(function (t) {
      var ZP = Z().ZP, u = ZP.sellUnit(p);
      return '<li data-tier-min="' + t.min + '"><span>' + t.min.toLocaleString('en-US') + '+ ' + esc(ZP.unitName(p, t.min)) + '</span><strong>' + kw(t.price) + ' ' + (u ? 'per ' + esc(u[1]) : 'each') + '</strong></li>';
    }).join('') + '</ul></div>';
  }
  function protectionHTML() {
    var bp = S().buyerProtection;
    if (!onOff(bp)) return '';
    return '<p class="protect"><span class="protect__icon" aria-hidden="true">🛡️</span><span><strong>Buyer protection.</strong> We hold your payment until you confirm delivery, then pay the seller. ' +
      'Not as described? <a href="help.html#returns">You get your money back</a>.</span></p>';
  }
  function soldOut(p) {
    if ((p.variants || []).length) return p.variants.every(function (v) { return !(v.stock > 0); });
    return p.stock === 'request' || p.stock === 'out';
  }
  on('productBuybox', function (p) {
    if (p.source === 'china') return '';
    var html = tiersHTML(p) + protectionHTML();
    if (S().alerts !== false && !(Z().backendActive && Z().backendActive())) {
      html += '<div class="mx-alerts">' +
        (soldOut(p) ? '<button class="btn btn--secondary btn--block btn--sm" type="button" data-mx-alert="back_in_stock" data-id="' + esc(p.id) + '">Notify me when it\'s back</button>' : '') +
        '<button class="link-btn" type="button" data-mx-alert="price_drop" data-id="' + esc(p.id) + '">Alert me if the price drops</button></div>';
    }
    if (S().share !== false) html += '<button class="link-btn mx-share" type="button" data-mx-share="' + esc(p.id) + '">Share this product</button>';
    return html;
  });
  // The bulk price row for the chosen quantity is highlighted
  on('productReady', function (p, qtyNow) {
    var box = document.querySelector('[data-tiers]'), input = document.getElementById('pdp-qty');
    if (!box || !input) return;
    var mark = function () {
      var n = qtyNow(), best = null;
      Z().$$('[data-tier-min]', box).forEach(function (li) { if (n >= Number(li.getAttribute('data-tier-min'))) best = li; });
      Z().$$('[data-tier-min]', box).forEach(function (li) { li.classList.toggle('is-on', li === best); });
    };
    input.addEventListener('input', mark); input.addEventListener('change', mark); mark();
  });

  /* ---------- Alerts and saved searches ---------- */
  function alerts() { return get('alerts', []); }
  function searches() { return get('searches', []); }
  function priceNow(p) { return Z().priceOf(p).now; }
  function addAlert(kind, id) {
    if (!signedIn()) return needSignIn(kind === 'price_drop' ? 'get price alerts' : 'get back-in-stock alerts');
    var p = Z().product(id); if (!p) return;
    var list = alerts().filter(function (a) { return !(a.kind === kind && a.product === id); });
    if (list.length >= 50) return Z().toast('You can have up to 50 alerts. Remove some in <a href="#/alerts">your alerts</a>.', 'warn');
    list.push({ kind: kind, product: id, price: priceNow(p), date: Z().today });
    set('alerts', list);
    Z().toast((kind === 'price_drop' ? 'We\'ll tell you if the price drops below ' + kw(priceNow(p)) : 'We\'ll tell you when it\'s back') +
      '. <a href="#/alerts">Your alerts</a>');
  }
  // Alerts that have come true since they were set
  function firedAlerts() {
    return alerts().map(function (a) {
      var p = Z().product(a.product);
      if (!p) return null;
      if (a.kind === 'price_drop' && priceNow(p) < a.price) return { a: a, p: p, text: 'Now ' + kw(priceNow(p)) + ', down from ' + kw(a.price) };
      if (a.kind === 'back_in_stock' && !soldOut(p)) return { a: a, p: p, text: 'Back in stock' };
      return null;
    }).filter(Boolean);
  }
  function searchIds(q, dept) {
    var words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return Z().products().filter(function (p) {
      var t = [p.title, p.tags].join(' ').toLowerCase();
      return (!dept || p.category === dept) && words.every(function (w) { return t.indexOf(w) !== -1; });
    }).map(function (p) { return p.id; });
  }
  on('searchTools', function (term, dept) {
    if (!term || S().alerts === false) return '';
    var saved = searches().some(function (x) { return x.q === term && (x.dept || '') === (dept || ''); });
    return '<p class="mx-save-search">' + (saved ? '<span class="pmeta">Search saved. New matches show in <a href="#/alerts">your alerts</a>.</span>'
      : '<button class="btn btn--secondary btn--sm" type="button" data-mx-save-search="' + esc(term) + '" data-dept="' + esc(dept || '') + '">Save this search</button> <span class="pmeta">and see new matches later</span>') + '</p>';
  });
  on('accountTiles', function () {
    if (S().alerts === false) return '';
    var fired = firedAlerts().length + searches().filter(function (x) { return newMatches(x).length; }).length;
    return '<li><a href="#/alerts"><strong>Alerts' + (fired ? ' <span class="badge">' + fired + ' new</span>' : '') + '</strong><span>' + alerts().length + ' alerts · ' + searches().length + ' saved searches</span></a></li>';
  });
  function newMatches(x) { var known = x.ids || []; return searchIds(x.q, x.dept).filter(function (id) { return known.indexOf(id) === -1; }); }
  // Explicit application keys: never clear another application's data or cookie preferences.
  var deviceKeys = ['user', 'cart', 'wish', 'bought', 'wish-asked', 'wish-pending', 'saved', 'recent', 'compare', 'orders', 'reviews', 'addresses',
    'complaints', 'alerts', 'searches', 'questions', 'seller', 'seller-couriers', 'seller-locations',
    'listings', 'promos', 'deals', 'team', 'voucher', 'moderation', 'staff-log', 'stock-data', 'stock-settings', 'location'];
  EXT.views.device = function () {
    var Zs = Z();
    Zs.show(Zs.crumbs([['My Account', '#/account'], ['Data on this device']]) + Zs.head('Data on this device') +
      '<div class="duo duo--gap"><section class="card"><h2>Keep a copy</h2><p>Download your saved profile, addresses, orders, reviews, shopping activity and seller work as a JSON file.</p>' +
      '<p>The file may contain names, phone numbers, addresses and photos. Store it privately.</p><button class="btn btn--secondary" type="button" data-mx-export>Download my data</button></section>' +
      '<section class="card"><h2>Clear this device</h2><p>Signing out removes your profile, but leaves other saved activity here. On a shared device, clear it when you finish.</p>' +
      '<p>This deletes saved details, shopping activity, orders, reviews, alerts and seller work from this browser. Download a copy first if you need it. Cookie choices, language and data saver preferences stay.</p>' +
      '<p>Messages you sent on WhatsApp and records held by Zed Supply are separate. <a href="privacy.html#rights">Contact us about those records</a>.</p>' +
      '<form data-mx-clear-device><div class="check"><input id="device-confirm" type="checkbox" required><label for="device-confirm">I understand that saved data on this device will be deleted.</label></div>' +
      '<button class="btn btn--secondary btn--danger" type="submit">Delete saved data on this device</button><p class="form-status" role="status"></p></form></section></div>', 'Data on this device');
  };
  EXT.views.alerts = function () {
    var Zs = Z();
    if (!signedIn()) { Zs.show(Zs.crumbs([['Alerts']]) + Zs.head('Alerts') + Zs.empty('Sign in to keep stock and price alerts and saved searches.', '<a class="btn btn--primary" href="#/account">Sign in</a>'), 'Alerts'); return; }
    var fired = firedAlerts();
    var list = alerts(), saved = searches();
    Zs.show(Zs.crumbs([['My Account', '#/account'], ['Alerts']]) + Zs.head('Alerts and saved searches', 'Prototype: checked when you visit, on this device. Once accounts move to our server, we\'ll message you on WhatsApp.') +
      (fired.length ? '<section class="card"><h2>Good news</h2><ul class="orders">' + fired.map(function (f) {
        return '<li class="order-row"><span><a href="#/product/' + esc(f.p.id) + '"><strong>' + esc(f.p.title) + '</strong></a><br><span class="pmeta">' + esc(f.text) + '</span></span>' +
          '<button class="link-btn" type="button" data-mx-del-alert="' + esc(f.a.kind + '|' + f.a.product) + '">Done</button></li>';
      }).join('') + '</ul></section>' : '') +
      '<div class="duo duo--gap"><section class="card"><h2>Your alerts</h2>' + (list.length ? '<ul class="orders">' + list.map(function (a) {
        var p = Zs.product(a.product);
        return '<li class="order-row"><span><a href="#/product/' + esc(a.product) + '"><strong>' + esc(p ? p.title : a.product) + '</strong></a><br><span class="pmeta">' +
          (a.kind === 'price_drop' ? 'Price drops below ' + kw(a.price) : 'Back in stock') + ' · since ' + Zs.niceDate(a.date) + '</span></span>' +
          '<button class="link-btn link-btn--danger" type="button" data-mx-del-alert="' + esc(a.kind + '|' + a.product) + '">Remove<span class="visually-hidden"> alert</span></button></li>';
      }).join('') + '</ul>' : '<p>No alerts yet. Use "Alert me if the price drops" on a product.</p>') + '</section>' +
      '<section class="card"><h2>Saved searches</h2>' + (saved.length ? '<ul class="orders">' + saved.map(function (x, i) {
        var fresh = newMatches(x).length;
        return '<li class="order-row"><span><a href="#/search?q=' + encodeURIComponent(x.q) + (x.dept ? '&dept=' + encodeURIComponent(x.dept) : '') + '" data-mx-seen-search="' + i + '"><strong>' + esc(x.q) + '</strong></a>' +
          (x.dept ? ' <span class="pmeta">in ' + esc(Zs.dept(x.dept).name) + '</span>' : '') + '<br><span class="pmeta">' + (fresh ? fresh + ' new since you saved it' : 'Nothing new yet') + '</span></span>' +
          '<button class="link-btn link-btn--danger" type="button" data-mx-del-search="' + i + '">Remove<span class="visually-hidden"> saved search</span></button></li>';
      }).join('') + '</ul>' : '<p>No saved searches. Search, then choose "Save this search".</p>') + '</section></div>', 'Alerts');
  };

  /* ---------- Sharing ---------- */
  function share(id) {
    var p = Z().product(id); if (!p) return;
    var url = pageUrl('#/product/' + encodeURIComponent(id)), text = p.title + ' – ' + kw(priceNow(p)) + ' on Zed Supply';
    if (navigator.share) { navigator.share({ title: p.title, text: text, url: url }).catch(function () { /* closed */ }); return; }
    var wa = 'https://wa.me/?text=' + encodeURIComponent(text + ' ' + url);
    var done = function () { Z().toast('Link copied. <a href="' + esc(wa) + '" target="_blank" rel="noopener noreferrer">Share on WhatsApp</a>'); };
    if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, function () { Z().toast('<a href="' + esc(wa) + '" target="_blank" rel="noopener noreferrer">Share on WhatsApp</a>'); });
    else Z().toast('<a href="' + esc(wa) + '" target="_blank" rel="noopener noreferrer">Share on WhatsApp</a>');
  }

  /* ---------- Questions and answers, bought together ---------- */
  function questionsFor(p) { return (p.questions || []).concat((get('questions', {})[p.id]) || []); }
  function boughtWith(p) {
    var Zs = Z(), count = {};
    (p.boughtWith || []).forEach(function (id) { count[id] = (count[id] || 0) + 2; });
    Zs.orders().forEach(function (o) {
      var ids = (o.items || []).map(function (it) { return it.id; });
      if (ids.indexOf(p.id) === -1) return;
      ids.forEach(function (id) { if (id !== p.id) count[id] = (count[id] || 0) + 1; });
    });
    return Object.keys(count).filter(function (id) { return count[id] >= 2; }).sort(function (a, b) { return count[b] - count[a]; })
      .map(Zs.product).filter(function (x) { return x && x.source !== 'china'; }).slice(0, 3);
  }
  on('productSections', function (p) {
    if (p.source === 'china') return '';
    var Zs = Z(), html = '', bw = boughtWith(p);
    if (bw.length) {
      var all = [p].concat(bw), sum = all.reduce(function (n, x) { return n + priceNow(x); }, 0);
      html += '<section class="section" aria-labelledby="bt-title"><h2 id="bt-title">Frequently bought together</h2><ul class="row">' + Zs.cards(bw) + '</ul>' +
        '<p><button class="btn btn--secondary" type="button" data-mx-add-all="' + esc(all.map(function (x) { return x.id; }).join(',')) + '">Add all ' + all.length + ' to cart · ' + kw(sum) + '</button></p></section>';
    }
    if (S().questions !== false && !(Z().backendActive && Z().backendActive())) {
      var qs = questionsFor(p);
      html += '<section class="section qa" id="questions" aria-labelledby="qa-title"><h2 id="qa-title">Questions and answers</h2>' +
        (qs.length ? '<dl class="qa__list">' + qs.map(function (x) {
          return '<div class="qa__item"><dt>Q: ' + esc(x.q) + (x.mine ? ' <span class="tag-mine">Your question</span>' : '') + '</dt><dd>' +
            (x.a ? 'A: ' + esc(x.a) + ' <span class="pmeta">– the seller</span>' : '<span class="pmeta">Waiting for the seller to answer.</span>') + '</dd></div>';
        }).join('') + '</dl>' : '<p class="pmeta">No questions yet. Ask the seller about size, fit, condition or what\'s included.</p>') +
        (signedIn() ? '<form class="form qa__ask" data-mx-ask="' + esc(p.id) + '"><label for="qa-q">Ask a question</label><div class="qa__row"><input id="qa-q" maxlength="300" minlength="10" required placeholder="e.g. Does it come with a charger?">' +
          '<button class="btn btn--secondary" type="submit">Ask</button></div><p class="hint">The seller\'s answer shows here for everyone. Prototype: kept on this device.</p></form>'
          : '<p><a class="btn btn--secondary btn--sm" href="#/account">Sign in to ask a question</a></p>') + '</section>';
    }
    return html;
  });

  /* ---------- Review photos ---------- */
  var pendingPhotos = null, photoGeneration = 0, photosLoading = false;
  on('reviewFormExtra', function () {
    pendingPhotos = null; photosLoading = false; photoGeneration++;
    return '<div class="field"><label for="rev-photos">Add photos (optional, up to 3)</label><input id="rev-photos" type="file" accept="image/jpeg,image/png,image/webp" multiple data-mx-review-photos>' +
      '<p class="hint">Photos of the item as it arrived help other buyers. Leave out faces and addresses.</p><div class="review-photos" id="rev-photos-preview"></div></div>';
  });
  on('reviewPhotos', function () { return pendingPhotos; });
  on('reviewPhotosReady', function () { return !photosLoading; });
  on('reviewPhotosHTML', function (v) {
    return (v.photos || []).length ? '<div class="review-photos">' + v.photos.map(function (src, i) {
      return '<img src="' + esc(src) + '" alt="Photo ' + (i + 1) + ' from ' + esc(v.name) + '\'s review" width="96" height="96" loading="lazy">';
    }).join('') + '</div>' : '';
  });
  // Shrinks a photo to 480 pixels on its longest side, so reviews stay light on data
  function shrink(file) {
    return new Promise(function (resolve, reject) {
      if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 15e6) { reject(new Error('type')); return; }
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () {
        var k = Math.min(1, 480 / Math.max(img.width, img.height)), c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        var out = c.toDataURL('image/webp', 0.72);
        resolve(out.indexOf('data:image/webp') === 0 ? out : c.toDataURL('image/jpeg', 0.72));
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('read')); };
      img.src = url;
    });
  }

  /* ---------- Typo-tolerant search ---------- */
  // Edit distance, stopping early once it can't be within max
  function distance(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    var prev = [], cur, i, j;
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) {
      cur = [i]; var low = i;
      for (j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (cur[j] < low) low = cur[j];
      }
      if (low > max) return max + 1;
      prev = cur;
    }
    return prev[b.length];
  }
  on('searchFuzzy', function (words, list, textOf) {
    var scored = list.map(function (p) {
      var tokens = textOf(p).split(/[^a-z0-9]+/).filter(function (t) { return t.length > 1; }), total = 0;
      var ok = words.every(function (w) {
        var max = w.length >= 7 ? 2 : w.length >= 4 ? 1 : 0, best = max + 1;
        tokens.forEach(function (t) { var d = t.indexOf(w) === 0 ? 0 : distance(w, t.slice(0, w.length + max), max); if (d < best) best = d; });
        total += best; return best <= max;
      });
      return ok ? { p: p, s: total } : null;
    }).filter(Boolean);
    scored.sort(function (a, b) { return a.s - b.s; });
    return scored.map(function (x) { return x.p; });
  });

  /* ---------- Checkout: pickup points, lay-by, pay on delivery, buyer protection ---------- */
  var co = { pickup: '', layby: false, ctx: null };
  function pickupPoints() {
    var live = S().pickupPoints || [];
    return live.length ? live : (S().isSample && window.ZS_SAMPLE && window.ZS_SAMPLE.pickupPoints) || [];
  }
  on('checkoutCollect', function () {
    var pts = pickupPoints();
    if (!pts.length) return '';
    var prov = Z().provinceOf(Z().loc());
    var sorted = pts.slice().sort(function (a, b) { return (b.province === prov) - (a.province === prov); });
    return '<div class="field"><label for="co-pickup">Or collect from a pickup point</label><select id="co-pickup" data-mx-pickup><option value="">No, use the choice above</option>' +
      sorted.map(function (x) { return '<option value="' + esc(x.id) + '"' + (co.pickup === x.id ? ' selected' : '') + '>' + esc(x.name + ' – ' + x.town) + '</option>'; }).join('') + '</select>' +
      '<p class="hint" id="co-pickup-hint">' + pickupHint() + '</p></div>';
  });
  function pickupHint() {
    var x = pickupPoints().filter(function (p) { return p.id === co.pickup; })[0];
    return x ? esc(x.address + (x.hours ? ' · ' + x.hours : '')) + '. We tell you on WhatsApp when it\'s ready to collect.' : 'Partner shops that keep your parcel until you collect it, often cheaper than delivery.';
  }
  function codMethod() { return (S().paymentMethods || []).filter(function (m) { return m.id === 'cod'; })[0]; }
  function codBlock(total) {
    var m = codMethod();
    if (!m) return '';
    if (m.maxZMW && total > m.maxZMW) return 'Cash on delivery is available on orders up to ' + kw(m.maxZMW) + '.';
    if (m.afterFirstOrder && !Z().orders().some(function (o) { return !o.sample && o.status >= 4; })) return 'Cash on delivery opens after your first delivered order.';
    return '';
  }
  on('checkoutPayment', function (total) {
    var html = protectionHTML(), lb = S().layby;
    if (onOff(lb)) {
      var dep = Math.ceil(total * (lb.depositPct || 20) / 100);
      html += '<div class="check"><input type="checkbox" id="co-layby" data-mx-layby' + (co.layby ? ' checked' : '') + '><label for="co-layby">Lay-by: pay ' + kw(dep) + ' now, the rest within ' + (lb.weeks || 8) + ' weeks</label></div>' +
        '<p class="hint">We keep the item for you and hand it over once it\'s fully paid. No interest. If it isn\'t paid in time, the order is cancelled; see <a href="help.html#layby">lay-by terms</a>.</p>';
    }
    var cod = codMethod(), why = codBlock(total);
    if (cod && (cod.enabled || (cod.preview && S().isSample)) && why) html += '<p class="hint" id="co-cod-note">' + esc(why) + '</p>';
    return html;
  });
  on('checkoutMessage', function (total) {
    var m = '', x = pickupPoints().filter(function (p) { return p.id === co.pickup; })[0], lb = S().layby;
    if (x) m += '\nPickup point: ' + x.name + ', ' + x.address + ' (' + x.town + ')';
    if (co.layby && onOff(lb)) m += '\nPayment plan: lay-by, deposit ' + kw(Math.ceil(total * (lb.depositPct || 20) / 100)) + ', rest within ' + (lb.weeks || 8) + ' weeks';
    return m;
  });
  on('checkoutReady', function (ctx) {
    if (Z().backendActive && Z().backendActive()) return;
    co.ctx = ctx;
    var btn = document.getElementById('checkout');
    if (!btn) return;
    // Registered before the store's own handler, so a blocked choice stops the order here
    btn.addEventListener('click', function (e) {
      var cod = codMethod(), why = codBlock(ctx.total);
      if (cod && ctx.payChoice() === cod.name && why) {
        e.preventDefault(); e.stopImmediatePropagation();
        Z().toast(esc(why) + ' Please choose another way to pay.', 'error');
        return;
      }
      // Keep the plan and pickup point with the order record main.js saves
      setTimeout(function () {
        var list = Z().orders(), changed = false;
        list.forEach(function (o) {
          if (o.ref !== ctx.ref) return;
          if (co.pickup) { o.pickup = co.pickup; changed = true; }
          if (co.layby && onOff(S().layby)) { o.plan = 'layby'; o.deposit = Math.ceil(ctx.total * (S().layby.depositPct || 20) / 100); changed = true; }
        });
        if (changed) set('orders', list);
        co.pickup = ''; co.layby = false;
      }, 0);
    });
  });

  /* ---------- Orders: confirming delivery (buyer protection), lay-by ---------- */
  on('orderActions', function (o) {
    if (o.sample) return '';
    var html = '', bp = S().buyerProtection, days = (bp && bp.holdDays) || 3;
    if (o.plan === 'layby') html += '<div class="notice"><p><strong>Lay-by.</strong> Deposit ' + kw(o.deposit || 0) + ', the rest within ' + ((S().layby || {}).weeks || 8) + ' weeks. We keep your item until it\'s paid.</p></div>';
    if (o.pickup) {
      var x = pickupPoints().filter(function (p) { return p.id === o.pickup; })[0];
      if (x) html += '<div class="deliver-box"><p class="deliver-box__label">Pickup point</p><p>' + esc(x.name) + '<br><span class="pmeta">' + esc(x.address + ', ' + x.town + (x.hours ? ' · ' + x.hours : '')) + '</span></p></div>';
    }
    if (onOff(bp)) {
      if (o.received) html += '<p class="protect"><span class="protect__icon" aria-hidden="true">🛡️</span><span>You confirmed delivery on ' + esc(Z().niceDate(o.received)) + '. We pay the seller ' + days + ' days later unless you report a problem.</span></p>';
      else if (o.status >= 3) html += '<div class="protect"><span class="protect__icon" aria-hidden="true">🛡️</span><span><strong>Got everything in good order?</strong> Confirm, and we release your payment to the seller ' + days + ' days later. ' +
        'If something\'s wrong, report it instead and we hold the payment.</span><button class="btn btn--primary btn--sm" type="button" data-mx-received="' + esc(o.ref) + '">I\'ve received my order</button></div>';
    }
    return html;
  });

  /* ---------- Seller Centre: sales, listing health, questions, bulk upload ---------- */
  on('sellerSections', function (s, mine) {
    var Zs = Z(), units = 0, sales = 0, month = Zs.today.slice(0, 7);
    mine.forEach(function (p) { var n = (p.sales || {})[month] || 0; units += n; sales += n * priceNow(p); });
    var low = mine.filter(function (p) { return (p.variants || []).length ? p.variants.some(function (v) { return v.stock <= 3; }) : p.stock === 'low'; });
    var weak = mine.filter(function (p) { return !p.image || !p.description || p.description.length < 60; });
    var open = [];
    mine.forEach(function (p) { questionsFor(p).forEach(function (q, i) { if (!q.a) open.push({ p: p, q: q, i: i }); }); });
    var t = trustOf(s);
    return '<section class="card sc-products" id="sc-health" aria-labelledby="sc-h-title"><h2 id="sc-h-title">Your store at a glance</h2>' +
      '<ul class="tiles tiles--4 mx-stats"><li><span><strong>' + units + '</strong><span>items sold this month' + (s.sample ? ' (sample)' : '') + '</span></span></li>' +
        '<li><span><strong>' + kw(sales) + '</strong><span>sales this month</span></span></li>' +
        '<li><span><strong>' + (t.reviews ? t.rating.toFixed(1) + ' ★' : '–') + '</strong><span>' + t.reviews + ' reviews</span></span></li>' +
        '<li><span><strong>' + low.length + '</strong><span>products low on stock</span></span></li></ul>' +
      '<p class="pmeta">Your performance score (cancellations, dispatch on time, complaints, reply time) and payouts appear here once orders run through our secure server.</p>' +
      (low.length ? '<h3 class="h3">Low on stock</h3><ul class="orders">' + low.map(function (p) { return '<li class="order-row"><span>' + esc(p.title) + '</span><a class="link-btn" href="#/listing/' + encodeURIComponent(p.id) + '">Update stock</a></li>'; }).join('') + '</ul>' : '') +
      (weak.length ? '<h3 class="h3">Listings to improve</h3><p class="pmeta">A clear photo and a full description sell more.</p><ul class="orders">' + weak.slice(0, 6).map(function (p) {
        return '<li class="order-row"><span>' + esc(p.title) + '<br><span class="pmeta">' + [!p.image ? 'add a photo' : '', !p.description || p.description.length < 60 ? 'describe it in more detail' : ''].filter(Boolean).join(', ') + '</span></span><a class="link-btn" href="#/listing/' + encodeURIComponent(p.id) + '">Edit</a></li>';
      }).join('') + '</ul>' : '') + '</section>' +
      (S().questions !== false ? '<section class="card sc-products" id="sc-questions" aria-labelledby="sc-q-title"><h2 id="sc-q-title">Questions from buyers</h2>' +
        (open.length ? '<ul class="orders">' + open.map(function (x) {
          return '<li class="order-row"><form class="form mx-answer" data-mx-answer="' + esc(x.p.id) + '|' + esc(x.q.q) + '"><p><strong>' + esc(x.p.title) + '</strong><br>' + esc(x.q.q) + '</p>' +
            '<label class="visually-hidden" for="ans-' + esc(x.p.id) + '-' + x.i + '">Your answer</label><div class="qa__row"><input id="ans-' + esc(x.p.id) + '-' + x.i + '" maxlength="1000" required placeholder="Your answer">' +
            '<button class="btn btn--secondary btn--sm" type="submit">Answer</button></div></form></li>';
        }).join('') + '</ul>' : '<p>No questions waiting.</p>') + '</section>' : '') +
      '<section class="card sc-products" id="sc-bulk" aria-labelledby="sc-b-title"><h2 id="sc-b-title">Add many products at once</h2>' +
        '<p class="pmeta">Upload a spreadsheet saved as CSV with these columns: <code>title, category, sub, priceZMW, stock, description, tags</code>. ' +
        'category and sub use the ids from the department list; stock is in, low or request. For trade listings you can add <code>unit, minQty, multiples, heavy, weightKg</code>: unit is a selling unit such as bag, tonne or sheet; heavy is yes or no. Add photos afterwards from each product\'s Edit page, straight from your phone\'s camera.</p>' +
        '<div class="field"><label for="sc-csv">CSV file</label><input id="sc-csv" type="file" accept=".csv,text/csv" data-mx-csv="' + esc(s.id) + '"></div>' +
        '<div id="sc-csv-out" role="status" aria-live="polite"></div></section>' + teamSection(s);
  });

  /* ---------- Seller Centre: store team ---------- */
  // The roles the server checks (supabase/migrations/20261103000020_seller_team.sql)
  var TEAM_ROLES = EXT.teamRoles = [
    ['owner', 'Owner', 'Everything, including the team, payouts and store details.'],
    ['manager', 'Manager', 'Store details, listings, prices, offers, promotions, deals, orders, shipments and complaints.'],
    ['listings', 'Listings', 'Products, prices, stock, photos, offers and buyer questions.'],
    ['dispatch', 'Dispatch', 'Orders, packing, shipments and delivery proof.'],
    ['finance', 'Finance (view only)', 'Orders, sales and payouts.']
  ], TEAM_LIMIT = 20;
  function roleName(id) { var r = TEAM_ROLES.filter(function (x) { return x[0] === id; })[0]; return r ? r[1] : id; }
  function roleOptions(chosen) { return TEAM_ROLES.map(function (r) { return '<option value="' + r[0] + '"' + (r[0] === chosen ? ' selected' : '') + '>' + esc(r[1]) + '</option>'; }).join(''); }
  EXT.teamRoleGuide = function () {
    return '<details class="card"><summary>What each role can do</summary><dl class="mx-roles">' + TEAM_ROLES.map(function (r) { return '<dt>' + esc(r[1]) + '</dt><dd>' + esc(r[2]) + '</dd>'; }).join('') + '</dl></details>';
  };
  // Prototype: kept in this browser per store. Invitations expire after 7 days.
  function teamOf(id) {
    var t = get('team', {})[id] || { members: [], invites: [] };
    t.invites = t.invites.filter(function (i) { return i.expires >= Z().today; });
    return t;
  }
  function saveTeam(id, t) { var all = get('team', {}); all[id] = t; set('team', all); }
  function teamSection(s) {
    var t = teamOf(s.id), u = Z().user();
    return '<section class="card sc-products" id="sc-team" aria-labelledby="sc-tm-title"><h2 id="sc-tm-title">Your team</h2>' +
      '<p class="pmeta">Invite the people who help run your store and give each a role, so they can do their job without seeing everything. A store can have up to ' + TEAM_LIMIT + ' people, counting open invitations, and always keeps at least one owner.</p>' +
      '<p class="notice">Prototype: your team is saved in this browser only. With seller accounts, the person signs in with the invited email to accept, and the server checks every role.</p>' +
      '<ul class="orders"><li class="order-row"><span><strong>' + (u && u.name ? esc(u.name) + '</strong> (you)' : 'You</strong>') + '<br><span class="pmeta">Owner</span></span></li>' +
      t.members.map(function (m) {
        return '<li class="order-row"><span><strong>' + esc(m.email) + '</strong><br><span class="pmeta">' + esc(roleName(m.role)) + '</span></span><span class="btn-row">' +
          '<label class="visually-hidden" for="tm-role-' + esc(m.id) + '">Role for ' + esc(m.email) + '</label><select id="tm-role-' + esc(m.id) + '" data-mx-team-role="' + esc(s.id) + '|' + esc(m.id) + '">' + roleOptions(m.role) + '</select>' +
          '<button class="btn btn--secondary btn--sm btn--danger" type="button" data-mx-team-remove="' + esc(s.id) + '|' + esc(m.id) + '">Remove<span class="visually-hidden"> ' + esc(m.email) + '</span></button></span></li>';
      }).join('') +
      t.invites.map(function (i) {
        return '<li class="order-row"><span><strong>' + esc(i.email) + '</strong> · invited<br><span class="pmeta">' + esc(roleName(i.role)) + ' · expires ' + Z().niceDate(i.expires) + '</span></span><span class="btn-row">' +
          '<button class="btn btn--secondary btn--sm" type="button" data-mx-team-accept="' + esc(s.id) + '|' + esc(i.id) + '">Mark accepted<span class="visually-hidden"> for ' + esc(i.email) + '</span></button>' +
          '<button class="btn btn--secondary btn--sm btn--danger" type="button" data-mx-team-cancel="' + esc(s.id) + '|' + esc(i.id) + '">Cancel<span class="visually-hidden"> invitation for ' + esc(i.email) + '</span></button></span></li>';
      }).join('') + '</ul>' +
      '<form class="form" data-mx-team-invite="' + esc(s.id) + '"><h3 class="h3">Invite someone</h3><div class="field-row">' +
        '<div class="field"><label for="tm-email">Email</label><input id="tm-email" type="email" required maxlength="254" autocomplete="off"></div>' +
        '<div class="field"><label for="tm-new-role">Role</label><select id="tm-new-role">' + roleOptions('listings') + '</select></div></div>' +
        '<p class="form-status" role="status" tabindex="-1"></p><button class="btn btn--primary" type="submit">Send invitation</button></form>' +
      EXT.teamRoleGuide() + '</section>';
  }
  function teamTarget(el, attr) { var parts = el.getAttribute(attr).split('|'); return { store: parts[0], id: parts[1], team: teamOf(parts[0]) }; }
  document.addEventListener('submit', function (e) {
    var f = e.target;
    if (!f.matches('[data-mx-team-invite]')) return;
    e.preventDefault();
    var id = f.getAttribute('data-mx-team-invite'), t = teamOf(id), st = f.querySelector('.form-status');
    var email = f.querySelector('#tm-email').value.trim().toLowerCase(), role = f.querySelector('#tm-new-role').value;
    var fail = function (m) { st.className = 'form-status is-error'; st.textContent = m; st.focus(); };
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail('Enter a valid email address.');
    if (t.members.some(function (m) { return m.email === email; })) return fail('That person is already on the team. Change their role instead.');
    var open = t.invites.filter(function (i) { return i.email === email; })[0];
    if (!open && 1 + t.members.length + t.invites.length >= TEAM_LIMIT) return fail('A store can have up to ' + TEAM_LIMIT + ' people, counting open invitations.');
    var expires = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
    if (open) { open.role = role; open.expires = expires; } else t.invites.push({ id: Z().newRef('T'), email: email, role: role, expires: expires });
    saveTeam(id, t); Z().toast('Invitation saved for ' + esc(email) + '.', 'success'); Z().route();
  });
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-mx-team-accept], [data-mx-team-cancel], [data-mx-team-remove]');
    if (!b) return;
    var attr = ['data-mx-team-accept', 'data-mx-team-cancel', 'data-mx-team-remove'].filter(function (a) { return b.hasAttribute(a); })[0], x = teamTarget(b, attr);
    if (attr === 'data-mx-team-remove') {
      if (!window.confirm('Remove this person from the team? They lose access straight away.')) return;
      x.team.members = x.team.members.filter(function (m) { return m.id !== x.id; });
    } else {
      var inv = x.team.invites.filter(function (i) { return i.id === x.id; })[0];
      x.team.invites = x.team.invites.filter(function (i) { return i.id !== x.id; });
      if (inv && attr === 'data-mx-team-accept') x.team.members.push({ id: inv.id, email: inv.email, role: inv.role });
    }
    saveTeam(x.store, x.team); Z().route();
  });
  document.addEventListener('change', function (e) {
    var sel = e.target.closest('[data-mx-team-role]');
    if (!sel) return;
    var x = teamTarget(sel, 'data-mx-team-role');
    x.team.members.forEach(function (m) { if (m.id === x.id) m.role = sel.value; });
    saveTeam(x.store, x.team); Z().toast('Role updated');
  });
  // A small CSV reader: quoted fields, commas and line breaks inside quotes, "" for a quote
  function parseCSV(text) {
    var rows = [], row = [], f = '', q = false, i, c;
    for (i = 0; i < text.length; i++) {
      c = text[i];
      if (q) { if (c === '"' && text[i + 1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c; }
      else if (c === '"') q = true;
      else if (c === ',') { row.push(f); f = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
      else f += c;
    }
    if (f || row.length) { row.push(f); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (x) { return x.trim(); }); });
  }
  function importCSV(sellerId, text) {
    var Zs = Z(), rows = parseCSV(text), out = { added: [], failed: [] };
    if (rows.length < 2) return out;
    var cols = rows[0].map(function (h) { return h.trim().toLowerCase(); });
    var at = function (r, name) { var i = cols.indexOf(name.toLowerCase()); return i === -1 ? '' : (r[i] || '').trim(); };
    rows.slice(1, 201).forEach(function (r, n) {
      var draft = { title: at(r, 'title'), category: at(r, 'category'), sub: at(r, 'sub'), seller: sellerId, brand: '', priceZMW: Number(at(r, 'priceZMW')),
        stock: at(r, 'stock') || 'in', description: at(r, 'description'), tags: at(r, 'tags'), image: '' };
      // Optional trade columns: a minimum order or multiples make it a trade listing
      var minQ = at(r, 'minQty'), stepQ = at(r, 'multiples'), unit = at(r, 'unit').toLowerCase(), heavy = at(r, 'heavy').toLowerCase();
      if (unit) draft.sellUnit = (Zs.ZP.SELL_UNITS.filter(function (u) { return u[0] === unit || u[1] === unit || u[2] === unit; })[0] || [unit])[0];
      if (minQ || stepQ) { draft.trade = true; draft.minQty = minQ ? Number(minQ) : 1; draft.qtyStep = stepQ ? Number(stepQ) : 1; }
      if (/^(yes|y|true|1)$/.test(heavy)) draft.heavy = true;
      if (at(r, 'weightKg')) draft.unitWeightKg = Number(at(r, 'weightKg'));
      var res = Zs.listings.create(draft, { departments: Zs.D.departments, brands: Zs.D.brands, products: Zs.products() });
      if (res.ok) out.added.push(res.product.title); else out.failed.push('Row ' + (n + 2) + ': ' + res.errors.map(function (e) { return e.message; }).join(' '));
    });
    return out;
  }

  /* ---------- Staff back office ---------- */
  // Opens in demo mode for now. Once accounts are on the server it opens for staff only, and
  // each decision goes through the staff_* database functions, which log it.
  function staffOpen() { var st = S().staff || {}; return !!(st.preview && S().isSample); }
  function staffLog(action, target) { var log = get('staff-log', []); log.unshift({ at: new Date().toISOString(), action: action, target: target }); set('staff-log', log.slice(0, 200)); }
  EXT.views.staff = function (tab) {
    var Zs = Z();
    if (!staffOpen()) { Zs.show(Zs.crumbs([['Staff']]) + Zs.head('Staff back office') + Zs.empty('This page is for Zed Supply staff. It opens once staff sign in on our secure server.', ''), 'Staff'); return; }
    tab = tab || 'listings';
    var reviewed = get('moderation', {}), local = Zs.listings.list();
    var queue = local.filter(function (p) { return !reviewed[p.id]; });
    var cx = Zs.complaints(), open = cx.filter(function (c) { return !/resolved|closed/.test(c.status || ''); });
    var ords = Zs.orders().filter(function (o) { return !o.sample; });
    var rider = Zs.store.get('rider-application', null), riderOpen = rider && ['new', 'review', 'info_needed', 'vetting'].indexOf(rider.status) !== -1;
    var tabs = [['listings', 'Listings to review', queue.length], ['complaints', 'Complaints', open.length], ['orders', 'Orders', ords.filter(function (o) { return o.status < 4 && !o.cancel; }).length], ['sellers', 'Sellers', Zs.D.sellers.length],
      ['delivery', 'Delivery prices', 0], ['riders', 'Riders', riderOpen ? 1 : 0], ['log', 'Log', 0]];
    var body = '';
    if (tab === 'listings') body = queue.length ? '<ul class="orders">' + queue.map(function (p) {
      return '<li class="order-row"><span><a href="#/product/' + esc(p.id) + '"><strong>' + esc(p.title) + '</strong></a><br><span class="pmeta">' + esc(p.id) + ' · ' + esc((Zs.seller(p.seller) || {}).name || p.seller) + ' · ' + kw(p.priceZMW) + ' · ' + esc(Zs.dept(p.category).name) + '</span></span>' +
        '<span class="btn-row"><button class="btn btn--primary btn--sm" type="button" data-mx-mod="approve|' + esc(p.id) + '">Approve</button><button class="btn btn--secondary btn--sm btn--danger" type="button" data-mx-mod="reject|' + esc(p.id) + '">Reject</button></span></li>';
    }).join('') + '</ul>' : '<p>Nothing waiting. New and changed listings from sellers appear here, including anything that may break the rules on what can\'t be sold.</p>';
    if (tab === 'complaints') body = cx.length ? '<ul class="orders">' + cx.map(function (c, i) {
      return '<li class="order-row"><span><strong>' + esc(c.ref) + '</strong> <span class="' + Z().statusClass(c.status || 'sent') + '">' + esc(c.status || 'sent') + '</span><br><span class="pmeta">' + esc((c.details || '').slice(0, 140)) + '</span></span>' +
        '<label class="visually-hidden" for="cx-' + i + '">Status for ' + esc(c.ref) + '</label><select id="cx-' + i + '" data-mx-cx="' + esc(c.ref) + '">' + ['sent', 'review', 'seller', 'resolved', 'closed'].map(function (st) {
          return '<option' + ((c.status || 'sent') === st ? ' selected' : '') + '>' + st + '</option>'; }).join('') + '</select></li>';
    }).join('') + '</ul>' : '<p>No complaints.</p>';
    if (tab === 'orders') body = ords.length ? '<ul class="orders">' + ords.map(function (o) {
      return '<li class="order-row"><span><a href="#/order/' + esc(o.ref) + '"><strong>' + esc(o.ref) + '</strong></a><br><span class="pmeta">' + Zs.niceDate(o.date) + ' · ' + kw(o.total || 0) + (o.cancel ? ' · cancellation ' + esc(o.cancel.status) : '') + '</span></span>' +
        (o.status < 4 && !o.cancel ? '<button class="btn btn--secondary btn--sm" type="button" data-mx-step="' + esc(o.ref) + '">Move to: ' + ['Confirmed', 'Packed', 'Out for delivery', 'Delivered'][o.status] + '</button>' : '<span class="' + Z().statusClass(o.cancel ? 'cancel ' + o.cancel.status : 'delivered') + '">' + (o.cancel ? 'cancel ' + esc(o.cancel.status) : 'delivered') + '</span>') + '</li>';
    }).join('') + '</ul>' : '<p>No orders on this device.</p>';
    if (tab === 'sellers') body = '<ul class="orders">' + Zs.D.sellers.map(function (s) {
      return '<li class="order-row"><span><strong>' + esc(s.name) + '</strong><br><span class="pmeta">' + esc(s.city || '') + (s.verified ? ' · verified' : ' · not verified') + '</span></span>' +
        '<button class="btn btn--secondary btn--sm" type="button" data-mx-verify="' + esc(s.id) + '">' + (s.verified ? 'Remove verification' : 'Verify') + '</button></li>';
    }).join('') + '</ul><p class="pmeta">Verify a seller only after checking their PACRA registration, ID and a physical or online presence.</p>';
    // Delivery prices: the same editor staff use on the server; here it changes this device's demo
    if (tab === 'delivery') body = '<p class="notice">Demo: changes stay on this device and reprice the demo cart. On the live site the same screen saves to the database, which is the only place delivery prices are kept.</p>' +
      Zs.deliveryEditorHTML(Zs.deliverySettingsNow()) + '<p><button class="btn btn--secondary btn--sm" type="button" data-mx-delivery-reset>Go back to the sample prices</button></p>';
    // Riders: review, ask, invite to the in-person checks, then approve; approval needs the checks first
    if (tab === 'riders') body = rider ? '<article class="card"><h2>' + esc(rider.full_name) + ' <span class="' + Z().statusClass(Zs.RIDER_STATUS[rider.status] === 'Approved to deliver' ? 'approved' : Zs.RIDER_STATUS[rider.status]) + '">' + esc(Zs.RIDER_STATUS[rider.status] || rider.status) + '</span></h2>' +
        '<dl class="totals"><div><dt>Phone</dt><dd>' + esc(rider.phone) + '</dd></div><div><dt>Town</dt><dd>' + esc(rider.town) + (rider.areas ? ' · ' + esc(rider.areas) : '') + '</dd></div>' +
        '<div><dt>Vehicle</dt><dd>' + esc(Zs.VEHICLES[rider.vehicle] || rider.vehicle) + (rider.owns_vehicle ? ', own' : '') + (rider.vehicle !== 'bicycle' ? ' · licence confirmed' : '') + '</dd></div>' +
        '<div><dt>Available</dt><dd>' + esc((rider.availability || []).map(function (a) { return Zs.AVAIL[a]; }).join(', ') || 'Not given') + '</dd></div></dl>' +
        (rider.experience ? '<p>' + esc(rider.experience) + '</p>' : '') + (rider.staff_note ? '<p class="notice"><strong>Last message to the rider:</strong> ' + esc(rider.staff_note) + '</p>' : '') +
        (riderOpen ? '<form class="form" id="mx-rider-decide"><label for="mx-rider-note">Message to the rider</label><textarea id="mx-rider-note" maxlength="1000"></textarea><div class="btn-row">' +
          (rider.status === 'new' ? '<button class="btn btn--secondary btn--sm" type="submit" value="review">Mark under review</button>' : '') +
          '<button class="btn btn--secondary btn--sm" type="submit" value="info_needed">Ask for more information</button>' +
          (rider.status === 'vetting' ? '<button class="btn btn--primary btn--sm" type="submit" value="approved">Checks passed: approve</button>' : '<button class="btn btn--primary btn--sm" type="submit" value="vetting">Invite to in-person checks</button>') +
          '<button class="btn btn--secondary btn--sm btn--danger" type="submit" value="rejected">Reject</button></div><p class="form-status" role="status"></p></form>' : '') + '</article>' +
        '<p class="pmeta">Approve only after checking the rider\'s NRC, licence, police clearance and references in person.</p>'
      : '<p>No rider applications yet. <a href="#/riders">See the rider sign-up</a>.</p>';
    if (tab === 'log') { var log = get('staff-log', []); body = log.length ? '<ul class="orders">' + log.map(function (l) { return '<li class="order-row"><span>' + esc(l.action) + ' · ' + esc(l.target) + '</span><span class="pmeta">' + esc(l.at.slice(0, 16).replace('T', ' ')) + '</span></li>'; }).join('') + '</ul>' : '<p>No staff actions yet.</p>'; }
    Zs.show(Zs.crumbs([['Staff']]) + Zs.head('Staff back office', 'Prototype on this device\'s data. On the server, each decision is checked and logged.') +
      '<nav class="chips mx-tabs" aria-label="Back office sections">' + tabs.map(function (t) {
        return '<a class="chip" href="#/staff/' + t[0] + '"' + (t[0] === tab ? ' aria-current="page"' : '') + '>' + t[1] + (t[2] ? ' <span class="badge">' + t[2] + '</span>' : '') + '</a>';
      }).join('') + '</nav><section class="card">' + body + '</section>', 'Staff back office');
    if (tab === 'delivery') Zs.bindDeliveryEditor(document.getElementById('delivery-editor'), function (x) {
      var saved = { rates: x.rates.map(function (r) { return { courier: r.courier, zone: r.zone, speed: r.speed, fee: r.fee, kg: r.kg, perKg: r.perKg, days: r.days, active: r.active }; }),
        freeDelivery: x.freeDelivery, defaultKg: x.defaultKg, origin: x.origin, sameDay: x.sameDay, closedDays: x.closedDays };
      set('demo-delivery', saved); Zs.applyDeliverySettings(saved, true); staffLog('Delivery prices saved', saved.rates.length + ' rates');
    });
    var decide = document.getElementById('mx-rider-decide');
    if (decide) decide.addEventListener('submit', function (e) {
      e.preventDefault();
      var d = e.submitter ? e.submitter.value : '', note = document.getElementById('mx-rider-note').value.trim(), st = decide.querySelector('[role="status"]');
      if (d !== 'review' && d !== 'approved' && note.length < 5) { st.className = 'form-status is-error'; st.textContent = 'Write a message to the rider.'; document.getElementById('mx-rider-note').focus(); return; }
      if (d === 'approved' && rider.status !== 'vetting') return;
      rider.status = d; if (note) rider.staff_note = note;
      Zs.store.set('rider-application', rider); staffLog('Rider application: ' + (Zs.RIDER_STATUS[d] || d), rider.full_name); Zs.toast('Saved', 'success'); Zs.route();
    });
  };

  /* ---------- Clicks, forms and file inputs ---------- */
  document.addEventListener('click', function (e) {
    var el;
    if (e.target.closest('[data-mx-delivery-reset]')) { try { localStorage.removeItem('zs-demo-delivery'); } catch (err) { /* blocked */ } location.reload(); return; }
    if ((el = e.target.closest('[data-mx-export]'))) {
      var data = {};
      deviceKeys.forEach(function (key) { var value = get(key, null); if (value !== null) data[key] = value; });
      try { var locationData = sessionStorage.getItem('zs-location'); if (locationData && !data.location) data.location = JSON.parse(locationData); } catch (err) { /* unavailable */ }
      var blob = new Blob([JSON.stringify({ application: 'Zed Supply', exportedAt: new Date().toISOString(), data: data }, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = 'zed-supply-device-data.json'; document.body.appendChild(link); link.click(); link.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000); return;
    }
    if ((el = e.target.closest('[data-mx-alert]'))) { addAlert(el.getAttribute('data-mx-alert'), el.getAttribute('data-id')); return; }
    if ((el = e.target.closest('[data-mx-share]'))) { share(el.getAttribute('data-mx-share')); return; }
    if ((el = e.target.closest('[data-mx-del-alert]'))) {
      var k = el.getAttribute('data-mx-del-alert').split('|');
      set('alerts', alerts().filter(function (a) { return !(a.kind === k[0] && a.product === k[1]); })); Z().route(); return;
    }
    if ((el = e.target.closest('[data-mx-save-search]'))) {
      if (!signedIn()) return needSignIn('save searches');
      var list = searches(); if (list.length >= 20) return Z().toast('You can save up to 20 searches.', 'warn');
      var q = el.getAttribute('data-mx-save-search'), d = el.getAttribute('data-dept');
      list.push({ q: q, dept: d, ids: searchIds(q, d), date: Z().today }); set('searches', list);
      Z().toast('Search saved. <a href="#/alerts">Your saved searches</a>'); Z().route(); return;
    }
    if ((el = e.target.closest('[data-mx-del-search]'))) { var s = searches(); s.splice(Number(el.getAttribute('data-mx-del-search')), 1); set('searches', s); Z().route(); return; }
    if ((el = e.target.closest('[data-mx-seen-search]'))) { var s2 = searches(), x = s2[Number(el.getAttribute('data-mx-seen-search'))]; if (x) { x.ids = searchIds(x.q, x.dept); set('searches', s2); } return; }
    if ((el = e.target.closest('[data-mx-add-all]'))) {
      var added = el.getAttribute('data-mx-add-all').split(',').filter(function (id) { var p = Z().product(id); return p && !(p.variants || []).length && Z().addToCart(id, window.ZSProduct.orderRules(p).min); });
      Z().toast(added.length ? 'Added ' + added.length + ' to your cart. <a href="#/cart">View cart</a>' : 'Choose options on each product to add it.'); return;
    }
    if ((el = e.target.closest('[data-mx-received]'))) {
      var ref = el.getAttribute('data-mx-received'), ol = Z().orders();
      ol.forEach(function (o) { if (o.ref === ref) { o.received = Z().today; if (o.status < 4) o.status = 4; } });
      set('orders', ol); Z().toast('Thanks for confirming. We\'ll release your payment to the seller.'); Z().route(); return;
    }
    if ((el = e.target.closest('[data-mx-mod]'))) {
      var m = el.getAttribute('data-mx-mod').split('|'), mod = get('moderation', {});
      mod[m[1]] = { decision: m[0], at: Z().today }; set('moderation', mod); staffLog(m[0] + ' listing', m[1]); Z().route(); return;
    }
    if ((el = e.target.closest('[data-mx-step]'))) {
      var r = el.getAttribute('data-mx-step'), os = Z().orders();
      os.forEach(function (o) { if (o.ref === r && o.status < 4) o.status += 1; });
      set('orders', os); staffLog('order step', r); Z().route(); return;
    }
    if ((el = e.target.closest('[data-mx-verify]'))) {
      var sv = Z().seller(el.getAttribute('data-mx-verify'));
      if (sv) { sv.verified = !sv.verified; staffLog((sv.verified ? 'verify' : 'unverify') + ' seller', sv.id); }
      Z().route();
    }
  });
  document.addEventListener('change', function (e) {
    var el = e.target;
    if (el.matches('[data-mx-pickup]')) { co.pickup = el.value; var h = document.getElementById('co-pickup-hint'); if (h) h.innerHTML = pickupHint(); if (co.ctx) co.ctx.sync(); }
    else if (el.matches('[data-mx-layby]')) { co.layby = el.checked; if (co.ctx) co.ctx.sync(); }
    else if (el.matches('[data-mx-cx]')) {
      var list = Z().complaints();
      list.forEach(function (c) { if (c.ref === el.getAttribute('data-mx-cx')) c.status = el.value; });
      set('complaints', list); staffLog('complaint ' + el.value, el.getAttribute('data-mx-cx'));
    } else if (el.matches('[data-mx-review-photos]')) {
      var files = Array.prototype.slice.call(el.files || [], 0, 3), box = document.getElementById('rev-photos-preview');
      var generation = ++photoGeneration;
      photosLoading = true; pendingPhotos = null;
      if (box) { box.setAttribute('aria-busy', 'true'); box.textContent = 'Preparing photos…'; }
      Promise.all(files.map(function (f) { return shrink(f).catch(function () { return null; }); })).then(function (out) {
        if (generation !== photoGeneration || !el.isConnected) return;
        photosLoading = false;
        pendingPhotos = out.filter(Boolean);
        if (box) { box.removeAttribute('aria-busy'); box.innerHTML = pendingPhotos.map(function (src, i) { return '<img src="' + src + '" alt="Your photo ' + (i + 1) + '" width="72" height="72">'; }).join(''); }
        if (out.length !== pendingPhotos.length) Z().toast('Some photos couldn\'t be added. Use JPEG, PNG or WebP.', 'warn');
      });
    } else if (el.matches('[data-mx-csv]')) {
      var file = el.files && el.files[0], outBox = document.getElementById('sc-csv-out');
      if (!file) return;
      if (file.size > 500000) { outBox.innerHTML = '<p class="form-status is-error">Keep the file under 500 KB (about 2,000 rows); split bigger lists.</p>'; return; }
      file.text().then(function (text) {
        var res = importCSV(el.getAttribute('data-mx-csv'), text);
        outBox.innerHTML = '<p class="form-status' + (res.failed.length ? ' is-error' : '') + '">' + res.added.length + ' added' + (res.failed.length ? ', ' + res.failed.length + ' need fixing:' : '.') + '</p>' +
          (res.failed.length ? '<ul>' + res.failed.slice(0, 20).map(function (f) { return '<li>' + esc(f) + '</li>'; }).join('') + '</ul>' : '') +
          (res.added.length ? '<p class="pmeta">They\'re in your products below, waiting for review.</p>' : '');
        el.value = '';
      });
    }
  });
  document.addEventListener('submit', function (e) {
    var f = e.target;
    if (f.matches('[data-mx-clear-device]')) {
      e.preventDefault();
      if (!f.querySelector('#device-confirm').checked) return;
      var removed = deviceKeys.map(function (key) { return Z().store.remove(key); }).every(Boolean);
      try { sessionStorage.removeItem('zs-location'); sessionStorage.removeItem('zs-auth-session'); } catch (err) { removed = false; }
      if (!removed) { f.querySelector('[role="status"]').textContent = 'Browser storage is blocked. Clear this website’s data in your browser settings to finish.'; return; }
      location.reload();
    } else if (f.matches('[data-mx-ask]')) {
      e.preventDefault();
      var q = Z().cleanText(f.querySelector('input').value, 300);
      if (q.length < 10) { Z().toast('Write your question in a few more words.', 'warn'); return; }
      var all = get('questions', {}), id = f.getAttribute('data-mx-ask');
      all[id] = (all[id] || []).concat([{ q: q, a: '', date: Z().today, mine: true }]); set('questions', all);
      Z().toast('Question sent to the seller.', 'success'); Z().route();
    } else if (f.matches('[data-mx-answer]')) {
      e.preventDefault();
      var parts = f.getAttribute('data-mx-answer').split('|'), pid = parts[0], text = parts.slice(1).join('|');
      var ans = Z().cleanText(f.querySelector('input').value, 1000), store = get('questions', {}), p = Z().product(pid);
      if (!ans) return;
      var mineQ = (store[pid] || []).filter(function (x) { return x.q === text; })[0];
      if (mineQ) mineQ.a = ans;
      else if (p) { (p.questions || []).forEach(function (x) { if (x.q === text) x.a = ans; }); store[pid] = (store[pid] || []).concat((p.questions || []).filter(function (x) { return x.q === text; })); p.questions = (p.questions || []).filter(function (x) { return x.q !== text; }); }
      set('questions', store); Z().toast('Answer published.', 'success'); Z().route();
    }
  });

  /* ---------- Installable app and offline browsing ---------- */
  function connectionStatus() {
    var note = document.getElementById('connection-status');
    if (!note) {
      note = document.createElement('div'); note.id = 'connection-status';
      note.className = 'connection-status'; note.setAttribute('role', 'status');
      document.body.appendChild(note);
    }
    note.hidden = navigator.onLine !== false;
    note.textContent = note.hidden ? '' : 'You’re offline. Saved pages may show older prices and stock. Reconnect and confirm availability before ordering.';
  }
  window.addEventListener('offline', connectionStatus);
  window.addEventListener('online', connectionStatus);
  document.addEventListener('DOMContentLoaded', connectionStatus);
  var installPrompt = null;
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () { /* offline support is optional */ }); });
  }
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault(); installPrompt = e;
    Array.prototype.forEach.call(document.querySelectorAll('[data-install-app]'), function (b) { b.hidden = false; });
  });
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-install-app]');
    if (!b || !installPrompt) return;
    installPrompt.prompt();
    installPrompt.userChoice.then(function () { installPrompt = null; b.hidden = true; });
  });

  /* ---------- Languages ---------- */
  // Elements marked data-i18n="key" take their text from window.ZS_LANG[language][key]. The
  // menu shows only when settings.languages lists two or more with a translation loaded.
  function applyLanguage(id) {
    var dict = (window.ZS_LANG || {})[id];
    Array.prototype.forEach.call(document.querySelectorAll('[data-i18n]'), function (el) {
      if (!el.hasAttribute('data-i18n-en')) el.setAttribute('data-i18n-en', el.textContent);
      var key = el.getAttribute('data-i18n');
      el.textContent = dict && dict[key] ? dict[key] : el.getAttribute('data-i18n-en');
    });
    document.documentElement.lang = dict ? id : 'en';
  }
  document.addEventListener('DOMContentLoaded', function () {
    var cat = window.ZS_CATALOGUE || {}, langs = ((cat.settings || {}).languages || []).filter(function (l) { return l[0] === 'en' || (window.ZS_LANG || {})[l[0]]; });
    var slot = document.querySelector('[data-lang-slot]');
    if (langs.length > 1 && slot) {
      var cur = '';
      try { cur = localStorage.getItem('zs-lang') || ''; } catch (e) { /* blocked */ }
      slot.innerHTML = '<label class="visually-hidden" for="lang-pick">Language</label><select id="lang-pick">' + langs.map(function (l) { return '<option value="' + l[0] + '"' + (l[0] === cur ? ' selected' : '') + '>' + l[1] + '</option>'; }).join('') + '</select>';
      slot.hidden = false;
      document.getElementById('lang-pick').addEventListener('change', function () { try { localStorage.setItem('zs-lang', this.value); } catch (e) { /* blocked */ } applyLanguage(this.value); });
      if (cur && cur !== 'en') applyLanguage(cur);
    }
  });
})();
