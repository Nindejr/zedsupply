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
    // Sample sales are [this month, last month], so the demo's trending and top picks never go stale
    var mk = function (d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2); }, n0 = new Date();
    D.products.forEach(function (p) {
      if (!p.demoSales) return;
      p.sales = {};
      p.sales[mk(n0)] = p.demoSales[0];
      p.sales[mk(new Date(n0.getFullYear(), n0.getMonth() - 1, 1))] = p.demoSales[1];
    });
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
  // Whole Kwacha show as K490; amounts with ngwee always show two places, K492.80
  function kwacha(n) {
    var v = Math.round((Number(n) + Number.EPSILON) * 100) / 100, cents = v % 1 !== 0;
    return 'K' + v.toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: 2 });
  }
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
    var saved = listingsApi.list().filter(function (p) { return seller(p.seller); }), byIdSaved = {};
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
  function reviewsFor(p) { return (p.reviews || []).concat((store.get('reviews', {})[p.id]) || []); }
  // { avg, count, dist } where dist[n] counts the n-star reviews; null when there are none
  function ratingOf(p) {
    var r = ZP.ratingSummary(reviewsFor(p));
    return r.count ? r : null;
  }
  function searchText(p) {
    var b = brand(p.brand), s = seller(p.seller);
    return [p.title, p.tags, dept(p.category).name, b ? b.name : '', s ? s.name : '', ZP.attrText(p)].join(' ').toLowerCase();
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
  function multiSellerGroups(cat) {
    var seen = {}, out = [];
    localProducts.forEach(function (p) {
      if (!p.match || seen[p.match] || (cat && p.category !== cat)) return;
      var all = [p].concat(sameItem(p));
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
  function setCart(c) { store.set('cart', c); updateCounts(); }
  function wish() { return store.get('wish', []); }
  function isLiked(id) { return wish().indexOf(id) !== -1; }
  function user() { return store.get('user', null); }
  // opt (optional): { colour, size, addons: [inBox index], commit: offer per item }.
  // The same product with different options is a separate line.
  function lineKey(l) { return l.id + (l.opt ? '|' + JSON.stringify(l.opt) : ''); }
  function addToCart(id, qty, opt) {
    var p = product(id), v = p ? variantOf(p, opt) : null;
    if (!p || !Number.isInteger(qty) || qty < 1 || qty > 99) { toast('Choose a whole quantity from 1 to 99.'); return false; }
    if (ZP.hasOptions(p)) {
      var already = cart().filter(function (l) { var cv = l.id === id ? variantOf(p, l.opt) : null; return cv && v && cv.sku === v.sku; })
        .reduce(function (sum, l) { return sum + l.qty; }, 0);
      if (!v || qty + already > v.stock) { toast('That variation does not have enough stock for your cart.'); return false; }
    }
    var c = cart(), line = null, key = lineKey({ id: id, opt: opt });
    for (var i = 0; i < c.length; i++) if (lineKey(c[i]) === key) line = c[i];
    if (line) line.qty = Math.min(99, line.qty + qty); else c.push(opt ? { id: id, qty: qty, opt: opt } : { id: id, qty: qty });
    setCart(c);
    return true;
  }
  // Price of one item on a cart line: the variant's own price, add-ons and any commit offer
  function variantOf(p, opt) { return opt && ZP.hasOptions(p) ? ZP.findVariant(p, opt) : null; }
  function basePriceOf(p, v) {
    if (!v || !v.priceZMW) return priceOf(p);
    var q = {}; for (var k in p) q[k] = p[k];
    q.priceZMW = v.priceZMW; q.wasZMW = 0;
    return priceOf(q);
  }
  function lineQuote(p, opt) { var v = variantOf(p, opt), pr = basePriceOf(p, v); return { pr: pr, q: ZP.quote(p, pr.now, opt), v: v }; }
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
      if (c) { c.id = p.id; c.name = p.name || c.name; c.url = p.url || ''; c.about = p.about || ''; c.note = p.note || ''; c.profile = true; }
      else out.push({ id: p.id, licence: '', name: p.name, legal: '', type: '', scope: p.scope || ['town'], url: p.url || '', about: p.about || '', note: p.note || '', profile: true, unlicensed: true });
    });
    return out;
  })();
  var shipScope = 'town', shipChoice = '';   // this cart's choice; kept in memory only
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
  // Checkout: the six top-ranked couriers for the route, and every other one in a list
  function shipChoiceHTML() {
    if (!COURIERS.length) return '';
    var list = rankedCouriers(shipScope), top = list.slice(0, 6), rest = list.slice(6).sort(byName);
    if (shipChoice && list.every(function (c) { return c.id !== shipChoice; })) shipChoice = '';
    var opt = function (value, label, sub) {
      var id = 'co-ship-' + (value || 'zs');
      return '<div class="pay-option"><input type="radio" name="co-ship" id="' + id + '" value="' + esc(value) + '"' + (shipChoice === value ? ' checked' : '') + '><label for="' + id + '">' + esc(label) + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</label></div>';
    };
    return '<fieldset class="field pay-choice" id="ship-choice"><legend>Delivery</legend>' +
      '<div class="ship-scope" role="radiogroup" aria-label="Where is it going?">' + Object.keys(SCOPES).map(function (s) {
        return '<label class="chip ship-scope__opt"><input type="radio" name="co-scope" value="' + s + '"' + (s === shipScope ? ' checked' : '') + '> ' + esc(SCOPES[s]) + '</label>';
      }).join('') + '</div>' +
      opt('', 'Zed Supply arranges it', 'We confirm the courier and fee on WhatsApp') +
      top.map(function (c) { return opt(c.id, c.name, c.unlicensed ? 'Licence not confirmed' : ''); }).join('') +
      (rest.length ? '<div class="field"><label for="co-ship-more">Or choose another courier (' + rest.length + ')</label><select id="co-ship-more"><option value="">Choose a courier…</option>' +
        rest.map(function (c) { return '<option value="' + esc(c.id) + '"' + (shipChoice === c.id ? ' selected' : '') + '>' + esc(c.name) + (c.unlicensed ? ' (licence not confirmed)' : c.type === 'L' ? ' (local)' : '') + '</option>'; }).join('') + '</select></div>' : '') +
      '<p class="hint"><a href="help.html#couriers" target="_blank" rel="noopener noreferrer">Compare couriers<span class="visually-hidden"> (opens in a new tab)</span></a>. You pay the delivery fee we confirm on WhatsApp.</p></fieldset>';
  }
  function shipSummary() {
    var c = courier(shipChoice);
    return SCOPES[shipScope] + ': ' + (c ? c.name + (c.licence ? ' (' + c.licence + ')' : ' (licence not confirmed)') : 'Zed Supply arranges the courier');
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
    if (p.stock === 'low') return '<p class="pstock pstock--low">Only a few left</p>';
    if (p.stock === 'request') return '<p class="pstock pstock--low">Sourced on request</p>';
    return '<p class="pstock">In stock</p>';
  }
  function likeBtn(p) {
    return '<button class="like" type="button" data-like="' + esc(p.id) + '" aria-pressed="' + isLiked(p.id) + '" aria-label="Save ' + esc(p.title) + ' to wishlist">' + icon(I.heart) + '</button>';
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
        (pr.deal ? '<span class="badge badge--deal">' + esc(DEAL_REASONS[pr.deal.reason] || 'Deal') + '</span>' : '') + (pr.promo ? '<span class="badge">Promotion</span>' : '') + (p.sample ? '<span class="tag-sample">Sample</span>' : '') + '</div>' +
      likeBtn(p) +
      '<a class="pmedia" href="' + R + 'product/' + esc(p.id) + '" tabindex="-1" aria-hidden="true">' + media(p) + '</a>' +
      '<div class="pbody">' +
        '<a class="ptitle" href="' + R + 'product/' + esc(p.id) + '">' + esc(p.title) + '</a>' +
        '<p class="pmeta">' + (s ? 'Sold by ' + esc(s.name) : (p.source === 'china' ? 'Shop the World' : esc(dept(p.category).name))) + '</p>' +
        (otherSellers ? '<p class="pmeta"><a href="' + R + 'compare?ids=' + [p.id].concat(others.map(function (x) { return x.id; })).map(encodeURIComponent).join(',') + '">Compare ' + (otherSellers + 1) + ' sellers</a></p>' : '') +
        ((p.attributes || {}).condition ? '<p class="pmeta">Condition: ' + esc(ZP.conditionLabel(p)) + '</p>' : '') + starsHTML(p) + (ZP.hasOptions(p) ? '<span class="pmeta">From</span>' : '') + priceHTML(pr) + (p.commit && ZP.commitRange(p, pr.now) ? '<p class="pmeta pcommit">Or name your price from ' + kwacha(ZP.commitRange(p, pr.now).min) + '</p>' : '') + stockHTML(p) +
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
    var category = entity.category || symbols[entity.id];
    if (!byId(D.departments, category)) category = '';
    if (entity.logo) return '<img class="brand__logo" src="' + esc(entity.logo) + '" data-fallback="assets/icons/marketplace.svg" alt="" width="96" height="96" loading="lazy" decoding="async">';
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
      if (!addToCart(id, qtyEl ? Math.max(1, parseInt(qtyEl.value, 10) || 1) : 1)) return;
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
    var sets = { christmas: ['baby', 'home', 'tech'], valentines: ['fashion', 'home', 'health'], easter: ['home', 'essentials', 'baby'], farmers: ['agri', 'hardware', 'solar'], blackfriday: ['tech', 'home', 'fashion'], school: ['office', 'baby', 'tech'] };
    return '<span class="season-art">' + (sets[id] || ['essentials', 'home', 'tech']).map(function (category) {
      var path = root.classList.contains('data-saver') ? 'assets/icons/' + category + '.svg' : 'assets/categories-3d/' + category + '.webp';
      return '<img src="' + path + '" data-fallback="assets/icons/' + category + '.svg" alt="" width="160" height="160" loading="lazy" decoding="async">';
    }).join('') + '</span>';
  }
  // Short category names for banner links, matching the Shop by category grid
  var DEPT_SHORT = { tech: 'Phones & Tech', solar: 'Solar & Power', fashion: 'Fashion & Beauty', home: 'Home & Kitchen', business: 'Business Equipment', office: 'Office & School',
    agri: 'Agriculture', auto: 'Auto', hardware: 'Tools & Hardware', baby: 'Baby & Kids', health: 'Health & Fitness', essentials: 'Everyday Essentials' };
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
        return byId(D.departments, id) ? '<li><a href="' + R + 'dept/' + esc(id) + '">' + esc(DEPT_SHORT[id] || dept(id).name) + '</a></li>' : '';
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
      row('', function (p) { return (ZP.hasOptions(p) ? '<a class="btn btn--primary btn--sm" href="' + R + 'product/' + esc(p.id) + '">Choose options<span class="visually-hidden">: ' + esc(p.title) + '</span></a>' : '<button class="btn btn--primary btn--sm" type="button" data-add="' + esc(p.id) + '">Add to cart<span class="visually-hidden">: ' + esc(p.title) + '</span></button>') + (removable ? ' <button class="link-btn" type="button" data-compare-remove="' + esc(p.id) + '">Remove<span class="visually-hidden"> ' + esc(p.title) + '</span></button>' : ''); }) +
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
  function specsHTML(p) {
    var a = p.attributes || {}, rows = [];
    if (a.manufacturer) rows.push(['Manufacturer', esc(a.manufacturer)]);
    if (a.condition) rows.push(['Condition', esc(ZP.conditionLabel(p))]);
    if (a.size) rows.push([ZP.UNITS[a.size.unit] && ZP.UNITS[a.size.unit].dim === 'volume' ? 'Volume' : ZP.UNITS[a.size.unit] && ZP.UNITS[a.size.unit].dim === 'mass' ? 'Weight' : 'Size', esc(ZP.sizeLabel(a.size))]);
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
        (v.verified ? ' <span class="verified-buy">' + icon(I.check) + 'Verified purchase</span>' : '') + (v.mine ? ' <span class="tag-mine">Your review</span>' : '') + (v.title ? '<h3 class="review__title">' + esc(v.title) + '</h3>' : '') + '<p>' + esc(v.text) + '</p></div>';
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
      '<label for="lst-sort" class="visually-hidden">Sort by</label><select id="lst-sort"><option value="">Sort: Relevance</option><option value="asc">Price: low to high</option><option value="desc">Price: high to low</option><option value="rating">Top rated</option></select></div></div>' +
      '<details class="listing-filters"' + (window.matchMedia && matchMedia('(min-width: 900px)').matches ? ' open' : '') + '><summary>Refine products</summary><div class="listing-filters__grid">' +
      facetSelect('lst-colour', 'Colour', values(colourSet)) + facetSelect('lst-age', 'Age', ZP.AGES.filter(function (a) { return ageSet[a[0]]; })) +
      facetSelect('lst-size', 'Size / capacity', values(sizeSet)) + facetSelect('lst-brand', 'Brand store', values(brandSet)) +
      facetSelect('lst-maker', 'Manufacturer / brand name', values(makerSet)) +
      facetSelect('lst-condition', 'Condition', ZP.CONDITIONS.filter(function (c) { return conditionSet[c[0]]; })) +
      '<div class="field"><label for="lst-min">Minimum price (K)</label><input id="lst-min" type="number" min="0" step="0.01" inputmode="decimal"></div>' +
      '<div class="field"><label for="lst-max">Maximum price (K)</label><input id="lst-max" type="number" min="0" step="0.01" inputmode="decimal"></div>' +
      '<div class="field"><label for="lst-stars">Customer rating</label><select id="lst-stars"><option value="">All ratings</option><option value="4">4 stars and up</option><option value="3">3 stars and up</option><option value="5">5 stars</option></select></div>' +
      (opts.list.some(function (p) { return p.commit; }) ? '<label class="inline-check"><input id="lst-offers" type="checkbox"> Accepts buyer offers</label>' : '') + '</div>' +
      (measureUnits.length ? '<fieldset class="measurement-filter"><legend>Measured size / volume / weight</legend><p class="hint">Equivalent units are compared together, such as 1 litre and 1,000 ml.</p><div class="listing-filters__grid"><div class="field"><label for="lst-unit">Unit</label><select id="lst-unit"><option value="">Any measurement</option>' + measureUnits.map(function (u) { return '<option value="' + u + '">' + esc(ZP.UNITS[u].name) + '</option>'; }).join('') + '</select></div><div class="field"><label for="lst-measure-min">Minimum</label><input id="lst-measure-min" type="number" min="0" step="any" inputmode="decimal" disabled></div><div class="field"><label for="lst-measure-max">Maximum</label><input id="lst-measure-max" type="number" min="0" step="any" inputmode="decimal" disabled></div></div></fieldset>' : '') +
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
        if (value('lst-brand') && p.brand !== value('lst-brand')) return false;
        if (maker && String(a.manufacturer||'').toLowerCase()!==maker) return false;
        if (value('lst-condition') && a.condition!==value('lst-condition')) return false;
        if (age && ZP.ages(p).indexOf(age)===-1) return false;
        if (stars && (ratingOf(p)||{avg:0}).avg<stars) return false;
        if (checked('lst-promo') && !onDeal(p)) return false;
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
    $$('.toolbar input, .toolbar select, .listing-filters input, .listing-filters select',view).forEach(function(el){el.addEventListener(el.type==='number'?'input':'change',draw);});
    $('#lst-clear').addEventListener('click',function(){$$('.toolbar input, .toolbar select, .listing-filters input, .listing-filters select',view).forEach(function(el){if(el.type==='checkbox')el.checked=false;else el.value='';});draw();});
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
      var groups = multiSellerGroups(id);
      listing({ title: esc(d.name), crumbs: [['Categories', '#/departments'], [d.name]], list: products.filter(function (p) { return p.category === id; }), docTitle: d.name,
        extra: '<ul class="chips" aria-label="Other categories">' + D.departments.map(function (x) { return '<li><a class="chip" href="#/dept/' + x.id + '"' + (x.id === id ? ' aria-current="page"' : '') + '>' + x.icon + ' ' + esc(x.name) + '</a></li>'; }).join('') + '</ul>' +
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
      var stores = D.sellers.filter(function (s) { return matches(s.name); }), brands = D.brands.filter(function (b) { return matches(b.name); });
      var extra = (stores.length || brands.length) ? '<ul class="chips" aria-label="Matching stores and brands">' +
        stores.map(function (s) { return '<li><a class="chip" href="#/store/' + s.id + '">🏪 Store: ' + esc(s.name) + '</a></li>'; }).join('') +
        brands.map(function (b) { return '<li><a class="chip" href="#/brand/' + b.id + '">🏷️ Brand: ' + esc(b.name) + '</a></li>'; }).join('') + '</ul>' : '';
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
        (list.length && fromList ? '<p class="view-foot"><button class="link-btn" type="button" id="cmp-clear">Clear compare list</button></p>' : ''), 'Compare');
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
      var html = crumbs([[d.name, '#/dept/' + p.category], [p.title]]) +
        '<div class="pdp">' +
          '<div class="pdp__media"><div class="pflags">' + (pr.off ? '<span class="flag-sale">-' + pr.off + '%</span>' : '') + (p.sample ? '<span class="tag-sample">Sample</span>' : '') + '</div>' + likeBtn(p) + '<div class="pmedia">' + media(p) + '</div></div>' +
          '<div>' +
            '<h1>' + esc(p.title) + '</h1>' +
            '<p class="pmeta">' + (b ? 'Brand: <a href="#/brand/' + b.id + '">' + esc(b.name) + '</a> · ' : '') + (s ? 'Sold by <a href="#/store/' + s.id + '">' + esc(s.name) + '</a>' + verifiedHTML(s) : '') + '</p>' +
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
          '</div>' +
          '<aside class="buybox" aria-label="Buy this product">' +
            '<div data-price-box>' + priceHTML(pr) + '</div><p class="pmeta" id="pdp-total" aria-live="polite"></p><div data-stock>' + stockHTML(p, v0) + '</div>' +
            '<p>' + esc(p.source === 'china' ? p.shipping : S.deliveryText) + '</p>' +
            (sellerCouriers(s).length ? '<p class="pmeta">Ships with ' + sellerCouriers(s).map(function (id) { return esc(courier(id).name); }).join(', ') + '. <a href="help.html#couriers">About couriers</a></p>' : '') +
            '<p class="pmeta"><button class="link-btn" type="button" data-open-location aria-haspopup="dialog"><span data-location-label>Deliver to: set location</span></button></p>' +
            '<div><label for="pdp-qty" class="pmeta">Quantity</label><div class="qty"><button type="button" data-step="-1" data-target="#pdp-qty" aria-label="Decrease quantity">−</button><input id="pdp-qty" type="number" min="1" max="99" value="1" inputmode="numeric"><button type="button" data-step="1" data-target="#pdp-qty" aria-label="Increase quantity">+</button></div></div>' +
            commitHTML(range) +
            '<button class="btn btn--primary btn--block" type="button" id="pdp-add">Add to cart</button>' +
            '<a class="btn btn--secondary btn--block" id="buy-now" href="#" target="_blank" rel="noopener noreferrer">Buy now on WhatsApp</a>' +
            '<p class="pmeta">The final price and delivery are confirmed on WhatsApp before you pay.</p>' +
            '<button class="btn btn--secondary btn--block btn--sm" type="button" id="pdp-compare" aria-pressed="' + inCompare + '">' + (inCompare ? 'In your compare list' : 'Add to compare') + '</button>' +
            alsoSoldHTML(p) +
            (payMethods().length ? '<div class="buybox__pay"><p class="pmeta">Pay with mobile money</p>' + payChipsHTML() + '</div>' : '') +
          '</aside>' +
        '</div>' +
        (similar.length ? '<section class="section" aria-labelledby="cmp-title"><div class="section-head"><h2 id="cmp-title">Compare with similar items</h2>' +
          '<a href="#/compare?ids=' + [p.id].concat(similarIds).map(encodeURIComponent).join(',') + '">Open full comparison</a></div>' + compareTable([p].concat(similar), false) + '</section>' : '') +
        '<section class="reviews" id="reviews" aria-labelledby="rev-title"><div>' +
          '<h2 id="rev-title">Customer reviews</h2>' + (r ? '<div class="rsum"><p class="rsum__avg"><strong>' + r.avg.toFixed(1) + '</strong><span class="visually-hidden"> out of 5</span></p><div>' + starsHTML(p) + '<p class="reviews__avg">' + r.count + (r.count === 1 ? ' rating' : ' ratings') + '</p></div></div>' + ratingBars(revs) : '<p>No reviews yet. Be the first to rate it.</p>') +
          (u ? reviewForm(mine, bought)
            : '<p><a class="btn btn--secondary" href="#/account">Sign in to rate and review</a></p>') +
        '</div><div>' + (revs.length > 1 ? '<div class="field reviews__sort"><label for="rev-sort">Sort reviews</label><select id="rev-sort"><option value="new">Most recent</option><option value="high">Highest rated</option><option value="low">Lowest rated</option><option value="verified">Verified purchases first</option></select></div>' : '') +
          (revs.length ? '<div class="review-filters"><div class="field"><label for="rev-star">Star rating</label><select id="rev-star"><option value="">All ratings</option>' + [5,4,3,2,1].map(function (n) { return '<option value="' + n + '">' + n + (n === 1 ? ' star' : ' stars') + '</option>'; }).join('') + '</select></div><div class="field"><label for="rev-find">Search reviews</label><input id="rev-find" type="search" maxlength="80" placeholder="e.g. battery or delivery"></div>' +
            (revs.some(function (v) { return v.verified; }) ? '<label class="inline-check"><input id="rev-verified" type="checkbox"> Verified purchases only</label>' : '') + '</div><p id="rev-count" role="status" class="pmeta">' + revs.length + (revs.length === 1 ? ' review' : ' reviews') + '</p><div id="rev-list" class="rev-scroll" tabindex="0" role="region" aria-label="Reviews, ' + revs.length + ' in total">' + reviewList(revs, 'new') + '</div>' : '') + '</div></section>' +
        (related.length ? '<section class="section" aria-labelledby="rel-title"><h2 id="rel-title">More in ' + esc(d.name) + '</h2><ul class="row">' + cards(related) + '</ul></section>' : '');
      show(html, p.title);
      // Everything the buyer picks (options, add-ons, their own price) updates the prices,
      // stock, buttons and the WhatsApp message together.
      var qty = $('#pdp-qty'), buy = $('#buy-now'), add = $('#pdp-add'), commitBox = $('#commit-box');
      var cRange = $('#commit-range'), cAmt = $('#commit-amt'), cur = null;
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
        var o = pick(), n = Math.max(1, parseInt(qty.value, 10) || 1), lq = lineQuote(p, o), v = lq.v, q = lq.q;
        if (cRange) {
          $('#pm-commit').disabled = !q.range;
          $('label[for="pm-commit"]').textContent = q.range ? 'Name your price' : 'Offers unavailable for this selection';
          if (!q.range && o.commit != null) {
            $('#pm-fixed').checked = true; commitBox.hidden = true; delete o.commit;
            lq = lineQuote(p, o); q = lq.q;
          } else if (q.commit) { o.commit = q.commit; cAmt.value = cRange.value = q.commit; }
        }
        var axes = ZP.options(p), missing = axes.filter(function (x) { return !o[x.key]; });
        var out = (p.variants || []).length && axes.length && (!v || v.stock <= 0);
        var quantityOK = Number.isInteger(Number(qty.value)) && Number(qty.value) >= 1 && n <= 99 && (!v || n <= v.stock);
        cur = { opt: o, q: q, v: v, n: n, ok: !missing.length && !out && quantityOK };
        // Prices: the main column shows the item price, the buy box adds add-ons and the buyer's own price
        $('[data-price-main]').innerHTML = priceHTML(lq.pr);
        $('[data-price-box]').innerHTML = q.commit ? '<p class="price"><span class="price__now"><span class="visually-hidden">Your price </span>' + kwacha(q.each) + '</span><span class="price__was"><span class="visually-hidden">listed at </span>' + kwacha(lq.pr.now + q.addTotal) + '</span></p>' : priceHTML({ now: q.each, was: lq.pr.was ? lq.pr.was + q.addTotal : 0 });
        $('#pdp-total').textContent = (q.addTotal ? kwacha(q.unit) + ' + ' + kwacha(q.addTotal) + ' add-ons. ' : '') + (q.commit ? 'Your offer, pending the seller. ' : '') + (n > 1 || q.addTotal || q.commit ? 'Total for ' + n + ': ' + kwacha(q.each * n) : '');
        $('[data-stock]').innerHTML = stockHTML(p, v);
        var sku = $('[data-sku]'); if (sku) sku.textContent = v ? ' · SKU ' + v.sku : '';
        if (!root.classList.contains('data-saver')) {
          var imageBox = $('.pdp__media .pmedia'), img = $('.pdp__media .pmedia > img');
          var imagePath = (v && v.image) || p.image;
          if (imagePath) {
            if (!img) { img = document.createElement('img'); img.width = img.height = 600; img.decoding = 'async'; imageBox.appendChild(img); }
            img.alt = p.title + (v ? ' · ' + [v.colour, v.size].filter(Boolean).join(', ') : '');
            if (img.getAttribute('src') !== imagePath) { img.classList.remove('is-broken'); img.src = imagePath; }
          } else if (img) img.remove();
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
        add.textContent = out ? 'Sold out' : missing.length ? 'Choose ' + missing.map(function (x) { return x.name.toLowerCase(); }).join(' and ') : !quantityOK ? 'Choose a quantity from 1 to ' + (v ? Math.min(99, v.stock) : 99) : q.commit ? 'Add to cart at ' + kwacha(q.each) : 'Add to cart';
        buy.classList.toggle('is-disabled', !cur.ok);
        buy.setAttribute('aria-disabled', String(!cur.ok));
        var bits = ZP.describe(p, o), m = q.commit
          ? 'Hi Zed Supply, I\'d like to commit ' + kwacha(q.unit) + ' each for: ' + p.title + ' (ID ' + p.id + (v ? ', SKU ' + v.sku : '') + '). The seller\'s range is ' + kwacha(q.range.min) + ' to ' + kwacha(q.range.max) + '.'
          : 'Hi Zed Supply, I\'d like to buy: ' + p.title + ' (ID ' + p.id + (v ? ', SKU ' + v.sku : '') + '), price ' + kwacha(q.unit) + ' each.';
        if (bits) m += ' Options: ' + bits + '.';
        if (q.addTotal) m += ' With add-ons: ' + kwacha(q.each) + ' each.';
        m += ' Quantity: ' + n;
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
      add.addEventListener('click', function () {
        if (!cur.ok) return;
        var o = cur.opt, hasAny = Object.keys(o).length;
        if (!addToCart(p.id, cur.n, hasAny ? o : undefined)) return;
        toast('Added to cart: ' + esc(p.title) + (hasAny ? ' (' + esc(ZP.describe(p, o)) + ')' : '') + ' <a href="#/cart">View cart</a>');
      });
      buy.addEventListener('click', function (e) { if (!cur.ok) e.preventDefault(); });
      view.onclick = function (e) {
        var j = e.target.closest('[data-jump]');
        if (j) { e.preventDefault(); $('#' + j.getAttribute('data-jump')).scrollIntoView(); }
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
        if (!picked) { st.className = 'form-status is-error'; st.textContent = 'Choose a star rating from 1 to 5.'; st.focus(); return; }
        if (!$('#rev-text').value.trim()) { st.className = 'form-status is-error'; st.textContent = 'Write a few words about your experience.'; $('#rev-text').focus(); return; }
        var headline = cleanText($('#rev-head').value, 120);
        if (!headline) { st.className = 'form-status is-error'; st.textContent = 'Add a short headline for your review.'; $('#rev-head').focus(); return; }
        var all = store.get('reviews', {});
        all[p.id] = (all[p.id] || []).filter(function (v) { return !v.mine; });
        all[p.id].push({ name: u.name, rating: Number(picked.value), date: today, title: headline, text: $('#rev-text').value.trim(), mine: true, verified: false });
        store.set('reviews', all);
        toast(mine ? 'Your review has been updated' : 'Thanks for your review');
        route();
      });
      if (q && q.get('review') && rf) setTimeout(function () { $('#reviews').scrollIntoView(); var first = $('input[name="rev-rating"]', rf); if (first) first.focus({ preventScroll: true }); }, 50);
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
      lines.forEach(function (l) { var p = product(l.id), lq = lineQuote(p, l.opt), pr = lq.pr, qty = Math.min(99, Math.max(1, parseInt(l.qty, 10) || 1)); sub += lq.q.each * qty; if (pr.was && !lq.q.commit) save += (pr.was - pr.now) * qty; items.push({ p: p, pr: pr, qty: qty, each: lq.q.each, commit: lq.q.commit, key: lineKey(l), label: ZP.describe(p, l.opt), sku: lq.v ? lq.v.sku : "", opt: l.opt }); });
      var v = voucher ? (D.vouchers || []).filter(function (x) { return x.code === voucher; })[0] : null;
      var vOff = v && sub >= v.minSpend ? Math.round(sub * v.percent / 100) : 0;
      var total = sub - vOff;
      var html = crumbs([['Cart']]) + head('Your cart', items.length + (items.length === 1 ? ' product' : ' products')) +
        '<div class="cart"><div><ul class="lines">' + items.map(function (it, i) {
          var s = seller(it.p.seller);
          return '<li class="line"><a class="pmedia" href="#/product/' + it.p.id + '" tabindex="-1" aria-hidden="true">' + media(it.p) + '</a><div>' +
            '<a class="line__title" href="#/product/' + it.p.id + '">' + esc(it.p.title) + '</a>' +
            '<p class="pmeta">' + (s ? 'Sold by ' + esc(s.name) + ' ' : '') + (it.pr.promo && !it.commit ? '<span class="badge">' + esc(it.pr.promo.title) + '</span>' : '') + '</p>' +
            (it.label ? '<p class="pmeta line__opts">' + esc(it.label) + (it.commit ? ' <span class="badge">Pending seller</span>' : '') + '</p>' : '') +
            '<p class="line__price">' + kwacha(it.each * it.qty) + (it.qty > 1 ? ' <small class="pmeta">(' + kwacha(it.each) + ' each)</small>' : '') + '</p>' +
            '<div class="line__actions"><div class="qty"><button type="button" data-step="-1" data-target="#cq' + i + '" aria-label="Decrease quantity of ' + esc(it.p.title) + '">−</button>' +
            '<input id="cq' + i + '" type="number" min="1" max="99" value="' + it.qty + '" data-cart-qty="' + esc(it.key) + '" aria-label="Quantity of ' + esc(it.p.title) + '"><button type="button" data-step="1" data-target="#cq' + i + '" aria-label="Increase quantity of ' + esc(it.p.title) + '">+</button></div>' +
            '<button class="link-btn" type="button" data-remove="' + esc(it.key) + '">Remove<span class="visually-hidden"> ' + esc(it.p.title) + '</span></button><button class="link-btn" type="button" data-save="' + esc(it.key) + '">Save for later<span class="visually-hidden">: ' + esc(it.p.title) + '</span></button></div>' +
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
          '<div id="ship-wrap">' + shipChoiceHTML() + '</div>' +
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
          items.map(function (it, i) { return (i + 1) + '. ' + it.p.title + ' (' + it.p.id + (it.sku ? ', SKU ' + it.sku : '') + ')' + (it.label ? ' [' + it.label + ']' : '') + ' x ' + it.qty + ' = ' + kwacha(it.each * it.qty) + (it.commit ? ' (my offer, pending the seller)' : ''); }).join('\n') +
          (vOff ? '\nVoucher ' + v.code + ': -' + kwacha(vOff) : '') + '\nEstimated total: ' + kwacha(total);
        var nm = $('#co-name').value.trim(), note = $('#co-note').value.trim();
        if (nm) m += '\nName: ' + nm;
        if (note) m += '\nNotes: ' + note;
        if (COURIERS.length) m += '\nDelivery: ' + shipSummary();
        if (payChoice) m += '\nPayment: ' + payChoice;
        return m;
      };
      // data-wa-message lets refreshLoc() update the link when the delivery location changes
      var syncCo = function () { var m = buildMsg(); co.setAttribute('data-wa-message', m); co.href = waUrl(m); };
      ['co-name', 'co-note'].forEach(function (id) { $('#' + id).addEventListener('input', syncCo); });
      $$('input[name="co-pay"]', view).forEach(function (r) { r.addEventListener('change', function () { payChoice = r.value; syncCo(); }); });
      // Delivery: changing "where is it going?" redraws the courier list for that distance
      var shipWrap = $('#ship-wrap');
      if (shipWrap) shipWrap.addEventListener('change', function (e) {
        if (e.target.name === 'co-scope') {
          shipScope = e.target.value;
          shipWrap.innerHTML = shipChoiceHTML();
          var again = $('input[name="co-scope"][value="' + shipScope + '"]', shipWrap);
          if (again) again.focus();
        } else if (e.target.name === 'co-ship') {
          shipChoice = e.target.value;
          var more = $('#co-ship-more', shipWrap); if (more) more.value = '';
        } else if (e.target.id === 'co-ship-more') {
          shipChoice = e.target.value;
          $$('input[name="co-ship"]', shipWrap).forEach(function (r) { r.checked = !shipChoice && r.value === ''; });
        }
        syncCo();
      });
      syncCo();
      co.addEventListener('click', function (e) {
        var reserved = {}, unavailable = items.some(function (it) {
          if (!ZP.hasOptions(it.p)) return false;
          var current = variantOf(it.p, it.opt);
          if (!current) return true;
          var key = JSON.stringify([it.p.id, current.sku]);
          reserved[key] = (reserved[key] || 0) + it.qty;
          return reserved[key] > current.stock;
        });
        if (unavailable) { e.preventDefault(); toast('A variation is unavailable or its quantity exceeds stock. Update your cart before checkout.'); return; }
        if (hasCardNumber($('#co-name').value + ' ' + $('#co-note').value)) { e.preventDefault(); toast(esc(CARD_WARNING)); $('#co-note').focus(); return; }
        var list = orders();
        list.unshift({ ref: ref, date: today, items: items.map(function (it) { return it.opt ? { id: it.p.id, qty: it.qty, price: it.each, opt: it.opt, label: it.label } : { id: it.p.id, qty: it.qty, price: it.each }; }), total: total, status: 0, deliverTo: locFull(), pay: payChoice, ship: COURIERS.length ? shipSummary() : '', shipId: shipChoice });
        store.set('orders', list);
        setCart([]);
        store.set('voucher', '');
        setTimeout(function () { location.hash = '#/order/' + ref; }, 400);
      });
      $$('[data-cart-qty]', view).forEach(function (inp) {
        inp.addEventListener('change', function () {
          var c = cart();
          c.forEach(function (l) { if (lineKey(l) === inp.getAttribute('data-cart-qty')) l.qty = Math.min(99, Math.max(1, parseInt(inp.value, 10) || 1)); });
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
        '<aside class="summary"><h2>Items</h2><ul class="lines">' + o.items.map(function (it) { var p = product(it.id); return '<li class="line line--plain"><div><a class="line__title" href="#/product/' + it.id + '">' + esc(p ? p.title : it.id) + '</a><p class="pmeta">' + (it.label ? esc(it.label) + ' · ' : '') + 'Quantity ' + (parseInt(it.qty, 10) || 0) + ' · ' + kwacha(it.price * it.qty) + '</p>' +
          (p && !o.sample ? '<a class="link-btn" href="#/product/' + encodeURIComponent(it.id) + '?review=1">' + (((store.get('reviews', {})[it.id]) || []).some(function (v) { return v.mine; }) ? 'Edit your review' : 'Rate this item') + '<span class="visually-hidden">: ' + esc(p.title) + '</span></a>' : '') + '</div></li>'; }).join('') + '</ul>' +
        '<dl class="totals"><div class="is-total"><dt>Total</dt><dd>' + kwacha(o.total) + '</dd></div></dl>' +
        (o.ship ? '<div class="deliver-box"><p class="deliver-box__label">Delivery</p><p>' + esc(o.ship) + '</p></div>' : '') +
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
        '<div class="duo duo--gap">' +
        '<section class="card" id="sc-deals" aria-labelledby="sc-d-title"><h2 id="sc-d-title">Your deals</h2><p class="pmeta">A deal lowers the price of one product, for example a price drop, clearance or bundle. Deals appear in Today\'s deals under their category.</p>' +
          (myDeals.length ? '<ul class="orders">' + myDeals.map(function (dl) {
            var dp = product(dl.product);
            return '<li class="order-row"><span><strong>' + esc(dp ? dp.title : dl.product) + '</strong><br><span class="pmeta">' + esc(DEAL_REASONS[dl.reason] || 'Deal') + ' · ' + kwacha(dl.price) + (dp ? ' (was ' + kwacha(dp.priceZMW) + ')' : '') + (dl.ends ? ' · until ' + niceDate(dl.ends) : ' · no end date') + '</span></span>' +
              '<span><span class="status">' + (dl.ends && dl.ends < today ? 'ended' : 'live') + '</span> <button class="link-btn" type="button" data-del-deal="' + esc(dl.id) + '">Delete<span class="visually-hidden"> deal on ' + esc(dp ? dp.title : '') + '</span></button></span></li>';
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
        toast('Couriers saved');
      });
      var dealForm = $('#sc-deal');
      if (dealForm && $('#dl-product')) dealForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var st = $('.form-status', dealForm), dp = product($('#dl-product').value), price = Math.round(Number($('#dl-price').value));
        var fail = function (m) { st.className = 'form-status is-error'; st.textContent = m; st.focus(); };
        if (!dp) return fail('Choose a product.');
        if (!(price > 0) || price >= dp.priceZMW) return fail('The deal price must be lower than the normal price of ' + kwacha(dp.priceZMW) + '.');
        var list = store.get('deals', []).filter(function (x) { return !(x.seller === s.id && x.product === dp.id); });
        list.push({ id: 'D' + Date.now().toString(36), demo: true, seller: s.id, product: dp.id, price: price, reason: $('#dl-reason').value, starts: today, ends: $('#dl-ends').value || '' });
        store.set('deals', list);
        toast('Deal published <a href="#/deals?cat=' + dp.category + '">View</a>');
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
    listing: function (id, q) {
      var sess = store.get('seller', null), s = sess ? seller(sess.id) : null;
      if (!s) { location.hash = '#/seller'; return; }
      var editing = id && id !== 'new' ? product(id) : null;
      if (id && id !== 'new' && (!editing || editing.seller !== s.id)) return views.notfound();
      var dr = editing ? JSON.parse(JSON.stringify(editing)) : { title: '', category: '', brand: '', priceZMW: '', wasZMW: '', stock: 'in', description: '', tags: '', image: '', alt: '' };
      dr.seller = s.id;
      dr.attributes = dr.attributes || {}; dr.options = dr.options || {}; dr.variants = dr.variants || []; dr.inBox = dr.inBox || [];
      var enabledFields = {};
      var fieldNames = { colour: 'Colour choices', size: 'Size / volume / weight', ageRange: 'Age suitability', inBox: 'Included items / add-ons', manufacturer: 'Manufacturer / brand name', specs: 'Custom specifications', condition: 'Item condition', features: 'Key features' };
      var specRows = Object.keys(dr.attributes.specs || {}).map(function (k) { return [k, dr.attributes.specs[k]]; });
      var ctx = { departments: D.departments, brands: D.brands, products: BASE_PRODUCTS };
      var tpl = function () { return (D.attributeTemplates || {})[dr.category] || { fields: dr.category ? ZP.FIELDS : [] }; };
      var used = {
        colour: function () { return (dr.options.colour || []).length; }, size: function () { return (dr.options.size || []).length || dr.attributes.size; },
        ageRange: function () { return (dr.attributes.ageRange || []).length; }, inBox: function () { return dr.inBox.length; },
        manufacturer: function () { return dr.attributes.manufacturer; }, specs: function () { return specRows.length; },
        condition: function () { return dr.attributes.condition || dr.attributes.conditionNotes; }, features: function () { return (dr.attributes.features || []).length; }
      };
      var has = function (f) { return enabledFields[f] || tpl().fields.indexOf(f) !== -1 || !!used[f](); };
      var units = function () { var suggested = tpl().sizeUnits || [], selected = dr.attributes.size ? [dr.attributes.size.unit] : []; if (!suggested.length && !selected.length && !enabledFields.measured && Array.isArray(tpl().sizeUnits)) return []; return suggested.concat(selected, Object.keys(ZP.UNITS)).filter(function (u, i, all) { return all.indexOf(u) === i; }); };
      var fieldsHTML = function () { return '<details class="lf-optional"><summary>Add other relevant product details</summary><p class="hint">Category suggestions are a starting point. Add only fields that describe this product; existing values are preserved.</p><div class="checks">' + ZP.FIELDS.filter(function (f) { return tpl().fields.indexOf(f) === -1; }).map(function (f) { return '<div class="check"><input type="checkbox" id="lf-enable-' + f + '" data-enable-field="' + f + '"' + (has(f) ? ' checked' : '') + (used[f]() ? ' disabled' : '') + '><label for="lf-enable-' + f + '">' + esc(fieldNames[f]) + '</label></div>'; }).join('') + '</div></details>'; };
      var addSuggestedSpecs = function () {
        (tpl().specs || []).forEach(function (k) { if (!specRows.some(function (r) { return r[0].toLowerCase() === k.toLowerCase(); })) specRows.push([k, '']); });
      };
      addSuggestedSpecs();

      var fieldHTML = function (fid, label, input, hint) { return '<div class="field" id="lf-f-' + fid + '"><label for="lf-' + fid + '">' + label + '</label>' + input + (hint ? '<p class="hint">' + hint + '</p>' : '') + '</div>'; };
      var attrsHTML = function () {
        var t = tpl(), out = '';
        if (!dr.category) return '<p class="pmeta">Choose a department to see the details buyers look for in it.</p>';
        if (has('size') && Array.isArray(t.sizeUnits) && !t.sizeUnits.length) out += '<div class="check"><input id="lf-measured" type="checkbox" data-measured' + (enabledFields.measured || dr.attributes.size ? ' checked' : '') + '><label for="lf-measured">Also specify a measured size, such as cm or ml</label></div>';
        if (has('size') && units().length) out += '<div class="field-row lf-size" id="lf-f-size"><div class="field"><label for="lf-size">' + (ZP.UNITS[units()[0]].dim === 'volume' ? 'Volume' : ZP.UNITS[units()[0]].dim === 'mass' ? 'Weight' : 'Size') + ' (one size only)</label><input id="lf-size" type="number" min="0" step="any" inputmode="decimal" value="' + esc(dr.attributes.size ? dr.attributes.size.value : '') + '"><p class="hint">Leave empty if buyers choose a size below.</p></div>' +
          '<div class="field"><label for="lf-unit">Unit</label><select id="lf-unit">' + units().map(function (u) { return '<option value="' + u + '"' + (dr.attributes.size && dr.attributes.size.unit === u ? ' selected' : '') + '>' + esc(ZP.UNITS[u].name) + '</option>'; }).join('') + '</select></div></div>';
        if (has('ageRange')) out += '<fieldset class="field" id="lf-f-ageRange"><legend>Age range</legend><div class="checks checks--ages">' + ZP.AGES.map(function (a) {
          return '<div class="check"><input type="checkbox" id="lf-age-' + a[0] + '" value="' + a[0] + '" data-age' + ((dr.attributes.ageRange || []).indexOf(a[0]) !== -1 ? ' checked' : '') + '><label for="lf-age-' + a[0] + '">' + a[1] + '</label></div>';
        }).join('') + '</div></fieldset>';
        if (has('manufacturer')) out += fieldHTML('manufacturer', 'Manufacturer / brand name', '<input id="lf-manufacturer" maxlength="80" value="' + esc(dr.attributes.manufacturer || '') + '">', 'Enter the actual brand or manufacturer. Choose a brand store above only when one exists.');
        if (has('condition')) out += fieldHTML('condition', 'Item condition', '<select id="lf-condition"><option value="">Not specified</option>' + ZP.CONDITIONS.map(function (c) { return '<option value="' + c[0] + '"' + (dr.attributes.condition === c[0] ? ' selected' : '') + '>' + c[1] + '</option>'; }).join('') + '</select><label for="lf-conditionNotes">Condition details</label><textarea id="lf-conditionNotes" maxlength="1000" placeholder="For used or refurbished items, describe wear, repairs and missing packaging.">' + esc(dr.attributes.conditionNotes || '') + '</textarea>');
        if (has('features')) out += fieldHTML('features', 'Key features', '<textarea id="lf-features" rows="5" placeholder="One feature per line">' + esc((dr.attributes.features || []).join('\n')) + '</textarea>', 'Up to eight checked facts, 160 characters each. Put warranty, compatibility, material and model details under Specifications.');
        if (has('specs')) out += '<fieldset class="field" id="lf-f-specs"><legend>Specifications</legend><p class="hint">Leave a value empty to skip it. Only list what you have checked on the item.</p><div class="lf-rows">' + specRows.map(function (r, i) {
          return '<div class="lf-row"><label class="visually-hidden" for="lf-sk-' + i + '">Specification name</label><input id="lf-sk-' + i + '" data-spec-key placeholder="Name" maxlength="60" value="' + esc(r[0]) + '">' +
            '<label class="visually-hidden" for="lf-sv-' + i + '">' + esc(r[0] || 'Specification') + ' value</label><input id="lf-sv-' + i + '" data-spec-val placeholder="Value" maxlength="200" value="' + esc(r[1]) + '">' +
            '<button class="link-btn" type="button" data-del-spec="' + i + '">Remove<span class="visually-hidden"> ' + esc(r[0] || 'specification') + '</span></button></div>';
        }).join('') + '</div><button class="btn btn--secondary btn--sm" type="button" data-add-spec>Add a specification</button></fieldset>';
        if (has('inBox')) out += '<fieldset class="field" id="lf-f-inBox"><legend>In the box</legend><p class="hint">What the buyer gets. An optional add-on is ticked by the buyer and adds its price.</p><div class="lf-rows">' + dr.inBox.map(function (c, i) {
          var addon = c.addonZMW != null && c.addonZMW !== '';
          return '<div class="lf-row lf-row--box"><label class="visually-hidden" for="lf-bi-' + i + '">Item</label><input id="lf-bi-' + i + '" data-box-item placeholder="e.g. Charging cable" maxlength="80" value="' + esc(c.item || '') + '">' +
            '<label class="visually-hidden" for="lf-bk-' + i + '">Included or add-on</label><select id="lf-bk-' + i + '" data-box-kind><option value="included">Included</option><option value="addon"' + (addon ? ' selected' : '') + '>Optional add-on</option></select>' +
            '<label class="visually-hidden" for="lf-bp-' + i + '">Add-on price in Kwacha</label><input id="lf-bp-' + i + '" data-box-price type="number" min="0" step="0.01" inputmode="decimal" placeholder="K price"' + (addon ? ' value="' + esc(c.addonZMW) + '"' : ' hidden') + '>' +
            '<button class="link-btn" type="button" data-del-box="' + i + '">Remove<span class="visually-hidden"> ' + esc(c.item || 'item') + '</span></button></div>';
        }).join('') + '</div><button class="btn btn--secondary btn--sm" type="button" data-add-box>Add an item</button></fieldset>';
        return out || '<p class="pmeta">No extra details for this department.</p>';
      };
      var varsHTML = function () {
        var out = '', cols = dr.options.colour || [], sizes = dr.options.size || [];
        if (has('colour')) out += '<fieldset class="field" id="lf-f-colour"><legend>Colours the buyer can choose</legend><p class="hint">Pick a swatch that matches the real item.</p><div class="lf-rows">' + cols.map(function (c, i) {
          return '<div class="lf-row lf-row--colour"><label class="visually-hidden" for="lf-cn-' + i + '">Colour name</label><input id="lf-cn-' + i + '" data-col-name placeholder="e.g. Midnight black" maxlength="40" value="' + esc(c.name) + '">' +
            '<label class="visually-hidden" for="lf-ch-' + i + '">Swatch for ' + esc(c.name || 'this colour') + '</label><input id="lf-ch-' + i + '" data-col-hex type="color" value="' + esc(/^#[0-9a-f]{6}$/i.test(c.hex || '') ? c.hex : '#808080') + '">' +
            '<button class="link-btn" type="button" data-del-col="' + i + '">Remove<span class="visually-hidden"> ' + esc(c.name || 'colour') + '</span></button></div>';
        }).join('') + '</div><button class="btn btn--secondary btn--sm" type="button" data-add-col>Add a colour</button></fieldset>';
        if (has('size')) out += '<fieldset class="field" id="lf-f-sizes"><legend>Sizes the buyer can choose</legend><p class="hint">For example S, M, L, 42, or 500 ml and 1 l. Measured sizes are read with their unit.</p>' +
          (sizes.length ? '<ul class="lf-chips">' + sizes.map(function (sz, i) { return '<li><span>' + esc(ZP.sizeLabel(sz)) + '</span><button type="button" class="lf-chip-x" data-del-size="' + i + '" aria-label="Remove size ' + esc(ZP.sizeLabel(sz)) + '">×</button></li>'; }).join('') + '</ul>' : '') +
          '<div class="lf-row"><label class="visually-hidden" for="lf-newsize">New size</label><input id="lf-newsize" maxlength="20" placeholder="Add a size"><button class="btn btn--secondary btn--sm" type="button" data-add-size>Add size</button></div></fieldset>';
        out += '<fieldset class="field lf-extra"><legend>Other buyer choices</legend><p class="hint">Use related variations such as Storage, Capacity, Material, Pack size or Fit. Different brands should have separate product listings.</p>' + (dr.options.extra || []).map(function (axis, i) {
          return '<div class="lf-row"><label for="lf-extra-name-' + i + '">Choice name</label><input id="lf-extra-name-' + i + '" data-extra-name="' + axis.key + '" maxlength="40" placeholder="e.g. Storage" value="' + esc(axis.name) + '"><label for="lf-extra-values-' + i + '">Values</label><input id="lf-extra-values-' + i + '" data-extra-values="' + axis.key + '" placeholder="e.g. 128 GB, 256 GB" value="' + esc(axis.values.join(', ')) + '"><button type="button" class="link-btn" data-del-extra="' + i + '">Remove choice</button></div>';
        }).join('') + ((dr.options.extra || []).length < 2 ? '<button type="button" class="btn btn--secondary btn--sm" data-add-extra>Add another choice</button>' : '') + '<p class="hint">Up to two extra choice types and ' + ZP.MAX_COMBINATIONS + ' total combinations.</p></fieldset>';
        if (ZP.combinationCount(dr.options) > ZP.MAX_COMBINATIONS) out += '<p class="form-status is-error">There are too many combinations. Remove some values to generate the stock table.</p>';
        if (dr.variants.length) {
          var withC = cols.length > 0, matrixAxes = ZP.options(dr);
          out += '<div class="field" id="lf-f-variants"><p class="lf-label" id="lf-vt">Stock for each combination (' + dr.variants.length + ')</p><p class="hint">Stock 0 shows that combination as sold out. Leave the price empty to use the main price.</p>' +
            '<div class="cmp lf-matrix" tabindex="0" role="region" aria-labelledby="lf-vt"><table><thead><tr>' + matrixAxes.map(function (a) { return '<th scope="col">' + esc(a.name) + '</th>'; }).join('') + '<th scope="col">SKU</th><th scope="col">Stock</th><th scope="col">Price (K)</th></tr></thead><tbody>' +
            dr.variants.map(function (v, i) {
              var name = matrixAxes.map(function (a) { return v[a.key]; }).join(' / ');
              var hex = withC ? ((cols.filter(function (c) { return c.name === v.colour; })[0] || {}).hex || '') : '';
              return '<tr>' + matrixAxes.map(function (a, ai) { var tag = ai === 0 ? 'th' : 'td'; return '<' + tag + (ai === 0 ? ' scope="row"' : '') + '>' + (a.key === 'colour' ? '<span class="swatch swatch--sm" style="--sw:' + esc(hex) + '" aria-hidden="true"></span> ' : '') + esc(v[a.key]) + '</' + tag + '>'; }).join('') +
                '<td><input data-v-sku="' + i + '" maxlength="40" value="' + esc(v.sku || '') + '" aria-label="SKU for ' + esc(name) + '"></td>' +
                '<td><input data-v-stock="' + i + '" type="number" min="0" step="1" inputmode="numeric" value="' + esc(v.stock) + '" aria-label="Stock for ' + esc(name) + '"></td>' +
                '<td><input data-v-price="' + i + '" type="number" min="0.01" step="0.01" inputmode="decimal" value="' + esc(v.priceZMW || '') + '" placeholder="Main price" aria-label="Price for ' + esc(name) + ' in Kwacha"></td></tr>';
            }).join('') + '</tbody></table></div><button class="btn btn--secondary btn--sm" type="button" data-fill-sku>Fill in empty SKUs</button></div>';
        }
        return out || '<p class="pmeta">This department doesn\'t use colours or sizes.</p>';
      };
      var commitOn = !!dr.commit;
      var html = crumbs([['Seller Centre', '#/seller'], [editing ? 'Edit product' : 'Add a product']]) +
        head(editing ? 'Edit ' + esc(editing.title) : 'Add a product', 'Selling as ' + esc(s.name) + '. Fields marked * are required.') +
        (q && q.get('saved') && editing ? '<div class="notice notice--secure" role="status"><p><strong>Saved.</strong> <a href="#/product/' + esc(editing.id) + '">View the product page</a>. Prototype: saved in this browser only.</p>' +
          '<details><summary>Copy for catalogue.js</summary><p class="pmeta">To publish it for everyone, paste this into the products list in js/catalogue.js' + (/^data:/.test(editing.image || '') ? ' and save the photo as ' + esc('assets/products/' + editing.id + '.webp') : '') + '.</p><textarea class="lf-code" readonly rows="10" aria-label="Catalogue entry">' + esc(ZP.catalogueEntry(editing)) + ',</textarea><button class="btn btn--secondary btn--sm" type="button" data-copy-entry>Copy</button></details></div>' : '') +
        '<form class="form form--card lf" id="lf" novalidate>' +
          '<div class="lf-errors" id="lf-errors" tabindex="-1" hidden></div>' +
          '<section class="lf-sec" aria-labelledby="lf-h1"><h2 class="h3" id="lf-h1">Basics</h2>' +
            fieldHTML('title', 'Product name *', '<input id="lf-title" maxlength="120" required value="' + esc(dr.title) + '">', 'Say what it is, its size or capacity, and the pack size, e.g. "Electric kettle, 1.7 litre".') +
            '<div class="field-row">' + fieldHTML('category', 'Department *', '<select id="lf-category" required><option value="">Choose a department</option>' + D.departments.map(function (x) { return '<option value="' + x.id + '"' + (x.id === dr.category ? ' selected' : '') + '>' + esc(x.name) + '</option>'; }).join('') + '</select>') +
              fieldHTML('brand', 'Brand', '<select id="lf-brand"><option value="">No brand store</option>' + D.brands.map(function (x) { return '<option value="' + x.id + '"' + (x.id === dr.brand ? ' selected' : '') + '>' + esc(x.name) + '</option>'; }).join('') + '</select>') + '</div>' +
            fieldHTML('description', 'Description', '<textarea id="lf-description" maxlength="2000">' + esc(dr.description || '') + '</textarea>') +
            fieldHTML('tags', 'Search words', '<input id="lf-tags" maxlength="200" value="' + esc(dr.tags || '') + '">', 'Other words buyers might search for, separated by spaces.') +
            '<div class="field-row">' + fieldHTML('image', 'Photo', '<input id="lf-image" type="file" accept="image/jpeg,image/png,image/webp">', 'A square photo of the actual item on a plain background. We crop it to 600 × 600.') +
              fieldHTML('alt', 'Photo description', '<input id="lf-alt" maxlength="160" value="' + esc(dr.alt || '') + '">', 'What the photo shows, for buyers using screen readers.') + '</div>' +
            (dr.image ? '<img class="lf-photo" id="lf-photo" src="' + esc(dr.image) + '" alt="Current photo" width="120" height="120">' : '<img class="lf-photo" id="lf-photo" alt="" width="120" height="120" hidden>') +
          '</section>' +
          '<section class="lf-sec" aria-labelledby="lf-h2"><h2 class="h3" id="lf-h2">Details</h2><div id="lf-optional">' + fieldsHTML() + '</div><div id="lf-attrs">' + attrsHTML() + '</div></section>' +
          '<section class="lf-sec" aria-labelledby="lf-h3"><h2 class="h3" id="lf-h3">Variations</h2><div id="lf-vars">' + varsHTML() + '</div></section>' +
          '<section class="lf-sec" aria-labelledby="lf-h4"><h2 class="h3" id="lf-h4">Price and stock</h2>' +
            '<div class="field-row">' + fieldHTML('priceZMW', 'Price (K) *', '<input id="lf-priceZMW" type="number" min="0.01" step="0.01" inputmode="decimal" required value="' + esc(dr.priceZMW) + '">', 'The Buy now price.') +
              fieldHTML('wasZMW', 'Was price (K)', '<input id="lf-wasZMW" type="number" min="0.01" step="0.01" inputmode="decimal" value="' + esc(dr.wasZMW || '') + '">', 'Only a genuine previous price.') + '</div>' +
            fieldHTML('stock', 'Stock status', '<select id="lf-stock">' + [['in', 'In stock'], ['low', 'Only a few left'], ['request', 'Sourced on request']].map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === dr.stock ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>', 'With variations, buyers see the stock from the table above instead.') +
            '<div class="lf-switch"><input type="checkbox" role="switch" id="lf-commit"' + (commitOn ? ' checked' : '') + ' aria-describedby="lf-commit-hint"><label for="lf-commit">Enable buyer offer and commit pricing</label></div>' +
            '<p class="hint" id="lf-commit-hint">Buyers can name a price between your lowest and target prices. You confirm each offer on WhatsApp. Buyers see the range, including your lowest price.</p>' +
            '<div class="field-row" id="lf-commit-fields"' + (commitOn ? '' : ' hidden') + '>' + fieldHTML('commitMin', 'Lowest price you\'ll accept (K) *', '<input id="lf-commitMin" type="number" min="0.01" step="0.01" inputmode="decimal" value="' + esc(dr.commit ? dr.commit.min : '') + '">') +
              fieldHTML('commitMax', 'Target price (K) *', '<input id="lf-commitMax" type="number" min="0.01" step="0.01" inputmode="decimal" value="' + esc(dr.commit ? dr.commit.max : dr.priceZMW) + '">', 'Usually your Buy now price. It can\'t be higher.') + '</div>' +
          '</section>' +
          '<p class="form-status" role="status" tabindex="-1"></p>' +
          '<div class="btn-row"><button class="btn btn--primary" type="submit">' + (editing ? 'Save changes' : 'Add product') + '</button><a class="btn btn--secondary" href="#/seller">Cancel</a>' +
            (editing && listingsApi.get(editing.id) ? '<button class="link-btn" type="button" id="lf-delete">' + (byId(BASE_PRODUCTS, editing.id) ? 'Undo my changes' : 'Delete this product') + '</button>' : '') + '</div>' +
        '</form>';
      show(html, editing ? 'Edit product' : 'Add a product');
      var form = $('#lf');

      // Form -> draft
      var collect = function () {
        dr.title = $('#lf-title').value; dr.category = $('#lf-category').value; dr.brand = $('#lf-brand').value;
        dr.description = $('#lf-description').value; dr.tags = $('#lf-tags').value; dr.alt = $('#lf-alt').value;
        dr.priceZMW = $('#lf-priceZMW').value; dr.wasZMW = $('#lf-wasZMW').value; dr.stock = $('#lf-stock').value;
        var a = dr.attributes;
        if ($('#lf-size')) { var sv = $('#lf-size').value.trim(); a.size = sv ? { value: Number(sv), unit: $('#lf-unit').value } : undefined; }
        if ($('#lf-f-ageRange')) a.ageRange = $$('[data-age]:checked', form).map(function (c) { return c.value; });
        if ($('#lf-manufacturer')) a.manufacturer = $('#lf-manufacturer').value;
        if ($('#lf-condition')) { a.condition = $('#lf-condition').value || undefined; a.conditionNotes = $('#lf-conditionNotes').value; }
        if ($('#lf-features')) a.features = $('#lf-features').value.split('\n').map(function (f) { return f.trim(); }).filter(Boolean);
        if ($('#lf-f-specs')) specRows = $$('[data-spec-key]', form).map(function (k, i) { return [k.value.trim(), $$('[data-spec-val]', form)[i].value.trim()]; });
        a.specs = {};
        specRows.forEach(function (r) { if (r[1]) a.specs[r[0]] = r[1]; });
        if ($('#lf-f-inBox')) dr.inBox = $$('[data-box-item]', form).map(function (it, i) {
          var kind = $$('[data-box-kind]', form)[i].value, price = $$('[data-box-price]', form)[i].value;
          return kind === 'addon' ? { item: it.value, addonZMW: price === '' ? 0 : price } : { item: it.value };
        });
        if ($('#lf-f-colour')) dr.options.colour = $$('[data-col-name]', form).map(function (n, i) { return { name: n.value.trim(), hex: $$('[data-col-hex]', form)[i].value }; });
        (dr.options.extra || []).forEach(function (axis) {
          var name = $('[data-extra-name="' + axis.key + '"]', form), values = $('[data-extra-values="' + axis.key + '"]', form);
          if (name) axis.name = name.value.trim();
          if (values) axis.values = values.value.split(',').map(function (v) { return v.trim(); }).filter(Boolean);
        });
        dr.variants.forEach(function (v, i) {
          var sk = $('[data-v-sku="' + i + '"]', form); if (!sk) return;
          v.sku = sk.value.trim(); v.stock = $('[data-v-stock="' + i + '"]', form).value; v.priceZMW = $('[data-v-price="' + i + '"]', form).value;
        });
        dr.commit = $('#lf-commit').checked ? { min: $('#lf-commitMin').value, max: $('#lf-commitMax').value } : undefined;
        if (!(dr.options.colour || []).length) delete dr.options.colour;
        if (!(dr.options.size || []).length) delete dr.options.size;
      };
      var rebuildMatrix = function () {
        var o = { colour: (dr.options.colour || []).filter(function (c) { return c.name; }), size: dr.options.size || [], extra: dr.options.extra || [] };
        dr.variants = ZP.matrix(o, dr.variants);
      };
      var redraw = function (focusSel) {
        var optionalOpen = $('#lf-optional details').open;
        $('#lf-optional').innerHTML = fieldsHTML();
        $('#lf-optional details').open = optionalOpen;
        $('#lf-attrs').innerHTML = attrsHTML();
        $('#lf-vars').innerHTML = varsHTML();
        var f = focusSel && $(focusSel, form); if (f) f.focus();
      };

      form.addEventListener('change', function (e) {
        var t = e.target;
        if (t.id === 'lf-category') { collect(); addSuggestedSpecs(); redraw(); }
        else if (t.hasAttribute('data-enable-field')) { var field = t.getAttribute('data-enable-field'); collect(); enabledFields[field] = t.checked; redraw('#lf-enable-' + field); }
        else if (t.hasAttribute('data-measured')) { collect(); enabledFields.measured = t.checked; if (!t.checked) delete dr.attributes.size; redraw(); }
        else if (t.hasAttribute('data-extra-name') || t.hasAttribute('data-extra-values')) { var extraId = t.id; collect(); rebuildMatrix(); redraw('#' + extraId); }
        else if (t.matches('[data-box-kind]')) { var pr = t.parentNode.querySelector('[data-box-price]'); pr.hidden = t.value !== 'addon'; if (!pr.hidden) pr.focus(); }
        else if (t.matches('[data-col-name]')) { collect(); rebuildMatrix(); var idx = $$('[data-col-name]', form).indexOf(t); redraw('#lf-cn-' + idx); }
        else if (t.matches('[data-col-hex]')) { collect(); $('#lf-vars').innerHTML = varsHTML(); }
        else if (t.id === 'lf-commit') {
          $('#lf-commit-fields').hidden = !t.checked;
          if (t.checked) { if (!$('#lf-commitMax').value) $('#lf-commitMax').value = $('#lf-priceZMW').value; $('#lf-commitMin').focus(); }
        } else if (t.id === 'lf-image') {
          bannerFromFile(t.files[0], 600, 600, function (img) {
            var st = $('.form-status', form);
            if (img === null) { st.className = 'form-status is-error'; st.textContent = 'That photo couldn\'t be used. Choose a JPEG, PNG or WebP under 10 MB.'; return; }
            if (!img) return;
            dr.image = img;
            var ph = $('#lf-photo'); ph.src = img; ph.alt = 'New photo'; ph.hidden = false;
          });
        }
      });
      var addSize = function () {
        var inp = $('#lf-newsize'), val = inp.value.trim();
        if (!val) return inp.focus();
        collect();
        var sz = ZP.parseSize(val), label = ZP.sizeLabel(sz).toLowerCase();
        dr.options.size = dr.options.size || [];
        if (!dr.options.size.some(function (x) { return ZP.sizeLabel(x).toLowerCase() === label; })) dr.options.size.push(sz);
        rebuildMatrix(); redraw('#lf-newsize');
      };
      form.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.id === 'lf-newsize') { e.preventDefault(); addSize(); } });
      form.addEventListener('click', function (e) {
        var t = e.target.closest('button');
        if (!t || t.type === 'submit') return;
        var n = function (attr) { return Number(t.getAttribute(attr)); };
        if (t.hasAttribute('data-add-extra')) { collect(); dr.options.extra = dr.options.extra || []; var key = dr.options.extra.some(function (a) { return a.key === 'custom_1'; }) ? 'custom_2' : 'custom_1'; dr.options.extra.push({ key: key, name: '', values: [] }); rebuildMatrix(); redraw('#lf-extra-name-' + (dr.options.extra.length - 1)); }
        else if (t.hasAttribute('data-del-extra')) { collect(); dr.options.extra.splice(n('data-del-extra'), 1); rebuildMatrix(); redraw('[data-add-extra]'); }
        else if (t.hasAttribute('data-add-spec')) { collect(); specRows.push(['', '']); redraw('#lf-sk-' + (specRows.length - 1)); }
        else if (t.hasAttribute('data-del-spec')) { collect(); specRows.splice(n('data-del-spec'), 1); redraw('[data-add-spec]'); }
        else if (t.hasAttribute('data-add-box')) { collect(); dr.inBox.push({ item: '' }); redraw('#lf-bi-' + (dr.inBox.length - 1)); }
        else if (t.hasAttribute('data-del-box')) { collect(); dr.inBox.splice(n('data-del-box'), 1); redraw('[data-add-box]'); }
        else if (t.hasAttribute('data-add-col')) { collect(); dr.options.colour = (dr.options.colour || []).concat([{ name: '', hex: '#808080' }]); redraw('#lf-cn-' + (dr.options.colour.length - 1)); }
        else if (t.hasAttribute('data-del-col')) { collect(); dr.options.colour.splice(n('data-del-col'), 1); rebuildMatrix(); redraw('[data-add-col]'); }
        else if (t.hasAttribute('data-add-size')) addSize();
        else if (t.hasAttribute('data-del-size')) { collect(); dr.options.size.splice(n('data-del-size'), 1); rebuildMatrix(); redraw('#lf-newsize'); }
        else if (t.hasAttribute('data-fill-sku')) {
          collect();
          dr.variants.forEach(function (v) { if (!v.sku) v.sku = ZP.skuFor(editing ? editing.id : dr.title, v); });
          redraw('[data-fill-sku]');
        }
      });
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        collect();
        $$('[aria-invalid]', form).forEach(function (x) { x.removeAttribute('aria-invalid'); });
        var res = editing ? listingsApi.update(editing.id, dr, ctx) : listingsApi.create(dr, ctx), box = $('#lf-errors');
        if (!res.ok) {
          box.hidden = false;
          box.innerHTML = '<h2 class="h3">Please fix ' + (res.errors.length === 1 ? 'this' : 'these ' + res.errors.length + ' things') + '</h2><ul>' + res.errors.map(function (er) {
            var wrap = $('#lf-f-' + er.field), ctl = wrap && $('input, select, textarea', wrap);
            if (ctl) ctl.setAttribute('aria-invalid', 'true');
            return '<li>' + (ctl ? '<a href="#lf-f-' + er.field + '" data-goto="' + er.field + '">' + esc(er.message) + '</a>' : esc(er.message)) + '</li>';
          }).join('') + '</ul>';
          box.focus();
          return;
        }
        loadProducts();
        toast((editing ? 'Changes saved' : 'Product added') + (res.stored ? '' : '. This browser\'s storage is full, so it lasts until you close the page.'));
        var to = '#/listing/' + encodeURIComponent(res.product.id) + '?saved=1';
        if (location.hash === to) route(); else location.hash = to;
      });
      $('#lf-errors').addEventListener('click', function (e) {
        var a = e.target.closest('[data-goto]'); if (!a) return;
        e.preventDefault();
        var wrap = $('#lf-f-' + a.getAttribute('data-goto')), ctl = wrap && $('input, select, textarea', wrap);
        if (ctl) ctl.focus();
      });
      var del = $('#lf-delete');
      if (del) del.addEventListener('click', function () {
        listingsApi.remove(editing.id);
        loadProducts();
        toast(byId(BASE_PRODUCTS, editing.id) ? 'Your changes were undone' : 'Product deleted');
        location.hash = '#/seller';
      });
      var cp = $('[data-copy-entry]');
      if (cp) cp.addEventListener('click', function () {
        var ta = $('.lf-code');
        ta.select();
        var done = function () { toast('Copied'); };
        if (navigator.clipboard) navigator.clipboard.writeText(ta.value).then(done, function () { document.execCommand('copy'); done(); });
        else { document.execCommand('copy'); done(); }
      });
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
