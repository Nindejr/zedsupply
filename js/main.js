/* Zed Supply — storefront script. No libraries.
   The static page content works without this file; this adds the store:
   cart, wishlist, search, product pages, account, orders, seller centre.

   PROTOTYPE NOTE: accounts, orders, reviews and seller promotions are saved in
   this browser only (localStorage). Real shared accounts arrive in Phase 2.

   DEMO MODE: ?demo=1 loads js/catalogue-sample.js (sample sellers, products,
   reviews, promotions) for this browser tab; ?demo=0 turns it off. The live store
   never downloads the demo file. */
(function () {
  'use strict';

  // Clickjacking guard: browsers ignore X-Frame-Options and frame-ancestors in a <meta> tag and GitHub Pages
  // can't send headers, so if another website shows this page inside a frame, swap it for a link out.
  var framed;
  try { framed = window.top !== window.self && window.top.location.origin !== location.origin; } catch (e) { framed = true; }
  if (framed) {
    var out = document.createElement('a');
    out.href = location.href; out.target = '_top'; out.rel = 'noopener noreferrer';
    out.textContent = 'Open Zed Supply in its own window';
    document.body.textContent = '';
    document.body.appendChild(out);
    return;
  }

  var demoOn = false;
  try {
    if (/[?&]demo=1\b/.test(location.search)) sessionStorage.setItem('zs-demo', '1');
    if (/[?&]demo=0\b/.test(location.search)) sessionStorage.removeItem('zs-demo');
    demoOn = sessionStorage.getItem('zs-demo') === '1';
  } catch (e) { demoOn = /[?&]demo=1\b/.test(location.search); }
  if (demoOn && !window.ZS_SAMPLE) {
    var demoScript = document.createElement('script');
    demoScript.src = 'js/catalogue-sample.js';
    demoScript.onload = demoScript.onerror = start;
    document.head.appendChild(demoScript);
  } else start();

  function start() {
  var root = document.documentElement;
  root.classList.remove('no-js');
  root.classList.add('js');

  var D = window.ZS_CATALOGUE || { settings: {}, departments: [], products: [], sellers: [], brands: [], promotions: [], seasons: [], vouchers: [], banners: [] };
  var S = D.settings || {};
  var DEMO = demoOn && !!window.ZS_SAMPLE;
  if (DEMO) {
    var X = window.ZS_SAMPLE;
    ['sellers', 'brands', 'products', 'promotions', 'vouchers'].forEach(function (k) { D[k] = (D[k] || []).concat(X[k] || []); });
    D.banners = (D.banners || []).slice(0, 2).concat(X.banners || [], (D.banners || []).slice(2));
    if (!D.demoOrder) D.demoOrder = X.demoOrder;
    S.isSample = true;
  }
  var china = !!S.chinaOrdering;
  var onIndex = !!document.getElementById('view');
  var R = onIndex ? '#/' : 'index.html#/';   // prefix for store links
  if (DEMO) {
    var demoBar = document.createElement('div');
    demoBar.className = 'demo-bar';
    demoBar.setAttribute('role', 'note');
    demoBar.innerHTML = '<div class="container demo-bar__inner"><p><strong>Demo mode:</strong> sample sellers, products, prices and reviews for preview only.</p><a href="' + (location.pathname.split('/').pop() || 'index.html') + '?demo=0">Exit demo</a></div>';
    var skipEl = document.querySelector('.skip-link');
    if (skipEl) skipEl.parentNode.insertBefore(demoBar, skipEl.nextSibling);
  }
  var WA = 'https://wa.me/' + (S.whatsapp || '260979050042') + '?text=';

  /* ---------- Storage (falls back to memory when blocked) ---------- */
  var mem = {};
  var store = {
    get: function (k, def) {
      try { var v = localStorage.getItem('zs-' + k); if (v !== null) return JSON.parse(v); } catch (e) { /* blocked */ }
      return k in mem ? mem[k] : def;
    },
    set: function (k, v) {
      mem[k] = v;
      try { localStorage.setItem('zs-' + k, JSON.stringify(v)); } catch (e) { /* blocked: memory only */ }
    }
  };

  /* ---------- Small helpers ---------- */
  function $(sel, scope) { return (scope || document).querySelector(sel); }
  function $$(sel, scope) { return Array.prototype.slice.call((scope || document).querySelectorAll(sel)); }
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function kwacha(n) { return 'K' + Math.round(n).toLocaleString('en-US'); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  var now = new Date();
  var today = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
  function niceDate(iso) {
    var p = String(iso).split('-');
    if (p.length !== 3) return esc(iso);
    return Number(p[2]) + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(p[1]) - 1] + ' ' + p[0];
  }
  function byId(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }
  function dept(id) { return byId(D.departments, id) || { name: '', icon: '🛍️' }; }
  function seller(id) { return byId(D.sellers, id); }
  function brand(id) { return byId(D.brands, id); }
  function season(id) { return byId(D.seasons, id) || { name: '', colours: ['#0A2A66', '#0057AE'] }; }
  function icon(path, extra) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"' + (extra || '') + '>' + path + '</svg>';
  }
  var I = {
    heart: '<path d="M12 21s-7.5-4.6-9.5-9.3C1.2 8.6 3.3 5 6.8 5c2 0 3.4 1.1 4.2 2.4h2C13.8 6.1 15.2 5 17.2 5c3.5 0 5.6 3.6 4.3 6.7C19.5 16.4 12 21 12 21Z"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/>'
  };

  /* ---------- Zambia Independence celebration theme ----------
     On automatically each year between celebration.start and .end (month-day),
     off from 1 January. ?theme=zambia or ?theme=off previews it on any date. */
  var CEL = S.celebration || { enabled: true, start: '10-01', end: '12-31', independenceDay: '10-24', independenceYear: 1964 };
  var monthDay = pad(now.getMonth() + 1) + '-' + pad(now.getDate());
  var themeParam = (location.search.match(/[?&]theme=(zambia|off)\b/) || [])[1];
  var zambia = themeParam ? themeParam === 'zambia' : (CEL.enabled !== false && monthDay >= CEL.start && monthDay <= CEL.end);
  root.classList.toggle('theme-zambia', zambia);
  function independenceDeals() { return allPromos().some(function (pr) { return pr.season === 'independence' && promoStatus(pr) !== 'ended'; }); }
  function ordinal(n) { var s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
  var indYears = now.getFullYear() - (CEL.independenceYear || 1964);
  function celebrationCopy() {
    var parts = (CEL.independenceDay || '10-24').split('-'), day = new Date(now.getFullYear(), Number(parts[0]) - 1, Number(parts[1]));
    var days = Math.round((day - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
    if (days > 1) return { lead: days + ' days to Independence Day', line: 'Zambia celebrates ' + indYears + ' years of independence on 24 October.' };
    if (days === 1) return { lead: 'Tomorrow is Independence Day', line: 'Zambia celebrates ' + indYears + ' years of independence on 24 October.' };
    if (days === 0) return { lead: 'Happy ' + ordinal(indYears) + ' Independence Day, Zambia!', line: 'Celebrating ' + indYears + ' years since 24 October 1964.' };
    return { lead: 'Celebrating ' + indYears + ' years of independence', line: 'Thank you for shopping Zambian this festive season.' };
  }
  if (zambia) {
    var cc = celebrationCopy(), bar = document.createElement('div');
    bar.className = 'zm-bar';
    bar.setAttribute('role', 'note');
    bar.innerHTML = '<div class="container zm-bar__inner"><img class="zm-bar__flag" src="assets/brand/zambia-flag.svg" alt="Flag of Zambia" width="34" height="23">' +
      '<p><strong>' + esc(cc.lead) + '</strong> ' + esc(cc.line) + '</p>' +
      (independenceDeals() ? '<a href="' + R + 'promotions?season=independence">Independence deals</a>' : '<a href="' + R + 'departments">Shop local</a>') + '</div>';
    var skipLink = $('.skip-link');
    if (skipLink) skipLink.parentNode.insertBefore(bar, skipLink.nextSibling);
  }

  /* ---------- Products, prices and promotions ---------- */
  var products = D.products.filter(function (p) { return china || p.source !== 'china'; });
  var localProducts = products.filter(function (p) { return p.source !== 'china'; });
  function product(id) { return byId(D.products, id); }

  function allPromos() { return D.promotions.concat(store.get('promos', [])); }
  function promoStatus(pr) { return today < pr.starts ? 'upcoming' : (today > pr.ends ? 'ended' : 'live'); }
  function livePromoFor(p) {
    var best = null;
    allPromos().forEach(function (pr) {
      if (promoStatus(pr) === 'live' && pr.products.indexOf(p.id) !== -1 && (!best || pr.discount > best.discount)) best = pr;
    });
    return best;
  }
  function chinaCost(cny, kg, qty) {
    var item = cny * S.exchangeRate * qty;
    var ship = kg * qty * S.shippingPerKg;
    var charge = function (rule, base) { return rule.type === 'fixed' ? rule.value : base * rule.value / 100; };
    var clear = charge(S.clearance, item + ship);
    var fee = charge(S.fee, item + ship + clear);
    return { item: item, shipping: ship, clearance: clear, fee: fee, total: Math.ceil(item + ship + clear + fee) };
  }
  function priceOf(p) {
    if (p.source === 'china') return { now: chinaCost(p.priceCNY, p.weightKg, 1).total, was: 0, off: 0, promo: null };
    var base = p.priceZMW, promo = livePromoFor(p), nowP = base, was = p.wasZMW || 0;
    if (promo) { nowP = Math.round(base * (1 - promo.discount / 100)); was = Math.max(was, base); }
    return { now: nowP, was: was > nowP ? was : 0, off: was > nowP ? Math.round((1 - nowP / was) * 100) : 0, promo: promo };
  }
  function reviewsFor(p) { return (p.reviews || []).concat((store.get('reviews', {})[p.id]) || []); }
  function ratingOf(p) {
    var r = reviewsFor(p);
    if (!r.length) return null;
    return { avg: r.reduce(function (a, b) { return a + Number(b.rating); }, 0) / r.length, count: r.length };
  }
  function searchText(p) {
    var b = brand(p.brand), s = seller(p.seller);
    return [p.title, p.tags, dept(p.category).name, b ? b.name : '', s ? s.name : ''].join(' ').toLowerCase();
  }

  /* ---------- Cart, wishlist, account state ---------- */
  function cart() { return store.get('cart', []); }
  function setCart(c) { store.set('cart', c); updateCounts(); }
  function wish() { return store.get('wish', []); }
  function isLiked(id) { return wish().indexOf(id) !== -1; }
  function user() { return store.get('user', null); }
  function addToCart(id, qty) {
    var c = cart(), line = null;
    for (var i = 0; i < c.length; i++) if (c[i].id === id) line = c[i];
    if (line) line.qty = Math.min(99, line.qty + qty); else c.push({ id: id, qty: qty });
    setCart(c);
  }
  function toggleLike(id) {
    var w = wish(), i = w.indexOf(id);
    if (i === -1) w.push(id); else w.splice(i, 1);
    store.set('wish', w);
    updateCounts();
    return i === -1;
  }
  function addRecent(id) {
    var r = store.get('recent', []).filter(function (x) { return x !== id; });
    r.unshift(id);
    store.set('recent', r.slice(0, 12));
  }

  /* ---------- Delivery location ----------
     { town, area, landmark }. Kept for this browser tab (sessionStorage) unless the
     customer ticks "Remember on this device" (localStorage). Never sent anywhere
     except inside WhatsApp messages the customer chooses to send. No GPS. */
  var loc = readLoc();
  function cleanText(v, max) { return String(v || '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max); }
  function readLoc() {
    var l = null;
    try { var v = localStorage.getItem('zs-location'); if (v) { l = JSON.parse(v); l.remember = true; } } catch (e) { /* blocked */ }
    if (!l) { try { var t = sessionStorage.getItem('zs-location'); if (t) l = JSON.parse(t); } catch (e) { /* blocked */ } }
    return l && l.town ? l : (mem.location || null);
  }
  function locShort() { return loc ? (loc.area ? loc.area + ', ' : '') + loc.town : ''; }
  function locFull() { return loc ? locShort() + (loc.landmark ? ' (' + loc.landmark + ')' : '') : ''; }
  function saveLoc(l) {
    loc = l && l.town ? { town: l.town, area: l.area || '', landmark: l.landmark || '', remember: !!l.remember } : null;
    mem.location = loc;
    try { localStorage.removeItem('zs-location'); } catch (e) { /* blocked */ }
    try { sessionStorage.removeItem('zs-location'); } catch (e) { /* blocked */ }
    if (loc) {
      var data = JSON.stringify({ town: loc.town, area: loc.area, landmark: loc.landmark });
      try { (loc.remember ? localStorage : sessionStorage).setItem('zs-location', data); } catch (e) { /* memory only */ }
    }
    refreshLoc();
  }
  function waUrl(message) {
    if (loc) message += '\nDelivery location: ' + locFull();
    return WA + encodeURIComponent(message);
  }
  function syncWa(scope) {
    $$('[data-wa-message]', scope).forEach(function (a) { a.href = waUrl(a.getAttribute('data-wa-message')); });
  }
  function locSummaryHTML() {
    return loc ? '<strong>' + esc(locShort()) + '</strong>' + (loc.landmark ? '<br><span class="pmeta">' + esc(loc.landmark) + '</span>' : '')
      : '<span class="pstock pstock--low">Not set yet. Add it so we can confirm delivery to your area.</span>';
  }
  function refreshLoc() {
    $$('[data-location-label]').forEach(function (el) { el.textContent = loc ? 'Deliver to: ' + locShort() : 'Deliver to: set location'; });
    $$('[data-loc-summary]').forEach(function (el) { el.innerHTML = locSummaryHTML(); });
    // Pre-fill the help centre contact form, unless the customer has typed their own
    var cf = $('#contact-location');
    if (cf && (!cf.value || cf.getAttribute('data-auto'))) { cf.value = locFull(); cf.setAttribute('data-auto', '1'); }
    syncWa(document);
  }
  var cfField = $('#contact-location');
  if (cfField) cfField.addEventListener('input', function () { cfField.removeAttribute('data-auto'); });

  /* ---------- Header: counts, greeting, suggestions ---------- */
  function updateCounts() {
    var n = cart().reduce(function (a, l) { return a + l.qty; }, 0), w = wish().length;
    $$('[data-count="cart"]').forEach(function (el) { el.textContent = n; el.toggleAttribute('data-zero', n === 0); });
    $$('[data-count="wish"]').forEach(function (el) { el.textContent = w; el.toggleAttribute('data-zero', w === 0); });
    $$('a[data-label="Cart"]').forEach(function (a) { a.setAttribute('aria-label', 'Cart, ' + n + (n === 1 ? ' item' : ' items')); });
    $$('a[data-label="Wishlist"]').forEach(function (a) { a.setAttribute('aria-label', 'Wishlist, ' + w + (w === 1 ? ' item' : ' items')); });
    var u = user();
    $$('[data-greet]').forEach(function (el) { el.textContent = u ? 'Hello, ' + u.name.split(' ')[0] : 'Hello, sign in'; });
  }

  var suggest = $('#search-suggest');
  if (suggest) {
    var seen = {}, opts = '';
    products.forEach(function (p) { seen[p.title] = 1; });
    D.brands.forEach(function (b) { seen[b.name] = 1; });
    D.sellers.forEach(function (s) { seen[s.name] = 1; });
    D.departments.forEach(function (d) { seen[d.name] = 1; });
    Object.keys(seen).forEach(function (k) { opts += '<option value="' + esc(k) + '"></option>'; });
    suggest.innerHTML = opts;
  }

  // Search: on the store page, route without reloading; elsewhere the form submits to index.html?q=
  $$('form.search').forEach(function (f) {
    f.addEventListener('submit', function (e) {
      if (!onIndex) return;
      e.preventDefault();
      var q = f.q.value.trim(), dp = f.dept ? f.dept.value : '';
      location.hash = '#/search?q=' + encodeURIComponent(q) + (dp ? '&dept=' + dp : '');
    });
  });

  /* ---------- Dialogs: departments drawer and delivery location ---------- */
  function openDialog(d) { if (!d) return; if (d.showModal) d.showModal(); else d.setAttribute('open', ''); }
  function closeDialog(d) { if (!d) return; if (d.close) d.close(); else d.removeAttribute('open'); }
  document.addEventListener('click', function (e) {
    if (e.target.closest('[data-open-drawer]')) openDialog($('#drawer'));
    if (e.target.closest('[data-open-location]')) openLocation();
    var dlg = e.target.closest('dialog');
    if (e.target.closest('[data-close-dialog]') || (dlg && e.target === dlg) || (dlg && e.target.closest('a'))) closeDialog(dlg);
  });

  var locForm = $('#location-form');
  function openLocation() {
    if (!locForm) return;
    locForm.town.value = loc ? loc.town : '';
    locForm.area.value = loc ? loc.area : '';
    locForm.landmark.value = loc ? loc.landmark : '';
    locForm.remember.checked = !!(loc && loc.remember);
    $('#loc-clear').hidden = !loc;
    openDialog($('#location-dialog'));
  }
  if (locForm) {
    locForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var town = cleanText(locForm.town.value, 60);
      if (!town) { locForm.town.focus(); return; }
      saveLoc({ town: town, area: cleanText(locForm.area.value, 60), landmark: cleanText(locForm.landmark.value, 100), remember: locForm.remember.checked });
      closeDialog($('#location-dialog'));
      toast('Delivering to ' + esc(locShort()));
    });
    $('#loc-clear').addEventListener('click', function () {
      saveLoc(null);
      closeDialog($('#location-dialog'));
      toast('Delivery location cleared');
    });
  }

  /* ---------- Data saver ---------- */
  // Swap 3D category and store artwork for the tiny line icons
  function saverArt(scope) {
    if (!root.classList.contains('data-saver')) return;
    $$('img[data-fallback]', scope).forEach(function (im) { im.src = im.getAttribute('data-fallback'); im.removeAttribute('data-fallback'); });
  }
  var saver = store.get('datasaver', false);
  root.classList.toggle('data-saver', !!saver);
  $$('[data-saver-toggle]').forEach(function (cb) {
    cb.checked = !!saver;
    cb.addEventListener('change', function () {
      store.set('datasaver', cb.checked);
      root.classList.toggle('data-saver', cb.checked);
      saverArt(document);
      document.dispatchEvent(new Event('zs:datasaver'));
      toast(cb.checked ? 'Data saver on: photos and banner images hidden' : 'Data saver off');
    });
  });

  /* ---------- Toast ---------- */
  var toastEl = $('#toast'), toastTimer;
  function toast(html) {
    if (!toastEl) return;
    toastEl.innerHTML = html;
    toastEl.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('is-on'); }, 3200);
  }

  // Save to localStorage and report whether it actually fitted (images can exceed the quota)
  function trySave(k, v) {
    try { localStorage.setItem('zs-' + k, JSON.stringify(v)); mem[k] = v; return true; } catch (e) { return false; }
  }

  // Shrink an uploaded image to a banner (cover crop) and return a JPEG data URL
  function bannerFromFile(file, w, h, done) {
    if (!file) return done('');
    if (!/^image\//.test(file.type) || file.size > 10 * 1024 * 1024) return done(null);
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        var c = document.createElement('canvas'); c.width = w; c.height = h;
        var scale = Math.max(w / img.width, h / img.height), sw = w / scale, sh = h / scale;
        c.getContext('2d').drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, 0, 0, w, h);
        done(c.toDataURL('image/jpeg', 0.8));
      };
      img.onerror = function () { done(null); };
      img.src = reader.result;
    };
    reader.onerror = function () { done(null); };
    reader.readAsDataURL(file);
  }

  /* ---------- Payment methods (mobile money) ---------- */
  var payChoice = '';   // the customer's preferred method for this cart; kept in memory only
  function payMethods() { return (S.paymentMethods || []).filter(function (m) { return m.enabled !== false; }); }
  function payChipsHTML() {
    return '<ul class="paychips" aria-label="Mobile money we accept">' + payMethods().map(function (m) {
      return '<li class="paychip"><span class="paychip__dot" style="--pay:' + esc(m.colour || '#4CC21A') + '" aria-hidden="true"></span>' + esc(m.name) + '</li>';
    }).join('') + '</ul>';
  }
  function payChoiceHTML() {
    var list = payMethods();
    if (!list.length) return '';
    var opt = function (value, label, sub, colour) {
      return '<div class="pay-option"><input type="radio" name="co-pay" id="co-pay-' + (value ? esc(value).replace(/\W+/g, '-').toLowerCase() : 'later') + '" value="' + esc(value) + '"' + (payChoice === value ? ' checked' : '') + '>' +
        '<label for="co-pay-' + (value ? esc(value).replace(/\W+/g, '-').toLowerCase() : 'later') + '">' + (colour ? '<span class="paychip__dot" style="--pay:' + esc(colour) + '" aria-hidden="true"></span>' : '') + esc(label) + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</label></div>';
    };
    return '<fieldset class="field pay-choice"><legend>How would you like to pay?</legend>' +
      list.map(function (m) { return opt(m.name, m.name, m.kind, m.colour); }).join('') +
      opt('', 'Decide on WhatsApp', '', '') +
      '</fieldset>';
  }
  // Fill every "we accept" spot on the page (footer, help centre)
  $$('[data-pay-methods]').forEach(function (el) { if (payMethods().length) el.innerHTML = payChipsHTML(); });

  /* ---------- Rendering pieces ---------- */
  function media(p) {
    return '<span class="pmedia__emoji" aria-hidden="true">' + dept(p.category).icon + '</span>' +
      (p.image && !root.classList.contains('data-saver') ? '<img src="' + esc(p.image) + '" alt="' + esc((p.sample ? 'Illustrative sample: ' : '') + (p.alt || p.title)) + '" width="600" height="600" loading="lazy" decoding="async">' : '');
  }
  function starString(n) { var s = ''; for (var i = 1; i <= 5; i++) s += i <= n ? '★' : '☆'; return s; }
  function starsHTML(p) {
    var r = ratingOf(p);
    if (!r) return '';
    return '<p class="stars"><span class="stars__icons" aria-hidden="true">' + starString(Math.round(r.avg)) + '</span><span aria-hidden="true">(' + r.count + ')</span>' +
      '<span class="visually-hidden">Rated ' + r.avg.toFixed(1) + ' out of 5 from ' + r.count + (r.count === 1 ? ' review' : ' reviews') + '</span></p>';
  }
  function priceHTML(pr) {
    return '<p class="price"><span class="price__now"><span class="visually-hidden">Price </span>' + kwacha(pr.now) + '</span>' +
      (pr.was ? '<span class="price__was"><span class="visually-hidden">was </span>' + kwacha(pr.was) + '</span>' : '') + '</p>';
  }
  function stockHTML(p) {
    if (p.source === 'china') return '<p class="pstock">' + esc(p.shipping) + '</p>';
    if (p.stock === 'low') return '<p class="pstock pstock--low">Only a few left</p>';
    if (p.stock === 'request') return '<p class="pstock pstock--low">Sourced on request</p>';
    return '<p class="pstock">In stock</p>';
  }
  function likeBtn(p) {
    return '<button class="like" type="button" data-like="' + esc(p.id) + '" aria-pressed="' + isLiked(p.id) + '" aria-label="Save ' + esc(p.title) + ' to wishlist">' + icon(I.heart) + '</button>';
  }
  function card(p) {
    var pr = priceOf(p), s = seller(p.seller);
    return '<li><article class="pcard">' +
      '<div class="pflags">' + (pr.off ? '<span class="flag-sale">-' + pr.off + '%</span>' : '') + (pr.promo ? '<span class="badge">Promotion</span>' : '') + (p.sample ? '<span class="tag-sample">Sample</span>' : '') + '</div>' +
      likeBtn(p) +
      '<a class="pmedia" href="' + R + 'product/' + esc(p.id) + '" tabindex="-1" aria-hidden="true">' + media(p) + '</a>' +
      '<div class="pbody">' +
        '<a class="ptitle" href="' + R + 'product/' + esc(p.id) + '">' + esc(p.title) + '</a>' +
        '<p class="pmeta">' + (s ? 'Sold by ' + esc(s.name) : (p.source === 'china' ? 'Shop the World' : esc(dept(p.category).name))) + '</p>' +
        starsHTML(p) + priceHTML(pr) + stockHTML(p) +
        '<button class="btn btn--primary btn--sm" type="button" data-add="' + esc(p.id) + '">Add to cart<span class="visually-hidden">: ' + esc(p.title) + '</span></button>' +
      '</div></article></li>';
  }
  function cards(list) { return list.map(card).join(''); }
  function promoCard(pr, level) {
    var h = level === 2 ? 'h2' : 'h3';
    var s = seller(pr.seller), se = season(pr.season), st = promoStatus(pr);
    var label = st === 'live' ? 'Live now · ends ' + niceDate(pr.ends) : (st === 'upcoming' ? 'Starts ' + niceDate(pr.starts) : 'Ended');
    var img = pr.image && !root.classList.contains('data-saver');
    return '<li><a class="promo' + (img ? ' promo--img' : '') + '" href="' + R + 'promo/' + esc(pr.id) + '" style="--promo-a:' + se.colours[0] + ';--promo-b:' + se.colours[1] + (img ? ';--promo-img:url(\'' + esc(pr.image) + '\')' : '') + '">' +
      '<span class="promo__status' + (st === 'live' ? ' promo__status--live' : '') + '">' + label + '</span>' +
      '<span class="promo__off">' + (Number(pr.discount) || 0) + '% off</span>' +
      '<' + h + '>' + esc(pr.title) + '</' + h + '>' +
      '<p>' + esc(se.name) + (s ? ' · ' + esc(s.name) : '') + (pr.sample ? ' · Sample' : '') + (pr.demo ? ' · Demo' : '') + '</p>' +
      '<p class="promo__cta">View promotion →</p></a></li>';
  }
  function sortPromos(list) {
    var rank = { live: 0, upcoming: 1, ended: 2 };
    return list.slice().sort(function (a, b) { return rank[promoStatus(a)] - rank[promoStatus(b)] || (a.starts < b.starts ? -1 : 1); });
  }
  function brandCard(b) {
    var n = products.filter(function (p) { return p.brand === b.id; }).length;
    return '<li><a class="brand" href="' + R + 'brand/' + esc(b.id) + '" style="--brand-a:' + b.colours[0] + ';--brand-b:' + b.colours[1] + '">' + identityArt(b) + '<strong>' + esc(b.name) + '</strong><span>' + esc(b.tagline) + '</span><span>' + n + (n === 1 ? ' product' : ' products') + '</span></a></li>';
  }
  function identityArt(entity) {
    var symbols = { 'brand-a': 'tech', 'brand-b': 'solar', 'brand-c': 'home', 'brand-d': 'hardware', 'store-a': 'office', 'store-b': 'solar', 'store-c': 'fashion' };
    var category = symbols[entity.id];
    return '<img class="brand__logo" src="' + (category ? 'assets/categories-3d/' + category + '.webp' : 'assets/icons/marketplace.svg') + '" data-fallback="assets/icons/' + (category || 'marketplace') + '.svg" alt="" width="96" height="96" loading="lazy" decoding="async">';
  }
  function departmentArtwork(d) {
    return '<img src="assets/categories-3d/' + d.id + '.webp" data-fallback="assets/icons/' + d.id + '.svg" alt="" width="112" height="112" loading="lazy" decoding="async">';
  }
  function verifiedHTML(s) { return s && s.verified ? ' <span class="verified">' + icon(I.shield) + 'Verified seller</span>' : ''; }

  /* ---------- Delegated actions: add to cart, like, quantities ---------- */
  document.addEventListener('click', function (e) {
    var add = e.target.closest('[data-add]');
    if (add) {
      var id = add.getAttribute('data-add'), qtyEl = add.getAttribute('data-qty-from') ? $(add.getAttribute('data-qty-from')) : null;
      var p = product(id);
      addToCart(id, qtyEl ? Math.max(1, parseInt(qtyEl.value, 10) || 1) : 1);
      toast('Added to cart: ' + esc(p ? p.title : '') + ' <a href="' + R + 'cart">View cart</a>');
      return;
    }
    var like = e.target.closest('[data-like]');
    if (like) {
      var lid = like.getAttribute('data-like'), on = toggleLike(lid);
      $$('[data-like="' + lid + '"]').forEach(function (b) { b.setAttribute('aria-pressed', String(on)); });
      toast(on ? 'Saved to your wishlist <a href="' + R + 'wishlist">View</a>' : 'Removed from your wishlist');
      if (onIndex && location.hash.indexOf('#/wishlist') === 0) route();
      return;
    }
    var step = e.target.closest('[data-step]');
    if (step) {
      var input = $(step.getAttribute('data-target'));
      input.value = Math.min(99, Math.max(1, (parseInt(input.value, 10) || 1) + Number(step.getAttribute('data-step'))));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    if (e.target.closest('[data-back-top]')) { window.scrollTo(0, 0); var skip = $('.skip-link'); if (skip) skip.focus(); }
  });

  /* ---------- Card-number guard (PCI DSS) ----------
     Zed Supply never accepts card details through this site, email or WhatsApp.
     If anything typed into a form looks like a real payment card number
     (13–19 digits that pass the Luhn check), the message is not sent. */
  function luhn(d) {
    var sum = 0, alt = false;
    for (var i = d.length - 1; i >= 0; i--) {
      var n = d.charCodeAt(i) - 48;
      if (alt) { n *= 2; if (n > 9) n -= 9; }
      sum += n; alt = !alt;
    }
    return sum % 10 === 0;
  }
  function hasCardNumber(text) {
    var runs = String(text || '').match(/\d(?:[ -]?\d){12,18}/g) || [];
    return runs.some(function (r) { var d = r.replace(/\D/g, ''); return d.length >= 13 && d.length <= 19 && !/^(\d)\1+$/.test(d) && luhn(d); });
  }
  var CARD_WARNING = 'For your security, please remove the card number. Zed Supply never asks for card details on this website, by email or on WhatsApp.';
  function cardWarning(form) {
    var st = form && $('.form-status', form);
    if (st) { st.className = 'form-status is-error'; st.textContent = CARD_WARNING; st.focus(); } else toast(esc(CARD_WARNING));
  }
  function formHasCard(form) {
    return $$('input:not([type=hidden]):not([type=checkbox]):not([type=file]), textarea', form).some(function (f) { return hasCardNumber(f.value); });
  }
  // Capture phase: runs before every other submit handler on the page
  document.addEventListener('submit', function (e) {
    if (formHasCard(e.target)) { e.preventDefault(); e.stopImmediatePropagation(); cardWarning(e.target); }
  }, true);

  /* ---------- Google Analytics 4: custom events ----------
     The gtag.js snippet is in the <head> of every page. These events use one
     document-level listener, so links added later (store views, banners) are
     covered too. Addresses are sent without their ?query part, so customers'
     WhatsApp messages, names or locations never reach Google Analytics.
     The same call passes form_submit, whatsapp_click and phone_click to the
     advertising tags in js/ad-tags.js, which send them only after consent. */
  function track(name, params) {
    if (typeof window.gtag === 'function') window.gtag('event', name, params || {});
    if (window.ZSAds) window.ZSAds.track(name, params || {});
  }
  function cleanUrl(href) {
    try { var u = new URL(href, location.href); return u.protocol === 'tel:' || u.protocol === 'mailto:' ? u.protocol + u.pathname : u.origin + u.pathname; } catch (e) { return String(href).split('?')[0]; }
  }
  function linkText(a) { return (a.textContent || a.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 100); }
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    var href = a.getAttribute('href'), url;
    try { url = new URL(href, location.href); } catch (err) { return; }
    var base = { link_url: cleanUrl(url.href), link_text: linkText(a) };
    if (url.protocol === 'tel:') return track('phone_click', base);
    if (url.protocol === 'mailto:') return track('email_click', base);
    if (/(^|\.)wa\.me$|(^|\.)whatsapp\.com$/.test(url.hostname)) track('whatsapp_click', base);
    if (/\.pdf$/i.test(url.pathname) || a.hasAttribute('download')) {
      track('profile_download', { file_name: decodeURIComponent(url.pathname.split('/').pop()), link_url: cleanUrl(url.href), link_text: base.link_text });
    }
    // Leaving the site: any http(s) link to another host (file:// previews have no host)
    if (/^https?:$/.test(url.protocol) && url.hostname && url.hostname !== location.hostname) {
      track('outbound_click', { link_url: cleanUrl(url.href), link_domain: url.hostname, link_text: base.link_text });
    }
  }, true);

  /* ---------- Cookie consent (Google Consent Mode v2) ----------
     Analytics and ad storage start as 'denied' (set in the <head> snippet), and
     the advertising tags in js/ad-tags.js don't load at all until Accept.
     Accept updates them to 'granted'; the choice is kept in localStorage
     ('zs-consent') and can be changed from "Cookie settings" in the footer. */
  function consentChoice() { try { return localStorage.getItem('zs-consent'); } catch (e) { return null; } }
  function setConsent(choice) {
    try { localStorage.setItem('zs-consent', choice); } catch (e) { /* storage blocked: applies to this page only */ }
    var v = choice === 'granted' ? 'granted' : 'denied';
    if (typeof window.gtag === 'function') window.gtag('consent', 'update', { analytics_storage: v, ad_storage: v });
    // Microsoft Clarity: the <head> sets its starting state; this applies a new choice
    if (typeof window.clarity === 'function') window.clarity('consentv2', { ad_Storage: v, analytics_Storage: v });
    // Meta Pixel, LinkedIn Insight Tag and Google Ads (js/ad-tags.js) load only on 'granted'
    if (window.ZSAds) window.ZSAds.consent(v);
    if (v === 'denied') clearAnalyticsCookies();
  }
  // The tags stop using their cookies once consent is denied, but don't delete them; do that here:
  // Google Analytics (_ga), Meta (_fbp, _fbc), Google Ads (_gcl_) and LinkedIn (li_, _li_) cookies on this site
  function clearAnalyticsCookies() {
    var parts = location.hostname.split('.'), domains = [''];
    for (var i = 0; i < parts.length - 1; i++) domains.push('; domain=.' + parts.slice(i).join('.'));
    document.cookie.split(';').forEach(function (c) {
      var name = c.split('=')[0].trim();
      if (/^_ga(_|$)|^_fb[pc]$|^_gcl_|^_?li_/.test(name)) domains.forEach(function (d) { document.cookie = name + '=; Max-Age=0; path=/' + d; });
    });
  }

  // Keep personal details out of Clarity session recordings: forms, the signed-in
  // name, delivery location and order details are masked.
  function maskPersonal(scope) {
    $$('form, [data-greet], [data-location-label], [data-loc-summary], .deliver-box, .summary, .orders, .timeline', scope || document)
      .forEach(function (el) { el.setAttribute('data-clarity-mask', 'true'); });
  }
  maskPersonal(document);
  function showConsent() {
    var old = $('.consent');
    if (old) old.remove();
    var box = document.createElement('section');
    box.className = 'consent';
    box.setAttribute('aria-labelledby', 'consent-title');
    box.innerHTML = '<div class="consent__inner"><div class="consent__text"><p id="consent-title" class="consent__title">Cookies on Zed Supply</p>' +
      '<p>We\'d like to use cookies from Google Analytics and Microsoft Clarity to understand how people use our site, and from Meta, LinkedIn and Google Ads to measure and improve our adverts. They stay off unless you accept. ' +
      '<a href="privacy.html#cookies">Read our privacy policy</a></p></div>' +
      '<div class="consent__actions"><button class="btn btn--primary btn--sm" type="button" data-consent="granted">Accept</button>' +
      '<button class="btn btn--secondary btn--sm" type="button" data-consent="denied">Decline</button></div></div>';
    var skip = $('.skip-link');
    if (skip) skip.parentNode.insertBefore(box, skip.nextSibling); else document.body.insertBefore(box, document.body.firstChild);
  }
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-consent]');
    if (btn) {
      setConsent(btn.getAttribute('data-consent'));
      var box = $('.consent');
      if (box) box.remove();
      toast(btn.getAttribute('data-consent') === 'granted' ? 'Thanks. Analytics and advertising cookies are on.' : 'Analytics and advertising cookies are off.');
      return;
    }
    if (e.target.closest('[data-cookie-settings]')) showConsent();
  });
  if (!consentChoice()) showConsent();

  /* ---------- Formspree forms (seller application, contact) ---------- */
  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (!form.classList.contains('js-formspree') || !window.fetch) return;
    e.preventDefault();
    var status = $('.form-status', form), btn = $('button[type="submit"]', form), label = btn.textContent;
    var show = function (type, msg) { status.className = 'form-status is-' + type; status.textContent = msg; status.focus(); };
    if (form.getAttribute('action').indexOf('FORMSPREE_ENDPOINT_HERE') !== -1) {
      show('error', 'This form is not connected yet. Please contact us on WhatsApp for now.');
      return;
    }
    btn.disabled = true; btn.textContent = 'Sending…';
    fetch(form.action, { method: 'POST', body: new FormData(form), headers: { Accept: 'application/json' } })
      .then(function (res) { if (!res.ok) throw new Error('Request failed'); form.reset(); show('success', form.getAttribute('data-success') || 'Thank you. We will get back to you soon.'); if (form.id === 'quote') track('form_submit', { form_id: 'contact', form_name: 'Help centre contact form' }); })
      .catch(function () { show('error', 'Sorry, this could not be sent. Please try again or contact us on WhatsApp.'); })
      .then(function () { btn.disabled = false; btn.textContent = label; });
  });

  /* ---------- Request form (home) ---------- */
  var reqForm = $('#request-form');
  if (reqForm) reqForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var what = $('#req-what').value.trim(), budget = $('#req-budget').value.trim();
    if (!what) { $('#req-what').focus(); return; }
    track('whatsapp_click', { link_url: WA.split('?')[0], link_text: 'Request form: Send request on WhatsApp' });
    window.open(waUrl('Hi Zed Supply, please source this for me:\n' + what + (budget ? '\nBudget: ' + budget : '')), '_blank', 'noopener,noreferrer');
  });

  /* ---------- Footer year, image fallbacks ---------- */
  $$('[data-year]').forEach(function (el) { el.textContent = now.getFullYear(); });
  document.addEventListener('error', function (e) {
    if (e.target.tagName === 'IMG' && e.target.hasAttribute('data-fallback')) {
      var fallback = e.target.getAttribute('data-fallback');
      e.target.removeAttribute('data-fallback');
      e.target.src = fallback;
      return;
    }
    if (e.target.tagName === 'IMG' && e.target.closest('.pmedia') && !e.target.closest('.pmedia__emoji')) e.target.classList.add('is-broken');
  }, true);

  updateCounts();
  saverArt(document);
  refreshLoc();

  if (!onIndex) return;

  /* =====================================================================
     STORE (index.html only)
     ===================================================================== */
  var home = $('#home'), view = $('#view');
  var homeTitle = document.title;

  /* ---------- Advertising banner (carousel) ---------- */
  var reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var ads = { i: 0, timer: null, paused: reduceMotion, hover: false };
  var adsEl = $('#ads'), adsWrap = $('#ads-slides'), adsPause = $('.ads__pause');

  function adSlides() {
    var promos = allPromos().filter(function (pr) { return promoStatus(pr) === 'live'; }).map(function (pr) {
      var s = seller(pr.seller), se = season(pr.season), first = product(pr.products[0]);
      return { label: 'Promotion' + (s ? ' · ' + s.name : ''), title: pr.title, text: pr.discount + '% off until ' + niceDate(pr.ends) + '.', cta: 'Shop now', link: '#/promo/' + pr.id, colours: se.colours, art: first ? dept(first.category).icon : '🏷️', image: pr.image || '', photo: true, sample: pr.sample };
    });
    var list = (D.banners || []).concat(promos);
    if (zambia) {
      var cc = celebrationCopy();
      var deals = independenceDeals();
      list.unshift({ id: 'independence', zambia: true, label: 'Independence ' + now.getFullYear(), title: cc.lead,
        text: cc.line + (deals ? ' Shop local favourites and seller celebration deals.' : ' Shop local and support Zambian sellers.'),
        cta: deals ? 'Shop Independence deals' : 'Explore categories', link: deals ? '#/promotions?season=independence' : '#/departments', art: '<img src="assets/brand/zambia-flag.svg" alt="" width="220" height="147">' });
    }
    return list;
  }
  function adHTML(b, i, n) {
    var saverOn = root.classList.contains('data-saver');
    var link = esc(b.link || '#/deals');
    var attrs = ' role="group" aria-roledescription="slide" aria-label="' + (i + 1) + ' of ' + n + '"' + (i === ads.i ? '' : ' hidden');
    var sample = b.sample ? '<span class="tag-sample ad__sample">Sample</span>' : '';
    // Banner images download only when their slide is about to show (see wakeSlide):
    // hidden slides keep the address in data-src / data-srcset until then.
    var now = i === ads.i, src = now ? 'src' : 'data-src', srcset = now ? 'srcset' : 'data-srcset', prio = now ? ' fetchpriority="high"' : '';
    if (b.image && !b.photo && !saverOn) {
      return '<div class="ad ad--image"' + attrs + '><a class="ad__imglink" href="' + link + '"><picture>' +
        (b.imageMobile ? '<source media="(max-width: 599.98px)" ' + srcset + '="' + esc(b.imageMobile) + '">' : '') +
        '<img ' + src + '="' + esc(b.image) + '" alt="' + esc(b.alt || 'Advert') + '" width="1600" height="500"' + prio + '></picture></a>' + sample + '</div>';
    }
    var c = b.colours || ['#0A2A66', '#0057AE'];
    // Photo slides: phones get the smaller 800×640 crop when one is supplied
    var bg = b.image && b.photo && !saverOn ? '<picture>' + (b.imageMobile ? '<source media="(max-width: 599.98px)" ' + srcset + '="' + esc(b.imageMobile) + '">' : '') +
      '<img class="ad__bg" ' + src + '="' + esc(b.image) + '" alt="" width="1440" height="480"' + prio + '></picture>' : '';
    var art = bg ? '' : (b.art === 'logo' ? '<img class="ad__logo" src="assets/brand/mark-original-3d.webp" alt="" width="320" height="170">' : (b.art ? '<span class="ad__art" aria-hidden="true">' + b.art + '</span>' : ''));
    return '<div class="ad ad--designed' + (bg ? ' ad--photo' : '') + (b.zambia ? ' ad--zambia' : '') + '"' + attrs + ' style="--ad-a:' + c[0] + ';--ad-b:' + c[1] + '">' + bg +
      '<div class="ad__body">' + (b.label ? '<span class="ad__label">' + esc(b.label) + '</span>' : '') +
      '<p class="ad__title">' + esc(b.title || b.alt || 'Advert') + '</p>' + (b.text ? '<p class="ad__text">' + esc(b.text) + '</p>' : '') +
      '<a class="btn btn--primary" href="' + link + '">' + esc(b.cta || 'Shop now') + '</a></div>' + art + sample + '</div>';
  }
  function stopAds() { if (ads.timer) clearInterval(ads.timer); ads.timer = null; }
  function playAds() { stopAds(); if (!ads.paused && !ads.hover && $$('.ad', adsWrap).length > 1 && !home.hidden) ads.timer = setInterval(function () { goAd(ads.i + 1); }, 6000); }
  function wakeSlide(el) {
    if (!el) return;
    $$('source[data-srcset]', el).forEach(function (so) { so.srcset = so.getAttribute('data-srcset'); so.removeAttribute('data-srcset'); });
    $$('img[data-src]', el).forEach(function (im) { im.src = im.getAttribute('data-src'); im.removeAttribute('data-src'); });
  }
  function goAd(n) {
    var s = $$('.ad', adsWrap);
    if (!s.length) return;
    ads.i = (n + s.length) % s.length;
    s.forEach(function (el, i) { el.hidden = i !== ads.i; });
    wakeSlide(s[ads.i]);
    wakeSlide(s[(ads.i + 1) % s.length]);   // fetch the next slide's image ahead of time
    $$('.ads__dot', adsEl).forEach(function (d, i) { if (i === ads.i) d.setAttribute('aria-current', 'true'); else d.removeAttribute('aria-current'); });
  }
  function setPaused(p) {
    ads.paused = p;
    adsPause.setAttribute('aria-pressed', String(p));
    adsPause.setAttribute('aria-label', p ? 'Play slideshow' : 'Pause slideshow');
    if (p) stopAds(); else playAds();
  }
  function buildAds() {
    if (!adsWrap) return;
    var list = adSlides(), multi = list.length > 1;
    if (ads.i >= list.length) ads.i = 0;
    adsWrap.innerHTML = list.map(function (b, i) { return adHTML(b, i, list.length); }).join('');
    $$('.ads__arrow, .ads__bar', adsEl).forEach(function (el) { el.hidden = !multi; });
    $('#ads-dots').innerHTML = list.map(function (b, i) { return '<button class="ads__dot" type="button" data-ad="' + i + '" aria-label="Show slide ' + (i + 1) + ': ' + esc(b.title || b.alt || 'Advert') + '"></button>'; }).join('');
    goAd(ads.i);
    setPaused(ads.paused);
  }
  if (adsEl) {
    adsEl.addEventListener('click', function (e) {
      if (e.target.closest('.ads__arrow--prev')) goAd(ads.i - 1);
      else if (e.target.closest('.ads__arrow--next')) goAd(ads.i + 1);
      else if (e.target.closest('.ads__dot')) goAd(Number(e.target.closest('.ads__dot').getAttribute('data-ad')));
      else if (e.target.closest('.ads__pause')) { setPaused(!ads.paused); return; }
      else return;
      playAds();   // restart the timer after a manual change
    });
    adsEl.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft') { goAd(ads.i - 1); playAds(); }
      if (e.key === 'ArrowRight') { goAd(ads.i + 1); playAds(); }
    });
    // Pause while the pointer or keyboard focus is on the banner
    adsEl.addEventListener('mouseenter', function () { ads.hover = true; stopAds(); });
    adsEl.addEventListener('mouseleave', function () { ads.hover = false; playAds(); });
    adsEl.addEventListener('focusin', function () { ads.hover = true; stopAds(); });
    adsEl.addEventListener('focusout', function (e) { if (!adsEl.contains(e.relatedTarget)) { ads.hover = false; playAds(); } });
    // Swipe on touch screens
    var x0 = null;
    adsEl.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; }, { passive: true });
    adsEl.addEventListener('touchend', function (e) {
      if (x0 === null) return;
      var dx = e.changedTouches[0].clientX - x0; x0 = null;
      if (Math.abs(dx) > 40) { goAd(ads.i + (dx < 0 ? 1 : -1)); playAds(); }
    });
    document.addEventListener('zs:datasaver', function () { if (!home.hidden) renderHome(); });
  }

  // Fill a homepage list, or show a friendly "coming soon" note when there's nothing yet
  function fill(sel, html, msg, cta) {
    var list = $(sel), note = list.nextElementSibling && list.nextElementSibling.classList.contains('home-empty') ? list.nextElementSibling : null;
    list.innerHTML = html;
    list.hidden = !html;
    if (html) { if (note) note.remove(); return; }
    if (!note) { note = document.createElement('div'); note.className = 'empty home-empty'; list.parentNode.insertBefore(note, list.nextSibling); }
    note.innerHTML = '<img class="empty__art" src="assets/icons/empty.svg" alt="" width="64" height="64"><p>' + msg + '</p><div class="btn-row btn-row--center">' + cta + '</div>';
  }

  function renderHome() {
    buildAds();
    var deals = localProducts.filter(function (p) { return priceOf(p).was; });
    if (deals.length < 6) deals = deals.concat(localProducts.filter(function (p) { return deals.indexOf(p) === -1; })).slice(0, 8);
    var livePromos = sortPromos(allPromos().filter(function (pr) { return promoStatus(pr) !== 'ended'; })).slice(0, 4);
    fill('#home-deals', cards(deals), 'Our first deals are on their way. Sellers are joining Zed Supply now. Tell us what you need and we\'ll find it for you.',
      '<a class="btn btn--primary" href="#request">Make a request</a><a class="btn btn--secondary" href="#/sell">Sell on Zed Supply</a>');
    $('#home-featured').innerHTML = cards(localProducts.slice(0, 10));
    $('#home-featured').closest('section').hidden = !localProducts.length;
    fill('#home-promos', livePromos.map(promoCard).join(''), 'No promotions are running yet. Zed Supply sellers will run seasonal and store promotions here.',
      '<a class="btn btn--secondary" href="#/sell">Sell and run promotions</a>');
    fill('#home-brands', D.brands.map(brandCard).join(''), 'Brand stores are coming soon.',
      '<a class="btn btn--secondary" href="#/sell">Open a brand store</a>');
    var recent = store.get('recent', []).map(product).filter(Boolean);
    $('#home-recent-wrap').hidden = !recent.length;
    $('#home-recent').innerHTML = cards(recent);
    saverArt(home);
    $$('[data-sample-note]').forEach(function (n) { n.hidden = !S.isSample; });
  }

  function show(html, title) {
    stopAds();
    home.hidden = true;
    view.hidden = false;
    view.innerHTML = html;
    maskPersonal(view);
    saverArt(view);
    document.title = title + ' | Zed Supply';
    refreshLoc();
    window.scrollTo(0, 0);
    var h = $('h1', view);
    if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
    $$('.subnav a').forEach(function (a) {
      var target = a.getAttribute('href').replace('index.html', '');
      if (target.length > 2 && location.hash.indexOf(target) === 0) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
  }
  function crumbs(list) {
    return '<nav aria-label="Breadcrumb"><ol class="crumbs"><li><a href="#">Home</a></li>' +
      list.map(function (c) { return '<li>' + (c[1] ? '<a href="' + c[1] + '">' + esc(c[0]) + '</a>' : '<span aria-current="page">' + esc(c[0]) + '</span>') + '</li>'; }).join('') + '</ol></nav>';
  }
  function head(title, sub) { return '<div class="view-head"><h1>' + title + '</h1>' + (sub ? '<p>' + sub + '</p>' : '') + '</div>'; }
  function empty(msg, cta) { return '<div class="empty"><img class="empty__art" src="assets/icons/empty.svg" alt="" width="64" height="64"><p>' + msg + '</p>' + (cta || '') + '</div>'; }
  function askBtn(msg) { return '<a class="btn btn--primary" href="' + waUrl(msg) + '" data-wa-message="' + esc(msg) + '" target="_blank" rel="noopener noreferrer">Ask on WhatsApp</a>'; }
  function ticks(list) { return '<ul class="ticks">' + list.map(function (t) { return '<li>' + icon(I.check) + t + '</li>'; }).join('') + '</ul>'; }

  /* Product listing with sort and filters: departments, search, deals, brands, stores, promotions */
  function listing(opts) {
    var html = crumbs(opts.crumbs) + head(opts.title, opts.sub) + (opts.extra || '') +
      '<div class="toolbar"><p class="result-count" id="lst-count" role="status"></p><div class="toolbar__filters">' +
        '<label class="inline-check"><input type="checkbox" id="lst-promo"> On promotion</label>' +
        '<label class="inline-check"><input type="checkbox" id="lst-stock"> In stock</label>' +
        '<label for="lst-sort" class="visually-hidden">Sort by</label><select id="lst-sort"><option value="">Sort: Relevance</option><option value="asc">Price: low to high</option><option value="desc">Price: high to low</option><option value="rating">Top rated</option></select>' +
      '</div></div><ul class="grid" id="lst-grid"></ul>';
    show(html, opts.docTitle || opts.title);
    var draw = function () {
      var list = opts.list.slice();
      if ($('#lst-promo').checked) list = list.filter(function (p) { var pr = priceOf(p); return pr.promo || pr.was; });
      if ($('#lst-stock').checked) list = list.filter(function (p) { return p.stock === 'in' || p.stock === 'low'; });
      var sort = $('#lst-sort').value;
      if (sort === 'asc' || sort === 'desc') list.sort(function (a, b) { var d = priceOf(a).now - priceOf(b).now; return sort === 'asc' ? d : -d; });
      if (sort === 'rating') list.sort(function (a, b) { return (ratingOf(b) || { avg: 0 }).avg - (ratingOf(a) || { avg: 0 }).avg; });
      $('#lst-grid').innerHTML = list.length ? cards(list) : '<li class="grid__full">' + empty('Nothing listed here yet. Tell us what you need and we\'ll find it.', askBtn('Hi Zed Supply, I\'m looking for: ')) + '</li>';
      $('#lst-count').textContent = list.length + (list.length === 1 ? ' product' : ' products');
    };
    ['lst-promo', 'lst-stock', 'lst-sort'].forEach(function (id) { $('#' + id).addEventListener('change', draw); });
    draw();
  }

  var STATUS = ['Order sent on WhatsApp', 'Confirmed by Zed Supply', 'Packed by the seller', 'Out for delivery', 'Delivered'];
  function orders() { return store.get('orders', []); }
  function findOrder(ref) {
    ref = String(ref || '').trim().toUpperCase();
    var o = orders().filter(function (x) { return x.ref === ref; })[0];
    if (!o && D.demoOrder && D.demoOrder.ref === ref) o = D.demoOrder;
    return o || null;
  }

  var views = {
    departments: function () {
      show(crumbs([['All categories']]) + head('All categories') +
        '<ul class="depts">' + D.departments.map(function (d) {
          var n = products.filter(function (p) { return p.category === d.id; }).length;
          return '<li><a class="dept" href="#/dept/' + d.id + '"><span class="dept__icon" aria-hidden="true">' + departmentArtwork(d) + '</span>' + esc(d.name) + '<small>' + (n ? n + (n === 1 ? ' product' : ' products') : 'Coming soon') + '</small></a></li>';
        }).join('') + '</ul>', 'All categories');
    },

    dept: function (id) {
      var d = byId(D.departments, id);
      if (!d) return views.notfound();
      listing({ title: esc(d.name), crumbs: [['Categories', '#/departments'], [d.name]], list: products.filter(function (p) { return p.category === id; }), docTitle: d.name,
        extra: '<ul class="chips" aria-label="Other categories">' + D.departments.map(function (x) { return '<li><a class="chip" href="#/dept/' + x.id + '"' + (x.id === id ? ' aria-current="page"' : '') + '>' + x.icon + ' ' + esc(x.name) + '</a></li>'; }).join('') + '</ul>' });
    },

    search: function (arg, q) {
      var term = (q.get('q') || '').trim(), dp = q.get('dept') || '';
      var words = term.toLowerCase().split(/\s+/).filter(Boolean);
      var matches = function (name) { return words.length && words.every(function (w) { return name.toLowerCase().indexOf(w) !== -1; }); };
      var list = products.filter(function (p) {
        if (dp && p.category !== dp) return false;
        var t = searchText(p);
        return words.every(function (w) { return t.indexOf(w) !== -1; });
      });
      var stores = D.sellers.filter(function (s) { return matches(s.name); }), brands = D.brands.filter(function (b) { return matches(b.name); });
      var extra = (stores.length || brands.length) ? '<ul class="chips" aria-label="Matching stores and brands">' +
        stores.map(function (s) { return '<li><a class="chip" href="#/store/' + s.id + '">🏪 Store: ' + esc(s.name) + '</a></li>'; }).join('') +
        brands.map(function (b) { return '<li><a class="chip" href="#/brand/' + b.id + '">🏷️ Brand: ' + esc(b.name) + '</a></li>'; }).join('') + '</ul>' : '';
      var box = $('#q'); if (box) box.value = term;
      listing({ title: term ? 'Results for “' + esc(term) + '”' : 'All products', sub: dp ? 'In ' + esc(dept(dp).name) : '', crumbs: [['Search']], list: list, extra: extra, docTitle: term ? 'Search: ' + term : 'All products' });
    },

    deals: function () {
      listing({ title: "Today's deals", sub: 'Discounts and live seller promotions.', crumbs: [["Today's deals"]], list: localProducts.filter(function (p) { var pr = priceOf(p); return pr.was || pr.promo; }) });
    },

    product: function (id) {
      var p = product(id);
      if (!p || (p.source === 'china' && !china)) return views.notfound();
      addRecent(p.id);
      var pr = priceOf(p), s = seller(p.seller), b = brand(p.brand), d = dept(p.category), r = ratingOf(p), u = user();
      var buyMsg = 'Hi Zed Supply, I\'d like to buy: ' + p.title + ' (ID ' + p.id + '), price ' + kwacha(pr.now) + ' each.';
      var revs = reviewsFor(p);
      var related = products.filter(function (x) { return x.category === p.category && x.id !== p.id; }).slice(0, 8);
      var html = crumbs([[d.name, '#/dept/' + p.category], [p.title]]) +
        '<div class="pdp">' +
          '<div class="pdp__media"><div class="pflags">' + (pr.off ? '<span class="flag-sale">-' + pr.off + '%</span>' : '') + (p.sample ? '<span class="tag-sample">Sample</span>' : '') + '</div>' + likeBtn(p) + '<div class="pmedia">' + media(p) + '</div></div>' +
          '<div>' +
            '<h1>' + esc(p.title) + '</h1>' +
            '<p class="pmeta">' + (b ? 'Brand: <a href="#/brand/' + b.id + '">' + esc(b.name) + '</a> · ' : '') + (s ? 'Sold by <a href="#/store/' + s.id + '">' + esc(s.name) + '</a>' + verifiedHTML(s) : '') + '</p>' +
            (r ? starsHTML(p) + '<p><a href="#reviews" data-jump="reviews">' + r.count + (r.count === 1 ? ' review' : ' reviews') + '</a></p>' : '<p class="pmeta">No reviews yet</p>') +
            priceHTML(pr) +
            (pr.promo ? '<p class="notice">Part of <a href="#/promo/' + pr.promo.id + '">' + esc(pr.promo.title) + '</a>: ' + pr.promo.discount + '% off until ' + niceDate(pr.promo.ends) + '.</p>' : '') +
            '<h2 class="h3">About this product</h2><p>' + (p.description ? esc(p.description) : '<span class="placeholder">[PRODUCT DESCRIPTION: add a description field in catalogue.js]</span>') + '</p>' +
            '<p class="pmeta">Category: <a href="#/dept/' + p.category + '">' + esc(d.name) + '</a> · Product ID ' + esc(p.id) + '</p>' +
          '</div>' +
          '<aside class="buybox" aria-label="Buy this product">' +
            priceHTML(pr) + stockHTML(p) +
            '<p>' + esc(p.source === 'china' ? p.shipping : S.deliveryText) + '</p>' +
            '<p class="pmeta"><button class="link-btn" type="button" data-open-location aria-haspopup="dialog"><span data-location-label>Deliver to: set location</span></button></p>' +
            '<div><label for="pdp-qty" class="pmeta">Quantity</label><div class="qty"><button type="button" data-step="-1" data-target="#pdp-qty" aria-label="Decrease quantity">−</button><input id="pdp-qty" type="number" min="1" max="99" value="1" inputmode="numeric"><button type="button" data-step="1" data-target="#pdp-qty" aria-label="Increase quantity">+</button></div></div>' +
            '<button class="btn btn--primary btn--block" type="button" data-add="' + p.id + '" data-qty-from="#pdp-qty">Add to cart</button>' +
            '<a class="btn btn--secondary btn--block" id="buy-now" href="#" target="_blank" rel="noopener noreferrer">Buy now on WhatsApp</a>' +
            '<p class="pmeta">The final price and delivery are confirmed on WhatsApp before you pay.</p>' +
            (payMethods().length ? '<div class="buybox__pay"><p class="pmeta">Pay with mobile money</p>' + payChipsHTML() + '</div>' : '') +
          '</aside>' +
        '</div>' +
        '<section class="reviews" id="reviews" aria-labelledby="rev-title"><div>' +
          '<h2 id="rev-title">Customer reviews</h2>' + (r ? starsHTML(p) + '<p>' + r.avg.toFixed(1) + ' out of 5</p>' : '<p>No reviews yet.</p>') +
          (u ? '<form class="form form--card" id="review-form"><h3>Write a review</h3>' +
            '<div class="field"><label for="rev-rating">Your rating</label><select id="rev-rating" required><option value="5">5 – Excellent</option><option value="4">4 – Good</option><option value="3">3 – Okay</option><option value="2">2 – Poor</option><option value="1">1 – Bad</option></select></div>' +
            '<div class="field"><label for="rev-text">Your review</label><textarea id="rev-text" required maxlength="600"></textarea></div>' +
            '<p class="hint">Prototype: your review is saved on this device only.</p><button class="btn btn--primary" type="submit">Post review</button></form>'
            : '<p><a class="btn btn--secondary" href="#/account">Sign in to write a review</a></p>') +
        '</div><div>' + revs.map(function (v) {
          var stars = Math.min(5, Math.max(0, Number(v.rating) || 0));
          return '<div class="review"><span class="stars__icons" aria-hidden="true">' + starString(stars) + '</span><span class="visually-hidden">' + stars + ' out of 5</span> <strong>' + esc(v.name) + '</strong> <small>' + niceDate(v.date) + '</small><p>' + esc(v.text) + '</p></div>';
        }).join('') + '</div></section>' +
        (related.length ? '<section class="section" aria-labelledby="rel-title"><h2 id="rel-title">More in ' + esc(d.name) + '</h2><ul class="row">' + cards(related) + '</ul></section>' : '');
      show(html, p.title);
      var qty = $('#pdp-qty'), buy = $('#buy-now');
      var syncBuy = function () { var m = buyMsg + ' Quantity: ' + Math.max(1, parseInt(qty.value, 10) || 1); buy.setAttribute('data-wa-message', m); buy.href = waUrl(m); };
      qty.addEventListener('input', syncBuy); syncBuy();
      view.onclick = function (e) {
        var j = e.target.closest('[data-jump]');
        if (j) { e.preventDefault(); $('#' + j.getAttribute('data-jump')).scrollIntoView(); }
      };
      var rf = $('#review-form');
      if (rf) rf.addEventListener('submit', function (e) {
        e.preventDefault();
        var all = store.get('reviews', {});
        (all[p.id] = all[p.id] || []).push({ name: u.name, rating: Number($('#rev-rating').value), date: today, text: $('#rev-text').value.trim(), mine: true });
        store.set('reviews', all);
        toast('Thanks for your review');
        route();
      });
    },

    cart: function () {
      var lines = cart().filter(function (l) { return product(l.id); });
      var saved = store.get('saved', []).map(product).filter(Boolean);
      var u = user() || {};
      var savedHTML = saved.length ? '<h2 class="cart__saved">Saved for later</h2><ul class="grid">' + cards(saved) + '</ul>' : '';
      if (!lines.length) {
        show(crumbs([['Cart']]) + head('Your cart is empty') + empty('Find something you like, or tell us what you need and we\'ll source it.', '<div class="btn-row btn-row--center"><a class="btn btn--primary" href="#/deals">Shop today\'s deals</a><a class="btn btn--secondary" href="#/wishlist">View wishlist</a></div>') + savedHTML, 'Cart');
        bindSaved();
        return;
      }
      var voucher = store.get('voucher', '');
      var sub = 0, save = 0, items = [];
      lines.forEach(function (l) { var p = product(l.id), pr = priceOf(p), qty = Math.min(99, Math.max(1, parseInt(l.qty, 10) || 1)); sub += pr.now * qty; if (pr.was) save += (pr.was - pr.now) * qty; items.push({ p: p, pr: pr, qty: qty }); });
      var v = voucher ? (D.vouchers || []).filter(function (x) { return x.code === voucher; })[0] : null;
      var vOff = v && sub >= v.minSpend ? Math.round(sub * v.percent / 100) : 0;
      var total = sub - vOff;
      var html = crumbs([['Cart']]) + head('Your cart', items.length + (items.length === 1 ? ' product' : ' products')) +
        '<div class="cart"><div><ul class="lines">' + items.map(function (it, i) {
          var s = seller(it.p.seller);
          return '<li class="line"><a class="pmedia" href="#/product/' + it.p.id + '" tabindex="-1" aria-hidden="true">' + media(it.p) + '</a><div>' +
            '<a class="line__title" href="#/product/' + it.p.id + '">' + esc(it.p.title) + '</a>' +
            '<p class="pmeta">' + (s ? 'Sold by ' + esc(s.name) + ' ' : '') + (it.pr.promo ? '<span class="badge">' + esc(it.pr.promo.title) + '</span>' : '') + '</p>' +
            '<p class="line__price">' + kwacha(it.pr.now * it.qty) + (it.qty > 1 ? ' <small class="pmeta">(' + kwacha(it.pr.now) + ' each)</small>' : '') + '</p>' +
            '<div class="line__actions"><div class="qty"><button type="button" data-step="-1" data-target="#cq' + i + '" aria-label="Decrease quantity of ' + esc(it.p.title) + '">−</button>' +
            '<input id="cq' + i + '" type="number" min="1" max="99" value="' + it.qty + '" data-cart-qty="' + it.p.id + '" aria-label="Quantity of ' + esc(it.p.title) + '"><button type="button" data-step="1" data-target="#cq' + i + '" aria-label="Increase quantity of ' + esc(it.p.title) + '">+</button></div>' +
            '<button class="link-btn" type="button" data-remove="' + it.p.id + '">Remove<span class="visually-hidden"> ' + esc(it.p.title) + '</span></button><button class="link-btn" type="button" data-save="' + it.p.id + '">Save for later<span class="visually-hidden">: ' + esc(it.p.title) + '</span></button></div>' +
          '</div></li>';
        }).join('') + '</ul>' + savedHTML +
        '</div><aside class="summary" aria-labelledby="sum-title"><h2 id="sum-title">Order summary</h2>' +
          '<dl class="totals"><div><dt>Subtotal</dt><dd>' + kwacha(sub) + '</dd></div>' +
          (save ? '<div class="is-save"><dt>You save</dt><dd>' + kwacha(save) + '</dd></div>' : '') +
          (vOff ? '<div class="is-save"><dt>Voucher ' + esc(v.code) + '</dt><dd>−' + kwacha(vOff) + '</dd></div>' : '') +
          '<div><dt>Delivery</dt><dd>Confirmed on WhatsApp</dd></div>' +
          '<div class="is-total"><dt>Estimated total</dt><dd>' + kwacha(total) + '</dd></div></dl>' +
          '<form class="voucher" id="voucher-form"><label for="voucher" class="visually-hidden">Voucher code</label><input id="voucher" placeholder="Voucher code" value="' + esc(voucher) + '" autocapitalize="characters"><button class="btn btn--secondary btn--sm" type="submit">Apply</button></form>' +
          (voucher && !v ? '<p class="form-status is-error">That voucher code isn\'t valid.</p>' : '') +
          (v && !vOff ? '<p class="form-status is-error">' + esc(v.code) + ' needs a minimum spend of ' + kwacha(v.minSpend) + '.</p>' : '') +
          '<div class="field"><label for="co-name">Your name</label><input id="co-name" autocomplete="name" value="' + esc(u.name || '') + '"></div>' +
          '<div class="deliver-box"><p class="deliver-box__label">Deliver to</p><p data-loc-summary>' + locSummaryHTML() + '</p><button class="link-btn" type="button" data-open-location aria-haspopup="dialog">Set or change delivery location</button></div>' +
          '<div class="field"><label for="co-note">Notes for your order (optional)</label><input id="co-note"></div>' +
          payChoiceHTML() +
          '<a class="btn btn--primary btn--block" id="checkout" href="#" target="_blank" rel="noopener noreferrer">Checkout on WhatsApp</a>' +
          '<p class="pmeta">We confirm the final price and delivery fee on WhatsApp, then send payment instructions. You approve the payment on your own phone. We never ask for your PIN.</p>' +
          '<button class="link-btn" type="button" id="clear-cart">Empty cart</button>' +
        '</aside></div>';
      show(html, 'Cart');

      var ref = 'ZS-' + Date.now().toString(36).toUpperCase().slice(-6);
      var co = $('#checkout');
      var buildMsg = function () {
        var m = 'Hi Zed Supply, I\'d like to place an order (ref ' + ref + '):\n' +
          items.map(function (it, i) { return (i + 1) + '. ' + it.p.title + ' (' + it.p.id + ') x ' + it.qty + ' = ' + kwacha(it.pr.now * it.qty); }).join('\n') +
          (vOff ? '\nVoucher ' + v.code + ': -' + kwacha(vOff) : '') + '\nEstimated total: ' + kwacha(total);
        var nm = $('#co-name').value.trim(), note = $('#co-note').value.trim();
        if (nm) m += '\nName: ' + nm;
        if (note) m += '\nNotes: ' + note;
        if (payChoice) m += '\nPayment: ' + payChoice;
        return m;
      };
      // data-wa-message lets refreshLoc() update the link when the delivery location changes
      var syncCo = function () { var m = buildMsg(); co.setAttribute('data-wa-message', m); co.href = waUrl(m); };
      ['co-name', 'co-note'].forEach(function (id) { $('#' + id).addEventListener('input', syncCo); });
      $$('input[name="co-pay"]', view).forEach(function (r) { r.addEventListener('change', function () { payChoice = r.value; syncCo(); }); });
      syncCo();
      co.addEventListener('click', function (e) {
        if (hasCardNumber($('#co-name').value + ' ' + $('#co-note').value)) { e.preventDefault(); toast(esc(CARD_WARNING)); $('#co-note').focus(); return; }
        var list = orders();
        list.unshift({ ref: ref, date: today, items: items.map(function (it) { return { id: it.p.id, qty: it.qty, price: it.pr.now }; }), total: total, status: 0, deliverTo: locFull(), pay: payChoice });
        store.set('orders', list);
        setCart([]);
        store.set('voucher', '');
        setTimeout(function () { location.hash = '#/order/' + ref; }, 400);
      });
      $$('[data-cart-qty]', view).forEach(function (inp) {
        inp.addEventListener('change', function () {
          var c = cart();
          c.forEach(function (l) { if (l.id === inp.getAttribute('data-cart-qty')) l.qty = Math.min(99, Math.max(1, parseInt(inp.value, 10) || 1)); });
          setCart(c); views.cart();
        });
        inp.addEventListener('input', function (e) { if (e.isTrusted === false) inp.dispatchEvent(new Event('change')); });
      });
      $('#voucher-form').addEventListener('submit', function (e) { e.preventDefault(); store.set('voucher', $('#voucher').value.trim().toUpperCase()); views.cart(); });
      bindSaved();
    },

    wishlist: function () {
      var list = wish().map(product).filter(Boolean);
      show(crumbs([['Wishlist']]) + head('Your wishlist', 'Products you\'ve liked, saved for later.') +
        (list.length ? '<ul class="grid">' + cards(list) + '</ul>' : empty('Tap the heart on any product to save it here.', '<a class="btn btn--primary" href="#/deals">Browse deals</a>')), 'Wishlist');
    },

    account: function () {
      var u = user();
      if (!u) {
        show(crumbs([['My Account']]) + head('Sign in or create an account') +
          '<div class="duo"><form class="form form--card" id="signin"><h2>Welcome to Zed Supply</h2>' +
          '<p class="notice">Prototype: there are no passwords yet and nothing is sent to a server. Your details stay on this device. Secure accounts are coming soon.</p>' +
          '<div class="field"><label for="su-name">Your name</label><input id="su-name" autocomplete="name" required></div>' +
          '<div class="field"><label for="su-phone">Phone or WhatsApp number</label><input id="su-phone" type="tel" autocomplete="tel" required></div>' +
          '<div class="field"><label for="su-email">Email (optional)</label><input id="su-email" type="email" autocomplete="email"></div>' +
          '<button class="btn btn--primary" type="submit">Continue</button></form>' +
          '<div class="band"><h2>With a Zed Supply account you can</h2>' + ticks(['Track your orders', 'Save products to your wishlist', 'Write product reviews', 'Check out faster on WhatsApp']) +
          '<p>Selling? <a href="#/seller">Go to the Seller Centre</a></p></div></div>', 'My Account');
        $('#signin').addEventListener('submit', function (e) {
          e.preventDefault();
          store.set('user', { name: $('#su-name').value.trim(), phone: $('#su-phone').value.trim(), email: $('#su-email').value.trim() });
          updateCounts(); toast('Signed in'); route();
        });
        return;
      }
      var myReviews = 0, all = store.get('reviews', {});
      Object.keys(all).forEach(function (k) { myReviews += all[k].filter(function (rv) { return rv.mine; }).length; });
      var recent = store.get('recent', []).map(product).filter(Boolean);
      var tile = function (href, t, sub) { return '<li><a href="' + href + '"><strong>' + t + '</strong><span>' + sub + '</span></a></li>'; };
      show(crumbs([['My Account']]) + head('Hello, ' + esc(u.name.split(' ')[0])) +
        '<ul class="tiles">' +
          tile('#/orders', 'Orders', orders().length + ' orders · track and reorder') +
          tile('#/wishlist', 'Wishlist', wish().length + ' saved products') +
          tile('#/cart', 'Cart', cart().length + ' products in your cart') +
          tile('#/track', 'Track an order', 'Enter an order number') +
          tile('help.html#returns', 'Returns', 'How returns work') +
          tile('#/seller', 'Seller Centre', 'Manage your store') +
          tile('help.html', 'Help centre', 'Answers and contact') +
          tile('#/promotions', 'Promotions', 'Deals from sellers') +
        '</ul>' +
        '<div class="duo duo--gap"><form class="form form--card" id="acct"><h2>Your details</h2>' +
          '<div class="field"><label for="ac-name">Name</label><input id="ac-name" autocomplete="name" value="' + esc(u.name) + '" required></div>' +
          '<div class="field"><label for="ac-phone">Phone or WhatsApp</label><input id="ac-phone" type="tel" autocomplete="tel" value="' + esc(u.phone) + '"></div>' +
          '<div class="field"><label for="ac-email">Email</label><input id="ac-email" type="email" autocomplete="email" value="' + esc(u.email) + '"></div>' +
          '<div class="btn-row"><button class="btn btn--primary" type="submit">Save</button><button class="btn btn--secondary" type="button" id="signout">Sign out</button></div></form>' +
          '<div><div class="card"><h2>Delivery location</h2><p data-loc-summary>' + locSummaryHTML() + '</p>' +
            '<p class="pmeta">Added to your WhatsApp orders so we can confirm delivery to your area and the delivery fee. ' + (loc && loc.remember ? 'Remembered on this device.' : 'Kept until you close this tab unless you choose to remember it.') + '</p>' +
            '<button class="btn btn--secondary btn--sm" type="button" data-open-location aria-haspopup="dialog">Set or change location</button></div>' +
          '<div class="card"><h2>Your activity</h2><p>' + myReviews + (myReviews === 1 ? ' review' : ' reviews') + ' written · ' + recent.length + ' products viewed recently.</p><p class="pmeta">Prototype: your account is stored on this device only.</p></div></div></div>' +
        (recent.length ? '<section class="section"><h2>Recently viewed</h2><ul class="row">' + cards(recent) + '</ul></section>' : ''), 'My Account');
      $('#acct').addEventListener('submit', function (e) {
        e.preventDefault();
        store.set('user', { name: $('#ac-name').value.trim(), phone: $('#ac-phone').value.trim(), email: $('#ac-email').value.trim() });
        updateCounts(); toast('Details saved');
      });
      $('#signout').addEventListener('click', function () { store.set('user', null); updateCounts(); toast('Signed out'); route(); });
    },

    orders: function () {
      var list = orders();
      show(crumbs([['My Account', '#/account'], ['Orders']]) + head('Your orders', 'Orders you\'ve sent from this device.') +
        (list.length ? '<ul class="orders">' + list.map(function (o) {
          return '<li><a class="order-row" href="#/order/' + encodeURIComponent(o.ref) + '"><span><strong>' + esc(o.ref) + '</strong><br><span class="pmeta">' + niceDate(o.date) + ' · ' + o.items.length + (o.items.length === 1 ? ' product' : ' products') + '</span></span><span><span class="status">' + STATUS[o.status] + '</span><br><strong>' + kwacha(o.total) + '</strong></span></a></li>';
        }).join('') + '</ul>' : empty('No orders yet. When you check out on WhatsApp, your order appears here.', '<a class="btn btn--primary" href="#/deals">Start shopping</a>')) +
        '<p class="view-foot"><a href="#/track">Track an order by number</a></p>', 'Orders');
    },

    order: function (ref) {
      var o = findOrder(ref);
      if (!o) return views.track(null, null, ref);
      var msg = 'Hi Zed Supply, I\'d like an update on my order ' + o.ref + '.';
      show(crumbs([['Orders', '#/orders'], [o.ref]]) + head('Order ' + esc(o.ref), 'Placed ' + niceDate(o.date) + (o.sample ? ' · <span class="tag-sample">Demo order</span>' : '')) +
        '<div class="cart"><div class="card"><h2>Tracking</h2><ol class="timeline">' + STATUS.map(function (s, i) {
          return '<li class="' + (i < o.status ? 'is-done' : (i === o.status ? 'is-done is-current' : '')) + '">' + s + (i === o.status ? ' <span class="visually-hidden">(current status)</span>' : '') + '</li>';
        }).join('') + '</ol>' +
        (o.sample ? '<p class="pmeta">This is a demo order to show how tracking will look.</p>' : '<p class="pmeta">We update your order once it\'s confirmed on WhatsApp. Prototype: live tracking arrives with full accounts.</p>') +
        askBtn(msg) + '</div>' +
        '<aside class="summary"><h2>Items</h2><ul class="lines">' + o.items.map(function (it) { var p = product(it.id); return '<li class="line line--plain"><div><a class="line__title" href="#/product/' + it.id + '">' + esc(p ? p.title : it.id) + '</a><p class="pmeta">Quantity ' + (parseInt(it.qty, 10) || 0) + ' · ' + kwacha(it.price * it.qty) + '</p></div></li>'; }).join('') + '</ul>' +
        '<dl class="totals"><div class="is-total"><dt>Total</dt><dd>' + kwacha(o.total) + '</dd></div></dl>' +
        (o.pay ? '<div class="deliver-box"><p class="deliver-box__label">Payment</p><p>' + esc(o.pay) + '</p></div>' : '') +
        '<div class="deliver-box"><p class="deliver-box__label">Deliver to</p><p>' + (o.deliverTo ? esc(o.deliverTo) : '<span class="pmeta">No location given. We\'ll ask on WhatsApp.</span>') + '</p></div></aside></div>', 'Order ' + o.ref);
    },

    track: function (arg, q, missing) {
      show(crumbs([['Track order']]) + head('Track your order', 'Enter the order number from your WhatsApp message, e.g. ZS-ABC123.') +
        '<form class="form form--card form--narrow" id="track-form"><div class="field"><label for="tr-ref">Order number</label><input id="tr-ref" required autocapitalize="characters" value="' + esc(missing || '') + '"></div>' +
        (missing ? '<p class="form-status is-error">We couldn\'t find order ' + esc(missing) + ' on this device. Ask us on WhatsApp and we\'ll check for you.</p>' : '') +
        '<button class="btn btn--primary" type="submit">Track order</button>' + (D.demoOrder ? '<p class="hint">Try the demo order: <button class="link-btn" type="button" id="tr-demo">' + esc(D.demoOrder.ref) + '</button></p>' : '') + '</form>', 'Track order');
      $('#track-form').addEventListener('submit', function (e) { e.preventDefault(); location.hash = '#/order/' + encodeURIComponent($('#tr-ref').value.trim().toUpperCase()); });
      if ($('#tr-demo')) $('#tr-demo').addEventListener('click', function () { location.hash = '#/order/' + D.demoOrder.ref; });
    },

    sell: function () {
      show(crumbs([['Sell on Zed Supply']]) +
        '<div class="store-hero" style="--brand-a:#0A2A66;--brand-b:#106B3A"><h1>Sell on Zed Supply</h1><p>Open your store, reach more customers and run your own promotions.</p></div>' +
        '<ol class="steps"><li class="step"><h2>Apply</h2><p>Tell us about your business with the form below.</p></li><li class="step"><h2>Get verified</h2><p>We check your details and set up your seller account.</p></li><li class="step"><h2>List and promote</h2><p>Add products, set up your brand store and run seasonal promotions.</p></li></ol>' +
        '<div class="duo duo--gap"><div class="band"><h2>Why sell with us</h2>' +
          ticks(['Your own store page and brand store', 'Run seasonal or your own promotions from your Seller Centre', 'Orders confirmed with you before delivery', 'Reach Zambian households, professionals, SMEs and organisations']) +
          '<p><strong>Fees:</strong> <span class="placeholder">[SELLER FEES OR COMMISSION]</span></p><p>Already registered? <a href="#/seller">Seller Centre login</a></p></div>' +
        '<form class="form form--card js-formspree" id="seller-form" action="FORMSPREE_ENDPOINT_HERE" method="POST" data-success="Thank you. We\'ve received your application and will contact you to verify your business.">' +
          '<h2>Seller application</h2><p class="hint">Fields marked * are required.</p><input type="hidden" name="_subject" value="New seller application from the Zed Supply website">' +
          '<div class="field"><label for="sf-biz">Business name *</label><input id="sf-biz" name="business" required autocomplete="organization"></div>' +
          '<div class="field-row"><div class="field"><label for="sf-name">Contact person *</label><input id="sf-name" name="name" required autocomplete="name"></div>' +
          '<div class="field"><label for="sf-phone">Phone or WhatsApp *</label><input id="sf-phone" name="phone" type="tel" required autocomplete="tel"></div></div>' +
          '<div class="field-row"><div class="field"><label for="sf-email">Email *</label><input id="sf-email" name="email" type="email" required autocomplete="email"></div>' +
          '<div class="field"><label for="sf-town">Town or city *</label><input id="sf-town" name="town" required autocomplete="address-level2"></div></div>' +
          '<div class="field"><label for="sf-pacra">PACRA registration number (if registered)</label><input id="sf-pacra" name="pacra"></div>' +
          '<fieldset class="field"><legend>What do you sell?</legend><div class="checks">' + D.departments.map(function (d) { return '<div class="check"><input type="checkbox" id="sf-d-' + d.id + '" name="categories" value="' + esc(d.name) + '"><label for="sf-d-' + d.id + '">' + esc(d.name) + '</label></div>'; }).join('') + '</div></fieldset>' +
          '<div class="field"><label for="sf-more">Tell us about your products</label><textarea id="sf-more" name="message"></textarea></div>' +
          '<div class="hp-field" aria-hidden="true"><label for="sf-hp">Leave this field empty</label><input id="sf-hp" name="_gotcha" tabindex="-1" autocomplete="off"></div>' +
          '<div class="check"><input id="sf-consent" name="consent" type="checkbox" value="yes" required><label for="sf-consent">I agree that Zed Supply may use these details to assess my application, as set out in the <a href="privacy.html">privacy policy</a>. *</label></div>' +
          '<p class="form-status" role="status" aria-live="polite" tabindex="-1"></p><button class="btn btn--primary" type="submit">Send application</button></form></div>', 'Sell on Zed Supply');
    },

    seller: function () {
      var sess = store.get('seller', null), s = sess ? seller(sess.id) : null;
      if (!s && !D.sellers.length) {
        show(crumbs([['Seller Centre']]) + head('Seller Centre', 'Manage your store, products and promotions.') +
          '<div class="duo"><div class="band"><h2>Seller logins open soon</h2><p>We\'re verifying our first sellers now. Once your application is approved, you\'ll manage your store, products and promotions here.</p>' +
          '<a class="btn btn--primary" href="#/sell">Apply to sell</a></div>' +
          '<div class="band"><h2>Already applied?</h2><p>We\'ll contact you on WhatsApp or email when your store is ready.</p>' + askBtn('Hi Zed Supply, I\'d like an update on my seller application.') + '</div></div>' +
          '<div class="band duo--gap"><h2>Free stock planner</h2><p>Paste your stock list to see which items tie up your cash, what\'s about to run out and when to reorder. It works in your browser, so your list stays with you.</p><a class="btn btn--secondary" href="#/stock">Open the stock planner</a></div>', 'Seller Centre');
        return;
      }
      if (!s) {
        show(crumbs([['Seller Centre']]) + head('Seller Centre', 'Manage your store, products and promotions.') +
          '<div class="duo"><form class="form form--card" id="seller-login"><h2>Seller login</h2><p class="notice">Prototype: choose a sample store to try the Seller Centre. Real seller logins come with full accounts.</p>' +
          '<div class="field"><label for="sl-store">Store</label><select id="sl-store">' + D.sellers.map(function (x) { return '<option value="' + x.id + '">' + esc(x.name) + '</option>'; }).join('') + '</select></div>' +
          '<button class="btn btn--primary" type="submit">Enter Seller Centre</button></form>' +
          '<div class="band"><h2>Not selling yet?</h2><p>Apply to open your store on Zed Supply, or try our <a href="#/stock">free stock planner</a>.</p><a class="btn btn--dark" href="#/sell">Register as a seller</a></div></div>', 'Seller Centre');
        $('#seller-login').addEventListener('submit', function (e) { e.preventDefault(); store.set('seller', { id: $('#sl-store').value }); route(); });
        return;
      }
      var mine = products.filter(function (p) { return p.seller === s.id; });
      var promos = sortPromos(allPromos().filter(function (pr) { return pr.seller === s.id; }));
      var live = promos.filter(function (pr) { return promoStatus(pr) === 'live'; }).length;
      show(crumbs([['Seller Centre']]) +
        '<div class="store-hero" style="--brand-a:' + s.colours[0] + ';--brand-b:' + s.colours[1] + '"><h1>' + esc(s.name) + '</h1><p>Seller Centre' + (s.sample ? ' · sample store' : '') + verifiedHTML(s) + '</p></div>' +
        '<ul class="tiles tiles--5"><li><a href="#/store/' + s.id + '"><strong>' + mine.length + ' products</strong><span>View your store</span></a></li><li><a href="#sc-promos" data-jump="sc-promos"><strong>' + live + ' live</strong><span>Promotions running now</span></a></li><li><a href="#sc-new" data-jump="sc-new"><strong>New</strong><span>Create a promotion</span></a></li><li><a href="#/stock"><strong>Stock planner</strong><span>Reorder levels, overstock and forecasts</span></a></li><li><a href="help.html#selling"><strong>Help</strong><span>Selling on Zed Supply</span></a></li></ul>' +
        '<div class="duo duo--gap">' +
        '<section class="card" id="sc-promos" aria-labelledby="sc-p-title"><h2 id="sc-p-title">Your promotions</h2>' + (promos.length ? '<ul class="orders">' + promos.map(function (pr) {
          return '<li class="order-row"><span><strong>' + esc(pr.title) + '</strong><br><span class="pmeta">' + esc(season(pr.season).name) + ' · ' + (Number(pr.discount) || 0) + '% off · ' + niceDate(pr.starts) + ' to ' + niceDate(pr.ends) + (pr.image ? ' · with banner image' : '') + '</span></span><span><span class="status">' + promoStatus(pr) + '</span>' + (pr.demo ? ' <button class="link-btn" type="button" data-del-promo="' + esc(pr.id) + '">Delete<span class="visually-hidden"> ' + esc(pr.title) + '</span></button>' : '') + '</span></li>';
        }).join('') + '</ul>' : '<p>No promotions yet.</p>') + '</section>' +
        '<form class="form form--card" id="sc-new" aria-labelledby="sc-n-title"><h2 id="sc-n-title">Create a promotion</h2>' +
          '<p class="notice">Prototype: promotions you create appear across the store in this browser only.</p>' +
          '<div class="field"><label for="pn-title">Promotion name</label><input id="pn-title" required maxlength="60" placeholder="e.g. Festive season specials"></div>' +
          '<div class="field-row"><div class="field"><label for="pn-season">Type</label><select id="pn-season">' + D.seasons.map(function (x) { return '<option value="' + x.id + '">' + esc(x.name) + '</option>'; }).join('') + '</select></div>' +
          '<div class="field"><label for="pn-off">Discount (%)</label><input id="pn-off" type="number" min="5" max="90" value="10" required></div></div>' +
          '<div class="field-row"><div class="field"><label for="pn-start">Starts</label><input id="pn-start" type="date" value="' + today + '" required></div>' +
          '<div class="field"><label for="pn-end">Ends</label><input id="pn-end" type="date" min="' + today + '" required></div></div>' +
          '<fieldset class="field"><legend>Products in this promotion</legend><div class="checks">' + (mine.length ? mine.map(function (p) { return '<div class="check"><input type="checkbox" id="pn-p-' + p.id + '" value="' + p.id + '" checked><label for="pn-p-' + p.id + '">' + esc(p.title) + '</label></div>'; }).join('') : '<p>No products yet.</p>') + '</div></fieldset>' +
          '<div class="field"><label for="pn-img">Banner image (optional)</label><input id="pn-img" type="file" accept="image/jpeg,image/png,image/webp" aria-describedby="pn-img-hint">' +
          '<p class="hint" id="pn-img-hint">Shown in the homepage banner and on your promotion while it\'s live. Best size 1600 × 500 pixels; we crop and resize it for you. Keep important words in the middle.</p></div>' +
          '<p class="form-status" role="status" tabindex="-1"></p><button class="btn btn--primary" type="submit">Publish promotion</button></form></div>' +
        '<p class="view-foot"><button class="link-btn" type="button" id="seller-out">Sign out of Seller Centre</button></p>', 'Seller Centre');
      $('#sc-new').addEventListener('submit', function (e) {
        e.preventDefault();
        var st = $('.form-status', e.target), start = $('#pn-start').value, end = $('#pn-end').value;
        var picked = $$('#sc-new .checks input:checked').map(function (c) { return c.value; });
        var fail = function (m) { st.className = 'form-status is-error'; st.textContent = m; st.focus(); };
        if (end < start) return fail('The end date must be on or after the start date.');
        if (!picked.length) return fail('Choose at least one product.');
        var btn = $('button[type="submit"]', e.target);
        btn.disabled = true; btn.textContent = 'Publishing…';
        bannerFromFile($('#pn-img').files[0], 1600, 500, function (image) {
          btn.disabled = false; btn.textContent = 'Publish promotion';
          if (image === null) return fail('That image couldn\'t be used. Choose a JPEG, PNG or WebP under 10 MB.');
          var promo = { id: 'U' + Date.now().toString(36), demo: true, seller: s.id, title: $('#pn-title').value.trim(), season: $('#pn-season').value, discount: Math.min(90, Math.max(5, parseInt($('#pn-off').value, 10) || 10)), starts: start, ends: end, products: picked, image: image };
          var list = store.get('promos', []).concat([promo]);
          var note = '';
          if (!trySave('promos', list)) {
            // Browser storage is full: keep the promotion without its picture
            promo.image = '';
            store.set('promos', list);
            note = ' (without the image: this browser\'s storage is full)';
          }
          toast('Promotion published' + note + ' <a href="#/promotions">View</a>');
          route();
        });
      });
      view.onclick = function (e) {
        var j = e.target.closest('[data-jump]');
        if (j) { e.preventDefault(); $('#' + j.getAttribute('data-jump')).scrollIntoView(); }
        var del = e.target.closest('[data-del-promo]');
        if (del) { store.set('promos', store.get('promos', []).filter(function (x) { return x.id !== del.getAttribute('data-del-promo'); })); route(); }
        if (e.target.closest('#seller-out')) { store.set('seller', null); route(); }
      };
    },

    // Stock planner: js/stock-planner.js is fetched the first time this opens
    stock: function () {
      show(crumbs([['Seller Centre', '#/seller'], ['Stock planner']]) +
        '<div class="sp-hero"><span class="eyebrow">For sellers</span><h1>Stock planner</h1><p>See which items tie up your cash, what\'s about to run out, when to reorder and what the coming months look like. Every figure shows its working.</p></div>' +
        '<div id="sp-root" class="sp" data-clarity-mask="true"><p>Loading the planner…</p></div>', 'Stock planner');
      var mount = function () {
        var el = $('#sp-root');
        if (!el) return;
        if (!window.ZSStock) { el.innerHTML = '<p class="form-status is-error">The planner couldn\'t load. Check your connection and refresh the page.</p>'; return; }
        window.ZSStock.mount(el, { esc: esc, store: store, toast: toast });
      };
      if (window.ZSStock) return mount();
      var sp = document.createElement('script');
      sp.src = 'js/stock-planner.js';
      sp.onload = sp.onerror = mount;
      document.head.appendChild(sp);
    },

    promotions: function (arg, q) {
      var f = q.get('season') || '';
      var list = sortPromos(allPromos().filter(function (pr) { return promoStatus(pr) !== 'ended' && (!f || pr.season === f); }));
      show(crumbs([['Promotions']]) + head('Promotions', 'Seasonal and store promotions from Zed Supply sellers.') +
        '<ul class="chips" aria-label="Filter by type"><li><a class="chip" href="#/promotions"' + (!f ? ' aria-current="page"' : '') + '>All</a></li>' +
        D.seasons.map(function (x) { return '<li><a class="chip" href="#/promotions?season=' + x.id + '"' + (f === x.id ? ' aria-current="page"' : '') + '>' + esc(x.name) + '</a></li>'; }).join('') + '</ul>' +
        (list.length ? '<ul class="promos">' + list.map(function (pr) { return promoCard(pr, 2); }).join('') + '</ul>' : empty('No promotions of this type right now.', '<a class="btn btn--secondary" href="#/promotions">See all promotions</a>')) +
        '<p class="view-foot">Are you a seller? <a href="#/seller">Create a promotion in your Seller Centre</a>.</p>', 'Promotions');
    },

    promo: function (id) {
      var pr = byId(allPromos(), id);
      if (!pr) return views.notfound();
      var s = seller(pr.seller), se = season(pr.season), st = promoStatus(pr);
      listing({ title: esc(pr.title), crumbs: [['Promotions', '#/promotions'], [pr.title]], list: pr.products.map(product).filter(Boolean), docTitle: pr.title,
        extra: '<div class="store-hero' + (pr.image && !root.classList.contains('data-saver') ? ' promo--img' : '') + '" style="--brand-a:' + se.colours[0] + ';--brand-b:' + se.colours[1] + (pr.image ? ';--promo-img:url(\'' + esc(pr.image) + '\')' : '') + '"><p class="promo__off">' + (Number(pr.discount) || 0) + '% off</p><p>' + esc(se.name) + (s ? ' · by <a class="on-dark" href="#/store/' + s.id + '">' + esc(s.name) + '</a>' : '') + '</p><p>' +
          (st === 'live' ? 'Live now until ' + niceDate(pr.ends) : st === 'upcoming' ? 'Starts ' + niceDate(pr.starts) + '. Prices drop automatically when it begins.' : 'This promotion has ended.') + '</p>' + (pr.about ? '<p>' + esc(pr.about) + '</p>' : '') + '</div>' });
    },

    brands: function () {
      show(crumbs([['Brand stores']]) + head('Brand stores', 'Shop by brand.') + (D.brands.length ? '<ul class="brands">' + D.brands.map(brandCard).join('') + '</ul>' : empty('Brand stores are coming soon. Brands selling on Zed Supply will have their own store here.', '<a class="btn btn--primary" href="#/sell">Open a brand store</a>')) +
        '<p class="view-foot">Own a brand? <a href="#/sell">Open a brand store on Zed Supply</a>.</p>', 'Brand stores');
    },

    brand: function (id) {
      var b = brand(id);
      if (!b) return views.notfound();
      listing({ title: esc(b.name), crumbs: [['Brand stores', '#/brands'], [b.name]], list: products.filter(function (p) { return p.brand === id; }), docTitle: b.name,
        extra: '<div class="store-hero" style="--brand-a:' + b.colours[0] + ';--brand-b:' + b.colours[1] + '"><p>' + esc(b.tagline) + '</p>' + identityArt(b) + '</div>' });
    },

    store: function (id) {
      var s = seller(id);
      if (!s) return views.notfound();
      var promos = sortPromos(allPromos().filter(function (pr) { return pr.seller === id && promoStatus(pr) !== 'ended'; }));
      listing({ title: esc(s.name), crumbs: [['Stores'], [s.name]], list: products.filter(function (p) { return p.seller === id; }), docTitle: s.name,
        extra: '<div class="store-hero" style="--brand-a:' + s.colours[0] + ';--brand-b:' + s.colours[1] + '"><p>' + esc(s.city) + verifiedHTML(s) + '</p><p>' + esc(s.about) + '</p>' + identityArt(s) + '</div>' +
          (promos.length ? '<h2>Promotions</h2><ul class="promos promos--gap">' + promos.map(promoCard).join('') + '</ul>' : '') });
    },

    world: function () {
      if (!china) {
        show(crumbs([['Shop the World']]) +
          '<div class="band band--world band--big"><span class="eyebrow eyebrow--light">Shop the World</span><h1>Coming soon: shop from China and beyond</h1>' +
          '<p>We\'re putting supplier agreements in place first. When Shop the World opens, you\'ll be able to order from overseas marketplaces through Zed Supply as your local agent.</p>' +
          ticks(['The full landed cost in Kwacha shown upfront, including shipping and clearance', 'An estimated delivery time on every product', 'One local contact in Lusaka for your order']) +
          '<a class="btn btn--light" href="#" data-wa-message="Hi Zed Supply, please let me know when Shop the World opens." target="_blank" rel="noopener noreferrer">Tell me when it opens</a></div>' +
          '<p class="view-foot">Until then, <a href="#request">send us a request</a> and we\'ll source it locally.</p>', 'Shop the World');
        return;
      }
      var intl = D.products.filter(function (p) { return p.source === 'china'; });
      show(crumbs([['Shop the World']]) + head('Shop the World', 'Products from China, with the estimated landed cost in Kwacha. Exchange rate: 1 CNY = K' + S.exchangeRate.toFixed(2) + ' (updated ' + esc(S.rateUpdated) + ').') +
        '<ul class="grid">' + cards(intl) + '</ul>' +
        '<section class="section"><h2>Landed cost calculator</h2><form class="form form--card form--narrow" id="calc">' +
          '<div class="field"><label for="c-cny">Item price in Chinese Yuan (CNY)</label><input id="c-cny" type="number" min="0" step="0.01" value="100" inputmode="decimal"></div>' +
          '<div class="field-row"><div class="field"><label for="c-kg">Weight per item (kg)</label><input id="c-kg" type="number" min="0" step="0.1" value="1" inputmode="decimal"></div><div class="field"><label for="c-qty">Quantity</label><input id="c-qty" type="number" min="1" value="1" inputmode="numeric"></div></div>' +
          '<dl class="totals" id="c-out" aria-live="polite"></dl><p class="hint">Estimate. Final price confirmed on WhatsApp before you pay.</p></form></section>', 'Shop the World');
      var calc = function () {
        var c = chinaCost(parseFloat($('#c-cny').value) || 0, parseFloat($('#c-kg').value) || 0, Math.max(1, parseInt($('#c-qty').value, 10) || 1));
        $('#c-out').innerHTML = [['Item', c.item], ['Shipping', c.shipping], ['Clearance & duties', c.clearance], ['Service fee', c.fee]].map(function (r) { return '<div><dt>' + r[0] + '</dt><dd>' + kwacha(r[1]) + '</dd></div>'; }).join('') + '<div class="is-total"><dt>Estimated total</dt><dd>' + kwacha(c.total) + '</dd></div>';
      };
      $('#calc').addEventListener('input', calc); calc();
    },

    notfound: function () {
      show(head('We couldn\'t find that') + empty('It may have moved or no longer exist.', '<a class="btn btn--primary" href="#">Back to the store</a>'), 'Not found');
    }
  };

  // "Saved for later" items in the cart: adding one to the cart removes it from the saved list
  function bindSaved() {
    view.onclick = function (e) {
      var rm = e.target.closest('[data-remove]'), sv = e.target.closest('[data-save]'), ad = e.target.closest('[data-add]');
      if (rm || sv) {
        var id = (rm || sv).getAttribute(rm ? 'data-remove' : 'data-save');
        setCart(cart().filter(function (l) { return l.id !== id; }));
        if (sv) { var s2 = store.get('saved', []); if (s2.indexOf(id) === -1) s2.push(id); store.set('saved', s2); toast('Saved for later'); }
        views.cart();
      }
      if (e.target.closest('#clear-cart')) { setCart([]); views.cart(); }
      if (ad) {
        var aid = ad.getAttribute('data-add');
        if (store.get('saved', []).indexOf(aid) !== -1) {
          store.set('saved', store.get('saved', []).filter(function (x) { return x !== aid; }));
          setTimeout(views.cart, 0);
        }
      }
    };
  }

  function route() {
    view.onclick = null;
    var h = location.hash;
    if (h.indexOf('#/') !== 0 || h === '#/') {
      view.hidden = true; view.innerHTML = '';
      home.hidden = false;
      document.title = homeTitle;
      $$('.subnav a[aria-current]').forEach(function (a) { a.removeAttribute('aria-current'); });
      renderHome();
      if (h.length > 1 && h !== '#/') { var t = document.getElementById(h.slice(1)); if (t) t.scrollIntoView(); }
      return;
    }
    var parts = h.slice(2).split('?'), path = parts[0].split('/');
    var q = new URLSearchParams(parts[1] || '');
    (views[path[0]] || views.notfound)(decodeURIComponent(path[1] || ''), q);
  }

  // Support index.html?q=term (from other pages and search engines)
  var params = new URLSearchParams(location.search);
  if (params.has('q') && location.hash.indexOf('#/') !== 0) {
    var target = '#/search?q=' + encodeURIComponent(params.get('q') || '') + (params.get('dept') ? '&dept=' + encodeURIComponent(params.get('dept')) : '');
    try { history.replaceState(null, '', location.pathname + target); } catch (e) { location.hash = target; }
  }
  window.addEventListener('hashchange', route);
  route();
  }
})();
