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

  // Release version from this script's own address (main.js?v=…), added to files loaded later,
  // so a visitor never mixes files from two releases. Change ?v= on every page when releasing.
  var selfSrc = (document.currentScript || {}).src || '';
  var RELEASE = (/[?&]v=([\w.-]+)/.exec(selfSrc) || [])[1] || '';
  function versioned(path) { return RELEASE ? path + '?v=' + RELEASE : path; }

  // Demo mode (?demo=1) shows sample sellers and products. settings.allowDemo: false turns it
  // off completely, for a production site with real listings.
  var allowDemo = !(window.ZS_CATALOGUE && window.ZS_CATALOGUE.settings && window.ZS_CATALOGUE.settings.allowDemo === false);
  var demoOn = false;
  try {
    if (/[?&]demo=1\b/.test(location.search)) sessionStorage.setItem('zs-demo', '1');
    if (/[?&]demo=0\b/.test(location.search) || !allowDemo) sessionStorage.removeItem('zs-demo');
    demoOn = allowDemo && sessionStorage.getItem('zs-demo') === '1';
  } catch (e) { demoOn = allowDemo && /[?&]demo=1\b/.test(location.search); }
  var backendInitialized = false;
  if (demoOn && !window.ZS_SAMPLE) {
    var demoScript = document.createElement('script');
    demoScript.src = versioned('js/catalogue-sample.js');
    demoScript.onload = demoScript.onerror = start;
    document.head.appendChild(demoScript);
  } else start();

  function start() {
  if (!demoOn && !backendInitialized && window.ZSBackend && window.ZSBackend.enabled()) {
    backendInitialized = true;
    // Delivery prices have one source, the database: the same figures checkout charges
    window.ZSBackend.initialize().then(function () {
      return window.ZSBackend.rpc('delivery_settings', {}).then(function (x) { window.ZS_DELIVERY_SETTINGS = x; }, function () { /* fees stay "confirmed on WhatsApp" */ });
    }).then(start, start);
    return;
  }
  var root = document.documentElement;
  /* Extensions (js/marketplace.js) register hooks and pages in window.ZSExt before this runs.
     A hook returns HTML to insert, or does its work and returns nothing. A failing extension is
     logged and skipped, so the core store keeps working without it. */
  var EXT = window.ZSExt || { hooks: {}, views: {} };
  function ext(name) {
    var f = EXT.hooks[name];
    if (!f) return '';
    try { var r = f.apply(null, Array.prototype.slice.call(arguments, 1)); return r == null ? '' : r; } catch (e) { if (window.console) console.error(e); return ''; }
  }
  root.classList.remove('no-js');
  root.classList.add('js');

  var D = window.ZS_CATALOGUE || { settings: {}, departments: [], products: [], sellers: [], brands: [], promotions: [], seasons: [], vouchers: [], banners: [] };
  var S = D.settings || {};
  // Every department gets its line icon and a short name, and its subcategories as { id, name }
  (D.departments || []).forEach(function (d) {
    if (!d.icon) d.icon = '<img src="assets/icons/' + d.id + '.svg" alt="" width="32" height="32">';
    if (!d.short) d.short = d.name;
    d.subs = (d.subs || []).map(function (s) { return Array.isArray(s) ? { id: s[0], name: s[1] } : s; });
  });
  var DEMO = demoOn && !!window.ZS_SAMPLE;
  if (DEMO) {
    var X = window.ZS_SAMPLE;
    ['sellers', 'brands', 'products', 'promotions', 'vouchers'].forEach(function (k) { D[k] = (D[k] || []).concat(X[k] || []); });
    D.banners = (D.banners || []).slice(0, 2).concat(X.banners || [], (D.banners || []).slice(2));
    if (!D.demoOrder) D.demoOrder = X.demoOrder;
    // Sample delivery times, so the demo can show dates, while the real ones are still unset
    var liveEst = (S.delivery || {}).estimates || {};
    if (X.deliveryEstimates && S.delivery && !Object.keys(liveEst).some(function (k) { return liveEst[k]; })) {
      S.delivery.estimates = X.deliveryEstimates; S.delivery.sampleEstimates = true;
    }
    if (X.sameDay && S.delivery && !((S.delivery.sameDay || {}).towns || []).length) { S.delivery.sameDay = X.sameDay; S.delivery.sampleSameDay = true; }
    if (X.sellerDeadlines && !(S.sellerDeadlines && S.sellerDeadlines.acceptHours)) S.sellerDeadlines = Object.assign({}, X.sellerDeadlines, { sample: true });
    // Sample delivery prices, or the ones changed in the demo back office on this device
    var demoDelivery = null;
    try { demoDelivery = JSON.parse(localStorage.getItem('zs-demo-delivery') || 'null'); } catch (e) { /* blocked */ }
    if (X.deliveryRates) applyDeliverySettings(demoDelivery || { rates: X.deliveryRates, freeDelivery: X.freeDelivery, origin: X.deliveryOrigin }, true);
    S.isSample = true;
    S.vat = Object.assign({}, S.vat, { registered: true, tpin: '[SAMPLE TPIN]' });
    // Sample sales are [this month, last month], so the demo's trending and top picks never go stale
    var mk = function (d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2); }, n0 = new Date();
    D.products.forEach(function (p) {
      if (!p.demoSales) return;
      p.sales = {};
      p.sales[mk(n0)] = p.demoSales[0];
      p.sales[mk(new Date(n0.getFullYear(), n0.getMonth() - 1, 1))] = p.demoSales[1];
    });
    // Rolling sample promotions keep the demo useful after the dated seasonal examples end.
    D.promotions.forEach(function (pr) {
      if (!pr.sample || !pr.demoDays) return;
      function relativeDay(offset) {
        var d = new Date(n0.getFullYear(), n0.getMonth(), n0.getDate() + offset);
        return mk(d) + '-' + ('0' + d.getDate()).slice(-2);
      }
      pr.starts = relativeDay(pr.demoDays[0]); pr.ends = relativeDay(pr.demoDays[1]);
    });
  }
  if (!DEMO && window.ZS_DELIVERY_SETTINGS) applyDeliverySettings(window.ZS_DELIVERY_SETTINGS, false);
  /* Delivery prices have one source: the database's rate card when connected (staff edit it in the
     back office), or the sample card in demo mode, which the demo back office can change on this
     device. Nothing in catalogue.js prices delivery. */
  function applyDeliverySettings(x, sample) {
    var dl = S.delivery = S.delivery || {};
    dl.rates = (x.rates || []).filter(function (r) { return r.active !== false; }).map(function (r) {
      return { courier: r.courier || undefined, zone: r.zone, speed: r.speed, fee: Number(r.fee), kg: Number(r.kg) || 0, perKg: Number(r.perKg) || 0, days: r.days && r.days.length === 2 ? [Number(r.days[0]), Number(r.days[1])] : undefined };
    });
    dl.allRates = (x.rates || []).map(function (r) { return Object.assign({}, r); });
    dl.freeDelivery = x.freeDelivery && x.freeDelivery.min != null && x.freeDelivery.min !== '' ? { min: Number(x.freeDelivery.min), zones: x.freeDelivery.zones || [] } : { min: null, zones: (x.freeDelivery && x.freeDelivery.zones) || [] };
    if (x.defaultKg) dl.defaultKg = Number(x.defaultKg);
    dl.origin = x.origin && x.origin.town ? x.origin : null;
    if (x.sameDay) { dl.sameDay = { cutoff: Number(x.sameDay.cutoff), towns: x.sameDay.towns || [] }; dl.sampleSameDay = !!sample; }
    if (x.closedDays) dl.closedDays = x.closedDays.map(Number);
    dl.sampleRates = !!sample;
  }
  function deliverySettingsNow() {
    var dl = S.delivery || {};
    return { rates: dl.allRates || dl.rates || [], freeDelivery: dl.freeDelivery || { min: null, zones: [] }, defaultKg: dl.defaultKg || 1,
      origin: dl.origin || null, sameDay: dl.sameDay || { cutoff: 11, towns: [] }, closedDays: dl.closedDays || [0] };
  }
  var china = !!S.chinaOrdering;
  function secureMode() { return !DEMO && window.ZSBackend && window.ZSBackend.enabled(); }
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
    },
    remove: function (k) {
      delete mem[k];
      try { localStorage.removeItem('zs-' + k); return true; } catch (e) { return false; }
    }
  };

  /* ---------- Small helpers ---------- */
  function $(sel, scope) { return (scope || document).querySelector(sel); }
  function $$(sel, scope) { return Array.prototype.slice.call((scope || document).querySelectorAll(sel)); }
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  // Whole Kwacha show as K490; amounts with ngwee always show two places, K492.80
  function kwacha(n) {
    var v = Math.round((Number(n) + Number.EPSILON) * 100) / 100, cents = v % 1 !== 0;
    return 'K' + v.toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: 2 });
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  /* A reference such as ZS-7K2QH9TX: 8 random characters from the browser's secure generator
     (31 characters, without 0/O/1/I/L, so it reads clearly over the phone), about 850 billion
     possibilities. The clock alone repeated every few weeks, so two orders could share a number.
     Once orders are saved on the server, it should confirm the reference is unused. */
  function newRef(prefix) {
    var chars = '23456789ABCDEFGHJKMNPQRSTUVWXYZ', out = '', bytes = new Uint8Array(8);
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(bytes);
    else for (var j = 0; j < 8; j++) bytes[j] = Math.floor(Math.random() * 256);
    for (var i = 0; i < 8; i++) out += chars[bytes[i] % chars.length];
    return (prefix ? prefix + '-' : '') + out;
  }
  var now = new Date();
  var today = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
  function niceDate(iso) {
    var p = String(iso).split('-');
    if (p.length !== 3) return esc(iso);
    return Number(p[2]) + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(p[1]) - 1] + ' ' + p[0];
  }
  function byId(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }
  function dept(id) { return byId(D.departments, id) || { name: '', short: '', icon: '🛍️', subs: [] }; }
  function subOf(p) { return p && p.sub ? byId(dept(p.category).subs, p.sub) : null; }
  function seller(id) { return byId(D.sellers, id); }
  function brand(id) { return byId(D.brands, id); }
  function season(id) { return byId(D.seasons, id) || { name: '', colours: ['#0A2A66', '#0057AE'] }; }
  function icon(path, extra) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"' + (extra || '') + '>' + path + '</svg>';
  }
  var I = {
    comet: '<path class="comet__tail" d="m2 16 6-4m-4 9 5-5"/><path class="comet__star" d="m15 2 2 4.8 5.2.5-4 3.4 1.2 5.1-4.4-2.7-4.4 2.7 1.2-5.1-4-3.4 5.2-.5Z"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/>'
  };

  /* ---------- Festive periods (dates in js/catalogue.js, settings.festive) ----------
     One period at a time gets the bar above the header and the first homepage banner
     slide. Moveable dates are worked out for each year, and periods never overlap:
     one that would start before the previous one ends waits until it has ended.
     ?theme=<id> previews a period on any date (?theme=zambia is Independence);
     ?theme=off hides them. */
  var FEST = S.festive || { enabled: true, independenceYear: 1964, periods: [{ id: 'independence', start: '10-01', end: '10-31' }] };
  var DAY = 86400000;
  var today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  function dayOf(y, m, d) { return new Date(y, m, d); }
  function shift(d, n) { return dayOf(d.getFullYear(), d.getMonth(), d.getDate() + n); }
  function fromMonthDay(y, s) { var p = String(s).split('-'); return dayOf(y, Number(p[0]) - 1, Number(p[1])); }
  function nthWeekday(y, month, weekday, n) { var d = dayOf(y, month, 1); return shift(d, (weekday - d.getDay() + 7) % 7 + (n - 1) * 7); }
  function easterSunday(y) {
    // Anonymous Gregorian algorithm (Meeus/Jones/Butcher)
    var a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
    var h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    return dayOf(y, Math.floor((h + l - 7 * m + 114) / 31) - 1, ((h + l - 7 * m + 114) % 31) + 1);
  }
  // The dates of one period in year y. key is the day the copy counts down to.
  function festiveWindow(p, y) {
    if (p.rule === 'easter') { var es = easterSunday(y); return { start: shift(es, -13), end: shift(es, 1), key: shift(es, -2) }; }        // two weeks before, to Easter Monday
    if (p.rule === 'blackfriday') { var bf = shift(nthWeekday(y, 10, 4, 4), 1); return { start: shift(bf, -4), end: shift(bf, 3), key: bf }; }  // Monday to Cyber Monday
    if (p.rule === 'farmers') { var fd = nthWeekday(y, 7, 1, 1); return { start: shift(fd, -7), end: fd, key: fd }; }                       // the week before Farmers' Day
    var start = fromMonthDay(y, p.start), end = fromMonthDay(y, p.end);
    if (end < start) end = fromMonthDay(y + 1, p.end);   // runs into the new year (Christmas to New Year's Day)
    return { start: start, end: end, key: p.day ? fromMonthDay(y, p.day) : null };
  }
  function festiveCalendar(y) {
    var list = [];
    (FEST.periods || []).forEach(function (p) {
      if (p.enabled === false) return;
      [y - 1, y].forEach(function (yr) { var w = festiveWindow(p, yr); w.id = p.id; list.push(w); });
    });
    list.sort(function (a, b) { return a.start - b.start; });
    var out = [], lastEnd = null;
    list.forEach(function (w) {
      if (lastEnd && w.start <= lastEnd) w.start = shift(lastEnd, 1);
      if (w.start <= w.end) { out.push(w); lastEnd = w.end; }
    });
    return out;
  }
  var themeParam = (location.search.match(/[?&]theme=([a-z]+)\b/) || [])[1];
  if (themeParam === 'zambia') themeParam = 'independence';
  var fest = null;
  if (themeParam && themeParam !== 'off') {
    festiveCalendar(now.getFullYear()).forEach(function (w) { if (w.id === themeParam && (!fest || w.start.getFullYear() === now.getFullYear())) fest = w; });
  } else if (!themeParam && FEST.enabled !== false) {
    festiveCalendar(now.getFullYear()).forEach(function (w) { if (w.start <= today0 && today0 <= w.end) fest = w; });
  }
  var zambia = !!fest && fest.id === 'independence';
  root.classList.toggle('theme-zambia', zambia);

  function ordinal(n) { var s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
  function longDate(d) { return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getDay()] + ' ' + d.getDate() + ' ' + ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][d.getMonth()]; }
  function festiveDeals(id) { return allPromos().some(function (pr) { return pr.season === id && promoStatus(pr) === 'live'; }); }
  // Bar wording for each period. lead is bold; days counts down to the period's key day.
  function festiveCopy(w) {
    var days = w.key ? Math.round((w.key - today0) / DAY) : null;
    var count = function (n, name) { return n === 1 ? name + ' is tomorrow' : n + ' days to ' + name; };
    if (w.id === 'independence') {
      var yrs = w.key.getFullYear() - (FEST.independenceYear || 1964);
      if (days > 0) return { lead: count(days, 'Independence Day'), line: 'Zambia celebrates ' + yrs + ' years of independence on 24 October.' };
      if (days === 0) return { lead: 'Happy ' + ordinal(yrs) + ' Independence Day, Zambia!', line: 'Celebrating ' + yrs + ' years since 24 October 1964.' };
      return { lead: 'Celebrating ' + yrs + ' years of independence', line: 'Thank you for shopping Zambian this Independence month.' };
    }
    if (w.id === 'christmas') {
      var next = w.key.getFullYear() + 1;
      if (days > 0) return { lead: count(days, 'Christmas'), line: 'Gifts, treats and festive essentials from Zambian sellers.' };
      if (days === 0) return { lead: 'Merry Christmas from Zed Supply!', line: 'Thank you for shopping with Zambian sellers this year.' };
      return { lead: today0.getMonth() === 0 ? 'Happy New Year!' : 'Happy holidays from Zed Supply', line: 'Wishing you a happy and prosperous ' + next + '.' };
    }
    if (w.id === 'easter') {
      if (days > 0) return { lead: 'Easter weekend: ' + longDate(w.key) + ' to ' + longDate(w.end), line: 'Get ready for family get-togethers with Zambian sellers.' };
      return { lead: 'Happy Easter from Zed Supply', line: 'Wishing you a peaceful Easter weekend.' };
    }
    if (w.id === 'valentines') {
      if (days > 0) return { lead: count(days, 'Valentine\'s Day'), line: 'Gifts for someone special from Zambian sellers.' };
      return { lead: 'Happy Valentine\'s Day', line: 'Gifts for someone special from Zambian sellers.' };
    }
    if (w.id === 'farmers') return { lead: days > 0 ? 'Farmers\' Day is ' + longDate(w.key) : 'Happy Farmers\' Day', line: 'Celebrating Zambia\'s farmers: seed, tools and farm equipment from local suppliers.' };
    if (w.id === 'blackfriday') return { lead: days > 0 ? 'Black Friday is ' + longDate(w.key) : days === 0 ? 'It\'s Black Friday' : 'Black Friday weekend', line: 'Look out for seller deals all week, through to Cyber Monday.' };
    if (w.id === 'school') return { lead: 'Back to school', line: 'Stationery, bags and school essentials for the new term.' };
    return { lead: season(w.id).name, line: '' };
  }
  // Where the bar and banner link: the period's promotions when sellers run any, otherwise a fitting page
  var FEST_LINKS = {
    independence: ['Independence', '#/departments', 'Shop local'], christmas: ['Christmas', '#/departments', 'Shop gifts'],
    easter: ['Easter', '#/departments', 'Shop now'], valentines: ['Valentine\'s', '#/departments', 'Find a gift'],
    farmers: ['Farmers\' Day', '#/dept/agri', 'Shop farming'], blackfriday: ['Black Friday', '#/deals', 'Today\'s deals'],
    school: ['Back-to-school', '#/dept/office', 'Shop school supplies']
  };
  function festiveLink(id) {
    var l = FEST_LINKS[id] || [season(id).name, '#/departments', 'Shop now'];
    return festiveDeals(id) ? { href: '#/promotions?season=' + id, text: l[0] + ' deals' } : { href: l[1], text: l[2] };
  }
  if (fest) {
    var fc = festiveCopy(fest), fl = festiveLink(fest.id), fs = season(fest.id), bar = document.createElement('div');
    bar.className = 'fest-bar fest-bar--' + fest.id;
    bar.setAttribute('role', 'note');
    bar.style.setProperty('--fest-a', fs.colours[0]);
    bar.style.setProperty('--fest-b', fs.colours[1]);
    bar.innerHTML = '<div class="container fest-bar__inner">' +
      (zambia ? '<img class="fest-bar__flag" src="assets/brand/zambia-flag.svg" alt="Flag of Zambia" width="28" height="19">' : '<span class="fest-bar__mark" aria-hidden="true"></span>') +
      '<p><strong>' + esc(fc.lead) + '</strong> ' + esc(fc.line) + '</p><a href="' + R + fl.href.slice(2) + '">' + esc(fl.text) + '</a></div>';
    var skipLink = $('.skip-link');
    if (skipLink) skipLink.parentNode.insertBefore(bar, skipLink.nextSibling);
  }

  /* ---------- Products, prices and promotions ----------
     Listings a seller saved in the Seller Centre (this browser only, for now) join the
     catalogue; an edited catalogue product is replaced by its saved copy. Listings from
     sellers who aren't in the catalogue, such as demo stores outside demo mode, stay hidden. */
  var ZP = window.ZSProduct;
  var listingsApi = ZP.listings({ get: store.get, set: function (k, v) { if (trySave(k, v)) return true; mem[k] = v; return false; } });
  var BASE_PRODUCTS = D.products.slice();
  var products, localProducts;
  function loadProducts() {
    var saved = secureMode() ? [] : listingsApi.list().filter(function (p) { return seller(p.seller); }), byIdSaved = {};
    saved.forEach(function (p) { byIdSaved[p.id] = p; });
    D.products = BASE_PRODUCTS.map(function (p) { var s = byIdSaved[p.id]; delete byIdSaved[p.id]; return s || p; })
      .concat(saved.filter(function (p) { return byIdSaved[p.id]; }));
    products = D.products.filter(function (p) { return china || p.source !== 'china'; });
    localProducts = products.filter(function (p) { return p.source !== 'china'; });
  }
  loadProducts();
  function product(id) { return byId(D.products, id); }

  function allPromos() { return D.promotions.concat(store.get('promos', [])); }
  function promoStatus(pr) { return today < pr.starts ? 'upcoming' : (today > pr.ends ? 'ended' : 'live'); }
  // A promotion limited to some provinces (areas) applies only when the buyer's location is in one
  function promoHere(pr) { return !(pr.areas && pr.areas.length) || (!!loc && pr.areas.indexOf(provinceOf(loc)) !== -1); }
  function promoAreasText(pr) { return pr.areas && pr.areas.length ? 'Only in ' + pr.areas.map(provinceName).filter(Boolean).join(', ') : ''; }
  function livePromoFor(p) {
    var best = null;
    allPromos().forEach(function (pr) {
      if (promoStatus(pr) === 'live' && pr.products.indexOf(p.id) !== -1 && promoHere(pr) && (!best || pr.discount > best.discount)) best = pr;
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
  /* Deals: a seller lowers the price of one product, with a reason and an optional end
     date. From catalogue.js (deal: { price, reason, ends }) or made in the Seller Centre
     (saved in this browser in the prototype). The lowest live price wins. */
  var DEAL_REASONS = { reduced: 'Price drop', clearance: 'Clearance', limited: 'Limited stock', bundle: 'Bundle offer', seasonal: 'Seasonal deal' };
  function dealFor(p) {
    var best = null;
    (p.deal ? [p.deal] : []).concat(store.get('deals', []).filter(function (d) { return d.product === p.id; })).forEach(function (d) {
      var price = Number(d.price);
      if (price > 0 && price < p.priceZMW && (!d.starts || d.starts <= today) && (!d.ends || d.ends >= today) && (!best || price < best.price)) best = { price: price, reason: d.reason, ends: d.ends || '', id: d.id };
    });
    return best;
  }
  function priceOf(p) {
    if (p.source === 'china') return { now: chinaCost(p.priceCNY, p.weightKg, 1).total, was: 0, off: 0, promo: null, deal: null };
    var base = p.priceZMW, promo = livePromoFor(p), deal = dealFor(p), nowP = base, was = p.wasZMW || 0;
    if (promo) { nowP = Math.round(base * (1 - promo.discount / 100) * 100) / 100; was = Math.max(was, base); }
    if (deal && deal.price < nowP) { nowP = deal.price; promo = null; was = Math.max(was, base); } else deal = null;
    return { now: nowP, was: was > nowP ? was : 0, off: was > nowP ? Math.round((1 - nowP / was) * 100) : 0, promo: promo, deal: deal };
  }
  function onDeal(p) { var pr = priceOf(p); return !!(pr.was || pr.promo || pr.deal); }
  function reviewsFor(p) { return (p.reviews || []).concat(secureMode() ? [] : (store.get('reviews', {})[p.id]) || []); }
  // { avg, count, dist } where dist[n] counts the n-star reviews; null when there are none
  function ratingOf(p) {
    var r = ZP.ratingSummary(reviewsFor(p));
    return r.count ? r : null;
  }
  function searchText(p) {
    var b = brand(p.brand), s = seller(p.seller);
    return [p.title, p.tags, dept(p.category).name, (subOf(p) || {}).name || '', b ? b.name : '', s ? s.name : '', ZP.attrText(p)].join(' ').toLowerCase();
  }

  /* ---------- Trending and top picks ----------
     Scores come from what buyers do. Until shared accounts arrive (Phase 2) there are two sources:
       1. sales in catalogue.js: units sold per month, e.g. sales: { '2026-10': 14, '2026-09': 9 },
          recorded by Zed Supply from orders confirmed on WhatsApp;
       2. activity on this device: products ordered, in the cart, saved and viewed.
     Reviews add to a product's score; a live deal or a listing under 30 days old adds a small boost,
     but only to products buyers are already showing interest in. */
  var W = { sold: 5, ordered: 3, cart: 2, wish: 1.5, viewed: 1, review: 2, deal: 1.5, fresh: 1 };
  function monthKey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1); }
  var thisMonth = monthKey(now), lastMonth = monthKey(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  function monthName(key) { var p = key.split('-'); return ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][Number(p[1]) - 1]; }
  function localActivity() {
    var a = {}, get = function (id) { return a[id] || (a[id] = { months: {}, cart: 0, wish: 0, viewed: 0 }); };
    store.get('orders', []).forEach(function (o) {
      var key = String(o.date || '').slice(0, 7);
      (o.items || []).forEach(function (it) { var m = get(it.id).months; m[key] = (m[key] || 0) + (parseInt(it.qty, 10) || 1); });
    });
    store.get('cart', []).forEach(function (l) { get(l.id).cart = 1; });
    store.get('wish', []).forEach(function (id) { get(id).wish = 1; });
    store.get('recent', []).forEach(function (id) { get(id).viewed = 1; });
    return a;
  }
  function trendScore(p, act) {
    var s = p.sales || {}, a = act[p.id] || { months: {} }, r = ratingOf(p);
    var demand = W.sold * ((s[thisMonth] || 0) + 0.5 * (s[lastMonth] || 0)) +
      W.ordered * ((a.months[thisMonth] || 0) + 0.5 * (a.months[lastMonth] || 0)) +
      W.cart * (a.cart || 0) + W.wish * (a.wish || 0) + W.viewed * (a.viewed || 0) +
      (r ? W.review * (r.avg / 5) * Math.log(1 + r.count) : 0);
    if (!demand) return 0;
    var fresh = p.added && (now - new Date(p.added + 'T00:00:00')) / 86400000 <= 30;
    return demand + (onDeal(p) ? W.deal : 0) + (fresh ? W.fresh : 0);
  }
  function monthScore(p, key, act) {
    var a = act[p.id] || { months: {} };
    var revs = reviewsFor(p).filter(function (v) { return String(v.date).slice(0, 7) === key; });
    return W.sold * (((p.sales || {})[key]) || 0) + W.ordered * (a.months[key] || 0) +
      W.review * revs.reduce(function (t, v) { return t + (Number(v.rating) || 0) / 5; }, 0);
  }
  // Ranked trending products, grouped by category, busiest category first
  function trendingGroups() {
    var act = localActivity(), groups = {};
    localProducts.forEach(function (p) {
      var s = trendScore(p, act);
      if (s > 0) (groups[p.category] = groups[p.category] || []).push({ p: p, s: s });
    });
    return Object.keys(groups).map(function (id) {
      var list = groups[id].sort(function (a, b) { return b.s - a.s; });
      return { id: id, top: list[0].s, items: list.map(function (x) { return x.p; }) };
    }).sort(function (a, b) { return b.top - a.top; });
  }
  function topPicks(key) {
    var act = localActivity();
    return localProducts.map(function (p) { return { p: p, s: monthScore(p, key, act) }; })
      .filter(function (x) { return x.s > 0; }).sort(function (a, b) { return b.s - a.s; }).map(function (x) { return x.p; });
  }

  /* ---------- Similar products from different sellers ----------
     Products with the same match key in catalogue.js (match: 'solar-lantern') are the same
     item from different sellers. Otherwise, products in the same category whose titles and
     tags share enough words count as similar. */
  function words(p) {
    var stop = { with: 1, and: 1, for: 1, the: 1, of: 1, in: 1, set: 1, pieces: 1 };
    return (p.title + ' ' + (p.tags || '')).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(function (w) { return w.length > 2 && !stop[w]; });
  }
  function likeness(a, b) {
    var wa = words(a), wb = words(b), shared = wa.filter(function (w) { return wb.indexOf(w) !== -1; }).length;
    return shared / Math.max(1, Math.min(wa.length, wb.length));
  }
  function sameItem(p) { return p.match ? localProducts.filter(function (x) { return x.id !== p.id && x.match === p.match; }) : []; }
  function similarTo(p, max) {
    var same = sameItem(p);
    var near = localProducts.filter(function (x) { return x.id !== p.id && x.category === p.category && same.indexOf(x) === -1 && likeness(p, x) >= 0.34; })
      .sort(function (a, b) { return likeness(p, b) - likeness(p, a); });
    return same.sort(function (a, b) { return priceOf(a).now - priceOf(b).now; }).concat(near).slice(0, max || 3);
  }
  // Groups of the same item sold by two or more sellers, within one category
  function multiSellerGroups(cat, sub) {
    var seen = {}, out = [];
    localProducts.forEach(function (p) {
      if (!p.match || seen[p.match] || (cat && p.category !== cat) || (sub && p.sub !== sub)) return;
      var all = [p].concat(sameItem(p)).filter(function (x) {
        return (!cat || x.category === cat) && (!sub || x.sub === sub);
      });
      var sellers = all.map(function (x) { return x.seller; }).filter(function (s, i, l) { return s && l.indexOf(s) === i; });
      seen[p.match] = 1;
      if (sellers.length > 1) out.push({ key: p.match, items: all, from: Math.min.apply(null, all.map(function (x) { return priceOf(x).now; })) });
    });
    return out;
  }

  // Compare list: up to 4 products, kept on this device
  var COMPARE_MAX = 4;
  function compareList() { return store.get('compare', []).filter(function (id) { return product(id); }); }
  function toggleCompare(id) {
    var c = compareList(), i = c.indexOf(id);
    if (i !== -1) c.splice(i, 1);
    else { if (c.length >= COMPARE_MAX) c.shift(); c.push(id); }
    store.set('compare', c);
    return i === -1;
  }

  /* ---------- Cart, wishlist, account state ---------- */
  function cart() { return store.get('cart', []); }
  function setCart(c) { store.set('cart', c); updateCounts(); ext('cartChanged', c); }
  function wish() { return store.get('wish', []); }
  function isLiked(id) { return wish().indexOf(id) !== -1; }
  function user() { return secureMode() ? window.ZSBackend.profile() : store.get('user', null); }
  // opt (optional): { colour, size, addons: [inBox index], commit: offer per item }.
  // The same product with different options is a separate line.
  function lineKey(l) { return l.id + (l.opt ? '|' + JSON.stringify(l.opt) : ''); }
  function addToCart(id, qty, opt) {
    var p = product(id), v = p ? variantOf(p, opt) : null;
    if (!p || !ZP.qtyAllowed(p, qty)) { toast('Choose ' + (p ? qtyRange(p) : 'a quantity from 1 to 99') + '.', 'warn'); return false; }
    if (p._server && p._server.stock_qty !== null && !ZP.hasOptions(p) && qty + cart().filter(function (l) { return l.id === id; }).reduce(function (n, l) { return n + l.qty; }, 0) > p._server.stock_qty) { toast('This item does not have enough stock for that quantity.', 'error'); return false; }
    if (ZP.hasOptions(p)) {
      var already = cart().filter(function (l) { var cv = l.id === id ? variantOf(p, l.opt) : null; return cv && v && cv.sku === v.sku; })
        .reduce(function (sum, l) { return sum + l.qty; }, 0);
      if (!v || qty + already > v.stock) { toast('That variation does not have enough stock for your cart.', 'error'); return false; }
    }
    var c = cart(), line = null, key = lineKey({ id: id, opt: opt });
    for (var i = 0; i < c.length; i++) if (lineKey(c[i]) === key) line = c[i];
    // seen: the price per item when added, so the cart can say if it has changed since
    if (line) line.qty = ZP.fitQty(p, line.qty + qty); else { line = opt ? { id: id, qty: qty, opt: opt } : { id: id, qty: qty }; line.seen = lineQuote(p, opt).q.each; c.push(line); }
    setCart(c);
    return true;
  }
  /* ---------- Trade quantities ----------
     A listing sold by the bag, tonne or sheet says so beside its price; a trade listing can
     also set a minimum order and multiples (js/products.js orderRules). */
  // "a quantity from 20 to 9,990 bags, in multiples of 10"; upTo caps it at the stock left
  function qtyRange(p, upTo) {
    var r = ZP.orderRules(p), max = upTo != null ? Math.min(r.max, upTo - upTo % r.step) : r.max;
    return 'a quantity from ' + r.min.toLocaleString('en-US') + ' to ' + (ZP.sellUnit(p) ? ZP.qtyText(p, max) : max.toLocaleString('en-US')) + (r.step > 1 ? ', in multiples of ' + r.step.toLocaleString('en-US') : '');
  }
  // "20 bags", or plain "20" for a listing sold by the item
  function qtyLabel(p, n) { return ZP.sellUnit(p) ? ZP.qtyText(p, n) : String(n); }
  function perUnit(p) { var u = ZP.sellUnit(p); return u ? 'per ' + u[1] : 'each'; }
  function weightText(kg) { return kg >= 1000 ? (Math.round(kg / 10) / 100).toLocaleString('en-US') + ' tonnes' : (Math.round(kg * 1000) / 1000).toLocaleString('en-US') + ' kg'; }
  function qtyAttrs(p, value) { var r = ZP.orderRules(p); return 'type="number" min="' + r.min + '" max="' + r.max + '" step="' + r.step + '" value="' + value + '" inputmode="numeric"'; }
  // Product cards: "per bag · minimum 20"
  function tradeCardHTML(p) {
    var u = ZP.sellUnit(p), r = ZP.orderRules(p), bits = [];
    if (u) bits.push('per ' + u[1]);
    if (r.min > 1) bits.push('minimum ' + r.min.toLocaleString('en-US'));
    return bits.length ? '<p class="pmeta ptrade">' + esc(bits.join(' · ')) + '</p>' : '';
  }
  // Buy box: how it's sold, the minimum order, and how a heavy item travels
  function tradeHTML(p) {
    var r = ZP.orderRules(p), u = ZP.sellUnit(p), bits = [];
    if (u) bits.push('Price per ' + u[1]);
    if (ZP.qtyRuleText(p)) bits.push(ZP.qtyRuleText(p));
    if (r.weight) bits.push(weightText(r.weight) + ' per ' + ZP.unitName(p, 1));
    if (!r.trade && !bits.length && !r.heavy) return '';
    return '<div class="trade-terms">' + (r.trade ? '<p class="trade-terms__head"><span class="badge badge--trade">Trade</span> Order up to ' + esc(ZP.sellUnit(p) ? ZP.qtyText(p, r.max) : r.max.toLocaleString('en-US')) + ' at a time</p>' : '') +
      (bits.length ? '<p class="pmeta">' + esc(bits.join(' · ')) + '</p>' : '') +
      (r.heavy ? '<p class="pmeta trade-terms__freight">Heavy or bulky: delivered by truck, or collected. The delivery fee is quoted for your order before you pay.</p>' : '') + '</div>';
  }
  // Business details saved with the account, used at checkout: { name, tpin, address }
  function savedBusiness() {
    var u = user() || {};
    if (u.business) return u.business;
    return u.business_name ? { name: u.business_name, tpin: u.business_tpin || '', address: u.business_address || '' } : {};
  }
  // A Zambian TPIN is 10 digits; empty is allowed, as not every buyer has one to hand
  function tpinOK(v) { return !v || /^\d{10}$/.test(v); }
  // My Account: business details for trade buying, filled in at checkout and shown on order summaries
  function businessFormHTML(b) {
    return '<form class="form form--card" id="biz-form" novalidate><h2 id="business">Business details</h2><p class="pmeta">For buying for a farm, building site, shop or company. They fill in at checkout and appear on your order summary.</p>' +
      '<div class="field"><label for="bz-name">Business name</label><input id="bz-name" autocomplete="organization" maxlength="120" value="' + esc(b.name || '') + '"></div>' +
      '<div class="field"><label for="bz-tpin">TPIN (optional)</label><input id="bz-tpin" inputmode="numeric" maxlength="10" value="' + esc(b.tpin || '') + '" aria-describedby="bz-tpin-hint"><p class="hint" id="bz-tpin-hint">10 digits, from your ZRA registration.</p></div>' +
      '<div class="field"><label for="bz-addr">Billing address (optional)</label><input id="bz-addr" autocomplete="street-address" maxlength="200" value="' + esc(b.address || '') + '"></div>' +
      '<div class="btn-row"><button class="btn btn--primary" type="submit">Save business details</button>' + (b.name ? '<button class="link-btn link-btn--danger" type="button" id="bz-clear">Remove business details</button>' : '') + '</div><p class="form-status" role="status"></p></form>';
  }
  // save(details or null) may return a promise; the form reports what happened
  function bindBusinessForm(save) {
    var form = $('#biz-form'); if (!form) return;
    var st = $('.form-status', form), done = function (msg) { st.className = 'form-status'; st.textContent = ''; toast(msg, 'success'); route(); };
    var fail = function (msg, field) { st.className = 'form-status is-error'; st.textContent = msg; if (field) { field.setAttribute('aria-invalid', 'true'); field.focus(); } };
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      $$('[aria-invalid]', form).forEach(function (x) { x.removeAttribute('aria-invalid'); });
      var b = { name: cleanText($('#bz-name').value, 120), tpin: $('#bz-tpin').value.replace(/\s+/g, ''), address: cleanText($('#bz-addr').value, 200) };
      if (!b.name) return fail('Enter the business name.', $('#bz-name'));
      if (b.name.length < 2) return fail('Enter the full business name.', $('#bz-name'));
      if (!tpinOK(b.tpin)) return fail('Enter the TPIN as 10 digits, or leave it empty.', $('#bz-tpin'));
      if (hasCardNumber(b.address)) return fail(CARD_WARNING, $('#bz-addr'));
      Promise.resolve(save(b)).then(function () { done('Business details saved'); }, function (err) { fail(err.message); });
    });
    var clear = $('#bz-clear');
    if (clear) clear.addEventListener('click', function () { Promise.resolve(save(null)).then(function () { done('Business details removed'); }, function (err) { fail(err.message); }); });
  }
  // Price of one item on a cart line: the variant's own price, add-ons and any commit offer
  function variantOf(p, opt) { return opt && ZP.hasOptions(p) ? ZP.findVariant(p, opt) : null; }
  function basePriceOf(p, v) {
    if (!v || !v.priceZMW) return priceOf(p);
    var q = {}; for (var k in p) q[k] = p[k];
    q.priceZMW = v.priceZMW; q.wasZMW = 0;
    return priceOf(q);
  }
  function lineQuote(p, opt, qty) {
    var v = variantOf(p, opt), pr = basePriceOf(p, v), q = ZP.quote(p, pr.now, opt);
    // Bulk prices are set against the product's own price, so a variation with its own price doesn't get them
    var tier = !q.commit && !(v && v.priceZMW) ? ZP.tierPrice(p, qty) : 0;
    if (tier && tier < q.unit) { q.unit = tier; q.each = Math.round((tier + q.addTotal) * 100) / 100; q.bulk = true; }
    return { pr: pr, q: q, v: v };
  }
  function toggleLike(id) {
    var w = wish(), i = w.indexOf(id);
    if (i === -1) w.push(id); else w.splice(i, 1);
    store.set('wish', w);
    updateCounts();
    return i === -1;
  }
  /* Wishlist items that get bought. Nothing leaves the wishlist by itself: after an order, the
     confirmation asks once whether to remove the ones just bought (keeping them is the default,
     as people often buy again), and the wishlist marks what's in the cart and what was bought. */
  function noteBought(ids) {
    var b = store.get('bought', {});
    ids.forEach(function (id) { b[id] = today; });
    store.set('bought', b);
  }
  function rememberWished(ref, ids) {
    // Kept on the device so the question survives a reload; only the latest 20 orders are kept
    var pending = store.get('wish-pending', {}), refs;
    pending[ref] = wishedIn(ids);
    refs = Object.keys(pending);
    refs.slice(0, Math.max(0, refs.length - 20)).forEach(function (r) { delete pending[r]; });
    store.set('wish-pending', pending);
    noteBought(ids);
  }
  function wishedIn(ids) { var w = wish(); return ids.filter(function (id, i) { return w.indexOf(id) !== -1 && ids.indexOf(id) === i; }); }
  function wishPromptHTML(ref, ids) {
    ids = wishedIn(ids || []);
    if (!ids.length || store.get('wish-asked', {})[ref]) return '';
    var names = ids.map(function (id) { var p = product(id); return p ? p.title : id; });
    return '<div class="wish-prompt" data-wish-prompt="' + esc(ref) + '" tabindex="-1"><p><strong>' + (ids.length === 1 ? 'You bought something from your wishlist' : 'You bought ' + ids.length + ' things from your wishlist') + ':</strong> ' + esc(names.join(', ')) + '.</p>' +
      '<p class="pmeta">Keep ' + (ids.length === 1 ? 'it' : 'them') + ' there to buy again, or tidy your list.</p><div class="btn-row">' +
      '<button class="btn btn--secondary btn--sm" type="button" data-wish-remove="' + esc(ids.join(',')) + '">Remove from wishlist</button>' +
      '<button class="btn btn--secondary btn--sm" type="button" data-wish-keep>Keep on wishlist</button></div></div>';
  }
  function wishAsked(ref, answer) { var a = store.get('wish-asked', {}); if (answer) a[ref] = answer; else delete a[ref]; store.set('wish-asked', a); }
  function addRecent(id) {
    var r = store.get('recent', []).filter(function (x) { return x !== id; });
    r.unshift(id);
    store.set('recent', r.slice(0, 12));
  }

  /* ---------- Delivery location ----------
     { town, area, landmark, province, mode: 'delivery' | 'collection', via: 'typed' | 'gps' }.
     Kept for this browser tab (sessionStorage) unless the customer ticks "Remember on this
     device" (localStorage). Never sent anywhere except inside WhatsApp messages the customer
     chooses to send. GPS only finds the nearest town on the device; coordinates aren't kept. */
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
    loc = l && l.town ? { town: l.town, area: l.area || '', landmark: l.landmark || '', province: l.province || (townInfo(l.town) || {}).province || '',
      mode: l.mode === 'collection' ? 'collection' : 'delivery', via: l.via === 'gps' ? 'gps' : 'typed', remember: !!l.remember } : null;
    mem.location = loc;
    try { localStorage.removeItem('zs-location'); } catch (e) { /* blocked */ }
    try { sessionStorage.removeItem('zs-location'); } catch (e) { /* blocked */ }
    if (loc) {
      var data = JSON.stringify({ town: loc.town, area: loc.area, landmark: loc.landmark, province: loc.province, mode: loc.mode, via: loc.via });
      try { (loc.remember ? localStorage : sessionStorage).setItem('zs-location', data); } catch (e) { /* memory only */ }
    }
    refreshLoc();
  }
  function waUrl(message) {
    if (loc) message += '\n' + (loc.mode === 'collection' ? 'My location (collecting): ' : 'Delivery location: ') + locFull();
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
    $$('[data-location-label]').forEach(function (el) { el.textContent = loc ? (loc.mode === 'collection' ? 'Collect near: ' : 'Deliver to: ') + locShort() : 'Deliver to: set location'; });
    // Header pin: "Deliver to / Kitwe" or "Collect near / Kitwe"
    $$('[data-loc-pin]').forEach(function (el) { el.textContent = loc ? loc.town : 'Set location'; });
    $$('[data-loc-pin-mode]').forEach(function (el) { el.textContent = loc && loc.mode === 'collection' ? 'Collect near' : 'Deliver to'; });
    // Product page delivery block follows the new location straight away
    $$('[data-fulfil]').forEach(function (el) { var fp = product(el.getAttribute('data-fulfil')); if (fp) el.innerHTML = fulfilHTML(fp); });
    $$('[data-loc-summary]').forEach(function (el) { el.innerHTML = locSummaryHTML(); });
    var locErr = $('#co-loc-err'); if (locErr && loc) locErr.hidden = true;
    // Pre-fill the help centre contact form, unless the customer has typed their own
    var cf = $('#contact-location');
    if (cf && (!cf.value || cf.getAttribute('data-auto'))) { cf.value = locFull(); cf.setAttribute('data-auto', '1'); }
    syncWa(document);
  }
  /* ---------- Places, GPS, seller locations and delivery estimates ----------
     Provinces and towns come from settings in catalogue.js. A seller's stock location and the
     buyer's town decide the zone (same town, same province, elsewhere in Zambia), which gives
     the delivery estimate (settings.delivery.estimates) and whether the seller delivers there. */
  var LOCSET = S.location || {};
  var PROVINCES = S.provinces || [];
  var TOWNS = (S.towns || []).map(function (t) { return { name: t[0], province: t[1], lat: t[2], lng: t[3] }; });
  function provinceName(id) { var p = PROVINCES.filter(function (x) { return x[0] === id; })[0]; return p ? p[1] : ''; }
  function townInfo(name) { var n = String(name || '').trim().toLowerCase(); return TOWNS.filter(function (t) { return t.name.toLowerCase() === n; })[0] || null; }
  function provinceOf(l) { return !l ? '' : l.province || (townInfo(l.town) || {}).province || ''; }
  // Great-circle distance in km
  function kmBetween(lat1, lng1, lat2, lng2) {
    var r = Math.PI / 180, dLat = (lat2 - lat1) * r, dLng = (lng2 - lng1) * r;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  function nearestTown(lat, lng) {
    var best = null;
    TOWNS.forEach(function (t) { var km = kmBetween(lat, lng, t.lat, t.lng); if (!best || km < best.km) best = { town: t, km: km }; });
    return best;
  }
  // The device's GPS, turned into the nearest town here; done({ town, province } | { error })
  function locateMe(done) {
    if (LOCSET.gps === false || !navigator.geolocation) return done({ error: 'This browser can\'t share your location. Choose your town instead.' });
    navigator.geolocation.getCurrentPosition(function (pos) {
      var n = nearestTown(pos.coords.latitude, pos.coords.longitude);
      if (!n || n.km > (Number(LOCSET.gpsMaxKm) || 120)) return done({ error: 'You seem to be far from the towns we deliver to' + (n ? ' (nearest: ' + n.town.name + ', ' + Math.round(n.km) + ' km)' : '') + '. Choose your town instead.' });
      done({ town: n.town.name, province: n.town.province, km: n.km });
    }, function (err) {
      done({ error: err && err.code === 1 ? 'Location sharing was declined. You can choose your town instead.' : 'We couldn\'t get your location just now. Choose your town instead.' });
    }, { enableHighAccuracy: false, timeout: 12000, maximumAge: 600000 });
  }
  function useGps(status, after) {
    if (status) { status.className = 'pmeta'; status.textContent = 'Finding your nearest town…'; }
    locateMe(function (r) {
      if (r.error) { if (status) { status.className = 'form-status is-error'; status.textContent = r.error; } else toast(esc(r.error), 'error'); return; }
      saveLoc({ town: r.town, area: loc && loc.town === r.town ? loc.area : '', landmark: loc && loc.town === r.town ? loc.landmark : '', province: r.province, mode: loc ? loc.mode : 'delivery', via: 'gps', remember: loc ? loc.remember : false });
      if (status) { status.className = 'form-status'; status.textContent = 'Found: ' + r.town + ', ' + provinceName(r.province) + ' Province. Add your area below so the rider can find you.'; }
      if (after) after(r);
    });
  }
  // A seller's stock location: their Seller Centre setting on this device, then catalogue.js, then city
  function sellerLoc(s) {
    if (!s) return null;
    var l = (store.get('seller-locations', {}) || {})[s.id] || s.location || (s.city ? { town: s.city } : null);
    if (!l || !l.town) return null;
    return { town: l.town, area: l.area || '', province: l.province || (townInfo(l.town) || {}).province || '', sameDay: !!l.sameDay,
      collection: l.collection || { enabled: false }, deliversTo: l.deliversTo && l.deliversTo !== 'all' ? l.deliversTo : 'all' };
  }
  // How far an order travels: 'town', 'province' or 'country'; '' when either end is unknown
  function zoneFor(s) {
    var sl = sellerLoc(s);
    if (!sl || !loc) return '';
    if (sl.town.trim().toLowerCase() === String(loc.town).trim().toLowerCase()) return 'town';
    var bp = provinceOf(loc);
    return bp && bp === sl.province ? 'province' : 'country';
  }
  // Does the seller deliver to the buyer's province? Unknown places get the benefit of the doubt.
  function deliversHere(s) {
    var sl = sellerLoc(s), bp = provinceOf(loc);
    return !sl || !loc || sl.deliversTo === 'all' || !bp || sl.deliversTo.indexOf(bp) !== -1;
  }
  function collectionAt(s) { var sl = sellerLoc(s); return sl && sl.collection && sl.collection.enabled ? sl : null; }
  function deliveryNow() {
    var z = new Date(Date.now() + 2 * 60 * 60 * 1000);
    return new Date(z.getUTCFullYear(), z.getUTCMonth(), z.getUTCDate(), z.getUTCHours(), z.getUTCMinutes());
  }
  // The working day n days ahead, skipping closed days; orders after the cutoff start tomorrow
  function workingDay(n) {
    var current = deliveryNow();
    var d = new Date(current.getFullYear(), current.getMonth(), current.getDate()), closed = DELIVERY.closedDays || [];
    var left = n + (current.getHours() >= (Number(DELIVERY.cutoff) || 24) ? 1 : 0);
    while (left > 0) { d = shift(d, 1); if (closed.indexOf(d.getDay()) === -1) left--; }
    return d;
  }
  function shortDate(d) { return DAYS[d.getDay()].slice(0, 3) + ' ' + d.getDate() + ' ' + MONTHS3[d.getMonth()]; }
  function estimateFor(zone) {
    var e = zone && (DELIVERY.estimates || {})[zone];
    if (!e || e.length !== 2) return null;
    var from = workingDay(e[0]), to = workingDay(e[1]);
    return { min: e[0], max: e[1], text: e[0] === e[1] ? 'Arrives ' + shortDate(from) : 'Arrives ' + shortDate(from) + ' – ' + shortDate(to) };
  }
  // "1–2 working days" for an estimate [fewest, most]
  function daysText(e) { return (e[0] === e[1] ? e[0] : e[0] + '–' + e[1]) + ' working day' + (e[1] === 1 ? '' : 's'); }
  function hourText(h) { return ('0' + (Number(h) || 0)).slice(-2) + ':00'; }
  function sameDayTowns() { return ((DELIVERY.sameDay || {}).towns || []); }
  function sameDayTown(t) { var n = String(t || '').trim().toLowerCase(); return sameDayTowns().some(function (x) { return String(x || '').trim().toLowerCase() === n; }); }
  // Same day: the seller offers it, the buyer is in the seller's town, that town is on the
  // same-day list (settings.delivery.sameDay) and it's a working day before the cut-off
  function sameDayFor(s) {
    var sl = sellerLoc(s), cut = Number((DELIVERY.sameDay || {}).cutoff) || 0;
    if (!sl || !sl.sameDay || !loc || loc.mode === 'collection' || zoneFor(s) !== 'town' || !sameDayTown(loc.town)) return '';
    // Zambia uses UTC+2 year-round. Recheck the clock whenever this is rendered.
    var current = deliveryNow();
    if ((DELIVERY.closedDays || []).indexOf(current.getDay()) !== -1 || current.getHours() >= cut) return '';
    return 'Arrives today if you order by ' + hourText(cut);
  }
  // What sellers promise: accept a new order, then hand it over, within these hours (settings.sellerDeadlines)
  function deadlines() { var d = S.sellerDeadlines || {}; return d.acceptHours > 0 && d.dispatchHours > 0 ? d : null; }
  function hoursText(h) { return h + ' hour' + (h === 1 ? '' : 's'); }
  // One line for a seller's parcel: when it arrives, or where to collect it
  function fulfilLine(s) {
    if (!loc) return '';
    var sl = sellerLoc(s);
    if (loc.mode === 'collection') { var c = collectionAt(s); return c ? 'Collect in ' + c.town + (c.collection.hours ? ' · ' + c.collection.hours : '') : 'No collection from this seller · delivered instead'; }
    if (!deliversHere(s)) return 'Doesn\'t deliver to ' + (provinceName(provinceOf(loc)) || loc.town) + ' yet';
    var est = estimateFor(zoneFor(s)), sd = sameDayFor(s);
    return (sl ? 'Ships from ' + sl.town + ' · ' : '') + (sd || (est ? est.text : 'delivery time confirmed on WhatsApp'));
  }
  // Product page: where it comes from, whether it reaches the buyer, and when
  function fulfilHTML(p) {
    if (p.source === 'china') return '<p>' + esc(p.shipping) + '</p>';
    var s = seller(p.seller), sl = sellerLoc(s), out;
    if (!loc) {
      out = '<p class="fulfil__main">' + (sl ? 'Ships from ' + esc(sl.town) : esc(S.deliveryText || '')) + '</p>' +
        '<p class="pmeta"><button class="link-btn" type="button" data-open-location aria-haspopup="dialog">Set your location</button> to see when it can reach you, and stock near you.</p>';
    } else if (loc.mode === 'collection') {
      var c = collectionAt(s);
      out = c ? '<p class="fulfil__main">Collect from ' + esc(s.name) + '</p><p class="pmeta">' + esc([c.collection.address, c.town].filter(Boolean).join(', ')) + (c.collection.hours ? ' · ' + esc(c.collection.hours) : '') + '</p>' +
          (zoneFor(s) !== 'town' ? '<p class="pstock pstock--low">That\'s in ' + esc(c.town) + ', not ' + esc(loc.town) + '.</p>' : '')
        : '<p class="pstock pstock--low">This seller doesn\'t offer collection.</p><p class="pmeta"><button class="link-btn" type="button" data-set-mode="delivery">Switch to delivery</button></p>';
    } else if (!deliversHere(s)) {
      var cc = collectionAt(s);
      out = '<p class="pstock pstock--out">Doesn\'t deliver to ' + esc(provinceName(provinceOf(loc)) || loc.town) + ' yet</p>' +
        (cc ? '<p class="pmeta">You can collect it in ' + esc(cc.town) + '. <button class="link-btn" type="button" data-set-mode="collection">Switch to collection</button></p>' : '<p class="pmeta">Ask us on WhatsApp: we may be able to arrange it.</p>');
    } else {
      var zone = zoneFor(s), est = estimateFor(zone), sd = sameDayFor(s);
      var meta = [
        zone === 'town' ? 'In stock near you, in ' + esc(sl.town) : sl ? 'Ships from ' + esc(sl.town) : '',
        ((sd ? DELIVERY.sampleSameDay : (est && DELIVERY.sampleEstimates)) ? 'sample delivery times' : ''),
        '<a href="#/delivery-times">Delivery times</a>'
      ].filter(Boolean).join(' · ');
      out = '<p class="fulfil__main">' + (sd ? esc(sd) : est ? esc(est.text) : 'Delivery to ' + esc(loc.town) + ': time confirmed on WhatsApp') + '</p>' +
        '<p class="pmeta">' + meta + '</p>';
    }
    if (loc && !user()) out += '<p class="pmeta"><a href="#/account">Sign in</a> to keep your location and see the most accurate dates and offers.</p>';
    return '<div class="fulfil">' + out + '</div>';
  }
  // Delivery or collection: saved with the location; remembered for this visit before one is set
  var pendingMode = 'delivery';
  function coMode() { return loc ? loc.mode : pendingMode; }
  function checkoutNeedsDelivery(groups, mode) {
    return mode !== 'collection' || groups.some(function (g) { return !collectionAt(g.s); });
  }
  function setMode(mode) {
    pendingMode = mode === 'collection' ? 'collection' : 'delivery';
    if (loc) { var l = {}; for (var k in loc) l[k] = loc[k]; l.mode = pendingMode; saveLoc(l); }
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
    // A Sign out item under "Your account" in the menu, on every page, while someone is signed in
    $$('#drawer a[href$="#/account"]').forEach(function (a) {
      var list = a.parentNode.parentNode, item = list.querySelector('[data-sign-out-item]');
      if (u && !item) {
        item = document.createElement('li'); item.setAttribute('data-sign-out-item', '');
        item.innerHTML = '<button class="drawer__action" type="button" data-sign-out>Sign out</button>';
        list.appendChild(item);
      }
      if (item) item.hidden = !u;
    });
  }
  document.addEventListener('click', function (e) {
    if (!e.target.closest('[data-sign-out]')) return;
    closeDialog($('#drawer'));
    var done = function () { updateCounts(); toast('Signed out'); if (onIndex) route(); };
    if (secureMode()) window.ZSBackend.signOut().catch(function () { /* local tokens are cleared even when logout is unavailable */ }).then(done);
    else { store.set('user', null); done(); }
  });

  var suggest = $('#search-suggest');
  if (suggest) {
    var seen = {}, opts = '';
    products.forEach(function (p) { seen[p.title] = 1; });
    D.brands.forEach(function (b) { seen[b.name] = 1; });
    D.sellers.forEach(function (s) { seen[s.name] = 1; });
    D.departments.forEach(function (d) {
      seen[d.name] = 1;
      d.subs.forEach(function (s) {
        if (products.some(function (p) { return p.category === d.id && p.sub === s.id; })) seen[s.name] = 1;
      });
    });
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
  // The dialog's HTML is the same on every page; GPS, province and delivery-or-collection are added here
  if (locForm) {
    var townField = locForm.town.closest('.field');
    var gpsRow = document.createElement('div');
    gpsRow.className = 'loc-gps';
    gpsRow.innerHTML = (LOCSET.gps !== false && navigator.geolocation ? '<button class="btn btn--secondary btn--block" type="button" id="loc-gps"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="7"/></svg>Use my current location</button>' +
      '<p class="hint">Finds your nearest town on this device. Your exact position isn\'t saved or sent.</p><p class="pmeta" id="loc-gps-status" role="status" aria-live="polite"></p><p class="loc-or"><span>or enter it</span></p>' : '');
    townField.parentNode.insertBefore(gpsRow, townField);
    var provField = document.createElement('div');
    provField.className = 'field';
    provField.innerHTML = '<label for="loc-province">Province</label><select id="loc-province" name="province"><option value="">Choose a province</option>' +
      PROVINCES.map(function (p) { return '<option value="' + esc(p[0]) + '">' + esc(p[1]) + '</option>'; }).join('') + '</select>';
    townField.parentNode.insertBefore(provField, townField.nextSibling);
    var modeField = document.createElement('fieldset');
    modeField.className = 'field loc-mode';
    modeField.innerHTML = '<legend>How do you want your orders?</legend>' +
      '<div class="check"><input type="radio" name="mode" id="loc-mode-delivery" value="delivery" checked><label for="loc-mode-delivery">Deliver them to me</label></div>' +
      '<div class="check"><input type="radio" name="mode" id="loc-mode-collection" value="collection"><label for="loc-mode-collection">I\'ll collect from the seller</label></div>';
    var rememberRow = locForm.remember.closest('.check');
    rememberRow.parentNode.insertBefore(modeField, rememberRow);
    // Town suggestions from the full list, and the province filled in from a known town
    var townList = $('#zm-towns');
    if (townList && TOWNS.length) townList.innerHTML = TOWNS.map(function (t) { return '<option value="' + esc(t.name) + '"></option>'; }).join('');
    locForm.town.addEventListener('input', function () { var t = townInfo(locForm.town.value); if (t) locForm.province.value = t.province; });
    var gpsBtn = $('#loc-gps');
    if (gpsBtn) gpsBtn.addEventListener('click', function () {
      useGps($('#loc-gps-status'), function (r) {
        locForm.town.value = r.town; locForm.province.value = r.province;
        locForm.area.focus();
      });
    });
  }
  function openLocation() {
    if (!locForm) return;
    hideLocTip(true);
    locForm.town.value = loc ? loc.town : '';
    locForm.area.value = loc ? loc.area : '';
    locForm.landmark.value = loc ? loc.landmark : '';
    locForm.province.value = provinceOf(loc);
    locForm.remember.checked = !!(loc && loc.remember);
    var mode = $('#loc-mode-' + (loc && loc.mode === 'collection' ? 'collection' : 'delivery')); if (mode) mode.checked = true;
    var st = $('#loc-gps-status'); if (st) { st.textContent = ''; st.className = 'pmeta'; }
    $('#loc-clear').hidden = !loc;
    openDialog($('#location-dialog'));
  }
  if (locForm) {
    locForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var town = cleanText(locForm.town.value, 60);
      if (!town) { locForm.town.focus(); return; }
      var modePick = $('input[name="mode"]:checked', locForm);
      saveLoc({ town: town, area: cleanText(locForm.area.value, 60), landmark: cleanText(locForm.landmark.value, 100), province: locForm.province.value,
        mode: modePick ? modePick.value : 'delivery', via: loc && loc.town === town ? loc.via : 'typed', remember: locForm.remember.checked });
      closeDialog($('#location-dialog'));
      toast((loc.mode === 'collection' ? 'Collecting near ' : 'Delivering to ') + esc(locShort()));
      if (onIndex && /^#\/(cart|dept|search|deals|store|brand|promo)/.test(location.hash)) route();
    });
    $('#loc-clear').addEventListener('click', function () {
      saveLoc(null);
      closeDialog($('#location-dialog'));
      toast('Delivery location cleared');
    });
  }

  /* ---------- First-visit bubble at the location pin ----------
     Shown once (until dismissed or a location is set), pointing at the pin in the header. */
  var locTip = null;
  function hideLocTip(remember) {
    if (locTip) { locTip.remove(); locTip = null; window.removeEventListener('resize', placeLocTip); }
    if (remember) store.set('loc-tip-seen', true);
  }
  function placeLocTip() {
    var pin = $('#loc-pin');
    if (!locTip || !pin) return;
    var r = pin.getBoundingClientRect(), w = locTip.offsetWidth, vw = document.documentElement.clientWidth;
    var left = Math.max(12, Math.min(vw - w - 12, r.left + r.width / 2 - w / 2 + window.scrollX));
    locTip.style.top = (r.bottom + window.scrollY + 12) + 'px';
    locTip.style.left = left + 'px';
    locTip.style.setProperty('--arrow', Math.max(16, Math.min(w - 16, r.left + r.width / 2 + window.scrollX - left)) + 'px');
  }
  function showLocTip() {
    var pin = $('#loc-pin');
    if (LOCSET.tip === false || loc || locTip || store.get('loc-tip-seen', false) || !pin || !pin.offsetParent) return;
    locTip = document.createElement('div');
    locTip.className = 'loc-tip';
    locTip.setAttribute('role', 'dialog');
    locTip.setAttribute('aria-labelledby', 'loc-tip-title');
    locTip.innerHTML = '<button class="loc-tip__x" type="button" data-loc-tip="close" aria-label="Close">×</button>' +
      '<p class="loc-tip__title" id="loc-tip-title">Where are you?</p>' +
      '<p>Set your town to see what\'s in stock near you, delivery times and offers for your area, and whether you can collect.</p>' +
      '<div class="btn-row">' + (LOCSET.gps !== false && navigator.geolocation ? '<button class="btn btn--primary btn--sm" type="button" data-loc-tip="gps">Use my location</button>' : '') +
      '<button class="btn btn--secondary btn--sm" type="button" data-loc-tip="choose">Choose a town</button></div>' +
      '<button class="link-btn" type="button" data-loc-tip="later">Not now</button><p class="pmeta" role="status" aria-live="polite" data-loc-tip-status></p>';
    document.body.appendChild(locTip);
    placeLocTip();
    window.addEventListener('resize', placeLocTip);
    locTip.addEventListener('click', function (e) {
      var b = e.target.closest('[data-loc-tip]'); if (!b) return;
      var act = b.getAttribute('data-loc-tip');
      if (act === 'gps') {
        useGps($('[data-loc-tip-status]', locTip), function () { hideLocTip(true); toast('Showing delivery to ' + esc(loc.town) + '. <button class="link-btn" type="button" data-open-location>Change or add your area</button>'); if (onIndex && location.hash.indexOf('#/') === 0) route(); });
      } else if (act === 'choose') { hideLocTip(true); openLocation(); }
      else hideLocTip(true);
    });
    locTip.addEventListener('keydown', function (e) { if (e.key === 'Escape') { hideLocTip(true); pin.focus(); } });
  }
  setTimeout(showLocTip, 1500);

  /* ---------- Data saver ---------- */
  // Swap 3D category and store artwork for the tiny line icons
  function saverArt(scope) {
    var enabled = root.classList.contains('data-saver');
    $$('img[data-fallback]', scope).forEach(function (im) {
      if (enabled) {
        if (!im.hasAttribute('data-artwork')) im.setAttribute('data-artwork', im.getAttribute('src'));
        im.src = im.getAttribute('data-fallback');
      } else if (im.hasAttribute('data-artwork')) {
        im.src = im.getAttribute('data-artwork');
        im.removeAttribute('data-artwork');
      }
    });
  }
  var saver = store.get('datasaver', false);
  root.classList.toggle('data-saver', !!saver);
  // The service worker then stops downloading and saving images in the background (sw.js)
  function tellWorker(on) {
    try { if (navigator.serviceWorker) navigator.serviceWorker.ready.then(function (reg) { if (reg.active) reg.active.postMessage({ type: 'datasaver', on: !!on }); }).catch(function () {}); } catch (e) { /* no worker */ }
  }
  tellWorker(saver);
  $$('[data-saver-toggle]').forEach(function (cb) {
    cb.checked = !!saver;
    cb.addEventListener('change', function () {
      store.set('datasaver', cb.checked);
      root.classList.toggle('data-saver', cb.checked);
      tellWorker(cb.checked);
      saverArt(document);
      document.dispatchEvent(new Event('zs:datasaver'));
      toast(cb.checked ? 'Data saver on: photos and banner images hidden' : 'Data saver off');
    });
  });

  /* ---------- Toast ---------- */
  var toastEl = $('#toast'), toastTimer;
  // tone: 'success' (green tick), 'warn' (amber) or 'error' (red); without one it is plain news
  function toast(html, tone) {
    if (!toastEl) return;
    toastEl.className = 'toast' + (tone ? ' toast--' + tone : '');
    toastEl.setAttribute('aria-live', tone === 'error' ? 'assertive' : 'polite');
    toastEl.innerHTML = html;
    toastEl.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('is-on'); }, 3200);
  }

  /* ---------- Hover hints for buttons that show only an icon ----------
     Such a button already names itself to screen readers; mouse and keyboard users see the same
     name in a small hint (hidden from screen readers, so it isn't read twice). The hint stays while
     the pointer is over it, Escape closes it, and touch screens don't get one. */
  var tipEl = document.createElement('div'), tipFor = null, tipTimer;
  tipEl.className = 'tip'; tipEl.hidden = true; tipEl.setAttribute('aria-hidden', 'true');
  document.body.appendChild(tipEl);
  function tipText(el) {
    if (el.hasAttribute('title') || el.closest('.pmedia, [data-no-tip]')) return '';
    if ((el.innerText || '').replace(/\s+/g, ' ').trim().length > 1) return '';   // it has words already
    if (el.matches('[data-like]')) return el.getAttribute('aria-pressed') === 'true' ? 'Remove from wishlist' : 'Save to wishlist';
    var hidden = el.querySelector('.visually-hidden');
    return (el.getAttribute('data-tip') || el.getAttribute('aria-label') || (hidden ? hidden.textContent : '')).replace(/\s+/g, ' ').trim();
  }
  function showTip(el) {
    var text = tipText(el);
    if (!el.isConnected || !text) { hideTip(); return; }
    tipFor = el; tipEl.textContent = text; tipEl.hidden = false;
    var r = el.getBoundingClientRect(), t = tipEl.getBoundingClientRect(), gap = 8;
    var top = r.top - t.height - gap < 4 ? r.bottom + gap : r.top - t.height - gap;
    tipEl.style.top = Math.round(top) + 'px';
    tipEl.style.left = Math.round(Math.max(8, Math.min(window.innerWidth - t.width - 8, r.left + r.width / 2 - t.width / 2))) + 'px';
  }
  function hideTip() { clearTimeout(tipTimer); tipFor = null; tipEl.hidden = true; }
  var TIP_TARGETS = 'a, button, summary, [role="button"]';
  document.addEventListener('pointerover', function (e) {
    if (e.pointerType === 'touch' || e.target === tipEl) { if (e.target === tipEl) clearTimeout(tipTimer); return; }
    var el = e.target.closest(TIP_TARGETS);
    if (!el || el === tipFor || (e.relatedTarget && el.contains(e.relatedTarget))) return;
    clearTimeout(tipTimer); tipTimer = setTimeout(function () { showTip(el); }, 350);
  });
  document.addEventListener('pointerout', function (e) {
    var to = e.relatedTarget;
    // Moving between an icon's SVG children does not leave the button.
    if (to && (to === tipEl || (tipFor && tipFor.contains(to)) || (e.target.closest(TIP_TARGETS) && e.target.closest(TIP_TARGETS).contains(to)))) return;
    clearTimeout(tipTimer); tipTimer = setTimeout(hideTip, 120);
  });
  document.addEventListener('focusin', function (e) {
    var el = e.target.closest && e.target.closest(TIP_TARGETS);
    if (el && el.matches(':focus-visible')) { clearTimeout(tipTimer); showTip(el); } else hideTip();
  });
  document.addEventListener('focusout', hideTip);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') hideTip(); });
  document.addEventListener('click', hideTip, true);
  // A hover hint goes when the page scrolls; a keyboard-focused control's hint follows it, since
  // focusing it may itself scroll the page
  window.addEventListener('scroll', function () { if (tipFor && tipFor === document.activeElement && !tipEl.hidden) showTip(tipFor); else hideTip(); }, { passive: true, capture: true });
  window.addEventListener('resize', hideTip);
  window.addEventListener('hashchange', hideTip);

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

  /* ---------- Payment methods ----------
     Mobile money, bank transfer, cards (a secure link from a payment provider) and cash on
     delivery, as set in catalogue.js. Only switched-on methods show; demo mode also shows those
     marked preview. Nothing here takes payment details: instructions follow on WhatsApp. */
  var PAY_KINDS = { mobile: 'Mobile money', bank: 'Bank transfer', card: 'Card payments', cash: 'Cash on delivery' };
  // What the WhatsApp order asks for, by kind
  var PAY_ASK = { bank: 'please send your bank details', card: 'please send me a secure card payment link', cash: 'please confirm cash on delivery to my area' };
  function payMethods() { return (S.paymentMethods || []).filter(function (m) { return m.enabled !== false || (DEMO && m.preview); }); }
  function payKind(m) { return PAY_KINDS[m.kind] ? m.kind : 'mobile'; }
  function payByName(name) { return payMethods().filter(function (m) { return m.name === name; })[0] || null; }
  // "Pay with mobile money" while that's all there is, "Ways to pay" once there's more
  function payHeading() { return payMethods().every(function (m) { return payKind(m) === 'mobile'; }) ? 'Pay with mobile money' : 'Ways to pay'; }
  function payChipsHTML() {
    return '<ul class="paychips" aria-label="' + payHeading() + '">' + payMethods().map(function (m) {
      return '<li class="paychip"><span class="paychip__dot" style="--pay:' + esc(m.colour || '#4CC21A') + '" aria-hidden="true"></span>' + esc(m.name) + '</li>';
    }).join('') + '</ul>';
  }
  // Help centre: each method with its note, grouped by kind
  function payGuideHTML() {
    return Object.keys(PAY_KINDS).map(function (k) {
      var list = payMethods().filter(function (m) { return payKind(m) === k; });
      if (!list.length) return '';
      return '<h3>' + PAY_KINDS[k] + '</h3><ul class="pay-guide">' + list.map(function (m) {
        return '<li><span class="paychip__dot" style="--pay:' + esc(m.colour || '#4CC21A') + '" aria-hidden="true"></span><strong>' + esc(m.name) + '</strong>' +
          (m.note ? ' <span>' + esc(m.note) + '</span>' : '') +
          (k === 'card' && m.provider && !/^\[/.test(m.provider) ? ' <span>Payments are processed by ' + esc(m.provider) + '.</span>' : '') + '</li>';
      }).join('') + '</ul>';
    }).join('');
  }
  /* ---------- VAT ----------
     settings.vat in catalogue.js. With included: true (shop prices include VAT) the VAT inside
     the total is total × rate ÷ (100 + rate); otherwise it's added on top. Items from a seller
     with vatRegistered: false are left out. Shown only once Zed Supply is VAT-registered. */
  var VAT = S.vat || {};
  function vatActive() { return !!(VAT.registered && Number(VAT.rate) > 0); }
  // items: [{ p, each, qty }]; total: the amount after any voucher
  function vatFor(items, total) {
    if (!vatActive()) return 0;
    var sub = 0, taxable = 0;
    items.forEach(function (it) { var s = seller(it.p.seller), v = it.each * it.qty; sub += v; if (!(s && s.vatRegistered === false)) taxable += v; });
    if (!sub || !taxable) return 0;
    var base = total * taxable / sub, r = Number(VAT.rate);
    return Math.round((VAT.included === false ? base * r / 100 : base * r / (100 + r)) * 100) / 100;
  }
  function vatRowHTML(vat) {
    return vat ? '<div class="is-vat"><dt>' + (VAT.included === false ? 'VAT (' + VAT.rate + '%)' : 'Includes VAT (' + VAT.rate + '%)') + '</dt><dd>' + kwacha(vat) + '</dd></div>' : '';
  }

  /* ---------- Delivery days and times (settings.delivery) ---------- */
  var DELIVERY = S.delivery || {};
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MONTHS3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  // The days a buyer can ask for: from leadDays ahead, for daysAhead days, skipping closed days
  function deliveryDays() {
    var out = [], closed = DELIVERY.closedDays || [], d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    for (var i = Number(DELIVERY.leadDays) || 1; out.length < (Number(DELIVERY.daysAhead) || 14) && i < 60; i++) {
      var d = shift(d0, i);
      if (closed.indexOf(d.getDay()) === -1) out.push({ iso: d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()), label: DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS3[d.getMonth()] });
    }
    return out;
  }
  function slotLabel(id) { var s = (DELIVERY.slots || []).filter(function (x) { return x.id === id; })[0]; return s ? s.label : ''; }
  function dayLabel(iso) { var d = deliveryDays().filter(function (x) { return x.iso === iso; })[0]; return d ? d.label : niceDate(iso); }

  /* ---------- Saved addresses (settings.orderOptions.addresses) ----------
     An address book on this device for now; the same fields as user_addresses in supabase/migrations (orders_aftersales). */
  var OPTS = S.orderOptions || {};
  function addressesOn() { return !secureMode() && !!(OPTS.addresses && OPTS.addresses.enabled); }
  function addresses() { return store.get('addresses', []); }
  function addressLine(a) { return [a.landmark, a.area, a.town].filter(Boolean).join(', '); }

  /* ---------- Complaints (settings.orderOptions.complaints) ---------- */
  var COMPLAINT_TYPES = [
    ['not-received', 'Item not received'], ['damaged', 'Arrived damaged'], ['wrong', 'Wrong item, size or colour'],
    ['not-described', 'Not as described or pictured'], ['faulty', 'Faulty or stopped working'], ['missing', 'Missing parts or accessories'],
    ['refund', 'Return or refund problem'], ['conduct', 'Seller\'s behaviour or communication'], ['misleading', 'Misleading listing or price'],
    ['unsafe', 'Suspected counterfeit or unsafe product'], ['delivery', 'Delivery or courier problem'], ['other', 'Something else']
  ];
  var COMPLAINT_WANTS = [['refund', 'A refund'], ['replace', 'A replacement'], ['repair', 'A repair'], ['return', 'To return it'], ['fix', 'The seller to put it right'], ['inform', 'Just to let you know']];
  function complaintsOn() { return !!(OPTS.complaints && OPTS.complaints.enabled); }
  function complaints() { return store.get('complaints', []); }
  // Status colours: green when done, amber while waiting on someone, red when stopped or refused.
  // The words carry the meaning too, so colour is never the only signal.
  function statusClass(text) {
    var t = String(text || '').toLowerCase().trim();
    var tone = /^(withdrawn|ended|closed|cancel declined)$/.test(t) ? ''
      : /cancelled|cancel approved|not approved|rejected|failed|declined|refused/.test(t) ? 'bad'
      : /^(delivered|approved|resolved|live|paid|collected|accepted|completed)$/.test(t) ? 'ok' : 'wait';
    return 'status' + (tone ? ' status--' + tone : '');
  }
  var COMPLAINT_STATUS = { sent: 'Sent on WhatsApp', review: 'Being looked into', seller: 'Waiting for the seller', resolved: 'Resolved', closed: 'Closed' };

  /* ---------- Courier options (js/couriers.js) ----------
     Every ZICTA-licensed postal and courier operator, plus profiles of well-known couriers.
     Buyers choose where the parcel is going, then a courier (or let Zed Supply arrange it);
     the choice goes into their WhatsApp order. Sellers tick the couriers they use.
     Ranking: most used on Zed Supply first (each seller shipping with it +10, each order that
     chose it +4), then a checked public profile (+6), then licence reach (international 3,
     domestic 2, local 1). Couriers whose licence we couldn't confirm lose 8. Ties go A to Z. */
  var SCOPES = { town: 'Within the same town', country: 'Another town in Zambia', world: 'Outside Zambia' };
  var SCOPE_SHORT = { town: 'Same town', country: 'Across Zambia', world: 'International' };
  var LICENCES = {
    PPO: { label: 'Public postal operator', scope: ['town', 'country', 'world'], reach: 3 },
    ID: { label: 'International and domestic', scope: ['town', 'country', 'world'], reach: 3 },
    D: { label: 'Domestic: anywhere in Zambia', scope: ['town', 'country'], reach: 2 },
    L: { label: 'Local: one district only', scope: ['town'], reach: 1 }
  };
  var COURIERS = (function () {
    var src = window.ZS_COURIERS || {}, byLic = {}, out = [];
    if (S.couriersEnabled === false) return out;
    (src.register || []).forEach(function (r) {
      var t = LICENCES[r[2]] || LICENCES.L;
      var c = { id: 'zicta-' + r[0].replace(/^ZICTA\/P\//, '').replace(/\W+/g, '').toLowerCase(), licence: r[0], name: r[1], legal: r[1], type: r[2], scope: t.scope.slice(), about: '', url: '', note: '' };
      byLic[r[0]] = c; out.push(c);
    });
    (src.profiles || []).forEach(function (p) {
      var c = p.licence && byLic[p.licence];
      var track = /^https:\/\/[^\s]+\{n\}/.test(p.track || '') ? p.track : '';
      if (c) { c.id = p.id; c.name = p.name || c.name; c.url = p.url || ''; c.about = p.about || ''; c.note = p.note || ''; c.track = track; c.profile = true; }
      else out.push({ id: p.id, licence: '', name: p.name, legal: '', type: '', scope: p.scope || ['town'], url: p.url || '', about: p.about || '', note: p.note || '', track: track, profile: true, unlicensed: true });
    });
    return out;
  })();
  function courier(id) { return byId(COURIERS, id); }
  // A seller's couriers: ticked in the Seller Centre (this browser) or couriers: [...] on the seller in catalogue.js
  function sellerCouriers(s) {
    var local = s ? store.get('seller-couriers', {})[s.id] : null;
    return (local || (s && s.couriers) || []).filter(function (id) { return courier(id); });
  }
  function courierUse() {
    var use = { sellers: {}, score: {} };
    D.sellers.forEach(function (s) { sellerCouriers(s).forEach(function (id) { use.sellers[id] = (use.sellers[id] || 0) + 1; use.score[id] = (use.score[id] || 0) + 10; }); });
    store.get('orders', []).forEach(function (o) { if (o.shipId) use.score[o.shipId] = (use.score[o.shipId] || 0) + 4; });
    return use;
  }
  function rankedCouriers(scope, use) {
    use = use || courierUse();
    return COURIERS.filter(function (c) { return !scope || c.scope.indexOf(scope) !== -1; }).map(function (c) {
      return { c: c, s: (use.score[c.id] || 0) + (c.profile ? 6 : 0) + (LICENCES[c.type] ? LICENCES[c.type].reach : 0) - (c.unlicensed ? 8 : 0) };
    }).sort(function (a, b) { return b.s - a.s || a.c.name.localeCompare(b.c.name); }).map(function (x) { return x.c; });
  }
  function byName(a, b) { return a.name.localeCompare(b.name); }
  function courierName(c) { return c.url ? '<a href="' + esc(c.url) + '" target="_blank" rel="noopener noreferrer">' + esc(c.name) + '<span class="visually-hidden"> (opens in a new tab)</span></a>' : esc(c.name); }
  function licenceTag(c) {
    return c.unlicensed ? '<span class="courier__lic courier__lic--none">Licence not confirmed</span>'
      : '<span class="courier__lic">' + icon(I.shield) + 'ZICTA licensed<span class="visually-hidden">, ' + esc(LICENCES[c.type].label) + '</span></span>';
  }
  // Help Centre: cards for the best-known couriers, ranked
  function courierCardsHTML() {
    var use = courierUse(), list = rankedCouriers('', use).filter(function (c) { return c.profile || use.sellers[c.id]; });
    return '<ul class="couriers">' + list.map(function (c) {
      var n = use.sellers[c.id] || 0;
      return '<li class="courier"><p class="courier__name">' + courierName(c) + '</p>' + licenceTag(c) +
        '<ul class="courier__scope" aria-label="Delivers">' + c.scope.map(function (s) { return '<li>' + SCOPE_SHORT[s] + '</li>'; }).join('') + '</ul>' +
        (c.about ? '<p>' + esc(c.about) + '</p>' : '') + (c.note ? '<p class="pmeta">' + esc(c.note) + '</p>' : '') +
        (c.licence ? '<p class="pmeta">Licence ' + esc(c.licence) + (c.legal && c.legal !== c.name ? ' (' + esc(c.legal) + ')' : '') + '</p>' : '<p class="pmeta">Not on the ZICTA register we have. Check its licence before you book.</p>') +
        (n ? '<p class="courier__used">Used by ' + n + ' Zed Supply seller' + (n === 1 ? '' : 's') + '</p>' : '') + '</li>';
    }).join('') + '</ul><p class="pmeta">Zed Supply isn\'t paid by any courier listed here. Prices, coverage and delivery times are set by each courier, so confirm them before you book.</p>';
  }
  // Help Centre: the full register, searchable
  function courierDirectoryHTML() {
    var list = rankedCouriers('').filter(function (c) { return !c.unlicensed; });
    return '<div class="cdir"><div class="field-row"><div class="field"><label for="cdir-q">Search by name or licence number</label><input id="cdir-q" type="search" autocomplete="off"></div>' +
      '<div class="field"><label for="cdir-scope">Delivers</label><select id="cdir-scope"><option value="">Anywhere</option>' + Object.keys(SCOPES).map(function (s) { return '<option value="' + s + '">' + SCOPES[s] + '</option>'; }).join('') + '</select></div></div>' +
      '<p class="pmeta" id="cdir-count" role="status">' + list.length + ' licensed operators</p>' +
      '<div class="cmp" role="region" tabindex="0" aria-label="Licensed couriers (scrolls sideways)"><table class="cdir__table"><thead><tr><th scope="col">Courier</th><th scope="col">Licence</th><th scope="col">Licence type</th><th scope="col">Delivers</th></tr></thead><tbody>' +
      list.map(function (c) {
        return '<tr data-scope="' + c.scope.join(' ') + '" data-text="' + esc((c.name + ' ' + c.legal + ' ' + c.licence).toLowerCase()) + '"><th scope="row">' + courierName(c) + (c.legal && c.legal !== c.name ? '<br><small class="pmeta">' + esc(c.legal) + '</small>' : '') + '</th>' +
          '<td>' + esc(c.licence) + '</td><td>' + esc(LICENCES[c.type].label) + '</td><td>' + c.scope.map(function (s) { return SCOPE_SHORT[s]; }).join(', ') + '</td></tr>';
      }).join('') + '</tbody></table></div><p class="pmeta">Source: ' + esc((window.ZS_COURIERS || {}).registerNote || 'ZICTA register') + '. Local licences cover one district only.</p></div>';
  }
  if (COURIERS.length) {
    $$('[data-couriers]').forEach(function (el) { el.innerHTML = courierCardsHTML(); });
    $$('[data-courier-directory]').forEach(function (el) {
      el.innerHTML = courierDirectoryHTML();
      var qIn = $('#cdir-q', el), sc = $('#cdir-scope', el), rows = $$('tbody tr', el), count = $('#cdir-count', el);
      var filter = function () {
        var t = qIn.value.trim().toLowerCase(), s = sc.value, n = 0;
        rows.forEach(function (r) { var ok = (!t || r.getAttribute('data-text').indexOf(t) !== -1) && (!s || r.getAttribute('data-scope').indexOf(s) !== -1); r.hidden = !ok; if (ok) n++; });
        count.textContent = n + (n === 1 ? ' licensed operator' : ' licensed operators') + (t || s ? ' match' + (n === 1 ? 'es' : '') : '');
      };
      qIn.addEventListener('input', filter); sc.addEventListener('change', filter);
    });
  }

  /* ---------- Delivery fees (js/delivery.js, settings.delivery.rates) ----------
     Each seller's parcel is priced by how far it travels and how fast; the buyer picks the speed
     for the order. Without a rate card, fees stay "confirmed on WhatsApp" as before. */
  var ZD = window.ZS_DELIVERY || null;
  function speedName(sp) { return (ZD && ZD.NAMES[sp]) || 'Delivery'; }
  // "Arrives Thu 6 Nov – Fri 7 Nov", or "Arrives today"
  function arrivesText(days) {
    if (!days) return '';
    if (days[1] === 0) return 'Arrives today';
    var a = workingDay(days[0]), b = workingDay(days[1]);
    return 'Arrives ' + (days[0] === days[1] ? shortDate(a) : shortDate(a) + ' – ' + shortDate(b));
  }
  // When the last parcel arrives, at one speed
  function quoteArrives(q) {
    var lo = 0, hi = 0, known = false;
    q.parcels.forEach(function (p) { if (p.days) { known = true; lo = Math.max(lo, p.days[0]); hi = Math.max(hi, p.days[1]); } });
    return known ? arrivesText([lo, hi]) : '';
  }
  function feeText(fee, free) { return free || fee === 0 ? 'FREE' : kwacha(fee); }
  function sellerName(id) { var s = seller(id); return s ? s.name : 'Zed Supply'; }
  // A short line about a parcel, for the review, receipt and order page
  function parcelLine(p) {
    var c = p.courier ? courier(p.courier) : null;
    return esc(p.sellerName || sellerName(p.seller)) + ' · ' + esc(speedName(p.speed)) + (p.eta ? ' · ' + esc(p.eta) : '') + (c ? ' · ' + esc(c.name) : '');
  }

  // Fill every "we accept" spot on the page (footer, help centre)
  // data-pay-methods="guide" (help centre) lists each method with its note; otherwise chips.
  // data-pay-heading follows what's on offer: "Pay with mobile money" or "Ways to pay".
  $$('[data-pay-methods]').forEach(function (el) { if (payMethods().length) el.innerHTML = el.getAttribute('data-pay-methods') === 'guide' ? payGuideHTML() : payChipsHTML(); });
  $$('[data-pay-heading]').forEach(function (el) { if (payMethods().length) el.textContent = payHeading(); });
  /* Category menus come from catalogue.js departments, so adding or renaming a department is one
     edit there. The HTML on each page lists them too, for visitors without JavaScript. */
  var deptLink = function (d) { return (onIndex ? '#/dept/' : 'index.html#/dept/') + d.id; };
  $$('.search__dept').forEach(function (sel) {
    var cur = sel.value;
    var grouped = (D.departmentGroups || []).map(function (g) {
      var list = D.departments.filter(function (d) { return d.group === g[0]; });
      return list.length ? '<optgroup label="' + esc(g[1]) + '">' + list.map(function (d) { return '<option value="' + esc(d.id) + '">' + esc(d.short) + '</option>'; }).join('') + '</optgroup>' : '';
    }).join('');
    var ungrouped = D.departments.filter(function (d) { return !(D.departmentGroups || []).some(function (g) { return d.group === g[0]; }); });
    sel.innerHTML = '<option value="">All</option>' + grouped + ungrouped.map(function (d) { return '<option value="' + esc(d.id) + '">' + esc(d.short) + '</option>'; }).join('');
    sel.value = cur && byId(D.departments, cur) ? cur : '';
  });
  var drawerList = $('#drawer .drawer__body > ul');
  if (drawerList && D.departments.length) {
    var dg = (D.departmentGroups || []).map(function (g) { return { name: g[1], list: D.departments.filter(function (d) { return d.group === g[0]; }) }; }).filter(function (g) { return g.list.length; });
    var rest = D.departments.filter(function (d) { return !dg.some(function (g) { return g.list.indexOf(d) !== -1; }); });
    if (rest.length || !dg.length) dg.push({ name: dg.length ? 'More categories' : '', list: rest.length ? rest : D.departments });
    var wrap = document.createElement('div');
    wrap.className = 'drawer__depts';
    wrap.innerHTML = dg.map(function (g) {
      return (g.name ? '<p class="drawer__group">' + esc(g.name) + '</p>' : '') + '<ul>' + g.list.map(function (d) {
        return '<li><a href="' + deptLink(d) + '"><span class="emoji" aria-hidden="true"><img src="assets/icons/' + esc(d.id) + '.svg" alt="" width="24" height="24" loading="lazy"></span>' + esc(d.name) + '</a></li>';
      }).join('') + '</ul>';
    }).join('') + '<ul><li><a href="' + (onIndex ? '#/departments' : 'index.html#/departments') + '"><strong>See all categories</strong></a></li></ul>';
    drawerList.parentNode.replaceChild(wrap, drawerList);
  }
  // Homepage "Shop by category": the departments marked featured, then a link to the rest
  var homeDepts = $('#departments .depts');
  if (homeDepts && D.departments.length) {
    var feat = D.departments.filter(function (d) { return d.featured; });
    homeDepts.innerHTML = (feat.length ? feat : D.departments.slice(0, 12)).map(function (d) {
      return '<li><a class="dept" href="' + deptLink(d) + '"><span class="dept__icon" aria-hidden="true">' + departmentArtwork(d) + '</span>' + esc(d.short) + '</a></li>';
    }).join('');
  }

  // Help centre policies: day counts come from settings.orderOptions (returns, complaints)
  $$('[data-policy]').forEach(function (el) {
    var k = el.getAttribute('data-policy'), v = (OPTS.returns || {})[k] != null ? OPTS.returns[k] : (OPTS.complaints || {})[k];
    if (v != null) el.textContent = v;
  });

  // App store buttons (footer): each becomes a link once its address is set in settings.apps
  var APPS = S.apps || {};
  $$('[data-app]').forEach(function (el) {
    var url = APPS[el.getAttribute('data-app')];
    if (!url || !/^https:\/\//.test(url)) return;
    el.href = url; el.target = '_blank'; el.rel = 'noopener noreferrer';
    el.classList.remove('is-soon');
    var soon = el.querySelector('.app-btn__soon');
    if (soon) soon.remove();
  });

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
  // v (optional): the chosen variant, whose own stock count decides
  function stockHTML(p, v) {
    if (p.source === 'china') return '<p class="pstock">' + esc(p.shipping) + '</p>';
    var st = ZP.hasOptions(p) && (p.variants || []).length ? ZP.stockState(p, v) : '';
    if (st === 'out') return '<p class="pstock pstock--out">' + (v ? 'Sold out in this option' : 'Sold out') + '</p>';
    if (st === 'low') return '<p class="pstock pstock--low">' + (v ? 'Only ' + v.stock + ' left' : 'Only a few left') + '</p>';
    if (st === 'in') return '<p class="pstock">In stock</p>';
    if (p._server && p._server.stock_qty === 0) return '<p class="pstock pstock--out">Sold out</p>';
    if (p.stock === 'low') return '<p class="pstock pstock--low">Only a few left</p>';
    if (p.stock === 'request') return '<p class="pstock pstock--low">Sourced on request</p>';
    return '<p class="pstock">In stock</p>';
  }
  var cometSequence = 0;
  function likeBtn(p) {
    // Each instance needs its own paint server, including repeated product cards.
    var gold = 'wishlist-gold-' + (++cometSequence);
    var artwork = '<defs><linearGradient id="' + gold + '" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F6D778"/><stop offset=".45" stop-color="#DDA928"/><stop offset=".65" stop-color="#F2CE63"/><stop offset="1" stop-color="#A66C10"/></linearGradient></defs>' + I.comet +
      '<path class="comet__fill" fill="url(#' + gold + ')" d="m15 2 2 4.8 5.2.5-4 3.4 1.2 5.1-4.4-2.7-4.4 2.7 1.2-5.1-4-3.4 5.2-.5Z"/>';
    return '<button class="like" type="button" data-like="' + esc(p.id) + '" aria-pressed="' + isLiked(p.id) + '" aria-label="Save ' + esc(p.title) + ' to wishlist">' + icon(artwork, ' class="wishlist-comet"') + '</button>';
  }
  // rank: optional position in a trending or top-picks list
  function card(p, rank, displayedPrice) {
    var pr = displayedPrice || priceOf(p), s = seller(p.seller), others = sameItem(p);
    if (!displayedPrice && ZP.hasOptions(p)) {
      var pricedVariants = ZP.variants(p), available = pricedVariants.filter(function (v) { return v.stock > 0; });
      if (available.length) pricedVariants = available;
      if (pricedVariants.length) pr = pricedVariants.map(function (v) { return basePriceOf(p, v); }).sort(function (a,b) { return a.now-b.now; })[0];
    }
    var otherSellers = others.filter(function (x) { return x.seller && x.seller !== p.seller; }).length;
    return '<li><article class="pcard">' +
      '<div class="pflags">' + (rank ? '<span class="rank">#' + rank + '<span class="visually-hidden"> in this list</span></span>' : '') + (pr.off ? '<span class="flag-sale">-' + pr.off + '%</span>' : '') +
        (pr.deal ? '<span class="badge badge--deal">' + esc(DEAL_REASONS[pr.deal.reason] || 'Deal') + '</span>' : '') + (pr.promo ? '<span class="badge">Promotion</span>' : '') + (/^(town|province)$/.test(zoneFor(s)) ? '<span class="badge badge--near">Near you</span>' : '') + (p.sample ? '<span class="tag-sample">Sample</span>' : '') + '</div>' +
      likeBtn(p) +
      '<a class="pmedia" href="' + R + 'product/' + esc(p.id) + '" tabindex="-1" aria-hidden="true">' + media(p) + '</a>' +
      '<div class="pbody">' +
        '<a class="ptitle" href="' + R + 'product/' + esc(p.id) + '">' + esc(p.title) + '</a>' +
        '<p class="pmeta">' + (s ? 'Sold by ' + esc(s.name) : (p.source === 'china' ? 'Shop the World' : esc(dept(p.category).name))) + '</p>' +
        (otherSellers ? '<p class="pmeta"><a href="' + R + 'compare?ids=' + [p.id].concat(others.map(function (x) { return x.id; })).map(encodeURIComponent).join(',') + '">Compare ' + (otherSellers + 1) + ' sellers</a></p>' : '') +
        ((p.attributes || {}).condition ? '<p class="pmeta">Condition: ' + esc(ZP.conditionLabel(p)) + '</p>' : '') + starsHTML(p) + (ZP.hasOptions(p) ? '<span class="pmeta">From</span>' : '') + priceHTML(pr) + tradeCardHTML(p) + (p.commit && ZP.commitRange(p, pr.now) ? '<p class="pmeta pcommit">Or name your price from ' + kwacha(ZP.commitRange(p, pr.now).min) + '</p>' : '') + stockHTML(p) +
        (ZP.hasOptions(p) || ZP.inBox(p).addons.length || p.commit
          ? '<a class="btn btn--primary btn--sm" href="' + R + 'product/' + esc(p.id) + '">' + (ZP.hasOptions(p) ? 'Choose options' : 'See options') + '<span class="visually-hidden">: ' + esc(p.title) + '</span></a>'
          : '<button class="btn btn--primary btn--sm" type="button" data-add="' + esc(p.id) + '">Add to cart<span class="visually-hidden">: ' + esc(p.title) + '</span></button>') +
      '</div></article></li>';
  }
  function cards(list, ranked, priceFor) { return list.map(function (p, i) { return card(p, ranked ? i + 1 : 0, priceFor ? priceFor(p) : null); }).join(''); }
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
      (promoAreasText(pr) ? '<p>' + esc(promoAreasText(pr)) + (promoHere(pr) ? '' : ' · not your area') + '</p>' : '') +
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
    var symbols = { 'brand-a': 'tech', 'brand-b': 'solar', 'brand-c': 'home', 'brand-d': 'hardware', 'store-a': 'office', 'store-b': 'solar', 'store-c': 'womens' };
    var category = entity.category || symbols[entity.id];
    if (!byId(D.departments, category)) category = '';
    if (entity.logo) return '<img class="brand__logo" src="' + esc(entity.logo) + '" data-fallback="assets/icons/marketplace.svg" alt="" width="96" height="96" loading="lazy" decoding="async">';
    var d = dept(category), art = d.art3d;
    var path = art ? 'assets/categories-3d/' + (typeof art === 'string' ? art : category) + '.webp' : 'assets/icons/' + (category || 'marketplace') + '.svg';
    return '<img class="brand__logo" src="' + esc(path) + '" data-fallback="assets/icons/' + (category || 'marketplace') + '.svg" alt="" width="96" height="96" loading="lazy" decoding="async">';
  }
  // 3D artwork where it exists (art3d in catalogue.js), otherwise the department's line icon
  // art3d: true uses <id>.webp; a name (e.g. 'fashion') borrows that existing artwork
  function departmentArtwork(d) {
    if (!d.art3d) return '<img class="dept__svg" src="assets/icons/' + d.id + '.svg" alt="" width="112" height="112" loading="lazy" decoding="async">';
    return '<img src="assets/categories-3d/' + (typeof d.art3d === 'string' ? d.art3d : d.id) + '.webp" data-fallback="assets/icons/' + d.id + '.svg" alt="" width="112" height="112" loading="lazy" decoding="async">';
  }
  function verifiedHTML(s) { return s && s.verified ? ' <span class="verified">' + icon(I.shield) + 'Verified seller</span>' : ''; }

  /* ---------- Delegated actions: add to cart, like, quantities ---------- */
  document.addEventListener('click', function (e) {
    var add = e.target.closest('[data-add]');
    if (add) {
      var id = add.getAttribute('data-add'), qtyEl = add.getAttribute('data-qty-from') ? $(add.getAttribute('data-qty-from')) : null;
      var p = product(id), n = qtyEl ? Math.max(1, parseInt(qtyEl.value, 10) || 1) : ZP.orderRules(p).min;
      if (!addToCart(id, n)) return;
      // Quick-add on a trade listing adds its minimum, so say how many went in
      toast('Added to cart: ' + (n > 1 ? esc(qtyLabel(p, n)) + ' × ' : '') + esc(p ? p.title : '') + ' <a href="' + R + 'cart">View cart</a>', 'success');
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
    var modeBtn = e.target.closest('[data-set-mode]');
    if (modeBtn) {
      setMode(modeBtn.getAttribute('data-set-mode'));
      toast(loc && loc.mode === 'collection' ? 'Showing collection from sellers near ' + esc(loc.town) : 'Showing delivery to ' + esc(loc ? loc.town : 'you'));
      if (onIndex && /^#\/(cart|dept|search|deals)/.test(location.hash)) route();
      return;
    }
    if (e.target.closest('[data-print-order]') || e.target.closest('[data-print-receipt]')) { window.print(); return; }
    var wr = e.target.closest('[data-wish-remove]'), wu = e.target.closest('[data-wish-undo]'), wk = e.target.closest('[data-wish-keep]');
    if (wr || wu || wk) {
      var box = (wr || wu || wk).closest('[data-wish-prompt]'), ref = box ? box.getAttribute('data-wish-prompt') : '';
      if (wk) { wishAsked(ref, 'kept'); box.innerHTML = '<p role="status">Kept on your wishlist.</p>'; box.focus(); return; }
      var ids = (wr || wu).getAttribute(wr ? 'data-wish-remove' : 'data-wish-undo').split(',').filter(Boolean);
      if (wr) store.set('wish', wish().filter(function (id) { return ids.indexOf(id) === -1; }));
      else store.set('wish', wish().concat(ids.filter(function (id) { return wish().indexOf(id) === -1; })));
      updateCounts();
      if (!box) { toast((wr ? 'Removed ' : 'Put back ') + ids.length + (ids.length === 1 ? ' item' : ' items') + (wr ? ' from' : ' on') + ' your wishlist. ' + (wr ? '<button class="link-btn" type="button" data-wish-undo="' + esc(ids.join(',')) + '">Undo</button>' : ''), 'success'); if (location.hash.indexOf('#/wishlist') === 0) route(); return; }
      wishAsked(ref, wr ? 'removed' : '');
      box.innerHTML = wr ? '<p role="status">Removed from your wishlist. <button class="link-btn" type="button" data-wish-undo="' + esc(ids.join(',')) + '">Undo</button></p>' : '<p role="status">Back on your wishlist.</p>';
      var again = $('[data-wish-undo]', box); (again || box).focus();
      return;
    }
    var pdfBtn = e.target.closest('[data-receipt-pdf]');
    if (pdfBtn) { downloadReceiptPdf(pdfBtn.getAttribute('data-receipt-pdf'), pdfBtn); return; }
    var step = e.target.closest('[data-step]');
    if (step) {
      var input = $(step.getAttribute('data-target')), by = Number(input.step) || 1, lo = Number(input.min) || 1, hi = Number(input.max) || 99;
      // To the next multiple up or down, so 25 in tens goes to 30 or 20
      var now = parseInt(input.value, 10) || lo, up = Number(step.getAttribute('data-step')) > 0;
      var next = up ? Math.floor(now / by) * by + by : Math.ceil(now / by) * by - by;
      input.value = Math.min(hi, Math.max(lo, next));
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
    if (st) { st.className = 'form-status is-error'; st.textContent = CARD_WARNING; st.focus(); } else toast(esc(CARD_WARNING), 'error');
  }
  function formHasCard(form) {
    return $$('input:not([type=hidden]):not([type=checkbox]):not([type=file]), textarea', form).some(function (f) { return hasCardNumber(f.value); });
  }
  // Capture phase: runs before every other submit handler on the page
  document.addEventListener('submit', function (e) {
    if (formHasCard(e.target)) { e.preventDefault(); e.stopImmediatePropagation(); cardWarning(e.target); }
  }, true);

  /* ---------- Google Analytics 4: custom events ----------
     js/ad-tags.js loads gtag.js only after the visitor accepts cookies; until then gtag is
     undefined and these events go nowhere. These events use one
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
      // No form service connected yet: keep what was typed and offer to send it on WhatsApp
      if (!form.checkValidity()) { form.reportValidity(); return; }
      var lines = [], subject = form._subject ? form._subject.value : 'Message from the Zed Supply website';
      new FormData(form).forEach(function (v, k) {
        if (/^_|^consent$/.test(k) || !String(v).trim()) return;
        var field = form.querySelector('[name="' + k + '"]'), lab = field && field.id ? form.querySelector('label[for="' + field.id + '"]') : null;
        lines.push((lab ? lab.textContent.replace(/\s*\*$/, '').trim() : k) + ': ' + String(v).trim());
      });
      var msg = subject + '\n' + lines.join('\n');
      status.className = 'form-status is-success';
      status.innerHTML = 'Your details are ready to send. <a class="btn btn--primary btn--sm" href="' + esc(waUrl(msg)) + '" target="_blank" rel="noopener noreferrer">Send them on WhatsApp</a>';
      status.focus();
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
  var productZoomCleanup = null;
  function clearProductZoom() {
    if (productZoomCleanup) productZoomCleanup();
    productZoomCleanup = null;
  }
  var homeTitle = document.title;

  /* ---------- Advertising banner (carousel) ---------- */
  var reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var ads = { i: 0, timer: null, paused: reduceMotion, hover: false };
  var adsEl = $('#ads'), adsWrap = $('#ads-slides'), adsPause = $('.ads__pause');

  function adSlides() {
    var promos = allPromos().filter(function (pr) { return promoStatus(pr) === 'live'; }).map(function (pr) {
      var s = seller(pr.seller), se = season(pr.season), first = product(pr.products[0]);
      return { label: 'Promotion' + (s ? ' · ' + s.name : ''), title: pr.title, text: pr.discount + '% off until ' + niceDate(pr.ends) + '.', cta: 'Shop now', link: '#/promo/' + pr.id, colours: se.colours, art: first ? departmentArtwork(dept(first.category)) : seasonalArt(pr.season), image: pr.image || '', photo: true, sample: pr.sample };
    });
    var list = (D.banners || []).concat(promos);
    if (fest) {
      var cc = festiveCopy(fest), fl = festiveLink(fest.id), deals = festiveDeals(fest.id);
      // A period can show several banners one after the other (slides: [...]), or just its own image
      var period = byId(FEST.periods || [], fest.id) || {};
      var arts = period.slides && period.slides.length ? period.slides : [period];
      var defText = cc.line + (deals ? ' Shop seller celebration deals.' : ' Shop local and support Zambian sellers.');
      list.unshift.apply(list, arts.map(function (a, i) {
        return { id: 'festive-' + i, zambia: zambia, label: season(fest.id).name + ' ' + (fest.key || fest.start).getFullYear(), title: a.title || cc.lead,
          text: a.text || defText, cta: deals ? 'Shop ' + fl.text : fl.text, link: fl.href, colours: season(fest.id).colours,
          photo: true, curated: !!a.image, image: a.image || '', imageMobile: a.imageMobile || '', caption: a.caption || '', captionUrl: a.captionUrl || '', art: seasonalArt(fest.id) };
      }));
    }
    return list;
  }
  // Distinct seasonal compositions using the established 3D category collection.
  // Copy stays in HTML so artwork can be decorative and data saver can use line icons.
  function seasonalArt(id) {
    if (id === 'independence') return '<img src="assets/brand/zambia-flag.svg" alt="" width="220" height="147">';
    // Three departments that suit each season. Every department has 3D artwork (art3d);
    // one without it would show its flat line icon instead.
    var sets = { christmas: ['toys', 'home', 'games'], valentines: ['womens', 'beauty', 'home'], easter: ['home', 'essentials', 'toys'], farmers: ['agri', 'hardware', 'solar'], blackfriday: ['computers', 'tv', 'tech'], school: ['office', 'luggage', 'computers'] };
    return '<span class="season-art">' + (sets[id] || ['essentials', 'home', 'tech']).map(function (category) {
      var d = dept(category), art = d.art3d;
      var path = !root.classList.contains('data-saver') && art ? 'assets/categories-3d/' + (typeof art === 'string' ? art : category) + '.webp' : 'assets/icons/' + category + '.svg';
      return '<img src="' + path + '" data-fallback="assets/icons/' + category + '.svg" alt="" width="160" height="160" loading="lazy" decoding="async">';
    }).join('') + '</span>';
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
    return '<div class="ad ad--designed' + (bg ? ' ad--photo' : '') + (b.curated ? ' ad--curated' : '') + (b.zambia ? ' ad--zambia' : '') + '"' + attrs + ' style="--ad-a:' + c[0] + ';--ad-b:' + c[1] + '">' + bg +
      '<div class="ad__body">' + (b.label ? '<span class="ad__label">' + esc(b.label) + '</span>' : '') +
      '<p class="ad__title">' + esc(b.title || b.alt || 'Advert') + '</p>' + (b.text ? '<p class="ad__text">' + esc(b.text) + '</p>' : '') +
      // Collections link straight to each category they show
      (b.categories && b.categories.length ? '<ul class="ad__cats" aria-label="Categories in this collection">' + b.categories.map(function (id) {
        return byId(D.departments, id) ? '<li><a href="' + R + 'dept/' + esc(id) + '">' + esc(dept(id).short) + '</a></li>' : '';
      }).join('') + '</ul>' : '') +
      '<a class="btn btn--primary" href="' + link + '">' + esc(b.cta || 'Shop now') + '</a>' +
      (b.curated ? '<small class="ad__illustration">' + (b.caption ? (b.captionUrl ? '<a href="' + esc(b.captionUrl) + '" target="_blank" rel="noopener noreferrer">' + esc(b.caption) + '</a>' : esc(b.caption)) : 'Illustrative collection · availability confirmed on WhatsApp') + '</small>' : '') + '</div>' + art + sample + '</div>';
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
    adsEl.classList.toggle('ads--curated', !root.classList.contains('data-saver') && list.some(function (b) { return b.curated; }));
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
    document.addEventListener('zs:datasaver', function () { if (!home.hidden) renderHome(); else route(); });
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

  /* ---------- Featured brands strip (under the banner) ----------
     Brands marked featured: true in catalogue.js come first, then any brand with products. */
  function featuredBrandsHTML() {
    return D.brands.filter(function (b) { return b.featured || products.some(function (p) { return p.brand === b.id; }); })
      .sort(function (a, b) { return (b.featured ? 1 : 0) - (a.featured ? 1 : 0); })
      .map(function (b) {
        var n = products.filter(function (p) { return p.brand === b.id; }).length;
        var words = b.name.trim().split(/\s+/);
        var mono = (words[0].charAt(0) + (words.length > 1 ? words[words.length - 1].charAt(0) : words[0].charAt(1))).toUpperCase();
        return '<li><a class="fbrand" href="' + R + 'brand/' + esc(b.id) + '" style="--brand-a:' + b.colours[0] + ';--brand-b:' + b.colours[1] + '">' +
          (b.logo ? '<img class="fbrand__logo" src="' + esc(b.logo) + '" data-fallback="assets/icons/marketplace.svg" alt="" width="34" height="34" loading="lazy" decoding="async">' : '<span class="fbrand__mono" aria-hidden="true">' + esc(mono) + '</span>') +
          '<span class="fbrand__text"><strong>' + esc(b.name) + '</strong><small>' + n + (n === 1 ? ' product' : ' products') + '</small></span></a></li>';
      }).join('');
  }

  /* ---------- Trending by category, and top picks by month ---------- */
  var TREND_PAGE = 6, TREND_CATS = 3;
  function trendBlock(g, shown, level) {
    var d = dept(g.id), h = level || 'h3';
    return '<section class="trend" data-trend="' + g.id + '" aria-labelledby="tr-' + g.id + '"><div class="trend__head"><' + h + ' id="tr-' + g.id + '">' + esc(d.name) + '</' + h + '>' +
      '<a href="' + R + 'trending/' + g.id + '">See all<span class="visually-hidden"> trending in ' + esc(d.name) + '</span></a></div>' +
      '<ul class="grid trend__grid">' + cards(g.items.slice(0, shown), true) + '</ul>' +
      (g.items.length > shown ? '<button class="btn btn--secondary btn--sm trend__more" type="button" data-trend-more="' + g.id + '" data-shown="' + shown + '" data-level="' + h + '">View more in ' + esc(d.name) + ' (' + (g.items.length - shown) + ' more)</button>' : '') + '</section>';
  }
  function trendingHTML(groups, cats, level) {
    return groups.slice(0, cats).map(function (g) { return trendBlock(g, TREND_PAGE, level); }).join('') +
      (groups.length > cats ? '<button class="btn btn--secondary trend__cats" type="button" data-trend-cats="' + cats + '" data-level="' + (level || 'h3') + '">Show more trending categories (' + (groups.length - cats) + ')</button>' : '');
  }
  function picksTabs(keys, active, base) {
    return '<div class="tabs" role="tablist" aria-label="Top picks by month">' + keys.map(function (k) {
      return '<button class="tab" type="button" role="tab" id="pk-tab-' + k + '" aria-controls="pk-panel" aria-selected="' + (k === active) + '" tabindex="' + (k === active ? 0 : -1) + '" data-pick="' + k + '"' + (base ? ' data-pick-base="' + base + '"' : '') + '>' + monthName(k) + ' top picks</button>';
    }).join('') + '</div>';
  }
  function picksPanel(key, max) {
    var list = topPicks(key);
    return '<div id="pk-panel" role="tabpanel" aria-labelledby="pk-tab-' + key + '"><ul class="grid trend__grid">' + cards(max ? list.slice(0, max) : list, true) + '</ul>' +
      (max && list.length > max ? '<p class="view-foot"><a href="' + R + 'top-picks/' + key + '">See all ' + list.length + ' ' + monthName(key) + ' top picks</a></p>' : '') + '</div>';
  }
  function trendNote() {
    return '<details class="trend-note"><summary>How trending and top picks work</summary><p>Products move up when buyers order them (from orders confirmed on WhatsApp), and when shoppers save them, add them to their cart, view them or rate them well. This month counts more than last month. A live deal or a new listing gives a small extra lift, but only to products people are already interested in. Sellers can\'t pay to appear here.</p></details>';
  }
  // Side-by-side table. removable: show "Remove" for products on the compare list.
  function compareTable(list, removable) {
    var lowest = Math.min.apply(null, list.map(function (p) { return priceOf(p).now; }));
    var row = function (label, fn) { return '<tr><th scope="row">' + label + '</th>' + list.map(function (p) { return '<td>' + fn(p) + '</td>'; }).join('') + '</tr>'; };
    return '<div class="cmp" role="region" tabindex="0" aria-label="Comparison table (scrolls sideways)"><table><caption class="visually-hidden">Comparing ' + list.length + ' products</caption>' +
      '<thead><tr><td></td>' + list.map(function (p) {
        return '<th scope="col"><a class="cmp__media pmedia" href="' + R + 'product/' + esc(p.id) + '" tabindex="-1" aria-hidden="true">' + media(p) + '</a><a class="ptitle" href="' + R + 'product/' + esc(p.id) + '">' + esc(p.title) + '</a>' + (p.sample ? ' <span class="tag-sample">Sample</span>' : '') + '</th>';
      }).join('') + '</tr></thead><tbody>' +
      row('Price', function (p) { var pr = priceOf(p); return priceHTML(pr) + (pr.now === lowest && list.length > 1 ? '<span class="badge badge--best">Lowest price</span>' : ''); }) +
      row('Offer', function (p) { var pr = priceOf(p); return pr.deal ? esc(DEAL_REASONS[pr.deal.reason] || 'Deal') + (pr.deal.ends ? ' until ' + niceDate(pr.deal.ends) : '') : pr.promo ? esc(pr.promo.title) + ' (' + pr.promo.discount + '% off)' : pr.off ? pr.off + '% off' : '–'; }) +
      row('Rating', function (p) { var r = ratingOf(p); return r ? starsHTML(p) + ' ' + r.avg.toFixed(1) : 'No reviews yet'; }) +
      row('Seller', function (p) { var s = seller(p.seller); return s ? '<a href="' + R + 'store/' + esc(s.id) + '">' + esc(s.name) + '</a>' + verifiedHTML(s) : '–'; }) +
      row('Brand', function (p) { var b = brand(p.brand); return b ? '<a href="' + R + 'brand/' + esc(b.id) + '">' + esc(b.name) + '</a>' : '–'; }) +
      row('Availability', function (p) { return stockHTML(p); }) +
      row('', function (p) { return (ZP.hasOptions(p) ? '<a class="btn btn--primary btn--sm" href="' + R + 'product/' + esc(p.id) + '">Choose options<span class="visually-hidden">: ' + esc(p.title) + '</span></a>' : '<button class="btn btn--primary btn--sm" type="button" data-add="' + esc(p.id) + '">Add to cart<span class="visually-hidden">: ' + esc(p.title) + '</span></button>') + (removable ? ' <button class="link-btn link-btn--danger" type="button" data-compare-remove="' + esc(p.id) + '">Remove<span class="visually-hidden"> ' + esc(p.title) + '</span></button>' : ''); }) +
      '</tbody></table></div>';
  }
  // Buy box: the same item from other sellers, cheapest first
  function alsoSoldHTML(p) {
    var others = sameItem(p).filter(function (x) { return x.seller && x.seller !== p.seller; }).sort(function (a, b) { return priceOf(a).now - priceOf(b).now; });
    if (!others.length) return '';
    return '<div class="also"><p class="also__title">Also sold by ' + others.length + ' other seller' + (others.length === 1 ? '' : 's') + '</p><ul>' + others.slice(0, 3).map(function (x) {
      var sx = seller(x.seller);
      return '<li><a href="' + R + 'product/' + esc(x.id) + '"><span>' + esc(sx ? sx.name : '') + '</span><strong>' + kwacha(priceOf(x).now) + '</strong></a></li>';
    }).join('') + '</ul><a href="' + R + 'compare?ids=' + [p.id].concat(others.map(function (x) { return x.id; })).map(encodeURIComponent).join(',') + '">Compare all sellers</a></div>';
  }

  /* ---------- Product page: options, specifications, in the box, commit pricing ---------- */
  // Colour swatches and size badges are radio buttons, so they work with a keyboard and screen readers.
  // A combination that's sold out stays selectable (the buy box then says so), like Amazon.
  function optionsHTML(p, sel) {
    return ZP.options(p).map(function (o) {
      var cur = sel[o.key] || '';
      return '<fieldset class="popt popt--' + o.key + '"><legend>' + o.name + ': <strong data-opt-label="' + o.key + '">' + esc(cur || 'choose one') + '</strong></legend><div class="popt__list">' +
        o.values.map(function (v, i) {
          var id = 'po-' + o.key + '-' + i, out = (p.variants || []).length && !ZP.valueInStock(p, o.key, v.label, sel);
          return '<span class="popt__item' + (out ? ' is-out' : '') + '"><input type="radio" name="po-' + o.key + '" id="' + id + '" value="' + esc(v.label) + '"' + (v.label === cur ? ' checked' : '') + '>' +
            (o.key === 'colour'
              ? '<label for="' + id + '" class="swatch" style="--sw:' + esc(v.hex) + '" title="' + esc(v.label) + '"><span class="visually-hidden">' + esc(v.label) + '</span>'
              : '<label for="' + id + '" class="size-badge">' + esc(v.label)) +
            '<span class="visually-hidden" data-out-note>' + (out ? ' (sold out)' : '') + '</span></label></span>';
        }).join('') + '</div></fieldset>';
    }).join('');
  }
  // Photo thumbnails under the main photo: the main photo first, then the seller's extra photos
  function thumbsHTML(p) {
    var photos = (p.image ? [{ src: p.image, alt: p.alt || p.title }] : []).concat(p.images || []);
    if (photos.length < 2 || root.classList.contains('data-saver')) return '';
    return '<ul class="pthumbs" aria-label="Product photos">' + photos.map(function (ph, i) {
      return '<li><button class="pthumb" type="button" data-photo="' + esc(ph.src) + '" data-alt="' + esc(ph.alt) + '" aria-pressed="' + (i === 0) + '">' +
        '<img src="' + esc(ph.src) + '" alt="" width="64" height="64" loading="lazy" decoding="async"><span class="visually-hidden">Show photo ' + (i + 1) + ' of ' + photos.length + ': ' + esc(ph.alt) + '</span></button></li>';
    }).join('') + '</ul>';
  }
  function specsHTML(p) {
    var a = p.attributes || {}, rows = [];
    if (a.manufacturer) rows.push(['Manufacturer', esc(a.manufacturer)]);
    if (a.condition) rows.push(['Condition', esc(ZP.conditionLabel(p))]);
    if (a.size) rows.push([ZP.UNITS[a.size.unit] ? ZP.DIMENSIONS[ZP.UNITS[a.size.unit].dim] : 'Size', esc(ZP.sizeLabel(a.size))]);
    if (ZP.ages(p).length) rows.push(['Age range', ZP.AGES.filter(function (x) { return ZP.ages(p).indexOf(x[0]) !== -1; }).map(function (x) { return x[1]; }).join(', ')]);
    ZP.options(p).forEach(function (o) { rows.push([esc(o.name), o.values.map(function (v) { return esc(v.label); }).join(', ')]); });
    Object.keys(a.specs || {}).forEach(function (k) { rows.push([esc(k), esc(a.specs[k])]); });
    return rows.length ? '<h2 class="h3">Specifications</h2><table class="specs"><tbody>' + rows.map(function (r) { return '<tr><th scope="row">' + r[0] + '</th><td>' + r[1] + '</td></tr>'; }).join('') + '</tbody></table>' : '';
  }
  function inBoxHTML(p) {
    var box = ZP.inBox(p);
    if (!box.included.length && !box.addons.length) return '';
    return '<section class="inbox" aria-labelledby="inbox-title"><h2 class="h3" id="inbox-title">In the box</h2>' +
      (box.included.length ? '<ul class="inbox__list">' + box.included.map(function (c) { return '<li>' + icon(I.check) + esc(c.item) + '</li>'; }).join('') + '</ul>' : '') +
      (box.addons.length ? '<fieldset class="inbox__addons"><legend>Optional add-ons</legend><p class="pmeta">Tick any you\'d like. The price updates as you go.</p>' + box.addons.map(function (a) {
        return '<div class="check"><input type="checkbox" id="pa-' + a.index + '" value="' + a.index + '" data-addon><label for="pa-' + a.index + '">' + esc(a.item) + ' <strong class="inbox__price">+' + kwacha(a.price) + '</strong></label></div>';
      }).join('') + '</fieldset>' : '') + '</section>';
  }
  function commitHTML(range) {
    if (!range) return '';
    return '<fieldset class="pmode"><legend class="visually-hidden">How you want to pay</legend>' +
        '<div class="check"><input type="radio" name="pmode" id="pm-fixed" value="fixed" checked><label for="pm-fixed">Buy now at the listed price</label></div>' +
        '<div class="check"><input type="radio" name="pmode" id="pm-commit" value="commit"><label for="pm-commit">Name your price</label></div></fieldset>' +
      '<div class="commit" id="commit-box" hidden>' +
        '<label for="commit-range">Name your commitment price (Range: ' + kwacha(range.min) + ' – ' + kwacha(range.max) + ')</label>' +
        '<input type="range" id="commit-range" min="' + range.min + '" max="' + range.max + '" step="0.01" value="' + range.max + '" aria-describedby="commit-hint">' +
        '<div class="commit__amt"><span aria-hidden="true">K</span><label for="commit-amt" class="visually-hidden">Your price in Kwacha, per item</label><input id="commit-amt" type="number" min="' + range.min + '" max="' + range.max + '" step="0.01" value="' + range.max + '" inputmode="decimal"><span class="pmeta">per item</span></div>' +
        '<p class="hint" id="commit-hint">The seller accepts your price or replies on WhatsApp before you pay. Add-ons are charged at their listed price.</p>' +
      '</div>';
  }

  /* ---------- Ratings and reviews ---------- */
  function ratingBars(revs) {
    var sum = ZP.ratingSummary(revs);
    return '<ul class="rbars" aria-label="How buyers rated it">' + [5, 4, 3, 2, 1].map(function (n) {
      var c = sum.dist[n], pc = sum.count ? Math.round(c / sum.count * 100) : 0;
      return '<li><span>' + n + ' star</span><span class="rbar" aria-hidden="true"><span style="width:' + pc + '%"></span></span><span>' + pc + '%<span class="visually-hidden"> (' + c + ')</span></span></li>';
    }).join('') + '</ul>';
  }
  function reviewForm(mine, bought) {
    var labels = ['', 'Bad', 'Poor', 'Okay', 'Good', 'Excellent'], cur = mine ? Math.round(Number(mine.rating)) : 0;
    return '<form class="form form--card" id="review-form" novalidate><h3>' + (mine ? 'Update your review' : bought ? 'How was it?' : 'Rate and review') + '</h3>' +
      (bought ? '<p class="notice notice--secure">You ordered this on ' + niceDate(bought.date) + '. Purchase verification is available once shared accounts launch.</p>' : '') +
      '<fieldset class="rate"><legend>Your rating</legend><div class="rate__stars">' + [5, 4, 3, 2, 1].map(function (n) {
        return '<input type="radio" name="rev-rating" id="rr' + n + '" value="' + n + '"' + (n === cur ? ' checked' : '') + '><label for="rr' + n + '" title="' + n + ' – ' + labels[n] + '"><span aria-hidden="true">★</span><span class="visually-hidden">' + n + (n === 1 ? ' star' : ' stars') + ', ' + labels[n] + '</span></label>';
      }).join('') + '</div></fieldset>' +
      '<div class="field"><label for="rev-head">Headline</label><input id="rev-head" required maxlength="120" placeholder="Sum it up in a few words" value="' + esc(mine && mine.title ? mine.title : '') + '"></div>' +
      '<div class="field"><label for="rev-text">Your review</label><textarea id="rev-text" required maxlength="600" placeholder="What did you like or dislike? How was delivery?">' + esc(mine ? mine.text : '') + '</textarea></div>' +
      ext('reviewFormExtra', mine) +
      '<p class="hint">Prototype: your review is saved on this device only.</p><p class="form-status" role="status" tabindex="-1"></p>' +
      '<button class="btn btn--primary" type="submit">' + (mine ? 'Update review' : 'Post review') + '</button></form>';
  }
  function reviewList(revs, sort, filters) {
    filters = filters || {};
    var list = revs.filter(function (r) { return (!filters.star || Number(r.rating) === filters.star) && (!filters.verified || r.verified) && (!filters.query || [r.title, r.text].join(' ').toLowerCase().indexOf(filters.query) !== -1); });
    if (sort === 'high') list.sort(function (a, b) { return b.rating - a.rating; });
    else if (sort === 'low') list.sort(function (a, b) { return a.rating - b.rating; });
    else if (sort === 'verified') list.sort(function (a, b) { return (b.verified ? 1 : 0) - (a.verified ? 1 : 0) || (a.date < b.date ? 1 : -1); });
    else list.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
    return list.length ? list.map(function (v) {
      var stars = Math.min(5, Math.max(0, Number(v.rating) || 0));
      return '<div class="review"><span class="stars__icons" aria-hidden="true">' + starString(stars) + '</span><span class="visually-hidden">' + stars + ' out of 5</span> <strong>' + esc(v.name) + '</strong> <small>' + niceDate(v.date) + '</small>' +
        (v.verified ? ' <span class="verified-buy">' + icon(I.check) + 'Verified purchase</span>' : '') + (v.mine ? ' <span class="tag-mine">Your review</span>' : '') + (v.title ? '<h3 class="review__title">' + esc(v.title) + '</h3>' : '') + '<p>' + esc(v.text) + '</p>' + ext('reviewPhotosHTML', v) + '</div>';
    }).join('') : '<p class="pmeta">No reviews match these filters.</p>';
  }
  function pickMonths() { return [thisMonth, lastMonth].filter(function (k) { return topPicks(k).length; }); }
  // "View more", "More categories" and month tabs work the same on the homepage and their own pages
  document.addEventListener('click', function (e) {
    var more = e.target.closest('[data-trend-more]');
    if (more) {
      var id = more.getAttribute('data-trend-more'), shown = Number(more.getAttribute('data-shown')) + TREND_PAGE;
      var g = trendingGroups().filter(function (x) { return x.id === id; })[0], block = more.closest('.trend');
      if (!g || !block) return;
      var before = $$('.pcard', block).length;
      block.outerHTML = trendBlock(g, shown, more.getAttribute('data-level'));
      var fresh = $('[data-trend="' + id + '"]'), next = fresh && $$('.ptitle', fresh)[before];
      if (next) next.focus();
      return;
    }
    var cats = e.target.closest('[data-trend-cats]');
    if (cats) {
      var from = Number(cats.getAttribute('data-trend-cats')), groups = trendingGroups(), level = cats.getAttribute('data-level');
      var holder = document.createElement('div');
      holder.innerHTML = trendingHTML(groups.slice(from), TREND_CATS, level);
      var firstNew = holder.querySelector('.trend h2, .trend h3');
      while (holder.firstChild) cats.parentNode.insertBefore(holder.firstChild, cats);
      cats.remove();
      if (firstNew) { firstNew.setAttribute('tabindex', '-1'); firstNew.focus(); }
      return;
    }
    var tab = e.target.closest('[data-pick]');
    if (tab) selectPick(tab);
  });
  function selectPick(tab) {
    var key = tab.getAttribute('data-pick'), list = tab.closest('.tabs');
    $$('[role="tab"]', list).forEach(function (t) { var on = t === tab; t.setAttribute('aria-selected', on); t.tabIndex = on ? 0 : -1; });
    var panel = $('#pk-panel');
    if (panel) panel.outerHTML = picksPanel(key, tab.hasAttribute('data-pick-base') ? 0 : TREND_PAGE * 2);
    if (tab.hasAttribute('data-pick-base')) try { history.replaceState(null, '', '#/top-picks/' + key); } catch (err) { /* old browser */ }
  }
  document.addEventListener('keydown', function (e) {
    var tab = e.target.closest && e.target.closest('.tabs [role="tab"]');
    if (!tab || (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft')) return;
    var tabs = $$('[role="tab"]', tab.parentNode), i = tabs.indexOf(tab) + (e.key === 'ArrowRight' ? 1 : -1);
    var next = tabs[(i + tabs.length) % tabs.length];
    next.focus(); selectPick(next); e.preventDefault();
  });

  function renderHome() {
    buildAds();
    var fb = featuredBrandsHTML();
    $('#home-fbrands').hidden = !fb;
    $('#home-fbrands-list').innerHTML = fb;
    var tg = trendingGroups();
    $('#home-trending-wrap').hidden = !tg.length;
    $('#home-trending').innerHTML = trendingHTML(tg, TREND_CATS);
    var months = pickMonths();
    $('#home-picks-wrap').hidden = !months.length;
    $('#home-picks').innerHTML = months.length ? picksTabs(months, months[0]) + picksPanel(months[0], TREND_PAGE * 2) : '';
    var deals = localProducts.filter(function (p) { return priceOf(p).was; });
    if (deals.length < 6) deals = deals.concat(localProducts.filter(function (p) { return deals.indexOf(p) === -1; })).slice(0, 8);
    deals = deals.slice(0, 8);
    var livePromos = sortPromos(allPromos().filter(function (pr) { return promoStatus(pr) !== 'ended'; })).slice(0, 4);
    fill('#home-deals', cards(deals), 'Our first deals are on their way. Sellers are joining Zed Supply now. Tell us what you need and we\'ll find it for you.',
      '<a class="btn btn--primary" href="#request">Make a request</a><a class="btn btn--secondary" href="#/sell">Sell on Zed Supply</a>');
    // Lead with different departments, then fill any remaining spaces with other products.
    var featured = [], featuredCats = {};
    var queues = (D.departmentGroups || []).map(function (g) { return D.departments.filter(function (d) { return d.group === g[0]; }); });
    for (var round = 0; round < D.departments.length; round++) {
      queues.forEach(function (queue) {
        var d = queue[round], p = d && localProducts.filter(function (p) { return p.category === d.id; })[0];
        if (p) { featured.push(p); featuredCats[p.category] = true; }
      });
    }
    localProducts.forEach(function (p) { if (!featuredCats[p.category]) { featured.push(p); featuredCats[p.category] = true; } });
    $('#home-featured').innerHTML = cards(featured.concat(localProducts.filter(function (p) { return featured.indexOf(p) === -1; })).slice(0, 12));
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
    clearProductZoom();
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
  // Attribute facets appear only when represented in this result set.
  function facetSelect(id, label, values) {
    return values.length ? '<label for="' + id + '" class="visually-hidden">' + label + '</label><select id="' + id + '"><option value="">' + label + ': all</option>' +
      values.map(function (v) { return '<option value="' + esc(v[0]) + '">' + esc(v[1]) + '</option>'; }).join('') + '</select>' : '';
  }
  function listing(opts) {
    // Nothing listed yet (the live store before sellers join): no filters, just ask us to source it
    if (!opts.list.length) {
      show(crumbs(opts.crumbs) + head(opts.title, opts.sub) + (opts.extra || '') + '<ul class="grid"><li class="grid__full">' + empty('Nothing listed here yet. Tell us what you need and we\'ll find it.', askBtn('Hi Zed Supply, I\'m looking for: ')) + '</li></ul>', opts.docTitle || opts.title);
      return;
    }
    var colourSet = Object.create(null), ageSet = {}, sizeSet = Object.create(null), makerSet = Object.create(null), brandSet = {}, conditionSet = {}, dimensions = {};
    var categoryValues = D.departments.filter(function (d) { return opts.list.some(function (p) { return p.category === d.id; }); }).map(function (d) { return [d.id, d.name]; });
    var subValues = [];
    D.departments.forEach(function (d) {
      d.subs.forEach(function (s) {
        if (opts.list.some(function (p) { return p.category === d.id && p.sub === s.id; })) {
          subValues.push([d.id + '/' + s.id, (categoryValues.length > 1 ? d.short + ' / ' : '') + s.name]);
        }
      });
    });
    opts.list.forEach(function (p) {
      ZP.colours(p).forEach(function (c) { colourSet[c] = c; });
      ZP.ages(p).forEach(function (a) { ageSet[a] = 1; });
      var a = p.attributes || {};
      if (p.brand && brand(p.brand)) brandSet[p.brand] = brand(p.brand).name;
      if (a.manufacturer) makerSet[a.manufacturer.toLowerCase()] = a.manufacturer;
      if (a.condition) conditionSet[a.condition] = 1;
      (a.size ? [a.size] : []).concat((p.options || {}).size || []).forEach(function (s) { sizeSet[ZP.sizeToken(s)] = ZP.sizeLabel(s); });
      ZP.measures(p).forEach(function (s) { if (ZP.UNITS[s.unit]) dimensions[ZP.UNITS[s.unit].dim] = true; });
    });
    var values = function (set) { return Object.keys(set).map(function (k) { return [k, set[k]]; }).sort(function (a,b) { return a[1].localeCompare(b[1]); }); };
    var measureUnits = Object.keys(ZP.UNITS).filter(function (u) { return dimensions[ZP.UNITS[u].dim]; });
    var html = crumbs(opts.crumbs) + head(opts.title, opts.sub) + (opts.extra || '') +
      '<div class="toolbar"><p class="result-count" id="lst-count" role="status"></p><div class="toolbar__filters">' +
      '<label class="inline-check"><input type="checkbox" id="lst-promo"> On promotion</label><label class="inline-check"><input type="checkbox" id="lst-stock"> In stock</label>' +
      // With a location: sellers in the buyer's town or province, and sellers who offer collection there
      (loc ? '<label class="inline-check"><input type="checkbox" id="lst-near"> Near ' + esc(loc.town) + '</label><label class="inline-check"><input type="checkbox" id="lst-collect"> Collection in ' + esc(loc.town) + '</label>' : '') +
      '<label for="lst-sort" class="visually-hidden">Sort by</label><select id="lst-sort"><option value="">Sort: Relevance</option><option value="asc">Price: low to high</option><option value="desc">Price: high to low</option><option value="rating">Top rated</option></select></div></div>' +
      '<details class="listing-filters"' + (window.matchMedia && matchMedia('(min-width: 900px)').matches ? ' open' : '') + '><summary>Refine products</summary><div class="listing-filters__grid">' +
      (categoryValues.length > 1 ? facetSelect('lst-category', 'Department', categoryValues) : '') +
      (subValues.length > 1 ? facetSelect('lst-sub', 'Subcategory', subValues) : '') +
      facetSelect('lst-colour', 'Colour', values(colourSet)) + facetSelect('lst-age', 'Age', ZP.AGES.filter(function (a) { return ageSet[a[0]]; })) +
      facetSelect('lst-size', 'Size / capacity', values(sizeSet)) + facetSelect('lst-brand', 'Brand store', values(brandSet)) +
      facetSelect('lst-maker', 'Manufacturer / brand name', values(makerSet)) +
      facetSelect('lst-condition', 'Condition', ZP.CONDITIONS.filter(function (c) { return conditionSet[c[0]]; })) +
      '<div class="field"><label for="lst-min">Minimum price (K)</label><input id="lst-min" type="number" min="0" step="0.01" inputmode="decimal"></div>' +
      '<div class="field"><label for="lst-max">Maximum price (K)</label><input id="lst-max" type="number" min="0" step="0.01" inputmode="decimal"></div>' +
      '<div class="field"><label for="lst-stars">Customer rating</label><select id="lst-stars"><option value="">All ratings</option><option value="4">4 stars and up</option><option value="3">3 stars and up</option><option value="5">5 stars</option></select></div>' +
      (opts.list.some(function (p) { return p.commit; }) ? '<label class="inline-check"><input id="lst-offers" type="checkbox"> Accepts buyer offers</label>' : '') + '</div>' +
      (measureUnits.length ? '<fieldset class="measurement-filter"><legend>Size, capacity or weight</legend><p class="hint">Equivalent units are compared together, such as 1 litre and 1,000 ml, or 1 TB and 1,000 GB.</p><div class="listing-filters__grid"><div class="field"><label for="lst-unit">Unit</label><select id="lst-unit"><option value="">Any measurement</option>' + measureUnits.map(function (u) { return '<option value="' + u + '">' + esc(ZP.UNITS[u].name) + '</option>'; }).join('') + '</select></div><div class="field"><label for="lst-measure-min">Minimum</label><input id="lst-measure-min" type="number" min="0" step="any" inputmode="decimal" disabled></div><div class="field"><label for="lst-measure-max">Maximum</label><input id="lst-measure-max" type="number" min="0" step="any" inputmode="decimal" disabled></div></div></fieldset>' : '') +
      '<p class="form-status is-error" id="lst-filter-error" role="status"></p><button id="lst-clear" class="btn btn--secondary btn--sm" type="button">Clear filters</button></details><ul class="grid" id="lst-grid"></ul>';
    show(html, opts.docTitle || opts.title);
    var value = function (id) { var el = $('#' + id); return el ? el.value : ''; };
    var checked = function (id) { var el = $('#' + id); return !!el && el.checked; };
    var rangeNumber = function (id) { var v = value(id); return v === '' ? null : Number(v); };
    var filterState;
    function eligibleVariants(p) {
      return ZP.matchingVariants(p, { inStock: filterState.stock, colour: filterState.colour, size: filterState.size,
        dimension: filterState.unit ? ZP.UNITS[filterState.unit].dim : '', min: filterState.measureMin, max: filterState.measureMax });
    }
    function selectedPrice(p) {
      var variants = eligibleVariants(p);
      var prices = variants.length ? variants.map(function (v) { return basePriceOf(p, v); }) : [priceOf(p)];
      prices = prices.filter(function (pr) { return (filterState.min == null || pr.now >= filterState.min) && (filterState.max == null || pr.now <= filterState.max) && (!filterState.offers || ZP.commitRange(p, pr.now)); });
      if (!prices.length) return null;
      prices.sort(function (a,b) { return a.now-b.now; });
      return prices[0];
    }
    var draw = function () {
      var unit = value('lst-unit'), mn = rangeNumber('lst-measure-min'), mx = rangeNumber('lst-measure-max');
      if ($('#lst-measure-min')) { $('#lst-measure-min').disabled = $('#lst-measure-max').disabled = !unit; }
      var min = rangeNumber('lst-min'), max = rangeNumber('lst-max'), error = '';
      if ((min != null && min < 0) || (max != null && max < 0) || (min != null && max != null && min > max)) error = 'Enter a valid price range: minimum must not exceed maximum.';
      if (unit && ((mn != null && mn < 0) || (mx != null && mx < 0) || (mn != null && mx != null && mn > mx))) error = 'Enter a valid measurement range: minimum must not exceed maximum.';
      $('#lst-filter-error').textContent = error;
      if (error) { $('#lst-grid').innerHTML = ''; $('#lst-count').textContent = 'Check your filter range'; return; }
      filterState = { colour:value('lst-colour'), size:value('lst-size'), stock:checked('lst-stock'), min:min, max:max, unit:unit,
        measureMin:unit && mn != null ? mn*ZP.UNITS[unit].base : null, measureMax:unit && mx != null ? mx*ZP.UNITS[unit].base : null, offers:checked('lst-offers') };
      var list = opts.list.filter(function (p) {
        var a=p.attributes||{}, age=value('lst-age'), maker=value('lst-maker'), stars=Number(value('lst-stars'))||0;
        if (value('lst-category') && p.category !== value('lst-category')) return false;
        if (value('lst-sub') && p.category + '/' + p.sub !== value('lst-sub')) return false;
        if (value('lst-brand') && p.brand !== value('lst-brand')) return false;
        if (maker && String(a.manufacturer||'').toLowerCase()!==maker) return false;
        if (value('lst-condition') && a.condition!==value('lst-condition')) return false;
        if (age && ZP.ages(p).indexOf(age)===-1) return false;
        if (stars && (ratingOf(p)||{avg:0}).avg<stars) return false;
        if (checked('lst-promo') && !onDeal(p)) return false;
        if (checked('lst-near') && !/^(town|province)$/.test(zoneFor(seller(p.seller)))) return false;
        if (checked('lst-collect') && !(collectionAt(seller(p.seller)) && zoneFor(seller(p.seller)) === 'town')) return false;
        if (filterState.stock && ['in','low'].indexOf(ZP.stockState(p))===-1) return false;
        if (filterState.colour && ZP.colours(p).indexOf(filterState.colour)===-1) return false;
        if (filterState.size && !(p.options||{}).size && (!a.size || ZP.sizeToken(a.size)!==filterState.size)) return false;
        if (filterState.unit && !(p.options||{}).size && !ZP.measureMatches(p,ZP.UNITS[filterState.unit].dim,filterState.measureMin,filterState.measureMax)) return false;
        if (ZP.hasOptions(p) && !eligibleVariants(p).length) return false;
        return !!selectedPrice(p);
      });
      var sort=value('lst-sort');
      if(sort==='asc'||sort==='desc') list.sort(function(a,b){var n=selectedPrice(a).now-selectedPrice(b).now;return sort==='asc'?n:-n;});
      if(sort==='rating') list.sort(function(a,b){return (ratingOf(b)||{avg:0}).avg-(ratingOf(a)||{avg:0}).avg;});
      $('#lst-grid').innerHTML=list.length?cards(list,false,selectedPrice):'<li class="grid__full">'+empty('No products match these filters. Try a wider range or clear the filters.','')+'</li>';
      $('#lst-count').textContent=list.length+(list.length===1?' product':' products');
    };
    function syncSubcategories() {
      var select = $('#lst-sub'), category = value('lst-category');
      if (!select) return;
      Array.prototype.slice.call(select.options).forEach(function (option) {
        var unavailable = !!category && !!option.value && option.value.split('/')[0] !== category;
        option.hidden = unavailable; option.disabled = unavailable;
        if (unavailable && option.selected) select.value = '';
      });
    }
    $$('.toolbar input, .toolbar select, .listing-filters input, .listing-filters select',view).forEach(function(el){el.addEventListener(el.type==='number'?'input':'change',function () { syncSubcategories(); draw(); });});
    $('#lst-clear').addEventListener('click',function(){$$('.toolbar input, .toolbar select, .listing-filters input, .listing-filters select',view).forEach(function(el){if(el.type==='checkbox')el.checked=false;else el.value='';});syncSubcategories();draw();});
    draw();
  }
  var STATUS = ['Order sent on WhatsApp', 'Confirmed by Zed Supply', 'Packed by the seller', 'Out for delivery', 'Delivered'];
  function orders() { return store.get('orders', []); }
  /* The buyer's private handover code (migration 024). Read out at the door once the parcel is in
     hand, it lets the rider record the delivery and confirms receipt for the buyer. */
  function handoverHTML(ref, code, demo) {
    var shown = String(code).replace(/^(\d{3})(\d{3})$/, '$1 $2');
    var share = 'Zed Supply handover code for order ' + ref + ': ' + shown + '. Give it to the rider only once the parcel is in your hands and you have checked it.';
    return '<div class="handover"><p class="deliver-box__label">Your handover code' + (demo ? ' <span class="tag-sample">Demo</span>' : '') + '</p>' +
      '<p class="handover__code">' + esc(shown) + '</p>' +
      '<p class="pmeta">Read it out only when the parcel is in your hands and you\'ve checked it: the code confirms you received it. Zed Supply staff will never ask you for it.</p>' +
      '<a class="link-btn" href="https://wa.me/?text=' + encodeURIComponent(share) + '" target="_blank" rel="noopener noreferrer">Someone else receiving it? Send them the code</a></div>';
  }
  /* ---------- Receipts and parcel tracking ----------
     The receipt is built from the order as it was placed: items, each parcel's speed and fee,
     voucher, VAT and the total. It prints (or saves as PDF) on its own, and can be sent to the
     buyer's WhatsApp or email. Connected mode builds the same model from public.order_receipt(). */
  var TRACK = { booked: 'Booked with the courier', picked_up: 'Picked up from the seller', in_transit: 'On the way', out_for_delivery: 'Out for delivery',
    delivered: 'Delivered', failed: 'Delivery attempt failed', returned: 'Returned to the seller' };
  function trackUrl(c, number) { return c && c.track && number ? c.track.replace('{n}', encodeURIComponent(number)) : ''; }
  function whenText(at) { var t = String(at || ''); return t.length >= 16 ? niceDate(t.slice(0, 10)) + ', ' + t.slice(11, 16) : t ? niceDate(t.slice(0, 10)) : ''; }
  function orderTotalsHTML(o) {
    var d = o.delivery;
    if (o.sub == null && !d) return '<dl class="totals"><div class="is-total"><dt>Total</dt><dd>' + kwacha(o.total) + '</dd></div>' + (o.vat ? vatRowHTML(o.vat) : '') + '</dl>';
    var sub = o.sub != null ? o.sub : (o.items || []).reduce(function (n, it) { return n + it.price * it.qty; }, 0);
    var known = d ? !d.pending && d.fee != null : o.mode === 'collection';
    return '<dl class="totals"><div><dt>Items</dt><dd>' + kwacha(sub) + '</dd></div>' +
      (o.save ? '<div class="is-save"><dt>You saved</dt><dd>' + kwacha(o.save) + '</dd></div>' : '') +
      (o.voucher ? '<div class="is-save"><dt>Voucher ' + esc(o.voucher.code) + '</dt><dd>−' + kwacha(o.voucher.off) + '</dd></div>' : '') +
      (d && (d.parcels || []).length ? '<div' + (d.fee === 0 ? ' class="is-save"' : '') + '><dt>Delivery · ' + esc(speedName(d.speed)) + '</dt><dd>' + (known ? feeText(d.fee) : 'Quoted before you pay') + '</dd></div>'
        : o.mode === 'collection' ? '<div><dt>Collection</dt><dd>No delivery fee</dd></div>' : '<div><dt>Delivery</dt><dd>Confirmed on WhatsApp</dd></div>') +
      '<div class="is-total"><dt>' + (known ? 'Order total' : 'Total before delivery') + '</dt><dd>' + kwacha(o.total) + '</dd></div>' + (o.vat ? vatRowHTML(o.vat) : '') + '</dl>';
  }
  // Each parcel on the order page: seller, speed, fee, courier, tracking number and its updates
  function parcelsHTML(o) {
    var ps = (o.delivery && o.delivery.parcels) || [];
    if (!ps.length || o.mode === 'collection' && !ps.length) return '';
    return '<section class="parcels" aria-labelledby="parcels-title"><h3 id="parcels-title">' + (ps.length === 1 ? 'Your parcel' : 'Your ' + ps.length + ' parcels') + '</h3>' + ps.map(function (p) {
      var c = p.courier ? courier(p.courier) : null, url = !o.sample && trackUrl(c, p.tracking);
      return '<article class="parcel"><p class="parcel__head"><strong>' + esc(sellerName(p.seller)) + '</strong><span>' + esc(speedName(p.speed)) + ' · ' + (p.pending || p.fee == null ? 'fee to be quoted' : feeText(p.fee, p.free)) + '</span></p>' +
        (p.eta ? '<p class="pmeta">' + esc(p.eta) + ' (estimated when you ordered)</p>' : '') +
        '<p class="pmeta">' + (c ? 'Courier: ' + esc(c.name) : 'Courier: arranged by Zed Supply') + ' · ' + (p.tracking ? 'Tracking number <strong>' + esc(p.tracking) + '</strong>' : 'tracking number added when it\'s sent') + '</p>' +
        (url ? '<a class="btn btn--secondary btn--sm" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">Track with ' + esc(c.name) + '<span class="visually-hidden"> (opens in a new tab)</span></a>' : '') +
        ((p.events || []).length ? '<ol class="track-events" aria-label="Courier updates, newest first">' + p.events.slice().reverse().map(function (ev, i) {
          return '<li' + (i === 0 ? ' class="is-latest"' : '') + '><span class="track-events__what">' + esc(TRACK[ev.status] || ev.status) + '</span>' + (ev.text ? '<span>' + esc(ev.text) + '</span>' : '') +
            '<small>' + esc([ev.where, whenText(ev.at)].filter(Boolean).join(' · ')) + '</small></li>';
        }).join('') + '</ol>' : '') + '</article>';
    }).join('') + (o.sample ? '<p class="pmeta"><span class="tag-sample">Demo</span> Sample courier updates. Real ones arrive from the courier once it\'s connected.</p>' : '') + '</section>';
  }
  function receiptModel(o) {
    var lines = (o.items || []).map(function (it) {
      var p = product(it.id), q = parseInt(it.qty, 10) || 0, price = Number(it.price) || 0;
      return { title: p ? p.title : it.id, label: it.label || '', qty: p ? qtyLabel(p, q) : String(q), each: price, total: price * q, seller: p ? sellerName(p.seller) : '' };
    });
    var u = user() || {}, rc = o.receipt || {};
    return { ref: o.ref, date: o.date, sample: !!o.sample, status: o.cancel ? 'Cancellation requested' : STATUS[o.status] || '', name: o.name || u.name || '',
      whatsapp: rc.whatsapp || u.phone || '', email: rc.email || u.email || '', mode: o.mode || 'delivery', deliverTo: o.deliverTo || '', lines: lines,
      sub: o.sub != null ? o.sub : lines.reduce(function (n, l) { return n + l.total; }, 0), save: o.save || 0, voucher: o.voucher || null,
      vat: o.vat || 0, vatRate: o.vatRate, vatIncluded: o.vatIncluded, delivery: o.delivery || null, total: o.total, payment: o.pay || '', paid: !!o.paid, business: o.business || null, gift: o.gift || null };
  }
  function shopPhone() { var n = String(S.whatsapp || ''); return n.length === 12 ? '+' + n.slice(0, 3) + ' ' + n.slice(3, 5) + ' ' + n.slice(5, 8) + ' ' + n.slice(8) : n; }
  function siteAddress() { return (location.host + location.pathname).replace(/(index|help|privacy|404)\.html$/, '').replace(/\/$/, ''); }
  function receiptHTML(m) {
    // The buyer's own receipt always shows prices (they need them for returns); the gift receipt
    // (#/receipt/REF?gift=1), for the person receiving it, leaves every price out
    var d = m.delivery, ps = (d && d.parcels) || [], hide = !!m.giftReceipt;
    var taxRate = m.vatRate != null ? m.vatRate : VAT.rate, taxIncluded = m.vatIncluded != null ? m.vatIncluded : VAT.included;
    var known = d ? !d.pending && d.fee != null : m.mode === 'collection';
    var legal = (S.business || {}).legalName, tpin = vatActive() && VAT.tpin && !/^\[/.test(VAT.tpin) ? VAT.tpin : '';
    var row = function (label, value, cls) { return '<div' + (cls ? ' class="' + cls + '"' : '') + '><dt>' + label + '</dt><dd>' + value + '</dd></div>'; };
    return '<article class="receipt" id="receipt" aria-labelledby="rc-title">' +
      '<header class="receipt__head"><img src="assets/brand/logo-original-3d-dark.webp" alt="Zed Supply" width="190" height="48">' +
        '<div class="receipt__id"><h2 id="rc-title">Order receipt</h2><p>No. <strong>' + esc(m.ref) + '</strong></p><p>' + niceDate(m.date) + '</p>' +
        (m.sample ? '<p><span class="tag-sample">Demo order</span></p>' : '') + '</div></header>' +
      '<div class="receipt__flag" aria-hidden="true"></div>' +
      '<p class="receipt__status"><span>' + esc(m.status) + '</span><span>' + (m.paid ? 'Paid' : 'Payment: ' + esc(m.payment || 'to be arranged on WhatsApp')) + '</span></p>' +
      '<section class="receipt__parties"><div><h3>Customer</h3><p>' + esc(m.name || 'Customer') + (m.business ? '<br>' + esc(m.business.name) + (m.business.tpin ? '<br>TPIN ' + esc(m.business.tpin) : '') + (m.business.address ? '<br>' + esc(m.business.address) : '') : '') + '</p></div>' +
        '<div><h3>' + (m.mode === 'collection' ? 'Collection' : 'Deliver to') + '</h3><p>' + (m.deliverTo ? esc(m.deliverTo) : 'Confirmed on WhatsApp') + '</p></div>' +
        '<div><h3>Sold by</h3><p>' + esc(m.lines.map(function (l) { return l.seller; }).filter(function (x, i, a) { return x && a.indexOf(x) === i; }).join(', ') || 'Zed Supply') + '</p></div></section>' +
      '<div class="receipt__table" role="region" tabindex="0" aria-label="Items on this receipt"><table><thead><tr><th scope="col">Item</th><th scope="col">Qty</th>' + (hide ? '' : '<th scope="col" class="num">Price</th><th scope="col" class="num">Amount</th>') + '</tr></thead><tbody>' +
        m.lines.map(function (l) { return '<tr><th scope="row">' + esc(l.title) + (l.label ? '<small>' + esc(l.label) + '</small>' : '') + '</th><td>' + esc(l.qty) + '</td>' + (hide ? '' : '<td class="num">' + kwacha(l.each) + '</td><td class="num">' + kwacha(l.total) + '</td>') + '</tr>'; }).join('') +
      '</tbody></table></div>' +
      (ps.length ? '<section class="receipt__parcels"><h3>Delivery</h3><ul>' + ps.map(function (p) { return '<li><span>' + parcelLine(p) + '</span>' + (hide ? '' : '<strong>' + (p.pending || p.fee == null ? 'To be quoted' : feeText(p.fee, p.free)) + '</strong>') + '</li>'; }).join('') + '</ul></section>' : '') +
      (hide ? '<p class="pmeta">Gift receipt: prices are left out.</p>' : '<dl class="receipt__totals">' + row('Items', kwacha(m.sub)) +
        (m.save ? row('You saved', kwacha(m.save), 'is-save') : '') +
        (m.voucher ? row('Voucher ' + esc(m.voucher.code), '−' + kwacha(m.voucher.off), 'is-save') : '') +
        (d && ps.length ? row('Delivery · ' + esc(speedName(d.speed)), known ? feeText(d.fee) : 'To be quoted', d.fee === 0 ? 'is-save' : '') : m.mode === 'collection' ? row('Collection', 'No delivery fee') : row('Delivery', 'Confirmed on WhatsApp')) +
        (m.vat ? row(taxIncluded === false ? 'VAT (' + esc(taxRate) + '%)' : 'Includes VAT (' + esc(taxRate) + '%)', kwacha(m.vat), 'is-vat') : '') +
        row(known ? 'Order total' : 'Total before delivery', kwacha(m.total), 'is-total') + '</dl>') +
      '<footer class="receipt__foot"><p><strong>Zed Supply</strong>' + (legal ? ' · ' + esc(legal) : '') + ' · Lusaka, Zambia' + (tpin ? ' · TPIN ' + esc(tpin) : '') + '</p>' +
        '<p>WhatsApp ' + esc(shopPhone()) + ' · ' + esc(siteAddress()) + '</p>' +
        '<p class="pmeta">Thank you for shopping with Zed Supply. This receipt confirms your order' + (tpin ? '' : '; it is not a tax invoice') + '. Keep it for returns and buyer protection.</p></footer></article>';
  }
  function receiptText(m) {
    var d = m.delivery, ps = (d && d.parcels) || [], known = d ? !d.pending && d.fee != null : m.mode === 'collection';
    if (m.giftReceipt) return ['Zed Supply - gift receipt', 'Order ' + m.ref + ' · ' + niceDate(m.date), ''].concat(
      m.lines.map(function (l, i) { return (i + 1) + '. ' + l.title + (l.label ? ' [' + l.label + ']' : '') + ' x ' + l.qty; }),
      ['', 'Prices are left out.', (m.mode === 'collection' ? 'Collecting near: ' : 'Deliver to: ') + (m.deliverTo || 'to be confirmed'),
      'Questions? WhatsApp ' + shopPhone() + ' · ' + siteAddress()]).join('\n');
    var taxRate = m.vatRate != null ? m.vatRate : VAT.rate, taxIncluded = m.vatIncluded != null ? m.vatIncluded : VAT.included;
    return ['Zed Supply - order receipt', 'Order ' + m.ref + ' · ' + niceDate(m.date) + (m.sample ? ' (demo)' : ''), ''].concat(
      m.lines.map(function (l, i) { return (i + 1) + '. ' + l.title + (l.label ? ' [' + l.label + ']' : '') + ' x ' + l.qty + ' = ' + kwacha(l.total); }), [''],
      ['Items: ' + kwacha(m.sub)], m.voucher ? ['Voucher ' + m.voucher.code + ': -' + kwacha(m.voucher.off)] : [],
      ps.map(function (p) { return 'Delivery, ' + sellerName(p.seller) + ' (' + speedName(p.speed) + '): ' + (p.pending || p.fee == null ? 'to be quoted' : feeText(p.fee, p.free)); }),
      m.vat ? [(taxIncluded === false ? 'VAT ' : 'Includes VAT ') + taxRate + '%: ' + kwacha(m.vat)] : [],
      [(known ? 'Order total: ' : 'Total before delivery: ') + kwacha(m.total), '', (m.mode === 'collection' ? 'Collecting near: ' : 'Deliver to: ') + (m.deliverTo || 'to be confirmed'),
       'Payment: ' + (m.paid ? 'paid' : m.payment || 'to be arranged on WhatsApp'), '', 'Questions? WhatsApp ' + shopPhone() + ' · ' + siteAddress()]).join('\n');
  }
  // wa.me to the buyer's own number (they can message themselves), or to any chat they choose
  function waTo(number, text) {
    var n = String(number || '').replace(/\D/g, '');
    if (/^0\d{9}$/.test(n)) n = '260' + n.slice(1);
    return 'https://wa.me/' + (/^\d{11,15}$/.test(n) ? n : '') + '?text=' + encodeURIComponent(text);
  }
  function receiptActionsHTML(m, onReceipt) {
    var text = receiptText(m);
    receiptModels[m.ref] = m;
    return '<div class="receipt-actions no-print">' +
      (onReceipt ? '<button class="btn btn--primary" type="button" data-receipt-pdf="' + esc(m.ref) + '">Download PDF</button><button class="btn btn--secondary" type="button" data-print-receipt>Print</button>'
        : '<a class="btn btn--primary" href="#/receipt/' + encodeURIComponent(m.ref) + '">View receipt</a><button class="btn btn--secondary" type="button" data-receipt-pdf="' + esc(m.ref) + '">Download PDF</button>') +
      '<a class="btn btn--secondary" href="' + esc(waTo(m.whatsapp, text)) + '" target="_blank" rel="noopener noreferrer">Send to WhatsApp<span class="visually-hidden"> (opens WhatsApp)</span></a>' +
      '<a class="btn btn--secondary" href="mailto:' + esc(encodeURIComponent(m.email || '').replace(/%40/g, '@')) + '?subject=' + encodeURIComponent('Zed Supply receipt ' + m.ref) + '&body=' + encodeURIComponent(text) + '">Email receipt</a>' +
      (onReceipt && m.gift && m.gift.noPrice ? '<a class="btn btn--secondary" href="#/receipt/' + encodeURIComponent(m.ref) + (m.giftReceipt ? '' : '?gift=1') + '">' + (m.giftReceipt ? 'Show prices' : 'Gift receipt (no prices)') + '</a>' : '') +
      (onReceipt ? '<a class="btn btn--secondary" href="#/order/' + encodeURIComponent(m.ref) + '">Back to order</a>' : '') + '</div>';
  }
  /* The receipt as plain text blocks for js/receipt-pdf.js, which lays it out as a PDF file with
     the same sections, colours and logo as the receipt page */
  var receiptModels = {};
  function parcelText(p) {
    var c = p.courier ? courier(p.courier) : null;
    return [p.sellerName || sellerName(p.seller), speedName(p.speed), p.eta || '', c ? c.name : ''].filter(Boolean).join(' · ');
  }
  function receiptDoc(m) {
    var d = m.delivery, ps = (d && d.parcels) || [], hide = !!m.giftReceipt, known = d ? !d.pending && d.fee != null : m.mode === 'collection';
    var taxRate = m.vatRate != null ? m.vatRate : VAT.rate, taxIncluded = m.vatIncluded != null ? m.vatIncluded : VAT.included;
    var legal = (S.business || {}).legalName, tpin = vatActive() && VAT.tpin && !/^\[/.test(VAT.tpin) ? VAT.tpin : '';
    var sellers = m.lines.map(function (l) { return l.seller; }).filter(function (x, i, a) { return x && a.indexOf(x) === i; });
    var totals = hide ? [] : [['Items', kwacha(m.sub)]].concat(
      m.save ? [['You saved', kwacha(m.save), 'save']] : [], m.voucher ? [['Voucher ' + m.voucher.code, '-' + kwacha(m.voucher.off), 'save']] : [],
      [d && ps.length ? ['Delivery · ' + speedName(d.speed), known ? feeText(d.fee) : 'To be quoted', d.fee === 0 ? 'save' : ''] : m.mode === 'collection' ? ['Collection', 'No delivery fee'] : ['Delivery', 'Confirmed on WhatsApp']],
      m.vat ? [[(taxIncluded === false ? 'VAT (' : 'Includes VAT (') + taxRate + '%)', kwacha(m.vat), 'vat']] : [],
      [[known ? 'Order total' : 'Total before delivery', kwacha(m.total), 'total']]);
    return { ref: m.ref, title: hide ? 'Gift receipt' : 'Order receipt', date: niceDate(m.date), sample: !!m.sample, status: m.status || '',
      payment: m.paid ? 'Paid' : 'Payment: ' + (m.payment || 'to be arranged on WhatsApp'), hide: hide,
      parties: [['Customer', [m.name || 'Customer'].concat(m.business ? [m.business.name, m.business.tpin ? 'TPIN ' + m.business.tpin : '', m.business.address || ''].filter(Boolean) : [])],
        [m.mode === 'collection' ? 'Collection' : 'Deliver to', [m.deliverTo || 'Confirmed on WhatsApp']], ['Sold by', [sellers.join(', ') || 'Zed Supply']]],
      rows: m.lines.map(function (l) { return [l.title, l.label || '', String(l.qty), kwacha(l.each), kwacha(l.total)]; }),
      parcels: ps.map(function (p) { return [parcelText(p), hide ? '' : (p.pending || p.fee == null ? 'To be quoted' : feeText(p.fee, p.free))]; }),
      totals: totals, note: hide ? 'Gift receipt: prices are left out.' : '',
      foot: ['Zed Supply' + (legal ? ' · ' + legal : '') + ' · Lusaka, Zambia' + (tpin ? ' · TPIN ' + tpin : ''), 'WhatsApp ' + shopPhone() + ' · ' + siteAddress(),
        'Thank you for shopping with Zed Supply. This receipt confirms your order' + (tpin ? '' : '; it is not a tax invoice') + '. Keep it for returns and buyer protection.'] };
  }
  function downloadReceiptPdf(ref, btn) {
    var m = receiptModels[ref];
    if (!m) return;
    if (btn) btn.disabled = true;
    new Promise(function (ok, fail) {
      if (window.ZS_RECEIPT_PDF) return ok();
      var tag = document.createElement('script'); tag.src = versioned('js/receipt-pdf.js'); tag.onload = ok; tag.onerror = fail; document.head.appendChild(tag);
    }).then(function () { return window.ZS_RECEIPT_PDF.build(receiptDoc(m), { logo: 'assets/brand/logo-original-3d-dark.webp' }); }).then(function (bytes) {
      var url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' })), a = document.createElement('a');
      a.href = url; a.download = 'Zed-Supply-receipt-' + ref + (m.giftReceipt ? '-gift' : '') + '.pdf';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      toast('Receipt downloaded as a PDF', 'success');
    }).catch(function () { toast('The PDF couldn\'t be made on this device. Use Print and choose Save as PDF.', 'error'); })
      .then(function () { if (btn) btn.disabled = false; });
  }

  /* ---------- Delivery price editor (staff back office: demo and connected) ---------- */
  // In js/delivery-editor.js, shared with the admin page (/admin/)
  var DE = window.ZSDeliveryEditor ? window.ZSDeliveryEditor({ esc: esc, couriers: COURIERS, towns: TOWNS, days: DAYS }) : null;
  function deliveryEditorHTML(x) { return DE ? DE.html(x) : '<p class="form-status is-error">The price editor did not load. Reload the page.</p>'; }
  function bindDeliveryEditor(form, save) { if (DE && form) DE.bind(form, save); }

  /* ---------- Rider sign-up (settings.riders) ----------
     Riders apply from an account; staff review, invite them to in-person checks, then approve.
     Nothing like ID or licence numbers is collected online: those are checked in person. */
  var RIDERS = S.riders || {};
  var VEHICLES = { bicycle: 'Bicycle', motorbike: 'Motorbike', car: 'Car', van: 'Van', truck: 'Truck' };
  var AVAIL = { weekdays: 'Weekdays', saturdays: 'Saturdays', sundays: 'Sundays', evenings: 'Evenings' };
  var RIDER_STATUS = { new: 'Received', review: 'Being reviewed', info_needed: 'We need more information', vetting: 'Invited to in-person checks', approved: 'Approved to deliver', rejected: 'Not approved', withdrawn: 'Withdrawn' };
  function ridersOpen() { return RIDERS.open === true || !!(RIDERS.preview && DEMO); }
  function riderChecksHTML() {
    return '<section class="band" aria-labelledby="rd-need-title"><h2 id="rd-need-title">What you need' + (RIDERS.open !== true ? ' <span class="tag-sample">Proposed</span>' : '') + '</h2>' + ticks((RIDERS.checks || []).map(esc)) +
      '<p class="pmeta">We check your documents in person. We never ask for ID or licence numbers online.</p></section>';
  }
  function riderFormHTML(v, email) {
    v = v || {};
    var av = v.availability || [];
    return '<form class="form form--card" id="rider-apply" novalidate><h2>' + (v.status === 'info_needed' ? 'Update your application' : 'Apply to deliver') + '</h2><p class="hint">Fields marked * are required.' + (email ? ' We reply to ' + esc(email) + ' and your phone.' : '') + '</p>' +
      '<div class="field-row"><div class="field"><label for="rd-name">Full name *</label><input id="rd-name" required minlength="2" maxlength="80" autocomplete="name" value="' + esc(v.full_name || '') + '"></div>' +
      '<div class="field"><label for="rd-phone">Phone or WhatsApp *</label><input id="rd-phone" type="tel" required maxlength="20" autocomplete="tel" placeholder="0977 123456" value="' + esc(v.phone || '') + '"></div></div>' +
      '<div class="field-row"><div class="field"><label for="rd-town">Town *</label><input id="rd-town" required maxlength="60" list="rd-town-list" value="' + esc(v.town || '') + '"><datalist id="rd-town-list">' + TOWNS.map(function (t) { return '<option value="' + esc(t.name) + '">'; }).join('') + '</datalist></div>' +
      '<div class="field"><label for="rd-areas">Areas you can cover</label><input id="rd-areas" maxlength="300" placeholder="e.g. Kabulonga, Woodlands" value="' + esc(v.areas || '') + '"></div></div>' +
      '<div class="field-row"><div class="field"><label for="rd-vehicle">How would you deliver? *</label><select id="rd-vehicle" required>' + Object.keys(VEHICLES).map(function (k) { return '<option value="' + k + '"' + (v.vehicle === k ? ' selected' : '') + '>' + VEHICLES[k] + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><span class="field__label">Vehicle</span><div class="check"><input type="checkbox" id="rd-own"' + (v.owns_vehicle ? ' checked' : '') + '><label for="rd-own">I own it, or can use it for deliveries</label></div></div></div>' +
      '<fieldset class="field"><legend>When can you work?</legend><div class="checks">' + Object.keys(AVAIL).map(function (k) { return '<div class="check"><input type="checkbox" id="rd-av-' + k + '" value="' + k + '"' + (av.indexOf(k) !== -1 ? ' checked' : '') + '><label for="rd-av-' + k + '">' + AVAIL[k] + '</label></div>'; }).join('') + '</div></fieldset>' +
      '<div class="field"><label for="rd-exp">Delivery or driving experience</label><textarea id="rd-exp" maxlength="1000">' + esc(v.experience || '') + '</textarea></div>' +
      '<fieldset class="field"><legend>Please confirm *</legend>' +
        '<div class="check"><input type="checkbox" id="rd-adult"><label for="rd-adult">I\'m 18 or over and have a valid NRC</label></div>' +
        '<div class="check"><input type="checkbox" id="rd-licence"' + (v.has_licence ? ' checked' : '') + '><label for="rd-licence">I have a valid driving licence for my vehicle (not needed for a bicycle)</label></div>' +
        '<div class="check"><input type="checkbox" id="rd-phone-ok"><label for="rd-phone-ok">I have a smartphone with WhatsApp</label></div>' +
        '<div class="check"><input type="checkbox" id="rd-clear"><label for="rd-clear">I can get a police clearance certificate before my first delivery</label></div>' +
        '<div class="check"><input type="checkbox" id="rd-consent"><label for="rd-consent">Zed Supply may use these details to assess my application, as set out in the <a href="privacy.html">privacy policy</a></label></div></fieldset>' +
      '<button class="btn btn--primary" type="submit">' + (v.status === 'info_needed' ? 'Send updated application' : 'Send application') + '</button><p class="form-status" role="status" aria-live="polite"></p></form>';
  }
  // The form's answers, or { error } with the first thing to fix
  function readRiderForm() {
    var g = function (id) { return $('#' + id); }, v = { full_name: cleanText(g('rd-name').value, 80), phone: g('rd-phone').value.trim(), town: cleanText(g('rd-town').value, 60),
      areas: cleanText(g('rd-areas').value, 300), vehicle: g('rd-vehicle').value, owns_vehicle: g('rd-own').checked,
      availability: $$('[id^="rd-av-"]:checked').map(function (c) { return c.value; }), experience: cleanText(g('rd-exp').value, 1000),
      is_adult: g('rd-adult').checked, has_licence: g('rd-licence').checked, has_smartphone: g('rd-phone-ok').checked, can_get_clearance: g('rd-clear').checked };
    var digits = v.phone.replace(/[^\d+]/g, '');
    var bad = v.full_name.length < 2 ? ['rd-name', 'Enter your full name.'] : !/^(0\d{9}|\+?260\d{9})$/.test(digits) ? ['rd-phone', 'Enter a Zambian mobile number, for example 0977 123456.']
      : v.town.length < 2 ? ['rd-town', 'Enter your town.'] : !v.is_adult ? ['rd-adult', 'Riders must be 18 or over with a valid NRC.']
      : v.vehicle !== 'bicycle' && !v.has_licence ? ['rd-licence', 'You need a valid driving licence for a ' + VEHICLES[v.vehicle].toLowerCase() + '.']
      : !v.has_smartphone ? ['rd-phone-ok', 'You need a smartphone with WhatsApp to take deliveries.'] : !v.can_get_clearance ? ['rd-clear', 'You need a police clearance certificate before your first delivery.']
      : !g('rd-consent').checked ? ['rd-consent', 'Agree to us using your details to assess your application.'] : null;
    if (bad) { g(bad[0]).focus(); return { error: bad[1] }; }
    return v;
  }
  function riderStatusHTML(a) {
    return '<section class="card" aria-labelledby="rd-status-title"><h2 id="rd-status-title">Your rider application</h2><p><span class="' + statusClass(RIDER_STATUS[a.status] === 'Approved to deliver' ? 'approved' : RIDER_STATUS[a.status]) + '">' + esc(RIDER_STATUS[a.status] || a.status) + '</span></p>' +
      (a.staff_note ? '<p class="notice"><strong>From Zed Supply:</strong> ' + esc(a.staff_note) + '</p>' : '') +
      '<p class="pmeta">' + esc(VEHICLES[a.vehicle] || '') + ' · ' + esc(a.town) + '</p></section>';
  }
  var CANCEL_REASONS = ['I ordered by mistake', 'I found a better price', 'Delivery would take too long', 'I need to change the items or address', 'I no longer need it', 'Another reason'];
  // Order page: ask to cancel until the order is packed (settings.orderOptions.cancel); after that,
  // the seller may still stop it, or the buyer can return it under the returns policy
  function cancelHTML(o) {
    var c = OPTS.cancel || {};
    if (!c.enabled || o.sample || o.status >= 4) return '';
    if (o.cancel) return '<div class="notice" role="status"><p><strong>Cancellation requested</strong> on ' + niceDate(o.cancel.date) + ' (' + esc(o.cancel.reason) + '). We\'ll confirm on WhatsApp. If you\'ve already paid, we refund you the same way you paid.</p></div>';
    if (o.status > (c.untilStatus == null ? 1 : c.untilStatus)) {
      return '<p class="pmeta">This order is already packed. <a href="' + waUrl('Hi Zed Supply, can my order ' + o.ref + ' still be cancelled?') + '" target="_blank" rel="noopener noreferrer">Ask us about cancelling</a>; if it can\'t be stopped, you can <a href="help.html#returns">return it</a> once it arrives.</p>';
    }
    return '<details class="co-cancel"><summary>Cancel this order</summary><div class="field"><label for="cx-reason">Why are you cancelling?</label><select id="cx-reason">' +
      CANCEL_REASONS.map(function (r) { return '<option>' + esc(r) + '</option>'; }).join('') + '</select></div>' +
      '<a class="btn btn--secondary btn--sm" id="cx-send" href="#" target="_blank" rel="noopener noreferrer">Send cancellation request on WhatsApp</a>' +
      '<p class="hint">Free until the seller packs your order. If you\'ve already paid, we refund you the same way you paid.</p></details>';
  }
  function findOrder(ref) {
    ref = String(ref || '').trim().toUpperCase();
    var o = orders().filter(function (x) { return x.ref === ref; })[0];
    if (!o && D.demoOrder && D.demoOrder.ref === ref) o = D.demoOrder;
    return o || null;
  }

  var views = {
    // All categories, grouped as in catalogue.js departmentGroups, each with its subcategories
    departments: function () {
      var groups = (D.departmentGroups || [['', '']]).map(function (g) { return { id: g[0], name: g[1], list: D.departments.filter(function (d) { return (d.group || '') === g[0]; }) }; });
      var loose = D.departments.filter(function (d) { return !groups.some(function (g) { return g.list.indexOf(d) !== -1; }); });
      if (loose.length) groups.push({ id: 'other', name: 'More categories', list: loose });
      show(crumbs([['All categories']]) + head('All categories', D.departments.length + ' departments. Choose one, or go straight to what you need.') +
        '<div class="category-tools"><div class="field"><label for="category-query">Find a department or subcategory</label><input type="search" id="category-query" placeholder="Try laptops, clothing or pet supplies"></div>' +
        '<div class="field"><label for="category-group">Browse by group</label><select id="category-group"><option value="">All groups</option>' + groups.filter(function (g) { return g.list.length; }).map(function (g) { return '<option value="' + esc(g.id) + '">' + esc(g.name) + '</option>'; }).join('') + '</select></div>' +
        '<button class="btn btn--secondary btn--sm" id="category-clear" type="button">Clear</button></div><p id="category-count" class="pmeta" role="status"></p>' +
        groups.filter(function (g) { return g.list.length; }).map(function (g) {
          return '<section class="dept-group" data-category-group="' + esc(g.id) + '" aria-labelledby="dg-' + esc(g.id) + '"><h2 id="dg-' + esc(g.id) + '">' + esc(g.name) + '</h2><ul class="dept-dir">' + g.list.map(function (d) {
            var n = products.filter(function (p) { return p.category === d.id; }).length;
            return '<li class="dept-dir__item" data-category="' + esc(d.id) + '"><a class="dept-dir__head" href="#/dept/' + d.id + '"><span class="dept-dir__icon" aria-hidden="true">' + departmentArtwork(d) + '</span><span><strong>' + esc(d.name) + '</strong><small>' + (n ? n + (n === 1 ? ' product' : ' products') : 'Coming soon') + '</small></span></a>' +
              (d.subs.length ? '<ul class="dept-dir__subs">' + d.subs.map(function (s) {
                var count = products.filter(function (p) { return p.category === d.id && p.sub === s.id; }).length;
                // Counts only where there's something to count; the live store starts empty
                return '<li><a href="#/dept/' + d.id + '?sub=' + encodeURIComponent(s.id) + '">' + esc(s.name) + (count ? ' <span class="category-stock">(' + count + ')</span>' : '') + '</a></li>';
              }).join('') + '</ul>' : '') + '</li>';
          }).join('') + '</ul></section>';
        }).join('') + '<p id="category-empty" class="notice" hidden>No categories match. Try a broader search or clear the filters.</p>', 'All categories');
      function filterCategories() {
        var words = $('#category-query').value.trim().toLowerCase().split(/\s+/).filter(Boolean), group = $('#category-group').value, total = 0;
        $$('.dept-group', view).forEach(function (section) {
          var visible = 0;
          $$('[data-category]', section).forEach(function (card) {
            var d = dept(card.getAttribute('data-category'));
            var text = [d.name, d.short].concat(d.subs.map(function (s) { return s.name; })).join(' ').toLowerCase();
            card.hidden = (!!group && section.getAttribute('data-category-group') !== group) || !words.every(function (w) { return text.indexOf(w) !== -1; });
            if (!card.hidden) visible++;
          });
          section.hidden = !visible; total += visible;
        });
        $('#category-count').textContent = total + ' of ' + D.departments.length + ' departments';
        $('#category-empty').hidden = total > 0;
      }
      $('#category-query').addEventListener('input', filterCategories);
      $('#category-group').addEventListener('change', filterCategories);
      $('#category-clear').addEventListener('click', function () { $('#category-query').value = ''; $('#category-group').value = ''; filterCategories(); $('#category-query').focus(); });
      filterCategories();
    },

    // A department, or one of its subcategories with ?sub=<id>
    dept: function (id, q) {
      var d = byId(D.departments, id);
      if (!d) return views.notfound();
      var sub = q && q.get('sub') ? byId(d.subs, q.get('sub')) : null;
      if (q && q.get('sub') && !sub) return views.notfound();
      var inDept = products.filter(function (p) { return p.category === id; });
      var groups = multiSellerGroups(id, sub ? sub.id : '');
      var subChips = d.subs.length ? '<ul class="chips" aria-label="' + esc(d.short) + ' categories"><li><a class="chip" href="#/dept/' + d.id + '"' + (sub ? '' : ' aria-current="page"') + '>All ' + esc(d.short) + (inDept.length ? ' <span class="chip__count">' + inDept.length + '</span>' : '') + '</a></li>' + d.subs.map(function (s) {
        var n = inDept.filter(function (p) { return p.sub === s.id; }).length;
        return '<li><a class="chip" href="#/dept/' + d.id + '?sub=' + encodeURIComponent(s.id) + '"' + (sub && sub.id === s.id ? ' aria-current="page"' : '') + '>' + esc(s.name) + (n ? ' <span class="chip__count">' + n + '</span>' : '') + '</a></li>';
      }).join('') + '</ul>' : '';
      listing({ title: esc(sub ? sub.name : d.name), crumbs: sub ? [['Categories', '#/departments'], [d.name, '#/dept/' + d.id], [sub.name]] : [['Categories', '#/departments'], [d.name]],
        list: sub ? inDept.filter(function (p) { return p.sub === sub.id; }) : inDept, docTitle: sub ? sub.name + ' · ' + d.name : d.name,
        extra: (d.note ? '<p class="pmeta dept-note">' + esc(d.note) + ' <a href="help.html#not-sold">What can\'t be sold</a></p>' : '') + subChips +
          (groups.length ? '<div class="multi"><p class="multi__title">Sold by more than one seller: compare prices side by side</p><ul class="chips">' + groups.map(function (g) {
            var n = g.items.map(function (x) { return x.seller; }).filter(function (v, i, l) { return v && l.indexOf(v) === i; }).length;
            return '<li><a class="chip chip--compare" href="#/compare?ids=' + g.items.map(function (x) { return encodeURIComponent(x.id); }).join(',') + '">' + esc(g.items[0].title) + ' · ' + n + ' sellers from ' + kwacha(g.from) + '</a></li>';
          }).join('') + '</ul></div>' : '') });
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
      // Nothing matched exactly: try close spellings ("solr" finds "solar"), as the server search does
      var fuzzy = !list.length && words.length ? ext('searchFuzzy', words, products.filter(function (p) { return !dp || p.category === dp; }), searchText) : '';
      if (fuzzy && fuzzy.length) list = fuzzy;
      var stores = D.sellers.filter(function (s) { return matches(s.name); }), brands = D.brands.filter(function (b) { return matches(b.name); });
      var extra = (stores.length || brands.length) ? '<ul class="chips" aria-label="Matching stores and brands">' +
        stores.map(function (s) { return '<li><a class="chip" href="#/store/' + s.id + '">🏪 Store: ' + esc(s.name) + '</a></li>'; }).join('') +
        brands.map(function (b) { return '<li><a class="chip" href="#/brand/' + b.id + '">🏷️ Brand: ' + esc(b.name) + '</a></li>'; }).join('') + '</ul>' : '';
      extra = (fuzzy && fuzzy.length ? '<p class="notice" role="status">No exact matches, so here are close spellings.</p>' : '') + ext('searchTools', term, dp) + extra;
      var box = $('#q'); if (box) box.value = term;
      listing({ title: term ? 'Results for “' + esc(term) + '”' : 'All products', sub: dp ? 'In ' + esc(dept(dp).name) : '', crumbs: [['Search']], list: list, extra: extra, docTitle: term ? 'Search: ' + term : 'All products' });
    },

    deals: function (arg, q) {
      var all = localProducts.filter(onDeal), cat = q.get('cat') || '';
      var cats = D.departments.filter(function (d) { return all.some(function (p) { return p.category === d.id; }); });
      var chip = function (id, name, n) { return '<li><a class="chip" href="#/deals' + (id ? '?cat=' + id : '') + '"' + (id === cat ? ' aria-current="page"' : '') + '>' + esc(name) + ' <span class="chip__count">' + n + '</span></a></li>'; };
      listing({ title: cat ? 'Deals in ' + esc(dept(cat).name) : "Today's deals", docTitle: cat ? 'Deals: ' + dept(cat).name : "Today's deals",
        sub: 'Price drops, clearance, bundles and seller promotions, by category.', crumbs: cat ? [["Today's deals", '#/deals'], [dept(cat).name]] : [["Today's deals"]],
        list: all.filter(function (p) { return !cat || p.category === cat; }),
        extra: cats.length ? '<ul class="chips" aria-label="Deals by category">' + chip('', 'All deals', all.length) + cats.map(function (d) { return chip(d.id, d.name, all.filter(function (p) { return p.category === d.id; }).length); }).join('') + '</ul>' : '' });
    },

    trending: function (id) {
      var groups = trendingGroups();
      if (id) {
        var g = groups.filter(function (x) { return x.id === id; })[0], d = byId(D.departments, id);
        if (!d) return views.notfound();
        show(crumbs([['Trending', '#/trending'], [d.name]]) + head('Trending in ' + esc(d.name), 'Ranked by what buyers are ordering, saving and rating most right now.') +
          (g ? '<div id="trend-one">' + trendBlock(g, TREND_PAGE * 2, 'h2') + '</div>' : empty('Nothing is trending in this category yet.', '<a class="btn btn--primary" href="#/dept/' + id + '">Browse ' + esc(d.name) + '</a>')) + trendNote(), 'Trending: ' + d.name);
        return;
      }
      show(crumbs([['Trending']]) + head('Trending now', 'What buyers are ordering, saving and rating most, category by category.') +
        (groups.length ? trendingHTML(groups, groups.length, 'h2') : empty('Nothing is trending yet. Check back once buyers start ordering.', '<a class="btn btn--primary" href="#/deals">Shop today\'s deals</a>')) + trendNote(), 'Trending now');
    },

    'top-picks': function (key) {
      var months = pickMonths(), active = months.indexOf(key) !== -1 ? key : months[0];
      show(crumbs([['Top picks']]) + head(active ? monthName(active) + ' top picks' : 'Top picks', 'The products buyers chose most each month: orders, plus ratings and reviews written that month.') +
        (months.length ? picksTabs(months, active, 'page') + picksPanel(active, 0) : empty('Top picks appear once buyers have ordered or reviewed products this month.', '<a class="btn btn--primary" href="#/deals">Shop today\'s deals</a>')) + trendNote(), 'Top picks');
      var h1 = $('h1', view);
      $$('[data-pick]', view).forEach(function (t) { t.addEventListener('click', function () { h1.textContent = monthName(t.getAttribute('data-pick')) + ' top picks'; }); });
    },

    compare: function (arg, q) {
      var ids = q.get('ids') ? q.get('ids').split(',') : compareList();
      var list = ids.map(product).filter(function (p) { return p && (china || p.source !== 'china'); }).slice(0, COMPARE_MAX);
      var fromList = !q.get('ids');
      show(crumbs([['Compare']]) + head('Compare products', fromList ? 'Your compare list: up to ' + COMPARE_MAX + ' products, side by side.' : 'The same or similar products from different sellers, side by side.') +
        (list.length > 1 ? compareTable(list, fromList) : empty('Add two or more products to compare. Open a product and choose "Add to compare".', '<a class="btn btn--primary" href="#/deals">Browse deals</a>')) +
        (list.length && fromList ? '<p class="view-foot"><button class="link-btn link-btn--danger" type="button" id="cmp-clear">Clear compare list</button></p>' : ''), 'Compare');
      view.onclick = function (e) {
        var rm = e.target.closest('[data-compare-remove]');
        if (rm) { toggleCompare(rm.getAttribute('data-compare-remove')); route(); }
        if (e.target.closest('#cmp-clear')) { store.set('compare', []); route(); }
      };
    },

    product: function (id, q) {
      var p = product(id);
      if (!p || (p.source === 'china' && !china)) return views.notfound();
      addRecent(p.id);
      var s = seller(p.seller), b = brand(p.brand), d = dept(p.category), r = ratingOf(p), u = user();
      var sel = ZP.hasOptions(p) ? ZP.defaultSelection(p) : {}, v0 = variantOf(p, sel), pr = basePriceOf(p, v0);
      var range = p.source === 'china' ? null : ZP.commitRange(p, p.priceZMW);
      var revs = reviewsFor(p), mine = revs.filter(function (v) { return v.mine; })[0];
      var bought = orders().filter(function (o) { return !o.sample && Number(o.status) >= 1 && (o.items || []).some(function (it) { return it.id === p.id; }); })[0];
      var similar = p.source === 'china' ? [] : similarTo(p, 3);
      var similarIds = similar.map(function (x) { return x.id; });
      var related = products.filter(function (x) { return x.category === p.category && x.id !== p.id && similarIds.indexOf(x.id) === -1; }).slice(0, 8);
      var inCompare = compareList().indexOf(p.id) !== -1;
      var ps = subOf(p);
      var html = crumbs([[d.name, '#/dept/' + p.category]].concat(ps ? [[ps.name, '#/dept/' + p.category + '?sub=' + encodeURIComponent(ps.id)]] : [], [[p.title]])) +
        '<div class="pdp">' +
          '<div class="pdp__media"><div class="pflags">' + (pr.off ? '<span class="flag-sale">-' + pr.off + '%</span>' : '') + (p.sample ? '<span class="tag-sample">Sample</span>' : '') + '</div>' + likeBtn(p) + '<div class="pmedia">' + media(p) + '</div>' + thumbsHTML(p) + '</div>' +
          '<div>' +
            '<h1>' + esc(p.title) + '</h1>' +
            '<p class="pmeta">' + (b ? 'Brand: <a href="#/brand/' + b.id + '">' + esc(b.name) + '</a> · ' : '') + (s ? 'Sold by <a href="#/store/' + s.id + '">' + esc(s.name) + '</a>' + verifiedHTML(s) : '') + '</p>' + ext('productSeller', p, s) +
            (r ? starsHTML(p) + '<p><a href="#reviews" data-jump="reviews">' + r.count + (r.count === 1 ? ' review' : ' reviews') + '</a></p>' : '<p class="pmeta">No reviews yet</p>') +
            '<div data-price-main>' + priceHTML(pr) + '</div>' +
            (range ? '<p class="pmeta pcommit">Or name your own price from ' + kwacha(range.min) + ' in the buy box.</p>' : '') +
            (pr.promo ? '<p class="notice">Part of <a href="#/promo/' + pr.promo.id + '">' + esc(pr.promo.title) + '</a>: ' + pr.promo.discount + '% off until ' + niceDate(pr.promo.ends) + '.</p>' : '') +
            (ZP.hasOptions(p) ? '<div class="popts" id="pdp-opts">' + optionsHTML(p, sel) + '</div>' : '') +
            ((p.attributes || {}).features && p.attributes.features.length ? '<section class="product-features" aria-labelledby="features-title"><h2 id="features-title" class="h3">Key features</h2><ul>' + p.attributes.features.map(function (f) { return '<li>' + esc(f) + '</li>'; }).join('') + '</ul></section>' : '') +
            ((p.attributes || {}).condition ? '<section class="product-condition" aria-labelledby="condition-title"><h2 id="condition-title" class="h3">Item condition: ' + esc(ZP.conditionLabel(p)) + '</h2>' + (p.attributes.conditionNotes ? '<p>' + esc(p.attributes.conditionNotes) + '</p>' : '') + '</section>' : '') +
            inBoxHTML(p) +
            '<h2 class="h3">About this product</h2><p>' + (p.description ? esc(p.description) : '<span class="placeholder">[PRODUCT DESCRIPTION: add a description field in catalogue.js]</span>') + '</p>' +
            specsHTML(p) +
            '<p class="pmeta">Category: <a href="#/dept/' + p.category + '">' + esc(d.name) + '</a> · Product ID ' + esc(p.id) + '<span data-sku>' + (v0 ? ' · SKU ' + esc(v0.sku) : '') + '</span></p>' +
            (complaintsOn() && p.source !== 'china' ? '<p class="pmeta"><a href="#/complaint?product=' + encodeURIComponent(p.id) + '&type=misleading">Report a problem with this listing</a></p>' : '') +
          '</div>' +
          '<aside class="buybox" aria-label="Buy this product">' +
            '<div data-price-box>' + priceHTML(pr) + '</div><p class="pmeta" id="pdp-total" aria-live="polite"></p><div data-stock>' + stockHTML(p, v0) + '</div>' + tradeHTML(p) +
            '<div data-fulfil="' + esc(p.id) + '">' + fulfilHTML(p) + '</div>' +
            (sellerCouriers(s).length ? '<p class="pmeta">Ships with ' + sellerCouriers(s).map(function (id) { return esc(courier(id).name); }).join(', ') + '. <a href="help.html#couriers">About couriers</a></p>' : '') +
            '<p class="pmeta"><button class="link-btn" type="button" data-open-location aria-haspopup="dialog"><span data-location-label>Deliver to: set location</span></button></p>' +
            '<div><label for="pdp-qty" class="pmeta">Quantity' + (ZP.sellUnit(p) ? ' (' + esc(ZP.unitName(p, 2)) + ')' : '') + '</label><div class="qty"><button type="button" data-step="-1" data-target="#pdp-qty" aria-label="Decrease quantity">−</button><input id="pdp-qty" ' + qtyAttrs(p, ZP.orderRules(p).min) + '><button type="button" data-step="1" data-target="#pdp-qty" aria-label="Increase quantity">+</button></div></div>' +
            commitHTML(range) +
            '<button class="btn btn--primary btn--block" type="button" id="pdp-add">Add to cart</button>' +
            '<a class="btn btn--secondary btn--block" id="buy-now" href="#" target="_blank" rel="noopener noreferrer">Buy now on WhatsApp</a>' +
            '<p class="pmeta">The final price and delivery are confirmed on WhatsApp before you pay.</p>' +
            '<button class="btn btn--secondary btn--block btn--sm" type="button" id="pdp-compare" aria-pressed="' + inCompare + '">' + (inCompare ? 'In your compare list' : 'Add to compare') + '</button>' +
            alsoSoldHTML(p) + ext('productBuybox', p) +
            (payMethods().length ? '<div class="buybox__pay"><p class="pmeta">' + payHeading() + '</p>' + payChipsHTML() + '</div>' : '') +
          '</aside>' +
        '</div>' +
        (similar.length ? '<section class="section" aria-labelledby="cmp-title"><div class="section-head"><h2 id="cmp-title">Compare with similar items</h2>' +
          '<a href="#/compare?ids=' + [p.id].concat(similarIds).map(encodeURIComponent).join(',') + '">Open full comparison</a></div>' + compareTable([p].concat(similar), false) + '</section>' : '') +
        '<section class="reviews" id="reviews" aria-labelledby="rev-title"><div>' +
          '<h2 id="rev-title">Customer reviews</h2>' + (r ? '<div class="rsum"><p class="rsum__avg"><strong>' + r.avg.toFixed(1) + '</strong><span class="visually-hidden"> out of 5</span></p><div>' + starsHTML(p) + '<p class="reviews__avg">' + r.count + (r.count === 1 ? ' rating' : ' ratings') + '</p></div></div>' + ratingBars(revs) : '<p>No reviews yet. Be the first to rate it.</p>') +
          (secureMode() ? '<p>Verified-purchase review submission is being connected. Browser-only reviews are not submitted for live listings.</p>' : u ? reviewForm(mine, bought)
            : '<p><a class="btn btn--secondary" href="#/account">Sign in to rate and review</a></p>') +
        '</div><div>' + (revs.length > 1 ? '<div class="field reviews__sort"><label for="rev-sort">Sort reviews</label><select id="rev-sort"><option value="new">Most recent</option><option value="high">Highest rated</option><option value="low">Lowest rated</option><option value="verified">Verified purchases first</option></select></div>' : '') +
          (revs.length ? '<div class="review-filters"><div class="field"><label for="rev-star">Star rating</label><select id="rev-star"><option value="">All ratings</option>' + [5,4,3,2,1].map(function (n) { return '<option value="' + n + '">' + n + (n === 1 ? ' star' : ' stars') + '</option>'; }).join('') + '</select></div><div class="field"><label for="rev-find">Search reviews</label><input id="rev-find" type="search" maxlength="80" placeholder="e.g. battery or delivery"></div>' +
            (revs.some(function (v) { return v.verified; }) ? '<label class="inline-check"><input id="rev-verified" type="checkbox"> Verified purchases only</label>' : '') + '</div><p id="rev-count" role="status" class="pmeta">' + revs.length + (revs.length === 1 ? ' review' : ' reviews') + '</p><div id="rev-list" class="rev-scroll" tabindex="0" role="region" aria-label="Reviews, ' + revs.length + ' in total">' + reviewList(revs, 'new') + '</div>' : '') + '</div></section>' +
        ext('productSections', p) +
        (related.length ? '<section class="section" aria-labelledby="rel-title"><h2 id="rel-title">More in ' + esc(d.name) + '</h2><ul class="row">' + cards(related) + '</ul></section>' : '');
      show(html, p.title);
      // Everything the buyer picks (options, add-ons, their own price) updates the prices,
      // stock, buttons and the WhatsApp message together.
      var qty = $('#pdp-qty'), buy = $('#buy-now'), add = $('#pdp-add'), commitBox = $('#commit-box');
      var cRange = $('#commit-range'), cAmt = $('#commit-amt'), cur = null, shownPhoto = null;
      var pick = function () {
        var o = {};
        ZP.options(p).forEach(function (x) { var c = $('input[name="po-' + x.key + '"]:checked'); if (c) o[x.key] = c.value; });
        var adds = $$('[data-addon]:checked').map(function (c) { return Number(c.value); });
        if (adds.length) o.addons = adds;
        var mode = $('input[name="pmode"]:checked');
        if (mode && mode.value === 'commit') o.commit = Number(cAmt.value) || 0;
        return o;
      };
      var update = function () {
        var o = pick(), n = parseInt(qty.value, 10) || ZP.orderRules(p).min, lq = lineQuote(p, o, n), v = lq.v, q = lq.q;
        if (cRange) {
          $('#pm-commit').disabled = !q.range;
          $('label[for="pm-commit"]').textContent = q.range ? 'Name your price' : 'Offers unavailable for this selection';
          if (!q.range && o.commit != null) {
            $('#pm-fixed').checked = true; commitBox.hidden = true; delete o.commit;
            lq = lineQuote(p, o, n); q = lq.q;
          } else if (q.commit) { o.commit = q.commit; cAmt.value = cRange.value = q.commit; }
        }
        var axes = ZP.options(p), missing = axes.filter(function (x) { return !o[x.key]; });
        var out = (p.variants || []).length && axes.length && (!v || v.stock <= 0);
        var quantityOK = ZP.qtyAllowed(p, Number(qty.value)) && (!v || n <= v.stock);
        cur = { opt: o, q: q, v: v, n: n, ok: !missing.length && !out && quantityOK };
        // Prices: the main column shows the item price, the buy box adds add-ons and the buyer's own price
        $('[data-price-main]').innerHTML = priceHTML(lq.pr);
        $('[data-price-box]').innerHTML = q.commit ? '<p class="price"><span class="price__now"><span class="visually-hidden">Your price </span>' + kwacha(q.each) + '</span><span class="price__was"><span class="visually-hidden">listed at </span>' + kwacha(lq.pr.now + q.addTotal) + '</span></p>' : priceHTML({ now: q.each, was: lq.pr.was ? lq.pr.was + q.addTotal : 0 });
        $('#pdp-total').textContent = (q.addTotal ? kwacha(q.unit) + ' + ' + kwacha(q.addTotal) + ' add-ons. ' : '') + (q.commit ? 'Your offer, pending the seller. ' : '') + (n > 1 || q.addTotal || q.commit ? 'Total for ' + qtyLabel(p, n) + ': ' + kwacha(q.each * n) : '');
        $('[data-stock]').innerHTML = stockHTML(p, v);
        var sku = $('[data-sku]'); if (sku) sku.textContent = v ? ' · SKU ' + v.sku : '';
        // The chosen option's photo shows when the option changes; a thumbnail the buyer
        // picked stays until then, so changing the quantity doesn't undo it
        var imagePath = (v && v.image) || p.image;
        if (!root.classList.contains('data-saver') && imagePath !== shownPhoto) {
          shownPhoto = imagePath;
          var imageBox = $('.pdp__media .pmedia'), img = $('.pdp__media .pmedia > img');
          if (imagePath) {
            if (!img) { img = document.createElement('img'); img.width = img.height = 600; img.decoding = 'async'; imageBox.appendChild(img); }
            img.alt = (p.alt || p.title) + (v ? ' · ' + ZP.describe(p, { colour: v.colour, size: v.size }) : '');
            if (img.getAttribute('src') !== imagePath) { img.classList.remove('is-broken'); img.src = imagePath; }
          } else if (img) img.remove();
          $$('.pthumb').forEach(function (t) { t.setAttribute('aria-pressed', String(t.getAttribute('data-photo') === imagePath)); });
        }
        axes.forEach(function (x) {
          var lab = $('[data-opt-label="' + x.key + '"]'); if (lab) lab.textContent = o[x.key] || 'choose one';
          if (!(p.variants || []).length) return;
          $$('input[name="po-' + x.key + '"]').forEach(function (r) {
            var soldOut = !ZP.valueInStock(p, x.key, r.value, o);
            r.parentNode.classList.toggle('is-out', soldOut);
            $('[data-out-note]', r.parentNode).textContent = soldOut ? ' (sold out)' : '';
          });
        });
        if (cRange && q.range) {
          cRange.max = cAmt.max = q.range.max; cRange.min = cAmt.min = q.range.min;
          $('label[for="commit-range"]').textContent = 'Name your commitment price (Range: ' + kwacha(q.range.min) + ' – ' + kwacha(q.range.max) + ')';
        }
        add.disabled = !cur.ok;
        add.textContent = out ? 'Sold out' : missing.length ? 'Choose ' + missing.map(function (x) { return x.name.toLowerCase(); }).join(' and ') : !quantityOK ? 'Choose ' + qtyRange(p, v ? v.stock : null) : q.commit ? 'Add to cart at ' + kwacha(q.each) : 'Add to cart';
        buy.classList.toggle('is-disabled', !cur.ok);
        buy.setAttribute('aria-disabled', String(!cur.ok));
        var bits = ZP.describe(p, o), m = q.commit
          ? 'Hi Zed Supply, I\'d like to commit ' + kwacha(q.unit) + ' each for: ' + p.title + ' (ID ' + p.id + (v ? ', SKU ' + v.sku : '') + '). The seller\'s range is ' + kwacha(q.range.min) + ' to ' + kwacha(q.range.max) + '.'
          : 'Hi Zed Supply, I\'d like to buy: ' + p.title + ' (ID ' + p.id + (v ? ', SKU ' + v.sku : '') + '), price ' + kwacha(q.unit) + ' ' + perUnit(p) + '.';
        if (bits) m += ' Options: ' + bits + '.';
        if (q.addTotal) m += ' With add-ons: ' + kwacha(q.each) + ' each.';
        m += ' Quantity: ' + qtyLabel(p, n);
        if (ZP.orderRules(p).heavy) m += '. Heavy item: please quote truck delivery';
        buy.setAttribute('data-wa-message', m); buy.href = waUrl(m);
      };
      $('.pdp').addEventListener('change', function (e) {
        if (e.target.name === 'pmode') {
          commitBox.hidden = e.target.value !== 'commit';
          if (!commitBox.hidden) cAmt.focus();
        }
        if (e.target === cAmt) {
          // Typed prices outside the range snap to the nearest end of it
          cAmt.value = Math.min(Number(cAmt.max), Math.max(Number(cAmt.min), Math.round((Number(cAmt.value) || Number(cAmt.max)) * 100) / 100));
          cRange.value = cAmt.value;
        }
        if (e.target.closest('.popts, .inbox, .pmode') || e.target === cAmt) update();
      });
      if (cRange) cRange.addEventListener('input', function () { cAmt.value = cRange.value; update(); });
      if (cAmt) cAmt.addEventListener('input', function () { var n = Number(cAmt.value); if (n >= Number(cAmt.min) && n <= Number(cAmt.max)) { cRange.value = n; update(); } });
      qty.addEventListener('input', update);
      update();
      if (window.ZSProductZoom) productZoomCleanup = window.ZSProductZoom.mount($('.pdp__media .pmedia'));
      ext('productReady', p, function () { return Math.max(1, parseInt(qty.value, 10) || 1); });
      add.addEventListener('click', function () {
        if (!cur.ok) return;
        var o = cur.opt, hasAny = Object.keys(o).length;
        if (!addToCart(p.id, cur.n, hasAny ? o : undefined)) return;
        toast('Added to cart: ' + esc(p.title) + (hasAny ? ' (' + esc(ZP.describe(p, o)) + ')' : '') + ' <a href="#/cart">View cart</a>', 'success');
      });
      buy.addEventListener('click', function (e) { if (!cur.ok) e.preventDefault(); });
      view.onclick = function (e) {
        var j = e.target.closest('[data-jump]');
        if (j) { e.preventDefault(); $('#' + j.getAttribute('data-jump')).scrollIntoView(); }
        var th = e.target.closest('.pthumb');
        if (th) {
          var main = $('.pdp__media .pmedia > img');
          if (main) { main.classList.remove('is-broken'); main.src = th.getAttribute('data-photo'); main.alt = th.getAttribute('data-alt'); }
          $$('.pthumb').forEach(function (t) { t.setAttribute('aria-pressed', String(t === th)); });
        }
      };
      $('#pdp-compare').addEventListener('click', function () {
        var added = toggleCompare(p.id), btn = $('#pdp-compare');
        btn.setAttribute('aria-pressed', added);
        btn.textContent = added ? 'In your compare list' : 'Add to compare';
        var n = compareList().length;
        toast(added ? 'Added to compare (' + n + ' of ' + COMPARE_MAX + '). <a href="#/compare">Compare now</a>' : 'Removed from compare');
      });
      var sortSel = $('#rev-sort');
      var drawReviews = function () {
        var holder = $('#rev-list'); if (!holder) return;
        holder.innerHTML = reviewList(revs, sortSel ? sortSel.value : 'new', { star: Number($('#rev-star').value) || 0, query: $('#rev-find').value.trim().toLowerCase(), verified: $('#rev-verified') && $('#rev-verified').checked });
        var n = $$('.review', holder).length;
        $('#rev-count').textContent = n + ' of ' + revs.length + (revs.length === 1 ? ' review' : ' reviews'); holder.setAttribute('aria-label', 'Matching reviews: ' + n);
      };
      ['rev-sort', 'rev-star', 'rev-verified'].forEach(function (id) { var input = $('#' + id); if (input) input.addEventListener('change', drawReviews); });
      var reviewSearch = $('#rev-find'); if (reviewSearch) reviewSearch.addEventListener('input', drawReviews);
      var rf = $('#review-form');
      if (rf) rf.addEventListener('submit', function (e) {
        e.preventDefault();
        var picked = $('input[name="rev-rating"]:checked', rf), st = $('.form-status', rf);
        if (ext('reviewPhotosReady') === false) { st.className = 'form-status is-error'; st.textContent = 'Please wait while your photos are prepared, then submit again.'; return; }
        if (!picked) { st.className = 'form-status is-error'; st.textContent = 'Choose a star rating from 1 to 5.'; st.focus(); return; }
        if (!$('#rev-text').value.trim()) { st.className = 'form-status is-error'; st.textContent = 'Write a few words about your experience.'; $('#rev-text').focus(); return; }
        var headline = cleanText($('#rev-head').value, 120);
        if (!headline) { st.className = 'form-status is-error'; st.textContent = 'Add a short headline for your review.'; $('#rev-head').focus(); return; }
        var all = store.get('reviews', {});
        all[p.id] = (all[p.id] || []).filter(function (v) { return !v.mine; });
        var photos = ext('reviewPhotos', rf);
        all[p.id].push({ name: u.name, rating: Number(picked.value), date: today, title: headline, text: $('#rev-text').value.trim(), mine: true, verified: false, photos: photos || (mine && mine.photos) || [] });
        if (!saveStored('reviews', all)) { st.className = 'form-status is-error'; st.textContent = 'Your review could not be saved on this device. Try fewer photos or allow browser storage, then submit again.'; return; }
        toast(mine ? 'Your review has been updated' : 'Thanks for your review', 'success');
        route();
      });
      if (q && q.get('review') && rf) setTimeout(function () { $('#reviews').scrollIntoView(); var first = $('input[name="rev-rating"]', rf); if (first) first.focus({ preventScroll: true }); }, 50);
    },

    wishlist: function () {
      var list = wish().map(product).filter(Boolean), bought = store.get('bought', {}), inCart = cart().map(function (l) { return l.id; });
      var boughtIds = list.filter(function (p) { return bought[p.id]; }).map(function (p) { return p.id; });
      show(crumbs([['Wishlist']]) + head('Your wishlist', 'Products you\'ve liked, saved for later.') +
        (boughtIds.length ? '<div class="wish-tools"><p class="pmeta">' + boughtIds.length + (boughtIds.length === 1 ? ' item here was' : ' items here were') + ' bought.</p><button class="btn btn--secondary btn--sm" type="button" data-wish-remove="' + esc(boughtIds.join(',')) + '">Remove bought items</button></div>' : '') +
        (list.length ? '<ul class="grid">' + list.map(function (p) {
          var tags = (inCart.indexOf(p.id) !== -1 ? '<span class="wish-tag wish-tag--cart">In your cart</span>' : '') + (bought[p.id] ? '<span class="wish-tag wish-tag--bought">Bought ' + niceDate(bought[p.id]) + '</span>' : '');
          return tags ? card(p).replace('<div class="pbody">', '<div class="pbody"><p class="wish-status">' + tags + '</p>') : card(p);
        }).join('') + '</ul>' : empty('Tap the comet on any product to save it here.', '<a class="btn btn--primary" href="#/deals">Browse deals</a>')), 'Wishlist');
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
          '<p>Selling? <a href="#/seller">Go to the Seller Centre</a></p><p>Using a shared device? <a href="#/device">Manage saved data</a>.</p></div></div>', 'My Account');
        $('#signin').addEventListener('submit', function (e) {
          e.preventDefault();
          store.set('user', { name: $('#su-name').value.trim(), phone: $('#su-phone').value.trim(), email: $('#su-email').value.trim() });
          updateCounts(); toast('Signed in', 'success'); route();
        });
        return;
      }
      var myReviews = 0, all = store.get('reviews', {});
      Object.keys(all).forEach(function (k) { myReviews += all[k].filter(function (rv) { return rv.mine; }).length; });
      var recent = store.get('recent', []).map(product).filter(Boolean);
      var tile = function (href, t, sub) { return '<li><a href="' + href + '"><strong>' + t + '</strong><span>' + sub + '</span></a></li>'; };
      show(crumbs([['My Account']]) + head('Hello, ' + esc(u.name.split(' ')[0])) +
        '<div class="account-bar"><p>Signed in as <strong>' + esc(u.name) + '</strong> on this device.</p><button class="btn btn--secondary btn--sm" type="button" data-sign-out>Sign out</button></div>' +
        '<ul class="tiles">' +
          tile('#/orders', 'Orders', orders().length + ' orders · track and reorder') +
          tile('#/wishlist', 'Wishlist', wish().length + ' saved products') +
          tile('#/cart', 'Cart', cart().length + ' products in your cart') +
          tile('#/track', 'Track an order', 'Enter an order number') +
          tile('help.html#returns', 'Returns', 'How returns work') +
          (addressesOn() ? tile('#/addresses', 'Addresses', addresses().length + ' saved · choose at checkout') : '') +
          (complaintsOn() ? tile('#/complaints', 'Complaints', complaints().length + ' sent · make or follow up') : '') +
          ext('accountTiles') +
          tile('#/seller', 'Seller Centre', 'Manage your store') +
          tile('help.html', 'Help centre', 'Answers and contact') +
          tile('#/device', 'Data on this device', 'Export or delete your saved details and activity') +
          tile('#/promotions', 'Promotions', 'Deals from sellers') +
        '</ul>' +
        '<div class="duo duo--gap"><form class="form form--card" id="acct"><h2>Your details</h2>' +
          '<div class="field"><label for="ac-name">Name</label><input id="ac-name" autocomplete="name" value="' + esc(u.name) + '" required></div>' +
          '<div class="field"><label for="ac-phone">Phone or WhatsApp</label><input id="ac-phone" type="tel" autocomplete="tel" value="' + esc(u.phone) + '"></div>' +
          '<div class="field"><label for="ac-email">Email</label><input id="ac-email" type="email" autocomplete="email" value="' + esc(u.email) + '"></div>' +
          '<div class="btn-row"><button class="btn btn--primary" type="submit">Save</button><button class="btn btn--secondary" type="button" data-sign-out>Sign out</button></div></form>' +
          businessFormHTML(u.business || {}) +
          '<div><div class="card"><h2>Delivery location</h2><p data-loc-summary>' + locSummaryHTML() + '</p>' +
            '<p class="pmeta">Added to your WhatsApp orders so we can confirm delivery to your area and the delivery fee. ' + (loc && loc.remember ? 'Remembered on this device.' : 'Kept until you close this tab unless you choose to remember it.') + '</p>' +
            '<button class="btn btn--secondary btn--sm" type="button" data-open-location aria-haspopup="dialog">Set or change location</button></div>' +
          '<div class="card"><h2>Your activity</h2><p>' + myReviews + (myReviews === 1 ? ' review' : ' reviews') + ' written · ' + recent.length + ' products viewed recently.</p><p class="pmeta">Prototype: your account is stored on this device only.</p></div></div></div>' +
        ext('accountSections') +
        (recent.length ? '<section class="section"><h2>Recently viewed</h2><ul class="row">' + cards(recent) + '</ul></section>' : ''), 'My Account');
      ext('accountReady');
      $('#acct').addEventListener('submit', function (e) {
        e.preventDefault();
        store.set('user', Object.assign({}, user(), { name: $('#ac-name').value.trim(), phone: $('#ac-phone').value.trim(), email: $('#ac-email').value.trim() }));
        updateCounts(); toast('Details saved', 'success');
      });
      bindBusinessForm(function (b) { var next = Object.assign({}, user()); if (b) next.business = b; else delete next.business; store.set('user', next); });
    },

    orders: function () {
      var list = orders(), mineRev = store.get('reviews', {}), seen = {};
      var toRate = [];
      list.forEach(function (o) { (o.items || []).forEach(function (it) {
        var p = product(it.id);
        if (p && !seen[it.id] && !(mineRev[it.id] || []).some(function (v) { return v.mine; })) { seen[it.id] = 1; toRate.push(p); }
      }); });
      show(crumbs([['My Account', '#/account'], ['Orders']]) + head('Your orders', 'Orders you\'ve sent from this device.') +
        (toRate.length ? '<section class="card rate-prompt" aria-labelledby="rate-title"><h2 id="rate-title">Rate your purchases</h2><p class="pmeta">Share your experience to help other buyers. Reviews are saved on this device.</p><ul class="rate-list">' +
          toRate.slice(0, 6).map(function (p) { return '<li><span>' + esc(p.title) + '</span><a class="btn btn--secondary btn--sm" href="#/product/' + encodeURIComponent(p.id) + '?review=1">Rate<span class="visually-hidden"> ' + esc(p.title) + '</span></a></li>'; }).join('') + '</ul></section>' : '') +
        (list.length ? '<ul class="orders">' + list.map(function (o) {
          return '<li><a class="order-row" href="#/order/' + encodeURIComponent(o.ref) + '"><span><strong>' + esc(o.ref) + '</strong><br><span class="pmeta">' + niceDate(o.date) + ' · ' + o.items.length + (o.items.length === 1 ? ' product' : ' products') + '</span></span><span><span class="' + statusClass(o.cancel ? 'Cancellation requested' : o.status >= 4 ? 'delivered' : STATUS[o.status]) + '">' + (o.cancel ? 'Cancellation requested' : STATUS[o.status]) + '</span><br><strong>' + kwacha(o.total) + '</strong></span></a></li>';
        }).join('') + '</ul>' : empty('No orders yet. When you check out on WhatsApp, your order appears here.', '<a class="btn btn--primary" href="#/deals">Start shopping</a>')) +
        '<p class="view-foot"><a href="#/track">Track an order by number</a></p>', 'Orders');
    },

    order: function (ref, q) {
      var o = findOrder(ref);
      if (!o) return views.track(null, null, ref);
      var msg = 'Hi Zed Supply, I\'d like an update on my order ' + o.ref + '.', placed = !!(q && q.get('placed'));
      show(crumbs([['Orders', '#/orders'], [o.ref]]) + head('Order ' + esc(o.ref), 'Placed ' + niceDate(o.date) + (o.sample ? ' · <span class="tag-sample">Demo order</span>' : '')) +
        (placed ? '<div class="placed" id="placed" role="status" tabindex="-1"><p class="placed__title">Thank you, your order is placed</p>' +
          '<p>' + (!o.sample && !o.status && o.message ? 'Press Send in WhatsApp so it reaches us; we then confirm it and send payment instructions. ' : '') + 'Your receipt is ready: download it, or send it to your WhatsApp or email.</p></div>' : '') +
        (placed ? wishPromptHTML(o.ref, o.wished) : '') +
        receiptActionsHTML(receiptModel(o), false) +
        '<div class="cart"><div class="card"><h2>Tracking</h2><ol class="timeline">' + STATUS.map(function (s, i) {
          return '<li class="' + (i < o.status ? 'is-done' : (i === o.status ? 'is-done is-current' : '')) + '">' + s + (i === o.status ? ' <span class="visually-hidden">(current status)</span>' : '') + '</li>';
        }).join('') + '</ol>' +
        (o.sample ? '<p class="pmeta">This is a demo order to show how tracking will look.</p>' : '<p class="pmeta">We update your order once it\'s confirmed on WhatsApp. Prototype: live tracking arrives with full accounts.</p>') +
        parcelsHTML(o) +
        (o.handover && o.status < 4 && !o.cancel ? handoverHTML(o.ref, o.handover, o.sample) : '') +
        // Until we confirm it, the order may not have been sent: WhatsApp opened, but Send wasn't pressed
        (!o.sample && !o.status && !o.cancel && o.message ? '<div class="notice" role="status"><p><strong>Didn\'t press Send?</strong> Your order reaches us only when the WhatsApp message is sent.</p><a class="btn btn--secondary btn--sm" href="' + waUrl(o.message) + '" data-wa-message="' + esc(o.message) + '" target="_blank" rel="noopener noreferrer">Open WhatsApp again</a></div>' : '') +
        cancelHTML(o) + ext('orderActions', o) +
        '<div class="btn-row">' + askBtn(msg) + (o.sample ? '' : '<button class="btn btn--secondary" type="button" id="buy-again">Buy again</button>') +
          (o.business ? '<button class="btn btn--secondary" type="button" data-print-order>Print order summary</button>' : '') +
          (complaintsOn() && !o.sample ? '<a class="btn btn--secondary" href="#/complaint?order=' + encodeURIComponent(o.ref) + '">' + (o.status >= 4 ? 'Return or report a problem' : 'Report a problem') + '</a>' : '') + '</div></div>' +
        '<aside class="summary"><h2>Items</h2><ul class="lines">' + o.items.map(function (it) { var p = product(it.id); return '<li class="line line--plain"><div><a class="line__title" href="#/product/' + it.id + '">' + esc(p ? p.title : it.id) + '</a><p class="pmeta">' + (it.label ? esc(it.label) + ' · ' : '') + 'Quantity ' + (p ? esc(qtyLabel(p, parseInt(it.qty, 10) || 0)) : (parseInt(it.qty, 10) || 0)) + ' · ' + kwacha(it.price * it.qty) + '</p>' +
          (p && !o.sample ? '<a class="link-btn" href="#/product/' + encodeURIComponent(it.id) + '?review=1">' + (((store.get('reviews', {})[it.id]) || []).some(function (v) { return v.mine; }) ? 'Edit your review' : 'Rate this item') + '<span class="visually-hidden">: ' + esc(p.title) + '</span></a>' : '') + '</div></li>'; }).join('') + '</ul>' +
        orderTotalsHTML(o) +
        (o.business ? '<div class="deliver-box"><p class="deliver-box__label">Billed to</p><p>' + esc(o.business.name) + (o.business.tpin ? '<br>TPIN ' + esc(o.business.tpin) : '') + (o.business.address ? '<br>' + esc(o.business.address) : '') + '</p>' +
          '<p class="pmeta">An order summary, not a tax invoice.</p></div>' : '') +
        (o.freight ? '<div class="deliver-box"><p class="deliver-box__label">Truck delivery</p><p>' + esc(o.freight) + '</p><p class="pmeta">The delivery fee is quoted before you pay.</p></div>' : '') +
        (o.mode === 'collection' ? '<div class="deliver-box"><p class="deliver-box__label">Collection</p><p>You\'re collecting this order. We confirm where and when on WhatsApp.</p></div>'
          : o.ship ? '<div class="deliver-box"><p class="deliver-box__label">Delivery</p><p>' + esc(o.ship) + '</p></div>' : '') +
        (o.when && (o.when.day || o.when.slot) ? '<div class="deliver-box"><p class="deliver-box__label">Preferred delivery</p><p>' + esc([o.when.day ? dayLabel(o.when.day) : 'Any day', o.when.slot ? slotLabel(o.when.slot) : 'any time'].join(', ')) + '</p></div>' : '') +
        (o.gift ? '<div class="deliver-box"><p class="deliver-box__label">Gift</p><p>' + (o.gift.message ? '“' + esc(o.gift.message) + '”' : 'Yes') + (o.gift.noPrice ? '<br><span class="pmeta">Prices left out of the parcel</span>' : '') + '</p></div>' : '') +
        (o.pay ? '<div class="deliver-box"><p class="deliver-box__label">Payment</p><p>' + esc(o.pay) + '</p></div>' : '') +
        '<div class="deliver-box"><p class="deliver-box__label">Deliver to</p><p>' + (o.deliverTo ? esc(o.deliverTo) : '<span class="pmeta">No location given. We\'ll ask on WhatsApp.</span>') + '</p></div></aside></div>', 'Order ' + o.ref);
      if (placed && $('#placed')) $('#placed').focus();
      // Cancellation request: the message follows the chosen reason; sending it marks the order
      var cxSend = $('#cx-send'), cxReason = $('#cx-reason');
      if (cxSend) {
        var cxMsg = function () { return 'Hi Zed Supply, please cancel my order ' + o.ref + '. Reason: ' + cxReason.value + '.'; };
        var cxSync = function () { cxSend.setAttribute('data-wa-message', cxMsg()); cxSend.href = waUrl(cxMsg()); };
        cxReason.addEventListener('change', cxSync); cxSync();
        cxSend.addEventListener('click', function () {
          var list = orders();
          list.forEach(function (x) { if (x.ref === o.ref) x.cancel = { date: today, reason: cxReason.value, status: 'requested' }; });
          store.set('orders', list);
          setTimeout(route, 400);
        });
      }
      var again = $('#buy-again');
      if (again) again.addEventListener('click', function () {
        // Same items and options at today's prices; an earlier offer price isn't reused
        var added = 0, skipped = 0;
        o.items.forEach(function (it) {
          var opt = it.opt ? JSON.parse(JSON.stringify(it.opt)) : undefined;
          if (opt) { delete opt.commit; if (!Object.keys(opt).length) opt = undefined; }
          if (product(it.id) && addToCart(it.id, Math.max(1, parseInt(it.qty, 10) || 1), opt)) added++; else skipped++;
        });
        toast(added ? 'Added ' + added + (added === 1 ? ' item' : ' items') + ' to your cart' + (skipped ? '; ' + skipped + ' no longer available' : '') + '. <a href="#/cart">View cart</a>' : 'These items are no longer available.');
      });
    },

    receipt: function (ref, q) {
      var o = findOrder(ref);
      if (!o) return views.track(null, null, ref);
      var m = receiptModel(o);
      m.giftReceipt = !!(m.gift && m.gift.noPrice && q && q.get('gift') === '1');
      show(crumbs([['Orders', '#/orders'], [o.ref, '#/order/' + encodeURIComponent(o.ref)], ['Receipt']]) + receiptActionsHTML(m, true) + receiptHTML(m), 'Receipt ' + o.ref);
      if (q && q.get('print') === '1') setTimeout(function () { window.print(); }, 250);
      if (q && q.get('pdf') === '1') downloadReceiptPdf(m.ref);
    },

    track: function (arg, q, missing) {
      show(crumbs([['Track order']]) + head('Track your order', 'Enter the order number from your WhatsApp message, e.g. ZS-ABC123.') +
        '<form class="form form--card form--narrow" id="track-form"><div class="field"><label for="tr-ref">Order number</label><input id="tr-ref" required autocapitalize="characters" value="' + esc(missing || '') + '"></div>' +
        (missing ? '<p class="form-status is-error">We couldn\'t find order ' + esc(missing) + ' on this device. Ask us on WhatsApp and we\'ll check for you.</p>' : '') +
        '<button class="btn btn--primary" type="submit">Track order</button>' + (D.demoOrder ? '<p class="hint">Try the demo order: <button class="link-btn" type="button" id="tr-demo">' + esc(D.demoOrder.ref) + '</button></p>' : '') + '</form>', 'Track order');
      $('#track-form').addEventListener('submit', function (e) { e.preventDefault(); location.hash = '#/order/' + encodeURIComponent($('#tr-ref').value.trim().toUpperCase()); });
      if ($('#tr-demo')) $('#tr-demo').addEventListener('click', function () { location.hash = '#/order/' + D.demoOrder.ref; });
    },

    /* Saved addresses (#/addresses). Kept on this device until accounts move to the server
       (settings.orderOptions.addresses.sync, supabase/migrations (orders_aftersales) user_addresses). */
    addresses: function (arg, q) {
      if (!addressesOn()) return views.notfound();
      var list = addresses(), max = (OPTS.addresses && OPTS.addresses.max) || 10;
      var editing = q && q.get('edit') ? list.filter(function (a) { return a.id === q.get('edit'); })[0] : null;
      var a = editing || { label: list.length ? '' : 'Home', recipient: (user() || {}).name || '', phone: (user() || {}).phone || '', town: '', area: '', landmark: '', instructions: '' };
      var f = function (id, label, input, hint) { return '<div class="field"><label for="ad-' + id + '">' + label + '</label>' + input + (hint ? '<p class="hint">' + hint + '</p>' : '') + '</div>'; };
      show(crumbs([['My Account', '#/account'], ['Addresses']]) + head('Your addresses', 'Choose one at checkout instead of typing it each time.') +
        '<p class="notice">Saved on this device only for now. Your addresses will follow you to other devices once secure accounts launch.</p>' +
        '<div class="duo duo--gap"><section class="card" aria-labelledby="ad-list-title"><h2 id="ad-list-title">Saved addresses (' + list.length + ' of ' + max + ')</h2>' +
          (list.length ? '<ul class="orders">' + list.map(function (x) {
            return '<li class="order-row"><span><strong>' + esc(x.label) + '</strong>' + (x.isDefault ? ' <span class="badge">Default</span>' : '') + '<br><span class="pmeta">' + esc([x.recipient, addressLine(x), x.phone].filter(Boolean).join(' · ')) + '</span>' +
              (x.instructions ? '<br><span class="pmeta">' + esc(x.instructions) + '</span>' : '') + '</span>' +
              '<span class="btn-row"><button class="link-btn" type="button" data-use-address="' + esc(x.id) + '">Deliver here</button><a class="link-btn" href="#/addresses?edit=' + encodeURIComponent(x.id) + '">Edit<span class="visually-hidden"> ' + esc(x.label) + '</span></a>' +
              (x.isDefault ? '' : '<button class="link-btn" type="button" data-default-address="' + esc(x.id) + '">Make default</button>') +
              '<button class="link-btn link-btn--danger" type="button" data-del-address="' + esc(x.id) + '">Remove<span class="visually-hidden"> ' + esc(x.label) + '</span></button></span></li>';
          }).join('') + '</ul>' : '<p>No saved addresses yet.</p>') + '</section>' +
        '<form class="form form--card" id="ad-form" novalidate><h2>' + (editing ? 'Edit ' + esc(editing.label) : 'Add an address') + '</h2>' +
          f('label', 'Name for this address *', '<input id="ad-label" list="ad-labels" maxlength="30" required value="' + esc(a.label) + '"><datalist id="ad-labels"><option value="Home"><option value="Work"><option value="Shop"><option value="Family"></datalist>', 'For example Home, Work or Mum\'s house.') +
          '<div class="field-row">' + f('recipient', 'Who receives it', '<input id="ad-recipient" autocomplete="name" maxlength="60" value="' + esc(a.recipient) + '">') +
          f('phone', 'Their phone number', '<input id="ad-phone" type="tel" autocomplete="tel" maxlength="20" value="' + esc(a.phone) + '">', 'For the rider. Shared only in orders you send.') + '</div>' +
          '<div class="field-row">' + f('town', 'Town or city *', '<input id="ad-town" list="zm-towns" autocomplete="address-level2" maxlength="60" required value="' + esc(a.town) + '">') +
          f('area', 'Area or neighbourhood', '<input id="ad-area" autocomplete="address-level3" maxlength="60" value="' + esc(a.area) + '">') + '</div>' +
          f('landmark', 'Street, house number or landmark', '<input id="ad-landmark" autocomplete="street-address" maxlength="100" value="' + esc(a.landmark) + '">') +
          f('instructions', 'Delivery instructions', '<input id="ad-instructions" maxlength="160" placeholder="e.g. Blue gate, call on arrival" value="' + esc(a.instructions) + '">') +
          '<div class="check"><input type="checkbox" id="ad-default"' + (a.isDefault || !list.length ? ' checked' : '') + '><label for="ad-default">Use as my default delivery address</label></div>' +
          '<p class="form-status" role="status" tabindex="-1"></p><div class="btn-row"><button class="btn btn--primary" type="submit">' + (editing ? 'Save changes' : 'Save address') + '</button>' + (editing ? '<a class="btn btn--secondary" href="#/addresses">Cancel</a>' : '') + '</div></form></div>', 'Addresses');
      var form = $('#ad-form'), st = $('.form-status', form);
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var val = function (id, n) { return cleanText($('#ad-' + id).value, n); };
        var rec = { id: editing ? editing.id : newRef('A'), label: val('label', 30), recipient: val('recipient', 60), phone: val('phone', 20), town: val('town', 60), area: val('area', 60), landmark: val('landmark', 100), instructions: val('instructions', 160), isDefault: $('#ad-default').checked };
        var fail = function (m, id) { st.className = 'form-status is-error'; st.textContent = m; $('#ad-' + id).focus(); };
        if (!rec.label) return fail('Give this address a name, such as Home.', 'label');
        if (!rec.town) return fail('Enter the town or city.', 'town');
        if (hasCardNumber(rec.instructions + ' ' + rec.landmark)) return fail(CARD_WARNING, 'instructions');
        if (!editing && list.length >= max) return fail('You can save up to ' + max + ' addresses. Remove one first.', 'label');
        var next = list.filter(function (x) { return x.id !== rec.id; }).map(function (x) { if (rec.isDefault) x.isDefault = false; return x; });
        next.push(rec);
        if (!next.some(function (x) { return x.isDefault; })) next[0].isDefault = true;
        store.set('addresses', next);
        toast(editing ? 'Address updated' : 'Address saved', 'success');
        location.hash = '#/addresses';
        if (!editing) route();
      });
      view.onclick = function (e) {
        var use = e.target.closest('[data-use-address]'), def = e.target.closest('[data-default-address]'), del = e.target.closest('[data-del-address]');
        if (use) { var x = list.filter(function (y) { return y.id === use.getAttribute('data-use-address'); })[0]; if (x) { saveLoc({ town: x.town, area: x.area, landmark: x.landmark, remember: !!(loc && loc.remember) }); toast('Delivering to ' + esc(x.label) + '. <a href="#/cart">Go to cart</a>'); } }
        if (def) { store.set('addresses', list.map(function (y) { y.isDefault = y.id === def.getAttribute('data-default-address'); return y; })); route(); }
        if (del) { var left = list.filter(function (y) { return y.id !== del.getAttribute('data-del-address'); }); if (left.length && !left.some(function (y) { return y.isDefault; })) left[0].isDefault = true; store.set('addresses', left); toast('Address removed'); route(); }
      };
    },

    /* Complaints (#/complaint) about an order, a listing, a seller or delivery. Sent to Zed Supply
       on WhatsApp now; kept on this device so the buyer can follow up (#/complaints). With seller
       accounts on the server, sellers reply in the Seller Centre (supabase/migrations (orders_aftersales) complaints). */
    complaint: function (arg, q) {
      if (!complaintsOn()) return views.notfound();
      var u = user() || {}, my = orders().filter(function (o) { return !o.sample; });
      var qOrder = q ? q.get('order') || '' : '', qProduct = q ? q.get('product') || '' : '', qSeller = q ? q.get('seller') || '' : '';
      var o = qOrder ? findOrder(qOrder) : null, p = qProduct ? product(qProduct) : null;
      // The seller follows from the product, or from the order when everything came from one seller
      var orderSellers = o ? o.items.map(function (it) { var x = product(it.id); return x ? x.seller : ''; }).filter(function (s, i, all) { return s && all.indexOf(s) === i; }) : [];
      var sid = qSeller || (p ? p.seller : orderSellers.length === 1 ? orderSellers[0] : '');
      var replyDays = (OPTS.complaints && OPTS.complaints.replyDays) || 2;
      var radio = function (name, list, cur) { return list.map(function (x) { return '<div class="pay-option"><input type="radio" name="' + name + '" id="' + name + '-' + x[0] + '" value="' + x[0] + '"' + (x[0] === cur ? ' checked' : '') + '><label for="' + name + '-' + x[0] + '">' + esc(x[1]) + '</label></div>'; }).join(''); };
      show(crumbs([['Help', 'help.html#complaints'], ['Make a complaint']]) + head('Make a complaint', 'Tell us what went wrong. We reply within ' + replyDays + ' working days, and work with the seller to put it right.') +
        '<div class="duo duo--gap"><form class="form form--card" id="cp-form" novalidate>' +
          '<div class="field-row"><div class="field"><label for="cp-order">Order</label><select id="cp-order"><option value="">Not about an order</option>' + my.map(function (x) { return '<option value="' + esc(x.ref) + '"' + (x.ref === qOrder ? ' selected' : '') + '>' + esc(x.ref + ' · ' + niceDate(x.date)) + '</option>'; }).join('') + '</select></div>' +
          '<div class="field"><label for="cp-seller">Seller</label><select id="cp-seller"><option value="">Not sure, or not about a seller</option>' + D.sellers.map(function (s) { return '<option value="' + esc(s.id) + '"' + (s.id === sid ? ' selected' : '') + '>' + esc(s.name) + '</option>'; }).join('') + '</select></div></div>' +
          (p ? '<p class="pmeta">About the listing: <a href="#/product/' + esc(p.id) + '">' + esc(p.title) + '</a> (' + esc(p.id) + ')</p>' : '') +
          '<fieldset class="field pay-choice"><legend>What went wrong? *</legend>' + radio('cp-type', COMPLAINT_TYPES, q ? q.get('type') || '' : '') + '</fieldset>' +
          '<div class="field"><label for="cp-text">What happened? *</label><textarea id="cp-text" maxlength="1000" rows="5" placeholder="Include dates, what you were told, and what you received."></textarea><p class="hint">Have photos? Send them in WhatsApp after this message. Never include card numbers or PINs.</p></div>' +
          '<fieldset class="field pay-choice"><legend>What would you like? *</legend>' + radio('cp-want', COMPLAINT_WANTS, '') + '</fieldset>' +
          '<div class="field-row"><div class="field"><label for="cp-name">Your name *</label><input id="cp-name" autocomplete="name" value="' + esc(u.name || '') + '"></div>' +
          '<div class="field"><label for="cp-phone">Phone or WhatsApp</label><input id="cp-phone" type="tel" autocomplete="tel" value="' + esc(u.phone || '') + '"></div></div>' +
          '<div class="check"><input type="checkbox" id="cp-share" checked><label for="cp-share">Zed Supply may share my complaint and order details with the seller to resolve it</label></div>' +
          '<p class="form-status" role="status" tabindex="-1"></p>' +
          '<a class="btn btn--primary" id="cp-send" href="#" target="_blank" rel="noopener noreferrer">Send complaint on WhatsApp</a></form>' +
        '<aside class="band"><h2>What happens next</h2><ol class="steps-list"><li>We acknowledge your complaint and give you its reference.</li><li>We reply within ' + replyDays + ' working days, after checking with the seller.</li><li>We agree a fix with you: a replacement, repair, refund or return, under our <a href="help.html#returns">returns policy</a>.</li><li>Not happy with the outcome? Ask us to review it. You can also contact the Competition and Consumer Protection Commission (CCPC).</li></ol>' +
          '<p><a href="#/complaints">Your complaints</a> · <a href="help.html#complaints">How complaints work</a></p></aside></div>', 'Make a complaint');
      var ref = newRef('ZC'), send = $('#cp-send'), st = $('.form-status', $('#cp-form'));
      var pick = function (name) { var r = $('input[name="' + name + '"]:checked'); return r ? r.value : ''; };
      var label = function (list, id) { var x = list.filter(function (y) { return y[0] === id; })[0]; return x ? x[1] : ''; };
      var data = function () {
        var s = seller($('#cp-seller').value);
        return { ref: ref, date: today, order: $('#cp-order').value, seller: s ? s.id : '', sellerName: s ? s.name : '', product: p ? p.id : '', type: pick('cp-type'), want: pick('cp-want'),
          text: $('#cp-text').value.trim().slice(0, 1000), name: cleanText($('#cp-name').value, 60), phone: cleanText($('#cp-phone').value, 20), share: $('#cp-share').checked, status: 'sent' };
      };
      var message = function (c) {
        return 'Hi Zed Supply, I\'d like to make a complaint (ref ' + c.ref + ').' +
          (c.order ? '\nOrder: ' + c.order : '') + (c.sellerName ? '\nSeller: ' + c.sellerName : '') + (p ? '\nListing: ' + p.title + ' (' + p.id + ')' : '') +
          '\nProblem: ' + label(COMPLAINT_TYPES, c.type) + '\nWhat happened: ' + c.text + '\nI\'d like: ' + label(COMPLAINT_WANTS, c.want) +
          '\nName: ' + c.name + (c.phone ? '\nPhone: ' + c.phone : '') + (c.share ? '' : '\nPlease don\'t share my details with the seller.');
      };
      var sync = function () { var m = message(data()); send.setAttribute('data-wa-message', m); send.href = waUrl(m); };
      $('#cp-form').addEventListener('input', sync); $('#cp-form').addEventListener('change', sync); sync();
      send.addEventListener('click', function (e) {
        var c = data(), fail = function (m, el) { e.preventDefault(); st.className = 'form-status is-error'; st.textContent = m; (el || st).focus(); };
        if (!c.type) return fail('Choose what went wrong.', $('input[name="cp-type"]'));
        if (c.text.length < 10) return fail('Tell us what happened, in a sentence or two.', $('#cp-text'));
        if (!c.want) return fail('Choose what you would like.', $('input[name="cp-want"]'));
        if (!c.name) return fail('Enter your name.', $('#cp-name'));
        if (hasCardNumber(c.text)) return fail(CARD_WARNING, $('#cp-text'));
        store.set('complaints', [c].concat(complaints()));
        setTimeout(function () { location.hash = '#/complaints'; }, 400);
      });
    },

    complaints: function () {
      if (!complaintsOn()) return views.notfound();
      var list = complaints();
      show(crumbs([['My Account', '#/account'], ['Complaints']]) + head('Your complaints', 'Complaints sent from this device. We reply on WhatsApp.') +
        (list.length ? '<ul class="orders">' + list.map(function (c) {
          var t = COMPLAINT_TYPES.filter(function (x) { return x[0] === c.type; })[0];
          return '<li class="order-row"><span><strong>' + esc(c.ref) + '</strong> · ' + esc(t ? t[1] : 'Complaint') + '<br><span class="pmeta">' + niceDate(c.date) + (c.order ? ' · order ' + esc(c.order) : '') + (c.sellerName ? ' · ' + esc(c.sellerName) : '') + '</span></span>' +
            '<span><span class="' + statusClass(c.status) + '">' + esc(COMPLAINT_STATUS[c.status] || c.status) + '</span><br><a href="' + waUrl('Hi Zed Supply, I\'d like an update on my complaint ' + c.ref + '.') + '" target="_blank" rel="noopener noreferrer">Ask for an update<span class="visually-hidden"> on ' + esc(c.ref) + '</span></a></span></li>';
        }).join('') + '</ul>' : empty('No complaints. We hope it stays that way.', '<a class="btn btn--secondary" href="#/complaint">Make a complaint</a>')) +
        '<p class="pmeta">Prototype: the status here updates once complaints are handled through secure accounts. Until then, we keep you updated on WhatsApp.</p>', 'Complaints');
    },

    'delivery-times': function () {
      var est = DELIVERY.estimates || {}, dl = deadlines(), cut = (DELIVERY.sameDay || {}).cutoff, closed = (DELIVERY.closedDays || []).map(function (d) { return DAYS[d]; });
      var start = loc && townInfo(loc.town) ? townInfo(loc.town).name : '';
      var timeFor = function (zone) { var e = est[zone], x = estimateFor(zone); return e && x ? daysText(e) + '<br><span class="pmeta">Order now: ' + esc(x.text.replace(/^Arrives /, 'arrives ')) + '</span>' : 'Confirmed on WhatsApp before you pay'; };
      show(crumbs([['Help', 'help.html#delivery'], ['Delivery times']]) + head('Delivery times by town', 'How long delivery takes depends on how far your parcel travels from the seller\'s town to yours.') +
        '<div class="duo duo--gap"><section class="card" aria-labelledby="dt-check-title"><h2 id="dt-check-title">Check your town' + (DELIVERY.sampleEstimates || DELIVERY.sampleSameDay ? ' <span class="tag-sample">Sample times</span>' : '') + '</h2>' +
          '<div class="field"><label for="dt-town">Your town</label><select id="dt-town"><option value="">Choose your town</option>' + PROVINCES.map(function (pv) {
            return '<optgroup label="' + esc(pv[1]) + '">' + TOWNS.filter(function (t) { return t.province === pv[0]; }).map(function (t) { return '<option' + (t.name === start ? ' selected' : '') + '>' + esc(t.name) + '</option>'; }).join('') + '</optgroup>';
          }).join('') + '</select></div><div id="dt-result" aria-live="polite"></div></section>' +
        '<section class="band" aria-labelledby="dt-how-title"><h2 id="dt-how-title">How we count</h2>' + ticks([
          'Times are in working days' + (closed.length ? ', not counting ' + esc(closed.join(' or ')) : '') + '.',
          DELIVERY.cutoff ? 'Orders after ' + hourText(DELIVERY.cutoff) + ' count from the next working day.' : '',
          sameDayTowns().length ? 'Same day in ' + esc(sameDayTowns().join(', ')) + (DELIVERY.sampleSameDay ? ' (sample towns)' : '') + ': order before ' + hourText(cut) + ' Zambia time on a working day from a seller in your town who offers it.' : '',
          'Each product page shows the date for your town, from that seller. You can pick a preferred day and time at checkout.',
          'Every delivery is confirmed with your private <a href="help.html#delivery">handover code</a>.'].filter(Boolean)) + '</section></div>' +
        (dl ? '<section class="section card" aria-labelledby="dt-sellers-title"><h2 id="dt-sellers-title">What sellers promise' + (dl.sample ? ' <span class="tag-sample">Sample</span>' : '') + '</h2>' +
          '<dl class="totals"><div><dt>Accept your order</dt><dd>Within ' + hoursText(dl.acceptHours) + '</dd></div><div><dt>Hand it to the courier, or have it ready to collect</dt><dd>Within ' + hoursText(dl.dispatchHours) + ' of accepting</dd></div></dl>' +
          '<p class="pmeta">If a seller misses these, we chase the order and keep you posted on WhatsApp.</p></section>' : '') +
        '<p class="view-foot"><a href="help.html#couriers">Courier options</a> · <a href="help.html#delivery">Delivery help</a></p>', 'Delivery times');
      var sel = $('#dt-town'), res = $('#dt-result');
      function draw() {
        var t = townInfo(sel.value);
        if (!t) { res.innerHTML = '<p class="pmeta">Choose your town to see what to expect.</p>'; return; }
        var here = D.sellers.filter(function (s) { var sl = sellerLoc(s); return sl && sl.town.toLowerCase() === t.name.toLowerCase(); });
        res.innerHTML = '<dl class="totals dt-times">' +
          (sameDayTown(t.name) ? '<div><dt>Same day, from sellers in ' + esc(t.name) + ' who offer it</dt><dd>Order by ' + hourText(cut) + '</dd></div>' : '') +
          '<div><dt>From a seller in ' + esc(t.name) + '</dt><dd>' + timeFor('town') + '</dd></div>' +
          '<div><dt>From elsewhere in ' + esc(provinceName(t.province)) + ' Province</dt><dd>' + timeFor('province') + '</dd></div>' +
          '<div><dt>From elsewhere in Zambia</dt><dd>' + timeFor('country') + '</dd></div>' +
          (est.world ? '<div><dt>From outside Zambia</dt><dd>' + timeFor('world') + '</dd></div>' : '') + '</dl>' +
          '<p class="pmeta">' + (here.length ? here.length + (here.length === 1 ? ' seller ships' : ' sellers ship') + ' from ' + esc(t.name) + '.' : 'No sellers ship from ' + esc(t.name) + ' yet, so orders come from other towns.') + '</p>';
      }
      sel.addEventListener('change', draw); draw();
    },

    riders: function () {
      if (ridersOpen()) {
        // Demo: the application is kept on this device; connected mode uses js/backend-ui.js
        var a = store.get('rider-application', null), u = user() || {};
        var editing = a && a.status === 'info_needed', open = a && ['new', 'review', 'vetting'].indexOf(a.status) !== -1;
        show(crumbs([['Deliver with Zed Supply']]) +
          '<div class="store-hero" style="--brand-a:#0A2A66;--brand-b:#0F5E2E"><h1>Deliver with Zed Supply</h1><p>Deliver parcels from Zed Supply sellers to buyers in your town, on the days you choose.</p>' + (DEMO ? '<p><span class="tag-sample">Demo</span> Applications here stay on this device.</p>' : '') + '</div>' +
          '<ol class="steps"><li class="step"><h2>Apply</h2><p>Tell us about you and how you\'d deliver.</p></li><li class="step"><h2>Meet us</h2><p>We check your documents in person and show you how handover codes work.</p></li><li class="step"><h2>Deliver</h2><p>Take parcels from sellers to buyers, and confirm each with the buyer\'s code.</p></li></ol>' +
          '<div class="duo duo--gap">' + riderChecksHTML() + '<div>' + (a ? riderStatusHTML(a) : '') + (open ? '<p><button class="btn btn--secondary btn--danger" type="button" id="rd-withdraw">Withdraw application</button></p>' : riderFormHTML(editing ? a : { full_name: u.name, phone: u.phone }, u.email)) + '</div></div>', 'Deliver with Zed Supply');
        var wd = $('#rd-withdraw');
        if (wd) wd.addEventListener('click', function () { a.status = 'withdrawn'; store.set('rider-application', a); toast('Application withdrawn'); route(); });
        var rf = $('#rider-apply');
        if (rf) rf.addEventListener('submit', function (e) {
          e.preventDefault();
          var v = readRiderForm(), st = $('[role="status"]', rf);
          st.className = 'form-status' + (v.error ? ' is-error' : ''); st.textContent = v.error || '';
          if (v.error) return;
          var keep = editing ? { id: a.id, created_at: a.created_at, staff_note: a.staff_note } : { id: newRef('RD'), created_at: new Date().toISOString(), staff_note: '' };
          store.set('rider-application', Object.assign(keep, v, { status: 'new' }));
          toast('Application sent. We\'ll be in touch.', 'success'); route();
        });
        return;
      }
      var msg = 'Hi Zed Supply, please tell me when rider sign-up opens. My town is: ';
      show(crumbs([['Deliver with Zed Supply']]) +
        '<div class="store-hero" style="--brand-a:#0A2A66;--brand-b:#0F5E2E"><h1>Deliver with Zed Supply</h1><p>Deliver parcels from Zed Supply sellers to buyers in your town. Rider sign-up is coming soon.</p></div>' +
        '<ol class="steps"><li class="step"><h2>Collect</h2><p>Pick up packed parcels from sellers near you.</p></li><li class="step"><h2>Deliver</h2><p>Take them to buyers in the day and time they chose.</p></li><li class="step"><h2>Confirm</h2><p>Enter the buyer\'s 6-digit handover code once the parcel is in their hands.</p></li></ol>' +
        '<div class="duo duo--gap"><section class="band" aria-labelledby="rd-why-title"><h2 id="rd-why-title">Why sign-up isn\'t open yet</h2>' +
          '<p>Riders go to people\'s homes and carry their goods, so we\'re settling how we check every rider in person before they take a parcel. These are the checks we plan:</p>' + ticks((RIDERS.checks || []).map(esc)) +
          '<p>Courier companies licensed by ZICTA can already be chosen at checkout: see <a href="help.html#couriers">courier options</a>.</p></section>' +
        '<section class="card" aria-labelledby="rd-soon-title"><h2 id="rd-soon-title">Rider sign-up</h2><p class="notice">Coming soon. Nothing is collected here yet.</p>' +
          '<div class="btn-row"><button class="btn btn--primary" type="button" disabled>Sign-up opens soon</button>' +
          '<a class="btn btn--secondary" href="' + waUrl(msg) + '" data-wa-message="' + esc(msg) + '" target="_blank" rel="noopener noreferrer">Tell me when it opens</a></div></section></div>', 'Deliver with Zed Supply');
    },

    services: function () {
      var msg = 'Hi Zed Supply, please tell me when the services directory opens. I\'m interested in: ';
      var plan = [['solar', 'Solar installation and repairs'], ['tv', 'TV mounting and setup'], ['home', 'Appliance installation and repair'],
        ['hardware', 'Electricians, plumbers and builders'], ['computers', 'Phone, laptop and computer repairs'], ['smarthome', 'Smart home and security camera setup'],
        ['auto', 'Vehicle fitting and servicing'], ['agri', 'Farm services, such as irrigation setup']].filter(function (x) { return byId(D.departments, x[0]); });
      show(crumbs([['Services']]) +
        '<div class="store-hero" style="--brand-a:#0A2A66;--brand-b:#0B6E69"><h1>Services</h1><p>Book checked local professionals to install, fix and set up what you buy. Coming in a later phase.</p></div>' +
        '<div class="duo duo--gap"><section class="band" aria-labelledby="sv-how-title"><h2 id="sv-how-title">How we plan it to work</h2><ol class="steps-list">' +
          '<li>Find a provider near you by service, or straight from the product you bought, such as installation for a solar kit.</li>' +
          '<li>See the price before you book, and pay through Zed Supply.</li>' +
          '<li>We pay the provider once you confirm the job is done: the same protection as your orders.</li></ol></section>' +
        '<section class="card" aria-labelledby="sv-list-title"><h2 id="sv-list-title">Services we plan to start with</h2>' +
          ticks(plan.map(function (x) { return esc(x[1]) + ' <span class="pmeta">· for <a href="#/dept/' + x[0] + '">' + esc(dept(x[0]).name) + '</a></span>'; })) +
          '<p class="notice">Not open yet. Providers will be able to apply once we\'ve settled how we check them.</p>' +
          '<a class="btn btn--secondary" href="' + waUrl(msg) + '" data-wa-message="' + esc(msg) + '" target="_blank" rel="noopener noreferrer">Tell me when it opens</a></section></div>', 'Services');
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
      var myDeals = store.get('deals', []).filter(function (dl) { return dl.seller === s.id; });
      var myCouriers = sellerCouriers(s);
      show(crumbs([['Seller Centre']]) +
        '<div class="store-hero" style="--brand-a:' + s.colours[0] + ';--brand-b:' + s.colours[1] + '"><h1>' + esc(s.name) + '</h1><p>Seller Centre' + (s.sample ? ' · sample store' : '') + verifiedHTML(s) + '</p></div>' +
        '<ul class="tiles tiles--5"><li><a href="#sc-products" data-jump="sc-products"><strong>' + mine.length + ' products</strong><span>Add and edit products</span></a></li><li><a href="#sc-promos" data-jump="sc-promos"><strong>' + live + ' live</strong><span>Promotions running now</span></a></li><li><a href="#sc-new" data-jump="sc-new"><strong>New</strong><span>Create a promotion</span></a></li><li><a href="#/stock"><strong>Stock planner</strong><span>Reorder levels, overstock and forecasts</span></a></li><li><a href="help.html#selling"><strong>Help</strong><span>Selling on Zed Supply</span></a></li></ul>' +
        '<section class="card sc-products" id="sc-products" aria-labelledby="sc-pr-title"><div class="section-head"><h2 id="sc-pr-title">Your products</h2><a class="btn btn--primary btn--sm" href="#/listing/new">Add a product</a></div>' +
          '<p class="pmeta">Set colours, sizes, stock for each combination, what\'s in the box, add-ons and buyer offers. <a href="#/store/' + s.id + '">View your store</a></p>' +
          (mine.length ? '<ul class="orders">' + mine.map(function (p) {
            var bits = [kwacha(p.priceZMW)];
            if ((p.variants || []).length) bits.push(p.variants.length + ' variations, ' + ZP.totalStock(p) + ' in stock');
            if (ZP.inBox(p).addons.length) bits.push(ZP.inBox(p).addons.length + ' add-ons');
            if (p.commit) bits.push('offers ' + kwacha(p.commit.min) + '–' + kwacha(p.commit.max));
            return '<li class="order-row"><span><a href="#/product/' + esc(p.id) + '"><strong>' + esc(p.title) + '</strong></a><br><span class="pmeta">' + esc(p.id) + ' · ' + bits.join(' · ') + (listingsApi.get(p.id) ? ' · edited in this browser' : '') + '</span></span>' +
              '<a class="link-btn" href="#/listing/' + encodeURIComponent(p.id) + '">Edit<span class="visually-hidden"> ' + esc(p.title) + '</span></a></li>';
          }).join('') + '</ul>' : '<p>No products yet.</p>') + '</section>' +
        (function () {
          // Where the stock is, collection and delivery areas: decides "near you", estimates and collection
          var sl = sellerLoc(s) || { town: '', area: '', province: '', collection: { enabled: false }, deliversTo: 'all' }, col = sl.collection || {};
          var limited = sl.deliversTo !== 'all';
          return '<form class="form form--card sc-products" id="sc-location" aria-labelledby="sc-l-title"><h2 id="sc-l-title">Your store location</h2>' +
            '<p class="pmeta">Where your stock is. Buyers nearby see "Near you" and faster delivery estimates, and can collect if you offer it.</p>' +
            (LOCSET.gps !== false && navigator.geolocation ? '<p><button class="btn btn--secondary btn--sm" type="button" id="sl-gps">Use my current location</button> <span class="pmeta" id="sl-gps-status" role="status" aria-live="polite"></span></p>' : '') +
            '<div class="field-row"><div class="field"><label for="sl-town">Town or city *</label><input id="sl-town" list="zm-towns" maxlength="60" required value="' + esc(sl.town) + '"></div>' +
            '<div class="field"><label for="sl-province">Province</label><select id="sl-province"><option value="">Choose a province</option>' + PROVINCES.map(function (pv) { return '<option value="' + pv[0] + '"' + (pv[0] === sl.province ? ' selected' : '') + '>' + esc(pv[1]) + '</option>'; }).join('') + '</select></div></div>' +
            '<div class="field"><label for="sl-area">Area or street</label><input id="sl-area" maxlength="60" value="' + esc(sl.area) + '"></div>' +
            '<div class="check"><input type="checkbox" id="sl-collect"' + (col.enabled ? ' checked' : '') + '><label for="sl-collect">Buyers can collect from me</label></div>' +
            '<div class="field-row" id="sl-collect-fields"' + (col.enabled ? '' : ' hidden') + '><div class="field"><label for="sl-caddr">Collection address</label><input id="sl-caddr" maxlength="120" placeholder="e.g. Shop 4, Cairo Road" value="' + esc(col.address || '') + '"></div>' +
              '<div class="field"><label for="sl-chours">Collection hours</label><input id="sl-chours" maxlength="60" placeholder="e.g. Mon–Sat 08:00–17:00" value="' + esc(col.hours || '') + '"></div></div>' +
            (sameDayTowns().length ? '<div class="check"><input type="checkbox" id="sl-sameday"' + (sl.sameDay ? ' checked' : '') + ' aria-describedby="sl-sameday-hint"><label for="sl-sameday">I deliver the same day within my town</label></div>' +
              '<p class="hint" id="sl-sameday-hint">For orders by ' + hourText((DELIVERY.sameDay || {}).cutoff) + ' on working days, in ' + esc(sameDayTowns().join(', ')) + (DELIVERY.sampleSameDay ? ' (sample towns)' : '') + '. Buyers in your town see "Arrives today". <a href="#/delivery-times">Delivery times</a></p>' : '') +
            '<fieldset class="field"><legend>Where you deliver</legend><div class="check"><input type="radio" name="sl-areas" id="sl-areas-all" value="all"' + (limited ? '' : ' checked') + '><label for="sl-areas-all">All of Zambia</label></div>' +
              '<div class="check"><input type="radio" name="sl-areas" id="sl-areas-some" value="some"' + (limited ? ' checked' : '') + '><label for="sl-areas-some">Only these provinces</label></div>' +
              '<div class="checks" id="sl-provs"' + (limited ? '' : ' hidden') + '>' + PROVINCES.map(function (pv) { return '<div class="check"><input type="checkbox" id="sl-p-' + pv[0] + '" value="' + pv[0] + '"' + (limited && sl.deliversTo.indexOf(pv[0]) !== -1 ? ' checked' : '') + '><label for="sl-p-' + pv[0] + '">' + esc(pv[1]) + '</label></div>'; }).join('') + '</div></fieldset>' +
            '<p class="form-status" role="status" tabindex="-1"></p><p class="hint">Prototype: saved in this browser only, until seller accounts launch.</p><button class="btn btn--primary" type="submit">Save location</button></form>';
        })() +
        (complaintsOn() ? (function () {
          // Until sellers sign in on the server (orderOptions.complaints.sellerDashboard), Zed Supply passes
          // complaints on by WhatsApp. This prototype lists those made on this device about the store.
          var mineC = complaints().filter(function (c) { return c.seller === s.id && c.share; }), days = (OPTS.complaints && OPTS.complaints.replyDays) || 2;
          return '<section class="card sc-products" id="sc-complaints" aria-labelledby="sc-cp-title"><h2 id="sc-cp-title">Complaints about your store</h2>' +
            '<p class="pmeta">When a buyer complains, Zed Supply contacts you on WhatsApp with the reference. Reply within ' + days + ' working days with your side and how you\'ll put it right: a replacement, repair, refund or return, under the <a href="help.html#returns">returns policy</a>. Complaints that are upheld again and again can lead to your store being paused.</p>' +
            (OPTS.complaints && OPTS.complaints.sellerDashboard ? '' : '<p class="notice">You\'ll be able to read and answer complaints here once seller accounts move to our secure server.</p>') +
            (mineC.length ? '<ul class="orders">' + mineC.map(function (c) { var t = COMPLAINT_TYPES.filter(function (x) { return x[0] === c.type; })[0]; return '<li class="order-row"><span><strong>' + esc(c.ref) + '</strong> · ' + esc(t ? t[1] : '') + '<br><span class="pmeta">' + niceDate(c.date) + (c.order ? ' · order ' + esc(c.order) : '') + ' · prototype, from this device</span></span><span class="' + statusClass(c.status) + '">' + esc(COMPLAINT_STATUS[c.status] || c.status) + '</span></li>'; }).join('') + '</ul>' : '') + '</section>';
        })() : '') +
        (deadlines() ? '<section class="card sc-products" id="sc-deadlines" aria-labelledby="sc-dl-title"><h2 id="sc-dl-title">Your delivery deadlines' + (deadlines().sample ? ' <span class="tag-sample">Sample</span>' : '') + '</h2>' +
          '<ol class="steps-list"><li><strong>Accept</strong> each new order within ' + hoursText(deadlines().acceptHours) + ', or tell us straight away if you can\'t fill it.</li>' +
          '<li><strong>Hand it over</strong> to the courier, or have it ready to collect, within ' + hoursText(deadlines().dispatchHours) + ' of accepting it.</li>' +
          '<li><strong>Confirm the handover</strong> with the buyer\'s 6-digit code, or a photo when they can\'t be there.</li></ol>' +
          '<p class="pmeta">Dispatching on time counts towards your performance score. <a href="#/delivery-times">See what buyers are told</a></p></section>' : '') +
        ext('sellerSections', s, mine) +
        '<div class="duo duo--gap">' +
        '<section class="card" id="sc-promos" aria-labelledby="sc-p-title"><h2 id="sc-p-title">Your promotions</h2>' + (promos.length ? '<ul class="orders">' + promos.map(function (pr) {
          return '<li class="order-row"><span><strong>' + esc(pr.title) + '</strong><br><span class="pmeta">' + esc(season(pr.season).name) + ' · ' + (Number(pr.discount) || 0) + '% off · ' + niceDate(pr.starts) + ' to ' + niceDate(pr.ends) + (pr.image ? ' · with banner image' : '') + '</span></span><span><span class="' + statusClass(promoStatus(pr)) + '">' + promoStatus(pr) + '</span>' + (pr.demo ? ' <button class="link-btn link-btn--danger" type="button" data-del-promo="' + esc(pr.id) + '">Delete<span class="visually-hidden"> ' + esc(pr.title) + '</span></button>' : '') + '</span></li>';
        }).join('') + '</ul>' : '<p>No promotions yet.</p>') + '</section>' +
        '<form class="form form--card" id="sc-new" aria-labelledby="sc-n-title"><h2 id="sc-n-title">Create a promotion</h2>' +
          '<p class="notice">Prototype: promotions you create appear across the store in this browser only.</p>' +
          '<div class="field"><label for="pn-title">Promotion name</label><input id="pn-title" required maxlength="60" placeholder="e.g. Festive season specials"></div>' +
          '<div class="field-row"><div class="field"><label for="pn-season">Type</label><select id="pn-season">' + D.seasons.map(function (x) { return '<option value="' + x.id + '">' + esc(x.name) + '</option>'; }).join('') + '</select></div>' +
          '<div class="field"><label for="pn-off">Discount (%)</label><input id="pn-off" type="number" min="5" max="90" value="10" required></div></div>' +
          '<div class="field-row"><div class="field"><label for="pn-start">Starts</label><input id="pn-start" type="date" value="' + today + '" required></div>' +
          '<div class="field"><label for="pn-end">Ends</label><input id="pn-end" type="date" min="' + today + '" required></div></div>' +
          '<fieldset class="field"><legend>Products in this promotion</legend><div class="checks">' + (mine.length ? mine.map(function (p) { return '<div class="check"><input type="checkbox" id="pn-p-' + p.id + '" value="' + p.id + '" checked><label for="pn-p-' + p.id + '">' + esc(p.title) + '</label></div>'; }).join('') : '<p>No products yet.</p>') + '</div></fieldset>' +
          '<fieldset class="field"><legend>Where it applies</legend><p class="hint">Leave all unticked for the whole of Zambia, or tick provinces to run it only there. Buyers see it once their location is in one of them.</p><div class="checks">' +
            PROVINCES.map(function (pv) { return '<div class="check"><input type="checkbox" id="pn-a-' + pv[0] + '" value="' + pv[0] + '"><label for="pn-a-' + pv[0] + '">' + esc(pv[1]) + '</label></div>'; }).join('') + '</div></fieldset>' +
          '<div class="field"><label for="pn-img">Banner image (optional)</label><input id="pn-img" type="file" accept="image/jpeg,image/png,image/webp" aria-describedby="pn-img-hint">' +
          '<p class="hint" id="pn-img-hint">Shown in the homepage banner and on your promotion while it\'s live. Best size 1600 × 500 pixels; we crop and resize it for you. Keep important words in the middle.</p></div>' +
          '<p class="form-status" role="status" tabindex="-1"></p><button class="btn btn--primary" type="submit">Publish promotion</button></form></div>' +
        '<div class="duo duo--gap">' +
        '<section class="card" id="sc-deals" aria-labelledby="sc-d-title"><h2 id="sc-d-title">Your deals</h2><p class="pmeta">A deal lowers the price of one product, for example a price drop, clearance or bundle. Deals appear in Today\'s deals under their category.</p>' +
          (myDeals.length ? '<ul class="orders">' + myDeals.map(function (dl) {
            var dp = product(dl.product);
            return '<li class="order-row"><span><strong>' + esc(dp ? dp.title : dl.product) + '</strong><br><span class="pmeta">' + esc(DEAL_REASONS[dl.reason] || 'Deal') + ' · ' + kwacha(dl.price) + (dp ? ' (was ' + kwacha(dp.priceZMW) + ')' : '') + (dl.ends ? ' · until ' + niceDate(dl.ends) : ' · no end date') + '</span></span>' +
              '<span><span class="' + statusClass(dl.ends && dl.ends < today ? 'ended' : 'live') + '">' + (dl.ends && dl.ends < today ? 'ended' : 'live') + '</span> <button class="link-btn link-btn--danger" type="button" data-del-deal="' + esc(dl.id) + '">Delete<span class="visually-hidden"> deal on ' + esc(dp ? dp.title : '') + '</span></button></span></li>';
          }).join('') + '</ul>' : '<p>No deals yet.</p>') + '</section>' +
        '<form class="form form--card" id="sc-deal" aria-labelledby="sc-dn-title"><h2 id="sc-dn-title">Make a product a deal</h2>' +
          '<p class="notice">Prototype: deals you create appear across the store in this browser only.</p>' +
          (mine.length ? '<div class="field"><label for="dl-product">Product</label><select id="dl-product">' + mine.map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(p.title) + ' (' + kwacha(p.priceZMW) + ')</option>'; }).join('') + '</select></div>' +
          '<div class="field-row"><div class="field"><label for="dl-price">Deal price (K)</label><input id="dl-price" type="number" min="1" step="1" required inputmode="numeric" aria-describedby="dl-price-hint"><p class="hint" id="dl-price-hint">Must be lower than the normal price.</p></div>' +
          '<div class="field"><label for="dl-reason">Reason</label><select id="dl-reason">' + Object.keys(DEAL_REASONS).map(function (k) { return '<option value="' + k + '">' + DEAL_REASONS[k] + '</option>'; }).join('') + '</select></div></div>' +
          '<div class="field"><label for="dl-ends">Ends (optional)</label><input id="dl-ends" type="date" min="' + today + '"></div>' +
          '<p class="form-status" role="status" tabindex="-1"></p><button class="btn btn--primary" type="submit">Publish deal</button>' : '<p>Add products to your store first.</p>') + '</form></div>' +
        (COURIERS.length ? '<div class="duo duo--gap">' +
          '<form class="form form--card" id="sc-couriers" aria-labelledby="sc-c-title"><h2 id="sc-c-title">Couriers you use</h2>' +
            '<p class="pmeta">Buyers see these on your products as "Ships with". Tick two or more per route, so you have a backup. All ' + COURIERS.filter(function (c) { return !c.unlicensed; }).length + ' ZICTA-licensed operators are listed; local licences cover one district only.</p>' +
            '<div class="field"><label for="scc-q">Find a courier (' + COURIERS.length + ')</label><input id="scc-q" type="search" autocomplete="off" placeholder="Name or licence number"></div>' +
            '<fieldset class="field"><legend class="visually-hidden">Couriers</legend><div class="checks checks--scroll" id="scc-list">' +
            myCouriers.map(courier).concat(rankedCouriers('').filter(function (c) { return myCouriers.indexOf(c.id) === -1; })).map(function (c) {
              return '<div class="check" data-text="' + esc((c.name + ' ' + c.legal + ' ' + c.licence).toLowerCase()) + '"><input type="checkbox" id="scc-' + c.id + '" value="' + c.id + '"' + (myCouriers.indexOf(c.id) !== -1 ? ' checked' : '') + '><label for="scc-' + c.id + '">' + esc(c.name) +
                ' <small class="pmeta">' + (c.unlicensed ? 'Licence not confirmed' : esc(LICENCES[c.type].label)) + '</small></label></div>';
            }).join('') + '</div></fieldset>' +
            '<p class="hint">Prototype: saved in this browser only.</p><button class="btn btn--primary" type="submit">Save couriers</button></form>' +
          '<section class="card" aria-labelledby="sc-t-title"><h2 id="sc-t-title">Before you send a parcel</h2>' +
            ticks(['Confirm the delivery fee and who pays it with the buyer before you dispatch.', 'Pack in a strong box with padding, wrap against rain, and label it with the order number.', 'Photograph the item and the sealed parcel, and keep the courier\'s waybill or tracking number.', 'Send the tracking number to the buyer, and ask the courier for proof of delivery.', 'Insure valuable items and declare their true value.', 'Check the courier\'s rules for batteries, liquids and chemicals. Power banks and other lithium batteries have special rules for air freight.']) +
            '<p><a href="help.html#shipping-tips">All shipping tips and courier details</a></p></section></div>' : '') +
        '<p class="view-foot"><button class="link-btn" type="button" id="seller-out">Sign out of Seller Centre</button></p>', 'Seller Centre');
      $('#sc-new').addEventListener('submit', function (e) {
        e.preventDefault();
        var st = $('.form-status', e.target), start = $('#pn-start').value, end = $('#pn-end').value;
        var picked = $$('#sc-new input[id^="pn-p-"]:checked').map(function (c) { return c.value; });
        var areas = $$('#sc-new input[id^="pn-a-"]:checked').map(function (c) { return c.value; });
        var fail = function (m) { st.className = 'form-status is-error'; st.textContent = m; st.focus(); };
        if (end < start) return fail('The end date must be on or after the start date.');
        if (!picked.length) return fail('Choose at least one product.');
        var btn = $('button[type="submit"]', e.target);
        btn.disabled = true; btn.textContent = 'Publishing…';
        bannerFromFile($('#pn-img').files[0], 1600, 500, function (image) {
          btn.disabled = false; btn.textContent = 'Publish promotion';
          if (image === null) return fail('That image couldn\'t be used. Choose a JPEG, PNG or WebP under 10 MB.');
          var promo = { id: newRef('U'), demo: true, seller: s.id, title: $('#pn-title').value.trim(), season: $('#pn-season').value, discount: Math.min(90, Math.max(5, parseInt($('#pn-off').value, 10) || 10)), starts: start, ends: end, products: picked, image: image };
          if (areas.length) promo.areas = areas;
          var list = store.get('promos', []).concat([promo]);
          var note = '';
          if (!trySave('promos', list)) {
            // Browser storage is full: keep the promotion without its picture
            promo.image = '';
            store.set('promos', list);
            note = ' (without the image: this browser\'s storage is full)';
          }
          toast('Promotion published' + note + ' <a href="#/promotions">View</a>', 'success');
          route();
        });
      });
      var locSeller = $('#sc-location');
      if (locSeller) {
        $('#sl-town', locSeller).addEventListener('input', function () { var t = townInfo(this.value); if (t) $('#sl-province', locSeller).value = t.province; });
        $('#sl-collect', locSeller).addEventListener('change', function () { $('#sl-collect-fields', locSeller).hidden = !this.checked; });
        $$('input[name="sl-areas"]', locSeller).forEach(function (r) { r.addEventListener('change', function () { $('#sl-provs', locSeller).hidden = r.value === 'all' && r.checked; }); });
        var slGps = $('#sl-gps', locSeller);
        if (slGps) slGps.addEventListener('click', function () {
          var stat = $('#sl-gps-status', locSeller);
          stat.textContent = 'Finding your nearest town…';
          // The seller's own location: fills the form only; it doesn't change their buyer location
          locateMe(function (r) {
            if (r.error) { stat.textContent = r.error; return; }
            $('#sl-town', locSeller).value = r.town; $('#sl-province', locSeller).value = r.province;
            stat.textContent = 'Found: ' + r.town + '. Add your area, then save.';
          });
        });
        locSeller.addEventListener('submit', function (e) {
          e.preventDefault();
          var st = $('.form-status', locSeller), town = cleanText($('#sl-town', locSeller).value, 60);
          var fail = function (m, el) { st.className = 'form-status is-error'; st.textContent = m; (el || st).focus(); };
          if (!town) return fail('Enter the town where your stock is.', $('#sl-town', locSeller));
          var some = $('#sl-areas-some', locSeller).checked, provs = $$('#sl-provs input:checked', locSeller).map(function (c) { return c.value; });
          if (some && !provs.length) return fail('Tick at least one province, or choose All of Zambia.');
          var collect = $('#sl-collect', locSeller).checked;
          if (collect && !cleanText($('#sl-caddr', locSeller).value, 120)) return fail('Add the collection address, so buyers know where to come.', $('#sl-caddr', locSeller));
          var all = store.get('seller-locations', {});
          all[s.id] = { town: town, area: cleanText($('#sl-area', locSeller).value, 60), province: $('#sl-province', locSeller).value,
            collection: { enabled: collect, address: cleanText($('#sl-caddr', locSeller).value, 120), hours: cleanText($('#sl-chours', locSeller).value, 60) },
            sameDay: !!($('#sl-sameday', locSeller) && $('#sl-sameday', locSeller).checked), deliversTo: some ? provs : 'all' };
          store.set('seller-locations', all);
          toast('Store location saved', 'success');
          route();
        });
      }
      var courierForm = $('#sc-couriers');
      if (courierForm) $('#scc-q', courierForm).addEventListener('input', function (e) {
        var t = e.target.value.trim().toLowerCase();
        $$('#scc-list .check', courierForm).forEach(function (row) { row.hidden = !!t && !$('input', row).checked && row.getAttribute('data-text').indexOf(t) === -1; });
      });
      if (courierForm) courierForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var all = store.get('seller-couriers', {});
        all[s.id] = $$('input:checked', courierForm).map(function (c) { return c.value; });
        store.set('seller-couriers', all);
        toast('Couriers saved', 'success');
      });
      var dealForm = $('#sc-deal');
      if (dealForm && $('#dl-product')) dealForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var st = $('.form-status', dealForm), dp = product($('#dl-product').value), price = Math.round(Number($('#dl-price').value));
        var fail = function (m) { st.className = 'form-status is-error'; st.textContent = m; st.focus(); };
        if (!dp) return fail('Choose a product.');
        if (!(price > 0) || price >= dp.priceZMW) return fail('The deal price must be lower than the normal price of ' + kwacha(dp.priceZMW) + '.');
        var list = store.get('deals', []).filter(function (x) { return !(x.seller === s.id && x.product === dp.id); });
        list.push({ id: newRef('D'), demo: true, seller: s.id, product: dp.id, price: price, reason: $('#dl-reason').value, starts: today, ends: $('#dl-ends').value || '' });
        store.set('deals', list);
        toast('Deal published <a href="#/deals?cat=' + dp.category + '">View</a>', 'success');
        route();
      });
      view.onclick = function (e) {
        var j = e.target.closest('[data-jump]');
        if (j) { e.preventDefault(); $('#' + j.getAttribute('data-jump')).scrollIntoView(); }
        var del = e.target.closest('[data-del-promo]');
        if (del) { store.set('promos', store.get('promos', []).filter(function (x) { return x.id !== del.getAttribute('data-del-promo'); })); route(); }
        var delDeal = e.target.closest('[data-del-deal]');
        if (delDeal) { store.set('deals', store.get('deals', []).filter(function (x) { return x.id !== delDeal.getAttribute('data-del-deal'); })); route(); }
        if (e.target.closest('#seller-out')) { store.set('seller', null); route(); }
      };
    },

    /* Seller Centre: add a product (#/listing/new) or edit one (#/listing/<id>).
       The department's template in catalogue.js (attributeTemplates) decides which extra
       fields show. A field the template leaves out still shows if the product already uses it,
       so switching department never hides data. Everything is kept in `dr` (the draft); each
       redraw reads the form into it first, so nothing typed is lost. */
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
      sp.src = versioned('js/stock-planner.js');
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
          (promos.length ? '<h2>Promotions</h2><ul class="promos promos--gap">' + promos.map(promoCard).join('') + '</ul>' : '') +
          (complaintsOn() ? '<p class="pmeta"><a href="#/complaint?seller=' + encodeURIComponent(s.id) + '">Report a problem with this seller</a></p>' : '') });
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
      // "Proceed to checkout" scrolls to the checkout steps without changing the page address
      var jump = e.target.closest('[data-jump]');
      if (jump) { e.preventDefault(); var to = $('#' + jump.getAttribute('data-jump')); if (to) { to.scrollIntoView(); to.focus({ preventScroll: true }); } return; }
      var rm = e.target.closest('[data-remove]'), sv = e.target.closest('[data-save]'), ad = e.target.closest('[data-add]');
      if (rm || sv) {
        var key = (rm || sv).getAttribute(rm ? 'data-remove' : 'data-save'), id = key.split('|')[0];
        setCart(cart().filter(function (l) { return lineKey(l) !== key; }));
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
    clearProductZoom();
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
    if (ext('route', path, q)) return;
    (views[path[0]] || EXT.views[path[0]] || views.notfound)(decodeURIComponent(path[1] || ''), q);
  }

  // Checkout lives in js/checkout.js. It gets the helpers it shares with the rest of the store here;
  // loc is a getter because saveLoc() replaces the location object.
  var checkoutKit = {
    $: $, $$: $$, CARD_WARNING: CARD_WARNING, COURIERS: COURIERS, D: D, DELIVERY: DELIVERY, OPTS: OPTS,
    PAY_ASK: PAY_ASK, PAY_KINDS: PAY_KINDS, SCOPES: SCOPES, VAT: VAT, W: W, ZD: ZD, ZP: ZP,
    addressLine: addressLine, addresses: addresses, addressesOn: addressesOn, arrivesText: arrivesText,
    bindSaved: bindSaved, byName: byName, cards: cards, cart: cart,
    checkoutNeedsDelivery: checkoutNeedsDelivery, cleanText: cleanText, closeDialog: closeDialog,
    coMode: coMode, collectionAt: collectionAt, courier: courier, crumbs: crumbs, dayLabel: dayLabel,
    deliveryDays: deliveryDays, empty: empty, esc: esc, ext: ext, feeText: feeText,
    fulfilLine: fulfilLine, hasCardNumber: hasCardNumber, head: head, kwacha: kwacha, lineKey: lineKey,
    lineQuote: lineQuote, locFull: locFull, locSummaryHTML: locSummaryHTML, media: media, newRef: newRef,
    noteBought: noteBought, openDialog: openDialog, openLocation: openLocation, orders: orders,
    parcelLine: parcelLine, payByName: payByName, payKind: payKind, payMethods: payMethods,
    perUnit: perUnit, product: product, provinceOf: provinceOf, qtyAttrs: qtyAttrs, qtyLabel: qtyLabel,
    qtyRange: qtyRange, quoteArrives: quoteArrives, rankedCouriers: rankedCouriers,
    sameDayFor: sameDayFor, saveLoc: saveLoc, savedBusiness: savedBusiness, secureMode: secureMode,
    seller: seller, sellerLoc: sellerLoc, sellerName: sellerName, setCart: setCart, setMode: setMode,
    show: show, slotLabel: slotLabel, speedName: speedName, stockHTML: stockHTML, store: store,
    toast: toast, today: today, townInfo: townInfo, tpinOK: tpinOK, user: user, variantOf: variantOf,
    vatFor: vatFor, vatRowHTML: vatRowHTML, verifiedHTML: verifiedHTML, view: view, waUrl: waUrl,
    weightText: weightText, wishedIn: wishedIn, zoneFor: zoneFor
  };
  Object.defineProperty(checkoutKit, 'loc', { get: function () { return loc; } });
  if (window.ZSModules && window.ZSModules.checkout) views.cart = window.ZSModules.checkout(checkoutKit).cart;

  // The seller listing form lives in js/listing-form.js, with the helpers it shares here.
  var listingKit = {
    $: $, $$: $$, BASE_PRODUCTS: BASE_PRODUCTS, D: D, ZP: ZP, bannerFromFile: bannerFromFile,
    brand: brand, byId: byId, crumbs: crumbs, dept: dept, esc: esc, head: head, listing: listing,
    listingsApi: listingsApi, loadProducts: loadProducts, perUnit: perUnit, product: product,
    route: route, seller: seller, show: show, store: store, toast: toast, views: views
  };
  if (window.ZSModules && window.ZSModules.listing) views.listing = window.ZSModules.listing(listingKit).listing;

  // What extensions may use. Read-only views of the store, plus the shared page helpers.
  window.ZS = {
    D: D, S: S, ZP: ZP, store: store, today: today,
    products: function () { return products; }, product: product, seller: seller, dept: dept, user: user, orders: orders,
    cart: cart, addToCart: addToCart, complaints: complaints, listings: listingsApi, loc: function () { return loc; },
    esc: esc, kwacha: kwacha, niceDate: niceDate, waUrl: waUrl, handoverHTML: handoverHTML, toast: toast, show: show, crumbs: crumbs, head: head, empty: empty,
    cards: cards, ratingOf: ratingOf, priceOf: priceOf, coMode: function () { return coMode(); }, provinceOf: provinceOf,
    route: route, $: $, $$: $$, newRef: newRef, statusClass: statusClass, payByName: payByName, cleanText: cleanText, backendActive: secureMode,
    businessFormHTML: businessFormHTML, bindBusinessForm: bindBusinessForm, qtyLabel: qtyLabel,
    ingest: function (rows) {
      rows.forEach(function (row) {
        var p = window.ZSBackend.mapProduct(row), index = BASE_PRODUCTS.findIndex(function (x) { return x.id === p.id; });
        if (index === -1) BASE_PRODUCTS.push(p); else BASE_PRODUCTS[index] = p;
        if (row.seller) { var s = { id: row.seller.id, name: row.seller.name, city: row.seller.city, verified: row.seller.verified, about: row.seller.about || '', colours: ['#0A2A66', '#0057AE'] }; var si = D.sellers.findIndex(function (x) { return x.id === s.id; }); if (si === -1) D.sellers.push(s); else D.sellers[si] = s; }
      }); loadProducts();
    },
    clearCheckout: function () { setCart([]); store.set('voucher', ''); store.set('voucher-server', null); store.set('voucher-why', ''); }, refreshCounts: updateCounts,
    receiptHTML: receiptHTML, receiptText: receiptText, arrivesText: arrivesText, receiptDoc: receiptDoc, downloadReceiptPdf: downloadReceiptPdf,
    rememberReceipt: function (m) { receiptModels[m.ref] = m; }, wishedIn: wishedIn, rememberWished: rememberWished,
    wishPromptHTML: function (ref) { return wishPromptHTML(ref, store.get('wish-pending', {})[ref] || []); }, applyDeliverySettings: applyDeliverySettings, deliverySettingsNow: deliverySettingsNow,
    deliveryEditorHTML: deliveryEditorHTML, bindDeliveryEditor: bindDeliveryEditor, riderFormHTML: riderFormHTML, readRiderForm: readRiderForm,
    riderChecksHTML: riderChecksHTML, riderStatusHTML: riderStatusHTML, ridersOpen: ridersOpen, RIDER_STATUS: RIDER_STATUS, VEHICLES: VEHICLES, AVAIL: AVAIL, waTo: waTo, speedName: speedName, feeText: feeText, courier: courier, trackUrl: trackUrl, TRACK: TRACK
  };

  // Support index.html?q=term (from other pages and search engines)
  var params = new URLSearchParams(location.search);
  if (params.has('q') && location.hash.indexOf('#/') !== 0) {
    var target = '#/search?q=' + encodeURIComponent(params.get('q') || '') + (params.get('dept') ? '&dept=' + encodeURIComponent(params.get('dept')) : '');
    try { history.replaceState(null, '', location.pathname + target); } catch (e) { location.hash = target; }
  }
  window.addEventListener('hashchange', route);
  route();
  if (secureMode() && !BASE_PRODUCTS.length && location.hash.indexOf('#/') !== 0) {
    window.ZSBackend.rpc('catalogue_page', { page_size: 24 }).then(function (rows) { window.ZS.ingest(rows); if (!home.hidden) renderHome(); }).catch(function () { toast('Live listings could not be refreshed. Please reconnect and try Search.'); });
  }
  }
})();
