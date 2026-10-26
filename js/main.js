/* Zed Supply — site script. No libraries. Everything here is progressive
   enhancement: the site still works if this file fails to load. */
(function () {
  'use strict';

  var root = document.documentElement;
  root.classList.remove('no-js');
  root.classList.add('js');

  /* ---------- Mobile navigation ---------- */
  var toggle = document.querySelector('.nav-toggle');
  var nav = document.getElementById('site-nav');

  function setMenu(open) {
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    nav.classList.toggle('is-open', open);
  }

  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      setMenu(toggle.getAttribute('aria-expanded') !== 'true');
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && nav.classList.contains('is-open')) {
        setMenu(false);
        toggle.focus();
      }
    });

    document.addEventListener('click', function (e) {
      if (nav.classList.contains('is-open') && !nav.contains(e.target) && !toggle.contains(e.target)) {
        setMenu(false);
      }
    });

    nav.addEventListener('click', function (e) {
      if (e.target.closest('a')) setMenu(false);
    });

    // Reset when the viewport grows past the breakpoint
    var desktop = window.matchMedia('(min-width: 768px)');
    var onChange = function (mq) { if (mq.matches) setMenu(false); };
    if (desktop.addEventListener) desktop.addEventListener('change', onChange);
    else if (desktop.addListener) desktop.addListener(onChange);
  }

  /* ---------- Footer year ---------- */
  var year = document.querySelectorAll('[data-year]');
  for (var i = 0; i < year.length; i++) year[i].textContent = new Date().getFullYear();

  /* ---------- Announcement banner (dismissal remembered per browser) ---------- */
  var banner = document.getElementById('site-banner');
  if (banner) {
    banner.querySelector('.site-banner__close').addEventListener('click', function () {
      root.classList.add('banner-off');
      try { localStorage.setItem('zs-banner', 'hidden'); } catch (e) { /* storage blocked: hide for this visit only */ }
    });
  }

  /* ---------- Shop: feed, filters and landed cost calculator ---------- */
  var data = window.ZS_CATALOGUE;
  var feed = document.getElementById('product-feed');
  if (data && feed) initShop(data);

  function initShop(cat) {
    var s = cat.settings;
    var waBase = 'https://wa.me/' + s.whatsapp + '?text=';
    var catName = {};
    cat.categories.forEach(function (c) { catName[c.id] = c.name; });

    // China ordering switch: hide China products and reveal China-only content when on
    var china = !!s.chinaOrdering;
    var products = cat.products.filter(function (pr) { return china || pr.source !== 'china'; });
    if (china) {
      var cn = document.querySelectorAll('[data-china]');
      for (var h = 0; h < cn.length; h++) cn[h].hidden = false;
    }

    var state = { cat: 'all', q: '', sort: 'featured' };
    try {
      var p = new URLSearchParams(window.location.search).get('cat');
      if (p && catName[p]) state.cat = p;
    } catch (e) { /* old browser: show everything */ }

    // Rate notice
    var rateEls = document.querySelectorAll('[data-rate]');
    for (var r = 0; r < rateEls.length; r++) {
      rateEls[r].textContent = '1 CNY = K' + s.exchangeRate.toFixed(2) + ' (updated ' + s.rateUpdated + ')' + (s.isSample ? ' [SAMPLE RATE]' : '');
    }
    var sampleNote = document.getElementById('sample-note');
    if (sampleNote && !s.isSample) sampleNote.hidden = true;

    // Price maths, shared by cards and calculator
    function applyCharge(rule, base) { return rule.type === 'fixed' ? rule.value : base * rule.value / 100; }
    function cost(priceCNY, weightKg, qty, priceZMW) {
      if (priceZMW != null) return { local: true, item: priceZMW * qty, total: Math.ceil(priceZMW * qty) };
      var item = priceCNY * s.exchangeRate * qty;
      var shipping = weightKg * qty * s.shippingPerKg;
      var clearance = applyCharge(s.clearance, item + shipping);
      var fee = applyCharge(s.fee, item + shipping + clearance);
      return { item: item, shipping: shipping, clearance: clearance, fee: fee, total: Math.ceil(item + shipping + clearance + fee) };
    }
    function kwacha(n) { return 'K' + Math.round(n).toLocaleString('en-US'); }
    function esc(t) { return String(t).replace(/[&<>"']/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]; }); }
    function breakdownHTML(c) {
      if (c.local) {
        return '<div><dt>Price</dt><dd>' + kwacha(c.item) + '</dd></div>' +
          '<div><dt>Delivery</dt><dd>Confirmed on WhatsApp</dd></div>';
      }
      return '<div><dt>Item</dt><dd>' + kwacha(c.item) + '</dd></div>' +
        '<div><dt>Shipping</dt><dd>' + kwacha(c.shipping) + '</dd></div>' +
        '<div><dt>Clearance &amp; duties</dt><dd>' + kwacha(c.clearance) + '</dd></div>' +
        '<div><dt>Service fee</dt><dd>' + kwacha(c.fee) + '</dd></div>' +
        '<div class="breakdown__total"><dt>Estimated total</dt><dd>' + kwacha(c.total) + '</dd></div>';
    }
    function withTracking(url) {
      var t = s.tracking;
      if (!url || !t || !t.value || t.value.charAt(0) === '[') return url;
      return url + (url.indexOf('?') === -1 ? '?' : '&') + encodeURIComponent(t.param) + '=' + encodeURIComponent(t.value);
    }

    // Department chips
    var chips = document.getElementById('dept-chips');
    var chipHTML = '<li><button type="button" class="chip" data-cat="all">All</button></li>';
    cat.categories.forEach(function (c) {
      var n = products.filter(function (pr) { return pr.category === c.id; }).length;
      chipHTML += '<li><button type="button" class="chip" data-cat="' + c.id + '">' + esc(c.name) + ' <span class="chip__count">' + n + '</span></button></li>';
    });
    chips.innerHTML = chipHTML;
    chips.addEventListener('click', function (e) {
      var b = e.target.closest('.chip');
      if (!b) return;
      state.cat = b.getAttribute('data-cat');
      render();
    });

    document.getElementById('shop-search').addEventListener('input', function (e) { state.q = e.target.value.trim().toLowerCase(); render(); });
    document.getElementById('shop-sort').addEventListener('change', function (e) { state.sort = e.target.value; render(); });
    document.getElementById('shop-form').addEventListener('submit', function (e) { e.preventDefault(); });

    var countEl = document.getElementById('result-count');

    function card(pr) {
      var c = cost(pr.priceCNY, pr.weightKg, 1, pr.priceZMW);
      var msg = 'Hi Zed Supply, I\'d like to order: ' + pr.title + ' (ID ' + pr.id + '). Estimated price ' + kwacha(c.total) + '. Quantity: 1';
      var link = withTracking(pr.url);
      return '<li><article class="product">' +
        '<div class="media product__media" data-file="' + esc(pr.image) + '"><img src="' + esc(pr.image) + '" alt="' + esc(pr.alt) + '" width="600" height="600" loading="lazy" decoding="async"></div>' +
        '<div class="product__body">' +
          '<p class="product__tags">' + (pr.sample ? '<span class="tag-sample">Sample</span>' : '') + (pr.badge ? '<span class="badge">' + esc(pr.badge) + '</span>' : '') + '</p>' +
          '<h3 class="product__title">' + esc(pr.title) + '</h3>' +
          '<p class="product__meta">' + (pr.source === 'china' ? 'From China' : 'Local') + ' · ' + esc(catName[pr.category] || '') + '</p>' +
          '<p class="product__price"><span class="visually-hidden">Estimated price </span>' + kwacha(c.total) + '</p>' +
          '<p class="product__est">' + (c.local ? 'Delivery confirmed on WhatsApp' : 'Estimate, delivered to Lusaka') + '</p>' +
          '<p class="product__ship"><span aria-hidden="true">' + (c.local ? '🚚' : '✈') + '</span> ' + esc(pr.shipping) + '</p>' +
          '<details class="product__breakdown"><summary>Cost breakdown</summary><dl class="breakdown">' + breakdownHTML(c) + '</dl></details>' +
          '<a class="btn btn--primary btn--sm" href="' + waBase + encodeURIComponent(msg) + '" target="_blank" rel="noopener">Order via WhatsApp<span class="visually-hidden"> – ' + esc(pr.title) + '</span></a>' +
          (link ? '<a class="product__link" href="' + esc(link) + '" target="_blank" rel="noopener sponsored">View original listing<span class="visually-hidden"> for ' + esc(pr.title) + '</span></a>' : '') +
        '</div></article></li>';
    }

    function render() {
      var list = products.filter(function (pr) {
        if (state.cat !== 'all' && pr.category !== state.cat) return false;
        if (state.q && (pr.title + ' ' + (catName[pr.category] || '')).toLowerCase().indexOf(state.q) === -1) return false;
        return true;
      });
      if (state.sort !== 'featured') {
        list = list.slice().sort(function (a, b) {
          var d = cost(a.priceCNY, a.weightKg, 1, a.priceZMW).total - cost(b.priceCNY, b.weightKg, 1, b.priceZMW).total;
          return state.sort === 'price-asc' ? d : -d;
        });
      }

      var html = list.map(card).join('');
      if (!list.length) {
        var where = state.cat === 'all' ? '' : ' in ' + catName[state.cat];
        html = '<li class="feed-empty"><p><strong>Nothing listed here' + esc(where) + ' yet.</strong> Tell us what you need and we\'ll find it.</p>' +
          '<a class="btn btn--primary btn--sm" href="' + waBase + encodeURIComponent('Hi Zed Supply, I\'m looking for: ') + '" target="_blank" rel="noopener">Ask on WhatsApp</a></li>';
      }
      feed.innerHTML = html;
      watchPhotos(feed);

      var btns = chips.querySelectorAll('.chip');
      for (var i = 0; i < btns.length; i++) btns[i].setAttribute('aria-pressed', String(btns[i].getAttribute('data-cat') === state.cat));
      countEl.textContent = list.length + (list.length === 1 ? ' product' : ' products') + (state.cat === 'all' ? '' : ' in ' + catName[state.cat]);
    }
    render();

    // Landed cost calculator
    var calc = document.getElementById('calc');
    if (calc && china) {
      var out = document.getElementById('calc-breakdown');
      var calcWa = document.getElementById('calc-whatsapp');
      var update = function () {
        var cny = parseFloat(calc.cny.value) || 0;
        var kg = parseFloat(calc.kg.value) || 0;
        var qty = Math.max(1, parseInt(calc.qty.value, 10) || 1);
        var c = cost(cny, kg, qty);
        out.innerHTML = breakdownHTML(c);
        calcWa.href = waBase + encodeURIComponent('Hi Zed Supply, please confirm a quote. Item price: ' + cny + ' CNY, weight: ' + kg + ' kg, quantity: ' + qty + '. Calculator estimate: ' + kwacha(c.total) + '. Link: ');
      };
      calc.addEventListener('input', update);
      calc.addEventListener('submit', function (e) { e.preventDefault(); update(); });
      update();
    }
  }

  /* ---------- Photos that haven't been added yet ---------- */
  function watchPhotos(scope) {
    var imgs = scope.querySelectorAll('.media img');
    for (var k = 0; k < imgs.length; k++) {
      var im = imgs[k];
      if (im.complete && im.naturalWidth === 0) markMissing(im);
      else im.addEventListener('error', function () { markMissing(this); });
    }
  }
  function markMissing(img) {
    var box = img.closest('.media');
    if (box) box.classList.add('is-missing');
  }
  watchPhotos(document);

  /* ---------- Contact form (Formspree) ---------- */
  var form = document.getElementById('quote-form');
  if (form && window.fetch && window.FormData) {
    var status = form.querySelector('.form-status');
    var button = form.querySelector('button[type="submit"]');

    form.addEventListener('submit', function (e) {
      e.preventDefault();

      if (form.action.indexOf('FORMSPREE_ENDPOINT_HERE') !== -1) {
        showStatus('error', 'This form is not connected yet. Please contact us on WhatsApp or email for now.');
        return;
      }

      button.disabled = true;
      button.textContent = 'Sending…';

      fetch(form.action, {
        method: 'POST',
        body: new FormData(form),
        headers: { Accept: 'application/json' }
      })
        .then(function (res) {
          if (!res.ok) throw new Error('Request failed');
          form.reset();
          showStatus('success', 'Thank you — your request has been sent. We will get back to you as soon as we can.');
        })
        .catch(function () {
          showStatus('error', 'Sorry, your message could not be sent. Please try again, or contact us on WhatsApp.');
        })
        .then(function () {
          button.disabled = false;
          button.textContent = 'Send my request';
        });
    });

    function showStatus(type, message) {
      status.className = 'form-status is-' + type;
      status.textContent = message;
      status.focus();
    }
  }
})();
