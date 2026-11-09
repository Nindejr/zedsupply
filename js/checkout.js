/* Zed Supply — checkout: the cart page, delivery speed, courier and payment choices, the
   review window and placing the order (on WhatsApp, or through the server when connected).

   Split from js/main.js, which loads this file first and then calls ZSModules.checkout(K) with
   the helpers both share (K). K.loc is a live view of the buyer's location, which main.js can
   replace at any time; everything else in K never changes after start-up. The delivery speed,
   courier and payment the buyer picks live here, in memory only, as before. */
(function () {
  'use strict';
  window.ZSModules = window.ZSModules || {};
  window.ZSModules.checkout = function (K) {
    var $ = K.$, $$ = K.$$, CARD_WARNING = K.CARD_WARNING, COURIERS = K.COURIERS, D = K.D, DELIVERY = K.DELIVERY;
    var OPTS = K.OPTS, PAY_ASK = K.PAY_ASK, PAY_KINDS = K.PAY_KINDS, SCOPES = K.SCOPES, VAT = K.VAT;
    var W = K.W, ZD = K.ZD, ZP = K.ZP, addressLine = K.addressLine, addresses = K.addresses, addressesOn = K.addressesOn;
    var arrivesText = K.arrivesText, bindSaved = K.bindSaved, byName = K.byName, cards = K.cards;
    var cart = K.cart, checkoutNeedsDelivery = K.checkoutNeedsDelivery, cleanText = K.cleanText, closeDialog = K.closeDialog;
    var coMode = K.coMode, collectionAt = K.collectionAt, courier = K.courier, crumbs = K.crumbs, dayLabel = K.dayLabel;
    var deliveryDays = K.deliveryDays, empty = K.empty, esc = K.esc, ext = K.ext, feeText = K.feeText;
    var fulfilLine = K.fulfilLine, hasCardNumber = K.hasCardNumber, head = K.head;
    var kwacha = K.kwacha, lineKey = K.lineKey, lineQuote = K.lineQuote, locFull = K.locFull, locSummaryHTML = K.locSummaryHTML;
    var media = K.media, newRef = K.newRef, noteBought = K.noteBought, openDialog = K.openDialog;
    var openLocation = K.openLocation, orders = K.orders, parcelLine = K.parcelLine, payByName = K.payByName;
    var payKind = K.payKind, payMethods = K.payMethods, perUnit = K.perUnit, product = K.product, provinceOf = K.provinceOf;
    var qtyAttrs = K.qtyAttrs, qtyLabel = K.qtyLabel, qtyRange = K.qtyRange, quoteArrives = K.quoteArrives;
    var rankedCouriers = K.rankedCouriers, sameDayFor = K.sameDayFor;
    var saveLoc = K.saveLoc, savedBusiness = K.savedBusiness, secureMode = K.secureMode, seller = K.seller;
    var sellerLoc = K.sellerLoc, sellerName = K.sellerName, setCart = K.setCart, setMode = K.setMode;
    var show = K.show, slotLabel = K.slotLabel, speedName = K.speedName, stockHTML = K.stockHTML, store = K.store;
    var toast = K.toast, today = K.today, townInfo = K.townInfo, tpinOK = K.tpinOK, user = K.user, variantOf = K.variantOf;
    var vatFor = K.vatFor, vatRowHTML = K.vatRowHTML, verifiedHTML = K.verifiedHTML, view = K.view;
    var waUrl = K.waUrl, weightText = K.weightText, wishedIn = K.wishedIn, zoneFor = K.zoneFor;
    var shipScope = 'town', shipChoice = '';   // this cart's courier choice; kept in memory only
    var payChoice = '';   // the customer's preferred method for this cart; kept in memory only
    var voucherChecking = '';   // the code the server is checking now, if any

    // What a voucher takes off, rounded to the kwacha as the server does: a percentage (with an
    // optional cap) or a kwacha amount, once the items reach the minimum spend
    function voucherOff(v, sub) {
      if (!v || sub < (Number(v.minSpend) || 0)) return 0;
      if (v.amount != null) return Math.min(Number(v.amount), sub);
      var off = Math.round(sub * Number(v.percent) / 100);
      return v.maxOff != null ? Math.min(off, Number(v.maxOff)) : off;
    }
    // A code from the catalogue, or one the server confirmed for this buyer (connected mode)
    function voucherFor(code) {
      if (!code) return null;
      var listed = (D.vouchers || []).filter(function (x) { return x.code === code; })[0];
      if (listed && !secureMode()) return listed;
      var checked = store.get('voucher-server', null);
      return checked && checked.code === code ? checked : null;
    }
    function voucherAbout(v) {
      if (v.label) return v.label;
      return [v.amount != null ? kwacha(v.amount) + ' off' : v.percent + '% off', v.amount == null && v.maxOff != null ? 'up to ' + kwacha(v.maxOff) : '',
        Number(v.minSpend) ? 'on orders of ' + kwacha(v.minSpend) + ' or more' : ''].filter(Boolean).join(', ');
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
      return '<fieldset class="field pay-choice" id="ship-choice"><legend>Courier</legend>' +
        '<div class="ship-scope" role="radiogroup" aria-label="Where is it going?">' + Object.keys(SCOPES).map(function (s) {
          return '<label class="chip ship-scope__opt"><input type="radio" name="co-scope" value="' + s + '"' + (s === shipScope ? ' checked' : '') + '> ' + esc(SCOPES[s]) + '</label>';
        }).join('') + '</div>' +
        (function () {
          var e = (DELIVERY.estimates || {})[shipScope];
          return e && e.length === 2 ? '<p class="pmeta ship-estimate">Usually delivered in ' + (e[0] === e[1] ? e[0] : e[0] + '–' + e[1]) + ' working day' + (e[1] === 1 ? '' : 's') + (DELIVERY.sampleEstimates ? ' (sample times)' : '') + '.</p>' : '';
        })() +
        opt('', 'Zed Supply arranges it', 'We confirm the courier and fee on WhatsApp') +
        top.map(function (c) { return opt(c.id, c.name, c.unlicensed ? 'Licence not confirmed' : ''); }).join('') +
        (rest.length ? '<div class="field"><label for="co-ship-more">Or choose another courier (' + rest.length + ')</label><select id="co-ship-more"><option value="">Choose a courier…</option>' +
          rest.map(function (c) { return '<option value="' + esc(c.id) + '"' + (shipChoice === c.id ? ' selected' : '') + '>' + esc(c.name) + (c.unlicensed ? ' (licence not confirmed)' : c.type === 'L' ? ' (local)' : '') + '</option>'; }).join('') + '</select></div>' : '') +
        '<p class="hint"><a href="help.html#couriers" target="_blank" rel="noopener noreferrer">Compare couriers<span class="visually-hidden"> (opens in a new tab)</span></a>. You pay the delivery fee we confirm on WhatsApp.</p></fieldset>';
    }
    function shipSummary() {
      var c = courier(shipChoice);
      // With priced delivery each parcel has its own route, so name the courier only
      return (ratesOn() ? 'Courier' : SCOPES[shipScope]) + ': ' + (c ? c.name + (c.licence ? ' (' + c.licence + ')' : ' (licence not confirmed)') : 'Zed Supply arranges the courier');
    }
    var shipSpeed = 'standard';   // this cart's delivery speed; kept in memory only
    function ratesOn() { return !!(ZD && DELIVERY.enabled !== false && (DELIVERY.rates || []).length); }
    // How far a parcel travels: from the seller's location, or from settings.delivery.origin
    function parcelZone(s) {
      if (!K.loc) return '';
      if (sellerLoc(s)) return zoneFor(s);
      var o = DELIVERY.origin;
      if (!o || !o.town) return '';
      if (String(o.town).trim().toLowerCase() === String(K.loc.town).trim().toLowerCase()) return 'town';
      var bp = provinceOf(K.loc);
      return bp && bp === (o.province || (townInfo(o.town) || {}).province) ? 'province' : 'country';
    }
    // One parcel per seller: its zone, weight (settings.delivery.defaultKg for items without one),
    // whether it needs a truck and whether same day is possible
    function parcelsFor(groups) {
      var dkg = Number(DELIVERY.defaultKg) || 1;
      return groups.map(function (g) {
        return { id: g.sid, zone: parcelZone(g.s), sameDay: !!sameDayFor(g.s),
          heavy: g.list.some(function (x) { return ZP.orderRules(x.it.p).heavy; }),
          kg: g.list.reduce(function (n, x) { return n + (ZP.orderRules(x.it.p).weight || dkg) * x.it.qty; }, 0) };
      });
    }
    function deliveryArgs(groups, itemsTotal, speed) {
      return { rates: DELIVERY.rates, parcels: parcelsFor(groups), speed: speed || shipSpeed, courier: shipChoice, itemsTotal: itemsTotal, free: DELIVERY.freeDelivery || {} };
    }
    function deliveryQuote(groups, itemsTotal, speed) { return ZD.quote(deliveryArgs(groups, itemsTotal, speed)); }
    // Checkout: one card per speed, with its price for this cart and when it arrives
    function speedChoiceHTML(opts) {
      if (!opts.length) return '';
      if (!opts.some(function (x) { return x.speed === shipSpeed; })) shipSpeed = opts[0].speed;
      return '<fieldset class="field speed-choice" id="speed-choice"><legend>Delivery speed</legend>' + opts.map(function (x) {
        var q = x.quote, id = 'co-speed-' + x.speed, when = quoteArrives(q);
        var price = q.pending ? (q.parcels.some(function (p) { return p.note === 'location'; }) ? 'Set your location' : 'Quoted before you pay') : feeText(q.total);
        return '<div class="speed-option"><input type="radio" name="co-speed" id="' + id + '" value="' + x.speed + '"' + (x.speed === shipSpeed ? ' checked' : '') + '>' +
          '<label for="' + id + '"><span class="speed-option__name">' + esc(x.name) + '</span>' +
          '<span class="speed-option__fee' + (q.total === 0 ? ' is-free' : '') + '">' + esc(price) + '</span>' +
          (when ? '<small>' + esc(when) + '</small>' : '') + '</label></div>';
      }).join('') + (DELIVERY.sampleRates ? '<p class="hint"><span class="tag-sample">Sample prices</span> Demo delivery prices to show how fees work, not real courier rates.</p>' : '') + '</fieldset>';
    }
    function payChoiceHTML() {
      var list = payMethods();
      if (!list.length) return '';
      var opt = function (value, label, sub, colour, note) {
        return '<div class="pay-option"><input type="radio" name="co-pay" id="co-pay-' + (value ? esc(value).replace(/\W+/g, '-').toLowerCase() : 'later') + '" value="' + esc(value) + '"' + (payChoice === value ? ' checked' : '') + '>' +
          '<label for="co-pay-' + (value ? esc(value).replace(/\W+/g, '-').toLowerCase() : 'later') + '">' + (colour ? '<span class="paychip__dot" style="--pay:' + esc(colour) + '" aria-hidden="true"></span>' : '') + esc(label) + (sub ? '<small' + (note ? ' class="pay-note"' : '') + '>' + esc(sub) + '</small>' : '') + '</label></div>';
      };
      // Mobile money shows its kind beside the name; bank, card and cash show their note underneath
      return '<fieldset class="field pay-choice"><legend>How would you like to pay?</legend>' +
        list.map(function (m) { return opt(m.name, m.name, m.note || PAY_KINDS[payKind(m)], m.colour, !!m.note); }).join('') +
        opt('', 'Decide on WhatsApp', '', '') +
        '</fieldset>';
    }

    var views = {
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
        lines.forEach(function (l) { var p = product(l.id), qty = ZP.fitQty(p, l.qty), lq = lineQuote(p, l.opt, qty), pr = lq.pr; sub += lq.q.each * qty; if (pr.was && !lq.q.commit) save += (pr.was - pr.now) * qty; items.push({ p: p, pr: pr, qty: qty, each: lq.q.each, commit: lq.q.commit, bulk: lq.q.bulk, key: lineKey(l), label: ZP.describe(p, l.opt), sku: lq.v ? lq.v.sku : "", opt: l.opt }); });
        var v = voucherFor(voucher);
        var vOff = voucherOff(v, sub);
        var total = sub - vOff;
        // VAT is usually inside the price (shown as "Includes VAT"); if settings add it on top, the total grows
        var vat = vatFor(items, total);
        if (VAT.included === false) total += vat;
        var book = addressesOn() ? addresses() : [];
        var days = DELIVERY.enabled ? deliveryDays() : [];
        var units = items.reduce(function (n, it) { return n + it.qty; }, 0), unitsText = units + (units === 1 ? ' item' : ' items');
        // Price changes since each item was added, as Amazon flags them. Shown once, then the new price is remembered.
        var changes = lines.map(function (l, i) { var it = items[i]; return l.seen != null && Math.abs(l.seen - it.each) >= 0.01 ? { it: it, was: l.seen } : null; }).filter(Boolean);
        if (changes.length) setCart(lines.map(function (l, i) { l.seen = items[i].each; return l; }));
        // Items grouped by seller: each seller packs and sends its own parcel
        var groups = [];
        items.forEach(function (it, i) {
          var sid = it.p.seller || '', g = groups.filter(function (x) { return x.sid === sid; })[0];
          if (!g) { g = { sid: sid, s: seller(sid), list: [] }; groups.push(g); }
          g.list.push({ it: it, i: i });
        });
        var lineHTML = function (it, i) {
          var v = variantOf(it.p, it.opt);
          return '<li class="line"><a class="pmedia" href="#/product/' + it.p.id + '" tabindex="-1" aria-hidden="true">' + media(it.p) + '</a><div>' +
            '<a class="line__title" href="#/product/' + it.p.id + '">' + esc(it.p.title) + '</a>' +
            (it.pr.promo && !it.commit ? '<p class="pmeta"><span class="badge">' + esc(it.pr.promo.title) + '</span></p>' : '') +
            (it.bulk ? '<p class="pmeta"><span class="badge">Bulk price</span></p>' : '') +
            (ZP.qtyRuleText(it.p) || ZP.orderRules(it.p).heavy ? '<p class="pmeta">' + esc(ZP.qtyRuleText(it.p)) + (ZP.orderRules(it.p).heavy ? (ZP.qtyRuleText(it.p) ? ' · ' : '') + '<span class="badge badge--trade">Truck delivery</span>' : '') + '</p>' : '') +
            (it.label ? '<p class="pmeta line__opts">' + esc(it.label) + (it.commit ? ' <span class="badge">Pending seller</span>' : '') + '</p>' : '') +
            stockHTML(it.p, v) +
            '<p class="line__price">' + kwacha(it.each * it.qty) + (it.qty > 1 || ZP.sellUnit(it.p) ? ' <small class="pmeta">(' + (ZP.sellUnit(it.p) ? esc(ZP.qtyText(it.p, it.qty)) + ', ' : '') + kwacha(it.each) + ' ' + perUnit(it.p) + ')</small>' : '') + '</p>' +
            '<div class="line__actions"><div class="qty"><button type="button" data-step="-1" data-target="#cq' + i + '" aria-label="Decrease quantity of ' + esc(it.p.title) + '">−</button>' +
            '<input id="cq' + i + '" ' + qtyAttrs(it.p, it.qty) + ' data-cart-qty="' + esc(it.key) + '" aria-label="Quantity of ' + esc(it.p.title) + '"><button type="button" data-step="1" data-target="#cq' + i + '" aria-label="Increase quantity of ' + esc(it.p.title) + '">+</button></div>' +
            '<button class="link-btn link-btn--danger" type="button" data-remove="' + esc(it.key) + '">Remove<span class="visually-hidden"> ' + esc(it.p.title) + '</span></button><button class="link-btn" type="button" data-save="' + esc(it.key) + '">Save for later<span class="visually-hidden">: ' + esc(it.p.title) + '</span></button></div>' +
          '</div></li>';
        };
        // Heavy or bulky items go by truck: the fee is quoted for this order, with the weight when known
        var heavy = items.filter(function (it) { return ZP.orderRules(it.p).heavy; });
        var heavyKg = heavy.reduce(function (kg, it) { return kg + ZP.orderRules(it.p).weight * it.qty; }, 0);
        var heavyText = heavy.map(function (it) { return it.p.title + ' (' + ZP.qtyText(it.p, it.qty) + ')'; }).join(', ') + (heavyKg ? ', about ' + weightText(heavyKg) + (heavy.every(function (it) { return ZP.orderRules(it.p).weight; }) ? '' : ' plus items without a listed weight') : '');
        var biz = savedBusiness();
        var step = function (n, title, body) { return '<section class="co-step" aria-labelledby="co-step-' + n + '"><h3 id="co-step-' + n + '"><span class="co-step__n" aria-hidden="true">' + n + '</span>' + title + '</h3>' + body + '</section>'; };
        var html = crumbs([['Cart']]) + head('Your cart') +
          // Subtotal and the way to checkout first, so phones don't have to scroll past every item
          '<div class="cart-top"><p><span>Subtotal (' + unitsText + '):</span> <strong>' + kwacha(sub) + '</strong></p><a class="btn btn--primary" href="#checkout-steps" data-jump="checkout-steps">Proceed to checkout</a></div>' +
          '<div id="co-free" aria-live="polite"></div>' +
          (changes.length ? '<div class="notice" role="status"><p><strong>Prices have changed since you added ' + (changes.length === 1 ? 'this item' : 'these items') + ':</strong></p><ul>' + changes.map(function (c) {
            return '<li>' + esc(c.it.p.title) + (c.it.label ? ' (' + esc(c.it.label) + ')' : '') + ': ' + (c.it.each < c.was ? 'down' : 'up') + ' from ' + kwacha(c.was) + ' to ' + kwacha(c.it.each) + ' each.</li>';
          }).join('') + '</ul></div>' : '') +
          '<div class="cart"><div>' +
            (groups.length > 1 ? '<p class="pmeta cart__split">Your items come from ' + groups.length + ' sellers, so they may arrive in separate parcels. We confirm delivery for each on WhatsApp.</p>' : '') +
            groups.map(function (g) {
              return '<section class="cart-group" aria-label="' + esc(g.s ? 'Sold by ' + g.s.name : 'Zed Supply') + '"><p class="cart-group__head">' + (g.s ? 'Sold and sent by <a href="#/store/' + esc(g.s.id) + '">' + esc(g.s.name) + '</a>' + verifiedHTML(g.s) : 'Sourced by Zed Supply') + (g.s ? '<span class="cart-group__fulfil" data-group-seller="' + esc(g.s.id) + '">' + esc(fulfilLine(g.s)) + '</span>' : '') + '</p>'+
                '<ul class="lines">' + g.list.map(function (x) { return lineHTML(x.it, x.i); }).join('') + '</ul></section>';
            }).join('') + savedHTML +
          '</div><aside class="summary" id="checkout-steps" aria-labelledby="sum-title" tabindex="-1"><h2 id="sum-title">Checkout</h2>' +
            step(1, 'Delivery or collection',
              '<fieldset class="field co-mode"><legend>How do you want this order?</legend>' +
                '<div class="check"><input type="radio" name="co-mode" id="co-mode-delivery" value="delivery"' + (coMode() === 'delivery' ? ' checked' : '') + '><label for="co-mode-delivery">Deliver it to me</label></div>' +
                '<div class="check"><input type="radio" name="co-mode" id="co-mode-collection" value="collection"' + (coMode() === 'collection' ? ' checked' : '') + '><label for="co-mode-collection">I\'ll collect it from the seller' + (groups.length > 1 ? 's' : '') + '</label></div>' +
                '<p class="form-status is-error" id="co-mode-warn" hidden></p></fieldset>' +
              '<div class="field"><label for="co-name">Your name *</label><input id="co-name" autocomplete="name" required aria-describedby="co-name-err" value="' + esc(u.name || '') + '"><p class="form-status is-error" id="co-name-err" hidden></p></div>' +
              (book.length ? '<div class="field"><label for="co-address">Saved address</label><select id="co-address"><option value="">Choose a saved address…</option>' + book.map(function (a) { return '<option value="' + esc(a.id) + '">' + esc(a.label + ': ' + addressLine(a)) + '</option>'; }).join('') + '</select><p class="hint"><a href="#/addresses">Manage addresses</a></p></div>' : '') +
              '<div class="deliver-box" id="co-loc-box"><p class="deliver-box__label">Deliver to *</p><p data-loc-summary>' + locSummaryHTML() + '</p><button class="link-btn" type="button" data-open-location aria-haspopup="dialog">Set or change delivery location</button>' +
                (addressesOn() ? ' · <button class="link-btn" type="button" id="co-save-address">Save to my addresses</button>' : '') + '<p class="form-status is-error" id="co-loc-err" hidden></p></div>' +
              ext('checkoutCollect') +
              '<div id="speed-wrap"></div>' +
              '<div id="ship-wrap">' + shipChoiceHTML() + '</div>' +
              (heavy.length ? '<div class="notice notice--freight" id="co-freight"><p><strong>Truck delivery:</strong> ' + esc(heavyText) + '.</p><p class="pmeta">We quote the delivery fee for these before you pay, or you can collect.' + (COURIERS.length && heavy.length < items.length ? ' The courier choice above is for your other items.' : '') + '</p></div>' : '') +
              (days.length ? '<fieldset class="field co-when"><legend>Preferred delivery day and time</legend><div class="field-row">' +
                '<div class="field"><label for="co-day">Day</label><select id="co-day"><option value="">Any day</option>' + days.map(function (d) { return '<option value="' + d.iso + '">' + esc(d.label) + '</option>'; }).join('') + '</select></div>' +
                '<div class="field"><label for="co-slot">Time</label><select id="co-slot"><option value="">Any time</option>' + (DELIVERY.slots || []).map(function (s) { return '<option value="' + esc(s.id) + '">' + esc(s.label) + '</option>'; }).join('') + '</select></div></div>' +
                '<p class="hint">A preference, not a booking: we confirm the day and time with you and the seller on WhatsApp.</p></fieldset>' : '') +
              (OPTS.gifts ? '<div class="check"><input type="checkbox" id="co-gift"><label for="co-gift">This order is a gift</label></div>' +
                '<div class="co-gift" id="co-gift-box" hidden><div class="field"><label for="co-gift-msg">Gift message (optional)</label><textarea id="co-gift-msg" maxlength="250" rows="3" placeholder="e.g. Happy birthday, Mum!"></textarea></div>' +
                '<div class="check"><input type="checkbox" id="co-gift-noprice" checked><label for="co-gift-noprice">Leave prices out of the parcel</label></div></div>' : '') +
              '<div class="field"><label for="co-note">Notes for your order (optional)</label><input id="co-note" placeholder="e.g. Call when you reach the gate"></div>' +
              '<div class="check"><input type="checkbox" id="co-biz"' + (biz.name ? ' checked' : '') + '><label for="co-biz">I\'m buying for a business</label></div>' +
              '<fieldset class="co-biz" id="co-biz-box"' + (biz.name ? '' : ' hidden') + '><legend class="visually-hidden">Business details</legend>' +
                '<div class="field"><label for="co-biz-name">Business name *</label><input id="co-biz-name" autocomplete="organization" maxlength="120" value="' + esc(biz.name || '') + '" aria-describedby="co-biz-err"></div>' +
                '<div class="field"><label for="co-biz-tpin">TPIN (optional)</label><input id="co-biz-tpin" inputmode="numeric" maxlength="10" value="' + esc(biz.tpin || '') + '" aria-describedby="co-biz-tpin-hint co-biz-err"><p class="hint" id="co-biz-tpin-hint">Your 10-digit ZRA taxpayer number, shown on your order summary.</p></div>' +
                '<div class="field"><label for="co-biz-addr">Billing address (optional)</label><input id="co-biz-addr" autocomplete="street-address" maxlength="200" value="' + esc(biz.address || '') + '"></div>' +
                '<p class="form-status is-error" id="co-biz-err" hidden></p><p class="hint"><a href="#/account">Save business details in My Account</a></p></fieldset>') +
            step(2, 'Payment',
              payChoiceHTML() + ext('checkoutPayment', total) +
              '<form class="voucher" id="voucher-form"><label for="voucher" class="visually-hidden">Voucher code</label><input id="voucher" placeholder="Voucher code" value="' + esc(voucher) + '" autocapitalize="characters"><button class="btn btn--secondary btn--sm" type="submit">Apply</button></form>' +
              (voucher && voucherChecking === voucher ? '<p class="form-status" role="status">Checking ' + esc(voucher) + '…</p>' :
                voucher && !v ? '<p class="form-status is-error">' + esc(store.get('voucher-why', '') || 'That voucher code isn\'t valid.') + '</p>' : '') +
              (v && vOff ? '<p class="form-status is-success">' + esc(v.code) + ' applied: ' + esc(voucherAbout(v)) + '. <button class="link-btn" type="button" id="voucher-remove">Remove</button></p>' : '') +
              (v && !vOff ? '<p class="form-status is-error">' + esc(v.code) + ' needs a minimum spend of ' + kwacha(v.minSpend) + '.</p>' : '')) +
            step(3, 'Review and place your order',
              '<div id="co-totals" aria-live="polite"></div>' +
              (secureMode() ? '<div class="field"><label for="co-phone">Recipient phone (+260…)</label><input id="co-phone" type="tel" autocomplete="tel" required value="' + esc(u.phone || '') + '"></div>' : '') +
              '<fieldset class="field co-receipt"><legend>Send my receipt to</legend>' +
                (secureMode() ? '' : '<div class="field"><label for="co-rc-wa">WhatsApp number (optional)</label><input id="co-rc-wa" type="tel" autocomplete="tel" inputmode="tel" maxlength="20" placeholder="+260 97…" value="' + esc(u.phone || '') + '"></div>') +
                '<div class="field"><label for="co-rc-email">Email (optional)</label><input id="co-rc-email" type="email" autocomplete="email" maxlength="200" value="' + esc(u.email || '') + '" aria-describedby="co-rc-err"><p class="form-status is-error" id="co-rc-err" hidden></p></div>' +
                '<p class="hint">Your receipt is ready to download as soon as you place the order, and you can send it again from the order page.</p></fieldset>' +
              (secureMode() ? '<a class="btn btn--primary btn--block" id="checkout" href="#" target="_blank" rel="noopener noreferrer">Review server total</a>'
                : '<button class="btn btn--primary btn--block" type="button" id="co-review" aria-haspopup="dialog">Review and place order</button>') +
              '<div id="server-checkout-review" aria-live="polite"></div>' +
              '<p class="pmeta">' + (ratesOn() ? 'Check everything in the next step before you place the order. ' : '') + 'Your order reaches us when you press Send in WhatsApp. We confirm it there, then send payment instructions. We never ask for your PIN.</p>' +
              '<p class="pmeta">By placing your order you agree to our <a href="privacy.html">privacy policy</a> and <a href="help.html#returns">returns and buyer protection</a>.</p>') +
            '<button class="link-btn link-btn--danger" type="button" id="clear-cart">Empty cart</button>' +
          '</aside></div>' +
          // Review before buying: everything in one window, then the button that places the order
          (secureMode() ? '' : '<dialog class="co-review" id="co-review-dialog" aria-labelledby="co-review-title">' +
            '<div class="co-review__head"><p id="co-review-title">Review your order</p><button class="icon-btn" type="button" data-close-dialog aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>' +
            '<div class="co-review__body" id="co-review-body"></div>' +
            '<div class="co-review__foot"><a class="btn btn--primary btn--block" id="checkout" href="#" target="_blank" rel="noopener noreferrer">Place order and send on WhatsApp</a>' +
            '<button class="btn btn--secondary btn--block" type="button" data-close-dialog>Keep editing</button>' +
            '<p class="pmeta">WhatsApp opens with your order: press Send so it reaches us. Your receipt opens here straight away.</p></div></dialog>');
        show(html, 'Cart');

        var ref = newRef('ZS');
        var co = $('#checkout');
        var chosenAddress = null;
        // Delivery: only the parcels that are delivered (a seller without collection still delivers)
        var deliveryGroups = function () { return coMode() === 'collection' ? groups.filter(function (g) { return !collectionAt(g.s); }) : groups; };
        var dq = null;   // the delivery quote for the current choices
        var liveQuoteId = null, liveFrom = '', liveSeq = 0;   // a courier's live price, saved on the server
        var deliveryKnown = function () { return ratesOn() && (!deliveryGroups().length || !!(dq && !dq.pending)); };
        var grand = function () { return total + (dq && !dq.pending ? dq.total : 0); };
        var deliveryMsg = function () {
          if (!dq || dq.pending) return '';
          return '\nDelivery (' + speedName(dq.speed) + '): ' + feeText(dq.total) + (dq.parcels.length > 1 ? ' [' + dq.parcels.map(function (p) { return sellerName(p.id) + ' ' + speedName(p.speed).toLowerCase() + ' ' + feeText(p.fee); }).join('; ') + ']' : '');
        };
        var totalsHTML = function () {
          var dg = deliveryGroups(), rows;
          if (!dg.length) rows = '<div><dt>Collection</dt><dd>No delivery fee</dd></div>';
          else if (!ratesOn()) rows = '<div><dt>Delivery</dt><dd>' + (heavy.length ? 'Truck delivery quoted' : 'Confirmed on WhatsApp') + '</dd></div>';
          else if (!K.loc) rows = '<div><dt>Delivery</dt><dd>Set your location</dd></div>';
          else if (!dq || dq.pending) rows = '<div><dt>Delivery</dt><dd>Quoted before you pay</dd></div>';
          else {
            rows = '<div' + (dq.total === 0 ? ' class="is-save"' : '') + '><dt>Delivery · ' + esc(speedName(dq.speed)) + (dq.parcels.length > 1 ? ' (' + dq.parcels.length + ' parcels)' : '') + '</dt><dd>' + feeText(dq.total) + '</dd></div>';
            if (dq.parcels.length > 1 || dq.parcels.some(function (p) { return p.speed !== dq.speed; }))
              rows += dq.parcels.map(function (p) { return '<div class="totals__sub"><dt>' + esc(sellerName(p.id)) + ' · ' + esc(speedName(p.speed)) + '</dt><dd>' + feeText(p.fee, p.free) + '</dd></div>'; }).join('');
          }
          return '<dl class="totals"><div><dt>Items (' + units + ')</dt><dd>' + kwacha(sub) + '</dd></div>' +
            (save ? '<div class="is-save"><dt>You save</dt><dd>' + kwacha(save) + '</dd></div>' : '') +
            (vOff ? '<div class="is-save"><dt>Voucher ' + esc(v.code) + '</dt><dd>−' + kwacha(vOff) + '</dd></div>' : '') +
            (VAT.included === false ? vatRowHTML(vat) : '') + rows +
            '<div class="is-total"><dt>' + (deliveryKnown() ? 'Order total' : 'Estimated total') + '</dt><dd>' + kwacha(deliveryKnown() ? grand() : total) + '</dd></div>' +
            (VAT.included === false ? '' : vatRowHTML(vat)) + '</dl>' +
            (dq && dq.parcels.some(function (p) { return p.note === 'fallback'; }) ? '<p class="pmeta">Some parcels can\'t go at that speed, so they go at the next fastest.</p>' : '') +
            (liveQuoteId ? '<p class="pmeta live-price">Live price from ' + esc(liveFrom) + ', held for 30 minutes.</p>' : '');
        };
        // Amazon-style nudge: how much more for free standard delivery
        var freeBarHTML = function () {
          var f = DELIVERY.freeDelivery || {}, dg = deliveryGroups();
          if (!ratesOn() || !K.loc || !dg.length || f.min == null) return '';
          var sq = deliveryQuote(dg, total, 'standard');
          if (sq.freeGap) return '<div class="free-bar"><p>Add <strong>' + kwacha(sq.freeGap) + '</strong> more for <strong>FREE standard delivery</strong>.</p>' +
            '<div class="free-bar__track" aria-hidden="true"><span style="width:' + Math.max(4, Math.min(100, Math.round(total / f.min * 100))) + '%"></span></div></div>';
          if (sq.parcels.some(function (p) { return p.free; })) return '<p class="free-bar is-done">Your order qualifies for <strong>FREE standard delivery</strong>' + (shipSpeed !== 'standard' ? ' if you choose Standard' : '') + '.</p>';
          return '';
        };
        var renderDelivery = function () {
          var dg = deliveryGroups(), on = ratesOn() && dg.length > 0, sw = $('#speed-wrap');
          if (sw) sw.innerHTML = on ? speedChoiceHTML(ZD.options(deliveryArgs(dg, total))) : '';
          dq = on && K.loc ? deliveryQuote(dg, total) : null;
          liveQuoteId = null; liveFrom = '';
          var seq = ++liveSeq;
          $('#co-totals').innerHTML = totalsHTML();
          $('#co-free').innerHTML = freeBarHTML();
          // With a courier chosen, the server asks that courier for its live price when it's connected
          if (dq && !dq.pending && shipChoice) ext('deliveryLive', { items: items, buyer_town: K.loc.town, buyer_province_id: provinceOf(K.loc), fulfilment: coMode(),
            delivery_speed: shipSpeed, courier_id: shipChoice, items_total_zmw: total, apply: function (r) {
              if (seq !== liveSeq || !speedWrap || !speedWrap.isConnected || !r || !r.quote_id || !Array.isArray(r.parcels)) return;
              dq = { speed: r.speed || shipSpeed, total: r.total == null ? null : Number(r.total), pending: !!r.pending, freeGap: dq ? dq.freeGap : null, free: Number(r.total) === 0,
                parcels: r.parcels.map(function (p) { return { id: p.seller_id, zone: p.zone, speed: p.speed, fee: p.fee == null ? null : Number(p.fee), free: !!p.free, pending: !!p.pending,
                  days: p.min_days != null && p.max_days != null ? [p.min_days, p.max_days] : null, note: p.note || '', courier: p.courier_id || '' }; }) };
              liveQuoteId = r.quote_id; liveFrom = (courier(shipChoice) || {}).name || 'the courier';
              $('#co-totals').innerHTML = totalsHTML(); syncCo();
            } });
        };
        renderDelivery();
        var speedWrap = $('#speed-wrap');
        if (speedWrap) speedWrap.addEventListener('change', function (e) {
          if (e.target.name !== 'co-speed') return;
          shipSpeed = e.target.value; renderDelivery(); syncCo();
          var again = $('input[name="co-speed"][value="' + shipSpeed + '"]', speedWrap); if (again) again.focus();
        });
        var receiptTo = function () { var w = $('#co-rc-wa'), m = $('#co-rc-email'); return { whatsapp: w ? cleanText(w.value, 20) : '', email: m ? m.value.trim() : '' }; };
        // The parcels as they stand now, kept with the order for the receipt and tracking
        var parcelsNow = function () {
          return dq ? dq.parcels.map(function (p) { return { seller: p.id, zone: p.zone, speed: p.speed, fee: p.fee, free: p.free, pending: p.pending, days: p.days, eta: arrivesText(p.days), courier: p.courier || shipChoice || '' }; }) : [];
        };
        var reviewHTML = function () {
          var col = coMode() === 'collection', g = gift(), pm = payChoice ? payByName(payChoice) : null;
          return '<section class="review-block"><h3>' + (col ? 'Collecting' : 'Delivering to') + '</h3><p><strong>' + esc($('#co-name').value.trim()) + '</strong><br>' + esc(locFull() || 'Location to be confirmed') + '</p>' +
              (chosenAddress && chosenAddress.instructions ? '<p class="pmeta">' + esc(chosenAddress.instructions) + '</p>' : '') + '</section>' +
            '<section class="review-block"><h3>Items</h3><ul class="review-items">' + items.map(function (it) {
              return '<li><span class="review-items__name">' + esc(it.p.title) + (it.label ? '<small>' + esc(it.label) + '</small>' : '') + '<small>' + esc(qtyLabel(it.p, it.qty)) + ' × ' + kwacha(it.each) + ' · sold by ' + esc(sellerName(it.p.seller)) + '</small></span><strong>' + kwacha(it.each * it.qty) + '</strong></li>';
            }).join('') + '</ul></section>' +
            (dq && !dq.pending && deliveryGroups().length ? '<section class="review-block"><h3>Delivery</h3><ul class="review-parcels">' + parcelsNow().map(function (p) {
              return '<li><span>' + parcelLine(p) + '</span><strong>' + feeText(p.fee, p.free) + '</strong></li>'; }).join('') + '</ul></section>'
              : heavy.length && !col ? '<section class="review-block"><h3>Truck delivery</h3><p>' + esc(heavyText) + '. We quote this before you pay.</p></section>' : '') +
            '<section class="review-block"><h3>Payment</h3><p>' + esc(payChoice || 'Decide on WhatsApp') + (pm && pm.note ? '<br><span class="pmeta">' + esc(pm.note) + '</span>' : '') + '</p></section>' +
            (g.on ? '<section class="review-block"><h3>Gift</h3><p>' + (g.message ? '“' + esc(g.message) + '”' : 'Yes') + (g.noPrice ? '<br><span class="pmeta">Prices left out of the parcel</span>' : '') + '</p></section>' : '') +
            '<section class="review-block review-block--totals">' + totalsHTML() + '</section>';
        };
        var when = function () { return { day: $('#co-day') ? $('#co-day').value : '', slot: $('#co-slot') ? $('#co-slot').value : '' }; };
        var business = function () {
          return $('#co-biz').checked ? { name: cleanText($('#co-biz-name').value, 120), tpin: $('#co-biz-tpin').value.replace(/\s+/g, ''), address: cleanText($('#co-biz-addr').value, 200) } : null;
        };
        var gift = function () {
          var on = !!($('#co-gift') && $('#co-gift').checked);
          return { on: on, message: on ? cleanText($('#co-gift-msg').value, 250) : '', noPrice: on && $('#co-gift-noprice').checked };
        };
        var buildMsg = function () {
          var m = 'Hi Zed Supply, I\'d like to place an order (ref ' + ref + '):\n' +
            items.map(function (it, i) { return (i + 1) + '. ' + it.p.title + ' (' + it.p.id + (it.sku ? ', SKU ' + it.sku : '') + ')' + (it.label ? ' [' + it.label + ']' : '') + ' x ' + qtyLabel(it.p, it.qty) + ' = ' + kwacha(it.each * it.qty) + (it.commit ? ' (my offer, pending the seller)' : ''); }).join('\n') +
            (vOff ? '\nVoucher ' + v.code + ': -' + kwacha(vOff) : '') + deliveryMsg() + (deliveryKnown() ? '\nOrder total: ' + kwacha(grand()) : '\nEstimated total: ' + kwacha(total)) +
            (vat ? (VAT.included === false ? ' (with VAT ' + VAT.rate + '%: ' + kwacha(vat) + ')' : ' (includes VAT ' + VAT.rate + '%: ' + kwacha(vat) + ')') : '');
          var nm = $('#co-name').value.trim(), note = $('#co-note').value.trim(), w = when();
          if (nm) m += '\nName: ' + nm;
          var b = business();
          if (b && b.name) m += '\nBusiness: ' + b.name + (b.tpin ? ', TPIN ' + b.tpin : '') + (b.address ? '\nBilling address: ' + b.address : '');
          if (chosenAddress && chosenAddress.phone) m += '\nRecipient phone: ' + chosenAddress.phone;
          if (chosenAddress && chosenAddress.instructions) m += '\nDelivery instructions: ' + chosenAddress.instructions;
          if (note) m += '\nNotes: ' + note;
          if (coMode() === 'collection') {
            // Where to collect each seller's parcel; a seller without collection delivers instead
            m += '\nCollection: I\'ll collect' + groups.map(function (g) {
              var c = collectionAt(g.s);
              return '\n- ' + (g.s ? g.s.name : 'Zed Supply') + ': ' + (c ? [c.collection.address, c.town].filter(Boolean).join(', ') + (c.collection.hours ? ' (' + c.collection.hours + ')' : '') : 'no collection, please deliver');
            }).join('');
          } else if (COURIERS.length) m += '\nDelivery: ' + shipSummary();
          if (heavy.length && coMode() !== 'collection') m += '\nTruck delivery needed: ' + heavyText;
          if (w.day || w.slot) m += '\nPreferred delivery: ' + [w.day ? dayLabel(w.day) : 'any day', w.slot ? slotLabel(w.slot) : 'any time'].join(', ');
          var g = gift();
          if (g.on) m += '\nGift: yes' + (g.noPrice ? ', leave prices out of the parcel' : '') + (g.message ? '\nGift message: ' + g.message : '');
          if (payChoice) { var pm = payByName(payChoice); m += '\nPayment: ' + payChoice + (pm && PAY_ASK[payKind(pm)] ? ' (' + PAY_ASK[payKind(pm)] + ')' : ''); }
          return m + ext('checkoutMessage', total);
        };
        // data-wa-message lets refreshLoc() update the link when the delivery location changes
        var syncCo = function () { var m = buildMsg(); co.setAttribute('data-wa-message', m); co.href = waUrl(m); };
        ext('checkoutReady', { sync: function () { syncCo(); }, total: total, payChoice: function () { return payChoice; }, ref: ref });
        ['co-name', 'co-note', 'co-biz-name', 'co-biz-tpin', 'co-biz-addr'].forEach(function (id) { $('#' + id).addEventListener('input', syncCo); });
        $('#co-biz').addEventListener('change', function () { $('#co-biz-box').hidden = !this.checked; if (this.checked) $('#co-biz-name').focus(); syncCo(); });
        $('#co-name').addEventListener('input', function () { if (this.value.trim()) { $('#co-name-err').hidden = true; this.removeAttribute('aria-invalid'); } });
        ['co-day', 'co-slot', 'co-gift-noprice'].forEach(function (id) { var el = $('#' + id); if (el) el.addEventListener('change', syncCo); });
        var giftMsg = $('#co-gift-msg'); if (giftMsg) giftMsg.addEventListener('input', syncCo);
        var giftBox = $('#co-gift');
        if (giftBox) giftBox.addEventListener('change', function () { $('#co-gift-box').hidden = !giftBox.checked; if (giftBox.checked) $('#co-gift-msg').focus(); syncCo(); });
        // A saved address fills in where to deliver (and the name, if empty)
        var addrSel = $('#co-address');
        if (addrSel) addrSel.addEventListener('change', function () {
          chosenAddress = addresses().filter(function (a) { return a.id === addrSel.value; })[0] || null;
          if (chosenAddress) {
            saveLoc({ town: chosenAddress.town, area: chosenAddress.area, landmark: chosenAddress.landmark,
              province: chosenAddress.province, mode: coMode(), remember: !!(K.loc && K.loc.remember) });
            if (!$('#co-name').value.trim() && chosenAddress.recipient) { $('#co-name').value = chosenAddress.recipient; $('#co-name').dispatchEvent(new Event('input')); }
          }
          syncCo();
        });
        if (addrSel) {
          // Show which saved address is in use; with no location yet, start from the default one
          var book2 = addresses(), match = K.loc && book2.filter(function (a) { return a.town === K.loc.town && a.area === K.loc.area && a.landmark === K.loc.landmark; })[0];
          var start = match || (!K.loc && book2.filter(function (a) { return a.isDefault; })[0]);
          if (start) { addrSel.value = start.id; if (match) { chosenAddress = match; } else addrSel.dispatchEvent(new Event('change')); }
        }
        // Delivery or collection for this order: courier choice only applies to delivery, and the
        // seller lines and the WhatsApp message follow the choice
        var syncMode = function () {
          var col = coMode() === 'collection', shipBox = $('#ship-wrap'), warn = $('#co-mode-warn');
          if (shipBox) shipBox.hidden = col;
          $$('[data-group-seller]').forEach(function (el) { el.textContent = fulfilLine(seller(el.getAttribute('data-group-seller'))); });
          var noCollect = groups.filter(function (g) { return g.s && !collectionAt(g.s); }).map(function (g) { return g.s.name; });
          warn.hidden = !(col && noCollect.length);
          warn.textContent = col && noCollect.length ? noCollect.join(' and ') + (noCollect.length === 1 ? ' doesn\'t' : ' don\'t') + ' offer collection, so ' + (noCollect.length === 1 ? 'that parcel' : 'those parcels') + ' will be delivered.' : '';
          $('#co-loc-box .deliver-box__label').textContent = col ? 'Your location (to find collection points near you)' : 'Deliver to *';
          renderDelivery();
          syncCo();
        };
        $$('input[name="co-mode"]', view).forEach(function (r) { r.addEventListener('change', function () { setMode(r.value); syncMode(); }); });
        syncMode();
        var saveAddr = $('#co-save-address');
        if (saveAddr) saveAddr.addEventListener('click', function () {
          if (!K.loc) { openLocation(); return; }
          var list = addresses(), max = (OPTS.addresses && OPTS.addresses.max) || 10;
          if (list.some(function (a) { return a.town === K.loc.town && a.area === K.loc.area && a.landmark === K.loc.landmark; })) { toast('That address is already saved. <a href="#/addresses">Manage addresses</a>'); return; }
          if (list.length >= max) { toast('You have ' + max + ' saved addresses. Remove one first. <a href="#/addresses">Manage addresses</a>', 'warn'); return; }
          list.push({ id: newRef('A'), label: list.length ? 'Address ' + (list.length + 1) : 'Home', recipient: $('#co-name').value.trim(), phone: '', town: K.loc.town, area: K.loc.area, landmark: K.loc.landmark, instructions: '', isDefault: !list.length });
          store.set('addresses', list);
          toast('Address saved. <a href="#/addresses">Name or edit it</a>', 'success');
        });
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
          renderDelivery();
          syncCo();
        });
        syncCo();
        var checkReady = function () {
          var reserved = {}, unavailable = items.some(function (it) {
            if (!ZP.hasOptions(it.p)) return false;
            var current = variantOf(it.p, it.opt);
            if (!current) return true;
            var key = JSON.stringify([it.p.id, current.sku]);
            reserved[key] = (reserved[key] || 0) + it.qty;
            return reserved[key] > current.stock;
          });
          if (unavailable) { toast('A variation is unavailable or its quantity exceeds stock. Update your cart before checkout.', 'error'); return false; }
          if (hasCardNumber($('#co-name').value + ' ' + $('#co-note').value + ' ' + gift().message + ' ' + $('#co-biz-addr').value)) { toast(esc(CARD_WARNING), 'error'); $('#co-note').focus(); return false; }
          // Like an address on Amazon: a name and a delivery location are needed before the order goes
          var nameEl = $('#co-name'), nameErr = $('#co-name-err'), locErr = $('#co-loc-err');
          // A location is needed to deliver; collecting needs only a name
          var noName = !nameEl.value.trim(), noLoc = !K.loc && checkoutNeedsDelivery(groups, coMode());
          nameErr.hidden = !noName; nameErr.textContent = noName ? 'Enter your name.' : '';
          nameEl.setAttribute('aria-invalid', String(noName));
          locErr.hidden = !noLoc; locErr.textContent = noLoc ? 'Set where to deliver, so we can quote the delivery fee.' : '';
          var b = business(), bizErr = $('#co-biz-err'), bizMsg = b && !b.name ? 'Enter the business name, or untick "I\'m buying for a business".' : b && !tpinOK(b.tpin) ? 'Enter the TPIN as 10 digits, or leave it empty.' : '';
          bizErr.hidden = !bizMsg; bizErr.textContent = bizMsg;
          $('#co-biz-name').setAttribute('aria-invalid', String(!!(b && !b.name)));
          $('#co-biz-tpin').setAttribute('aria-invalid', String(!!(b && b.name && !tpinOK(b.tpin))));
          var rc = receiptTo(), rcErr = $('#co-rc-err'), badMail = !!rc.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(rc.email);
          rcErr.hidden = !badMail; rcErr.textContent = badMail ? 'Enter an email address like name@example.com, or leave it empty.' : '';
          $('#co-rc-email').setAttribute('aria-invalid', String(badMail));
          if (noName || noLoc || bizMsg || badMail) {
            if (noName) nameEl.focus(); else if (noLoc) $('#co-loc-box [data-open-location]').focus(); else if (bizMsg) $(b.name ? '#co-biz-tpin' : '#co-biz-name').focus(); else $('#co-rc-email').focus();
            return false;
          }
          return true;
        };
        var reviewBtn = $('#co-review'), reviewDlg = $('#co-review-dialog');
        if (reviewBtn) reviewBtn.addEventListener('click', function () {
          if (!checkReady()) return;
          syncCo();
          $('#co-review-body').innerHTML = reviewHTML();
          co.textContent = deliveryKnown() ? 'Place order · ' + kwacha(grand()) : 'Place order and send on WhatsApp';
          openDialog(reviewDlg);
        });
        co.addEventListener('click', function (e) {
          // A second click on the same order (double click) sends nothing more
          if (orders().some(function (o) { return o.ref === ref; })) { e.preventDefault(); return; }
          if (!checkReady()) { e.preventDefault(); if (reviewDlg && reviewDlg.open) closeDialog(reviewDlg); return; }
          var nameEl = $('#co-name'), b = business();
          if (secureMode()) {
            e.preventDefault();
            ext('serverCheckout', { ref: ref, items: items, contact_name: nameEl.value.trim(), recipient_phone: $('#co-phone').value.trim(),
              fulfilment: coMode(), buyer_town: K.loc ? K.loc.town : '', buyer_province_id: K.loc ? provinceOf(K.loc) : '', deliver_to: locFull(),
              payment_method: (payByName(payChoice) || {}).id || '', notes: $('#co-note').value.trim(), voucher_code: voucher,
              preferred_date: when().day, preferred_slot: when().slot, is_gift: gift().on, gift_message: gift().message, hide_prices: gift().noPrice,
              business_name: b ? b.name : '', business_tpin: b ? b.tpin : '', business_address: b ? b.address : '',
              delivery_scope: shipScope, courier_id: shipChoice, delivery_speed: shipSpeed, receipt_email: receiptTo().email, delivery_quote_id: liveQuoteId || undefined,
              expected_delivery_zmw: deliveryKnown() && deliveryGroups().length ? dq.total : undefined });
            return;
          }
          var list = orders();
          list.unshift({ ref: ref, date: today, items: items.map(function (it) { return it.opt ? { id: it.p.id, qty: it.qty, price: it.each, opt: it.opt, label: it.label } : { id: it.p.id, qty: it.qty, price: it.each }; }), total: deliveryKnown() ? grand() : total, status: 0, deliverTo: locFull(), pay: payChoice, ship: COURIERS.length ? shipSummary() : '', shipId: shipChoice, message: co.getAttribute('data-wa-message'), vat: vat, when: when(), gift: gift().on ? gift() : null, addressId: chosenAddress ? chosenAddress.id : '', mode: coMode(), business: b, freight: heavy.length && coMode() !== 'collection' ? heavyText : '',
            name: nameEl.value.trim(), sub: sub, save: save, voucher: vOff ? { code: v.code, off: vOff } : null, itemsTotal: total, vatRate: vat ? VAT.rate : null, vatIncluded: VAT.included,
            delivery: ratesOn() ? { speed: shipSpeed, fee: dq && !dq.pending ? dq.total : null, pending: !deliveryKnown(), parcels: parcelsNow(), sample: !!DELIVERY.sampleRates } : null,
            receipt: receiptTo(), wished: wishedIn(items.map(function (it) { return it.p.id; })) });
          noteBought(items.map(function (it) { return it.p.id; }));
          store.set('orders', list);
          setCart([]);
          store.set('voucher', '');
          setTimeout(function () { location.hash = '#/order/' + ref + '?placed=1'; }, 400);
        });
        $$('[data-cart-qty]', view).forEach(function (inp) {
          inp.addEventListener('change', function () {
            var c = cart();
            var fixed = null;
            c.forEach(function (l) {
              if (lineKey(l) !== inp.getAttribute('data-cart-qty')) return;
              var lp = product(l.id); l.qty = ZP.fitQty(lp, inp.value);
              if (String(l.qty) !== String(inp.value).trim()) fixed = 'Quantity set to ' + esc(qtyLabel(lp, l.qty)) + ': choose ' + esc(qtyRange(lp)) + '.';
            });
            setCart(c); views.cart();
            if (fixed) toast(fixed, 'warn');
          });
          inp.addEventListener('input', function (e) { if (e.isTrusted === false) inp.dispatchEvent(new Event('change')); });
        });
        $('#voucher-form').addEventListener('submit', function (e) {
          e.preventDefault();
          var code = $('#voucher').value.trim().toUpperCase();
          store.set('voucher', code); store.set('voucher-server', null); store.set('voucher-why', '');
          // Connected: every code needs the server's current eligibility and discount.
          voucherChecking = code && !voucherFor(code) && ext('voucherCheck', code, function (r) {
            if (store.get('voucher', '') !== code) return;
            voucherChecking = '';
            store.set('voucher-server', r.voucher || null); store.set('voucher-why', r.reason || '');
            if (location.hash.indexOf('#/cart') === 0) views.cart();
          }) ? code : '';
          views.cart();
        });
        var vRemove = $('#voucher-remove');
        if (vRemove) vRemove.addEventListener('click', function () { store.set('voucher', ''); store.set('voucher-server', null); store.set('voucher-why', ''); views.cart(); });
        bindSaved();
      }
    };
    return { cart: function () { return views.cart.apply(null, arguments); } };
  };
})();
