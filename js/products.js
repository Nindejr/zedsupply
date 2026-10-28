/* Zed Supply — product model: attributes, variants, in-the-box add-ons, buyer commit
   pricing and rating summaries. The field names are documented in js/catalogue.js
   (Products) and match the server schema in db/migrations/.

   No DOM here. js/main.js renders; this file reads, checks and prices.

   Listings API (prototype): sellers' new and edited products are kept in this browser
   until shared accounts arrive. Each call checks the listing first and returns
   { ok: true, product } or { ok: false, errors: [{ field, message }] }:
     ZSProduct.listings(store).list(sellerId)     every listing saved by that seller
     ZSProduct.listings(store).get(id)
     ZSProduct.listings(store).create(draft, ctx)
     ZSProduct.listings(store).update(id, draft, ctx)
     ZSProduct.listings(store).remove(id)
   ctx: { departments, brands, products } from the catalogue, used by the checks. */
(function () {
  'use strict';

  var UNITS = {
    ml: { dim: 'volume', base: 1, label: 'ml', name: 'Millilitres (ml)' },
    l:  { dim: 'volume', base: 1000, label: 'l', name: 'Litres (l)' },
    g:  { dim: 'mass', base: 1, label: 'g', name: 'Grams (g)' },
    kg: { dim: 'mass', base: 1000, label: 'kg', name: 'Kilograms (kg)' },
    mm: { dim: 'length', base: 1, label: 'mm', name: 'Millimetres (mm)' },
    cm: { dim: 'length', base: 10, label: 'cm', name: 'Centimetres (cm)' },
    m:  { dim: 'length', base: 1000, label: 'm', name: 'Metres (m)' },
    in: { dim: 'length', base: 25.4, label: 'in', name: 'Inches (in)' }
  };
  var AGES = [['infant', 'Infant'], ['kid', 'Kid'], ['teen', 'Teen'], ['adult', 'Adult'], ['senior', 'Senior']];
  var AGE_IDS = AGES.map(function (a) { return a[0]; });
  var STOCK = ['in', 'low', 'request'];
  var FIELDS = ['colour', 'size', 'ageRange', 'inBox', 'manufacturer', 'specs'];
  var LOW_STOCK = 3;           // a variant with this many or fewer shows "Only n left"
  // Fields the seller form owns; everything else on a product is left as it was
  var EDITED = ['title', 'category', 'brand', 'priceZMW', 'wasZMW', 'stock', 'image', 'alt', 'tags', 'description', 'attributes', 'options', 'variants', 'inBox', 'commit'];

  function num(v) { var n = Number(v); return isFinite(n) ? n : NaN; }
  function money(v) { return Math.round((num(v) + Number.EPSILON) * 100) / 100; }
  function validMoney(v) { var n = num(v); return n >= 0 && n <= 9999999999.99 && Math.abs(n * 100 - Math.round(n * 100)) < 0.0001; }
  function validMeasure(v) { var n = num(v); return n > 0 && n <= 9999999.999 && Math.abs(n * 1000 - Math.round(n * 1000)) < 0.000001; }
  function text(v, max) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max || 200); }
  function copy(o) { return JSON.parse(JSON.stringify(o)); }

  /* ---------- Sizes ---------- */
  // '1.7 l', '500 ml', or a plain label such as 'XL' or '42'
  function sizeLabel(s) {
    if (s == null || s === '') return '';
    if (typeof s === 'object') return UNITS[s.unit] ? String(+s.value) + ' ' + UNITS[s.unit].label : '';
    return String(s);
  }
  // Reads '500 ml' or '1.5l' as { value, unit }; anything else stays a label
  function parseSize(v) {
    var m = String(v).trim().match(/^(\d+(?:\.\d+)?)\s*(ml|l|g|kg|mm|cm|m|in)$/i);
    return m ? { value: Number(m[1]), unit: m[2].toLowerCase() } : text(v, 20);
  }
  function sizeBase(s) { return s && typeof s === 'object' && UNITS[s.unit] ? s.value * UNITS[s.unit].base : NaN; }

  /* ---------- Options and variants ---------- */
  function options(p) {
    var o = p.options || {}, out = [];
    if (o.colour && o.colour.length) out.push({ key: 'colour', name: 'Colour', values: o.colour.map(function (c) { return { label: c.name, hex: c.hex }; }) });
    if (o.size && o.size.length) out.push({ key: 'size', name: 'Size', values: o.size.map(function (s) { return { label: sizeLabel(s), size: s }; }) });
    return out;
  }
  function hasOptions(p) { return options(p).length > 0; }
  function comboKey(sel) { return JSON.stringify([sel.colour || '', sel.size || '']); }
  function variants(p) { return (p.variants || []).map(function (v) { return { sku: v.sku, colour: v.colour || '', size: v.size || '', stock: Math.max(0, parseInt(v.stock, 10) || 0), priceZMW: v.priceZMW > 0 ? Number(v.priceZMW) : 0, image: v.image || '' }; }); }
  // sel: { colour, size }; an axis the product doesn't have is ignored
  function findVariant(p, sel) {
    var axes = options(p).map(function (o) { return o.key; });
    return variants(p).filter(function (v) { return axes.every(function (k) { return v[k] === (sel[k] || ''); }); })[0] || null;
  }
  // Is a value worth offering, given what is picked on the other axis?
  function valueInStock(p, key, label, sel) {
    var other = options(p).map(function (o) { return o.key; }).filter(function (k) { return k !== key; })[0];
    return variants(p).some(function (v) { return v[key] === label && v.stock > 0 && (!other || !sel[other] || v[other] === sel[other]); });
  }
  // First combination in stock, so the page opens on something the buyer can buy
  function defaultSelection(p) {
    var v = variants(p).filter(function (x) { return x.stock > 0; })[0] || variants(p)[0];
    return v ? { colour: v.colour, size: v.size } : {};
  }
  function totalStock(p) { return variants(p).reduce(function (a, v) { return a + v.stock; }, 0); }
  // 'in' | 'low' | 'out' | 'request' for a product or one variant
  function stockState(p, v) {
    if (v) return v.stock <= 0 ? 'out' : v.stock <= LOW_STOCK ? 'low' : 'in';
    if (hasOptions(p) && (p.variants || []).length) { var n = totalStock(p); return n <= 0 ? 'out' : n <= LOW_STOCK ? 'low' : 'in'; }
    return STOCK.indexOf(p.stock) !== -1 ? p.stock : 'in';
  }
  // Seller form: every Colour x Size combination, keeping what was already typed
  function matrix(opts, old) {
    var colours = (opts.colour || []).map(function (c) { return c.name; }), sizes = (opts.size || []).map(sizeLabel);
    if (!colours.length && !sizes.length) return [];
    var keep = {};
    (old || []).forEach(function (v) { keep[comboKey(v)] = v; });
    var out = [];
    (colours.length ? colours : ['']).forEach(function (c) {
      (sizes.length ? sizes : ['']).forEach(function (s) {
        var was = keep[comboKey({ colour: c, size: s })] || {};
        out.push({ sku: was.sku || '', colour: c, size: s, stock: was.stock != null ? was.stock : 0, priceZMW: was.priceZMW || '', image: was.image || '' });
      });
    });
    return out;
  }
  function skuFor(id, v) {
    var part = function (s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 4); };
    var hash = 0, key = comboKey(v);
    for (var i = 0; i < key.length; i++) hash = (hash * 33 + key.charCodeAt(i)) >>> 0;
    return ['ZS', part(id) || 'NEW', part(v.colour), part(v.size), hash.toString(36).toUpperCase()].filter(Boolean).join('-');
  }

  /* ---------- In the box ---------- */
  function inBox(p) {
    var out = { included: [], addons: [] };
    (p.inBox || []).forEach(function (c, i) {
      if (!c || !c.item) return;
      if (c.addonZMW != null && c.addonZMW !== '') out.addons.push({ index: i, item: c.item, price: Math.max(0, num(c.addonZMW) || 0) });
      else out.included.push({ index: i, item: c.item });
    });
    return out;
  }

  /* ---------- Buyer commit pricing ----------
     now: today's Buy now price (after promotions and deals). The range closes at whichever
     is lower, the seller's max or today's price, so committing never costs more than buying. */
  function commitRange(p, now) {
    var c = p.commit;
    if (!c || !(c.min > 0) || !(c.max > c.min)) return null;
    var max = Math.min(Number(c.max), now || Infinity);
    return max > c.min ? { min: Number(c.min), max: max } : null;
  }

  /* ---------- Price for one item ----------
     base: price before add-ons, from main.js priceOf() so promotions and deals apply.
     sel: { addons: [inBox index, ...], commit: amount or 0 } */
  function quote(p, base, sel) {
    sel = sel || {};
    var adds = inBox(p).addons.filter(function (a) { return (sel.addons || []).indexOf(a.index) !== -1; });
    var addTotal = money(adds.reduce(function (s, a) { return s + Math.round(a.price * 100); }, 0) / 100);
    var range = commitRange(p, base), commit = 0;
    if (sel.commit && range) commit = money(Math.min(range.max, Math.max(range.min, num(sel.commit) || range.max)));
    var unit = commit || base;
    return { unit: unit, addons: adds, addTotal: addTotal, each: money(unit + addTotal), commit: commit, range: range };
  }
  // Short text for the cart, orders and WhatsApp: "White, 42 · + Wall charger · Your offer K490"
  function describe(p, opt) {
    if (!opt) return '';
    var bits = [];
    var picked = [opt.colour, opt.size].filter(Boolean).join(', ');
    if (picked) bits.push(picked);
    inBox(p).addons.forEach(function (a) { if ((opt.addons || []).indexOf(a.index) !== -1) bits.push('+ ' + a.item); });
    if (opt.commit) bits.push('Your offer K' + money(opt.commit).toLocaleString('en-US', { minimumFractionDigits: money(opt.commit) % 1 ? 2 : 0, maximumFractionDigits: 2 }));
    return bits.join(' · ');
  }

  /* ---------- Ratings ----------
     dist[n] is the number of n-star reviews; dist[0] is unused, as rating_counts in the schema. */
  function ratingSummary(revs) {
    var dist = [0, 0, 0, 0, 0, 0], sum = 0, n = 0;
    (revs || []).forEach(function (r) {
      var v = Math.round(Number(r.rating));
      if (v >= 1 && v <= 5) { dist[v]++; sum += v; n++; }
    });
    return { count: n, avg: n ? sum / n : 0, dist: dist };
  }

  /* ---------- Searching and filtering ---------- */
  function attrText(p) {
    var a = p.attributes || {}, bits = [a.manufacturer || '', sizeLabel(a.size)];
    Object.keys(a.specs || {}).forEach(function (k) { bits.push(k, a.specs[k]); });
    options(p).forEach(function (o) { o.values.forEach(function (v) { bits.push(v.label); }); });
    return bits.join(' ');
  }
  function colours(p) { return ((p.options || {}).colour || []).map(function (c) { return c.name; }); }
  function ages(p) { return ((p.attributes || {}).ageRange || []).filter(function (a) { return AGE_IDS.indexOf(a) !== -1; }); }

  /* ---------- Checks ----------
     The same rules as the database constraints, so a listing that passes here will load. */
  function validate(d, ctx) {
    ctx = ctx || {};
    var errors = [], add = function (field, message) { errors.push({ field: field, message: message }); };
    var deptIds = (ctx.departments || []).map(function (x) { return x.id; });
    var brandIds = (ctx.brands || []).map(function (x) { return x.id; });
    var price = num(d.priceZMW);

    if (!text(d.title)) add('title', 'Enter a product name.');
    else if (String(d.title).length > 120) add('title', 'Keep the product name to 120 characters or fewer.');
    if (deptIds.indexOf(d.category) === -1) add('category', 'Choose a department.');
    if (d.brand && brandIds.indexOf(d.brand) === -1) add('brand', 'Choose a brand from the list, or none.');
    if (!(price > 0) || !validMoney(price)) add('priceZMW', 'Enter a price above K0 with at most two decimal places.');
    if (d.wasZMW && (!(num(d.wasZMW) > price) || !validMoney(d.wasZMW))) add('wasZMW', 'The "was" price must be higher than the price and use at most two decimal places.');
    if (STOCK.indexOf(d.stock) === -1) add('stock', 'Choose a stock status.');

    var a = d.attributes || {};
    if (a.size) {
      if (!validMeasure(a.size.value)) add('size', 'Enter a positive size with at most three decimal places, or leave it empty.');
      if (!UNITS[a.size.unit]) add('size', 'Choose a unit for the size.');
    }
    (a.ageRange || []).forEach(function (x) { if (AGE_IDS.indexOf(x) === -1) add('ageRange', 'Unknown age range: ' + x + '.'); });
    Object.keys(a.specs || {}).forEach(function (k) { if (!text(k) || !text(a.specs[k])) add('specs', 'Each specification needs a name and a value.'); });

    var o = d.options || {}, seen = {};
    (o.colour || []).forEach(function (c) {
      if (!text(c.name)) add('colour', 'Name each colour.');
      else if (c.name !== text(c.name, 40)) add('colour', 'Use a colour name of at most 40 characters with no extra spaces.');
      else if (seen['c' + c.name.toLowerCase()]) add('colour', 'The colour "' + c.name + '" is listed twice.');
      seen['c' + String(c.name).toLowerCase()] = 1;
      if (!/^#[0-9a-f]{6}$/i.test(c.hex || '')) add('colour', 'Pick a swatch colour for ' + (c.name || 'each colour') + '.');
    });
    (o.size || []).forEach(function (s) {
      var l = sizeLabel(s);
      if (s && typeof s === 'object' && (!validMeasure(s.value) || !UNITS[s.unit])) add('sizes', 'Each measured size needs a positive value with at most three decimal places and a supported unit.');
      if (!l) add('sizes', 'Sizes can\'t be empty.');
      else if (seen['s' + l.toLowerCase()]) add('sizes', 'The size "' + l + '" is listed twice.');
      seen['s' + l.toLowerCase()] = 1;
    });

    var vs = d.variants || [], named = { colour: (o.colour || []).filter(function (c) { return text(c.name); }), size: o.size };
    var expected = matrix(named, []).map(comboKey), skus = {}, keys = {};
    if (expected.length) {
      if (vs.length !== expected.length || vs.some(function (v) { return expected.indexOf(comboKey(v)) === -1; })) add('variants', 'The variations table doesn\'t match the colours and sizes. Check the table again.');
      vs.forEach(function (v) {
        var name = [v.colour, v.size].filter(Boolean).join(' / ');
        if (keys[comboKey(v)]) add('variants', name + ' appears twice.');
        keys[comboKey(v)] = 1;
        if (!text(v.sku)) add('variants', 'Enter a SKU for ' + name + '.');
        else if (v.sku !== text(v.sku, 40)) add('variants', 'Use a SKU of at most 40 characters with no extra spaces.');
        else if (skus[v.sku.toUpperCase()]) add('variants', 'The SKU ' + v.sku + ' is used twice.');
        skus[String(v.sku).toUpperCase()] = 1;
        if (v.stock == null || v.stock === '' || !Number.isInteger(num(v.stock)) || num(v.stock) < 0 || num(v.stock) > 2147483647) add('variants', 'Stock for ' + name + ' must be a whole number, 0 or more.');
        if (v.priceZMW !== '' && v.priceZMW != null && (!(num(v.priceZMW) > 0) || !validMoney(v.priceZMW))) add('variants', 'The price for ' + name + ' must be above K0 with at most two decimal places, or left empty.');
      });
    } else if (vs.length) add('variants', 'Add colours or sizes before the variations table.');

    var items = {};
    (d.inBox || []).forEach(function (c) {
      if (!text(c.item)) add('inBox', 'Name each item in the box.');
      else if (items[c.item.toLowerCase()]) add('inBox', '"' + c.item + '" is listed twice in the box.');
      items[String(c.item).toLowerCase()] = 1;
      if (c.addonZMW != null && c.addonZMW !== '' && !validMoney(c.addonZMW)) add('inBox', 'The add-on price for ' + (c.item || 'an item') + ' must be K0 or more with at most two decimal places.');
    });

    if (d.commit) {
      var mn = num(d.commit.min), mx = num(d.commit.max);
      if (!(mn > 0) || !validMoney(mn)) add('commitMin', 'Enter the lowest price you will accept, with at most two decimal places.');
      if (!(mx > mn) || !validMoney(mx)) add('commitMax', 'The target price must be higher than the lowest price, with at most two decimal places.');
      if (mx > price) add('commitMax', 'The target price can\'t be above the Buy now price of K' + price + '.');
    }
    return errors;
  }

  /* ---------- Tidy a draft into a catalogue entry ---------- */
  function clean(d) {
    var p = {
      id: d.id, title: text(d.title, 120), category: d.category, seller: d.seller, brand: d.brand || '',
      priceZMW: money(d.priceZMW), stock: d.stock, image: d.image || '', alt: text(d.alt || d.title, 160),
      tags: text(d.tags, 200), description: String(d.description || '').trim().slice(0, 2000), reviews: d.reviews || []
    };
    if (d.wasZMW) p.wasZMW = money(d.wasZMW);
    if (d.added) p.added = d.added;
    if (d.match) p.match = d.match;
    var a = d.attributes || {}, attrs = {};
    if (a.size && num(a.size.value) > 0) attrs.size = { value: num(a.size.value), unit: a.size.unit };
    if (a.ageRange && a.ageRange.length) attrs.ageRange = AGE_IDS.filter(function (x) { return a.ageRange.indexOf(x) !== -1; });
    if (text(a.manufacturer)) attrs.manufacturer = text(a.manufacturer, 80);
    var specs = {};
    Object.keys(a.specs || {}).forEach(function (k) { if (text(k) && text(a.specs[k])) specs[text(k, 60)] = text(a.specs[k], 200); });
    if (Object.keys(specs).length) attrs.specs = specs;
    if (Object.keys(attrs).length) p.attributes = attrs;
    var o = d.options || {}, opts = {};
    if (o.colour && o.colour.length) opts.colour = o.colour.map(function (c) { return { name: text(c.name, 40), hex: String(c.hex).toUpperCase() }; });
    if (o.size && o.size.length) opts.size = o.size.slice();
    if (Object.keys(opts).length) {
      p.options = opts;
      p.variants = (d.variants || []).map(function (v) {
        var row = { sku: text(v.sku, 40).toUpperCase(), stock: parseInt(v.stock, 10) || 0 };
        if (v.colour) row.colour = v.colour;
        if (v.size) row.size = v.size;
        if (num(v.priceZMW) > 0) row.priceZMW = money(v.priceZMW);
        if (v.image) row.image = v.image;
        return row;
      });
    }
    var box = (d.inBox || []).filter(function (c) { return text(c.item); }).map(function (c) {
      return c.addonZMW != null && c.addonZMW !== '' ? { item: text(c.item, 80), addonZMW: money(c.addonZMW) } : { item: text(c.item, 80) };
    });
    if (box.length) p.inBox = box;
    if (d.commit) p.commit = { min: money(d.commit.min), max: money(d.commit.max) };
    return p;
  }

  // The listing as it would be pasted into js/catalogue.js
  function catalogueEntry(p) {
    var out = copy(p);
    delete out.local; delete out.updated;
    if (/^data:/.test(out.image || '')) out.image = 'assets/products/' + out.id + '.webp';
    return JSON.stringify(out, null, 2).replace(/"([A-Za-z_$][\w$]*)":/g, '$1:').replace(/"((?:[^"\\']|\\.)*)"/g, function (m, s) { return '\'' + s.replace(/\\"/g, '"') + '\''; });
  }

  /* ---------- Listings store (prototype API) ---------- */
  function listings(store) {
    var KEY = 'listings';
    var all = function () { return store.get(KEY, []); };
    var save = function (list) { return store.set(KEY, list); };
    // stored: false when the browser refused to save (storage full or blocked); the listing lasts this visit only
    var ok = function (p, stored) { return { ok: true, product: p, stored: stored !== false }; };
    var fail = function (errors) { return { ok: false, errors: errors }; };
    return {
      list: function (sellerId) { return all().filter(function (p) { return !sellerId || p.seller === sellerId; }); },
      get: function (id) { return all().filter(function (p) { return p.id === id; })[0] || null; },
      create: function (draft, ctx) {
        var errors = validate(draft, ctx);
        if (errors.length) return fail(errors);
        var taken = (ctx.products || []).map(function (p) { return p.id; }).concat(all().map(function (p) { return p.id; }));
        var id = 'U' + Date.now().toString(36).toUpperCase();
        while (taken.indexOf(id) !== -1) id += 'X';
        var p = clean(Object.assign({}, draft, { id: id, added: draft.added || new Date().toISOString().slice(0, 10) }));
        p.local = true; p.updated = new Date().toISOString();
        return ok(p, save(all().concat([p])));
      },
      // Editing a catalogue product saves a local copy with the same id, which takes its place.
      // Fields the form doesn't edit (reviews, sales, match, deal, sample) carry over.
      update: function (id, draft, ctx) {
        if (!this.get(id) && !(ctx.products || []).some(function (p) { return p.id === id; })) return fail([{ field: 'id', message: 'That product does not exist.' }]);
        var errors = validate(draft, ctx);
        if (errors.length) return fail(errors);
        var was = copy(this.get(id) || (ctx.products || []).filter(function (x) { return x.id === id; })[0] || {});
        EDITED.forEach(function (k) { delete was[k]; });
        var p = Object.assign(was, clean(Object.assign({}, draft, { id: id, reviews: was.reviews, added: was.added, match: was.match })));
        p.local = true; p.updated = new Date().toISOString();
        return ok(p, save(all().filter(function (x) { return x.id !== id; }).concat([p])));
      },
      remove: function (id) {
        var before = all().length, list = all().filter(function (x) { return x.id !== id; });
        save(list);
        return list.length < before ? { ok: true } : fail([{ field: 'id', message: 'That listing isn\'t saved in this browser.' }]);
      }
    };
  }

  window.ZSProduct = {
    UNITS: UNITS, AGES: AGES, FIELDS: FIELDS, LOW_STOCK: LOW_STOCK,
    sizeLabel: sizeLabel, parseSize: parseSize, sizeBase: sizeBase,
    options: options, hasOptions: hasOptions, variants: variants, findVariant: findVariant, comboKey: comboKey,
    valueInStock: valueInStock, defaultSelection: defaultSelection, totalStock: totalStock, stockState: stockState,
    matrix: matrix, skuFor: skuFor, inBox: inBox, commitRange: commitRange, quote: quote, describe: describe,
    ratingSummary: ratingSummary, attrText: attrText, colours: colours, ages: ages,
    validate: validate, clean: clean, catalogueEntry: catalogueEntry, listings: listings
  };
})();
