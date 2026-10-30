/* Zed Supply stock planner. js/main.js loads this file only when someone opens
   #/stock, so the rest of the store stays light.

   A seller pastes or uploads their stock list (SKU, description, quantity on hand,
   cost price, annual usage, supplier lead time, and optionally source and monthly
   sales). Everything is worked out in this browser: the list is never sent
   anywhere, and is kept on the device only if the seller ticks "Keep this list".

   Every figure shows its working, and every assumption is listed, so sellers can
   check the numbers themselves. */
(function () {
  'use strict';

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  // Healthy stock-turn ranges (times a year). General retail rules of thumb, not
  // Zambian industry statistics: the page says so, and sellers can type their own.
  var SECTORS = [
    { id: 'grocery', name: 'Groceries and everyday essentials', low: 10, high: 20 },
    { id: 'phones', name: 'Phones, tech and smart gadgets', low: 5, high: 8 },
    { id: 'fashion', name: 'Fashion, beauty and hair', low: 3, high: 6 },
    { id: 'home', name: 'Home, kitchen and appliances', low: 3, high: 5 },
    { id: 'hardware', name: 'Building, tools and hardware', low: 3, high: 5 },
    { id: 'solar', name: 'Solar, power and energy', low: 3, high: 5 },
    { id: 'office', name: 'Office, school and stationery', low: 3, high: 6 },
    { id: 'health', name: 'Health, fitness and personal care', low: 4, high: 8 },
    { id: 'auto', name: 'Auto parts and accessories', low: 2, high: 4 },
    { id: 'agri', name: 'Agriculture and farming', low: 2, high: 4 },
    { id: 'baby', name: 'Baby, kids and toys', low: 3, high: 6 },
    { id: 'other', name: 'Other', low: 4, high: 6 }
  ];
  // Match the storefront's departments while keeping saved legacy sector selections usable.
  var legacySectors = SECTORS;
  var sectorAliases = { essentials: 'grocery', tech: 'phones', computers: 'phones', smarthome: 'phones', tv: 'phones', games: 'phones',
    salaula: 'fashion', womens: 'fashion', mens: 'fashion', girls: 'fashion', boys: 'fashion', beauty: 'fashion', luggage: 'fashion',
    arts: 'home', toys: 'baby', sports: 'health', business: 'hardware', pets: 'other' };
  if (window.ZS_CATALOGUE && window.ZS_CATALOGUE.departments.length) {
    SECTORS = window.ZS_CATALOGUE.departments.map(function (d) {
      var source = legacySectors.filter(function (s) { return s.id === (sectorAliases[d.id] || d.id); })[0] || legacySectors[legacySectors.length - 1];
      return { id: d.id, name: d.name, low: source.low, high: source.high };
    }).concat(legacySectors.filter(function (s) { return s.id === 'other'; }));
  }
  var DEFAULTS = { sector: 'hardware', low: 3, high: 5, localFactor: 0.5, importFactor: 1, importDays: 30, reviewDays: 30, extraImportDays: 0, orderCost: '', holdingPct: 25 };

  var TEMPLATE = 'SKU,Description,Quantity on hand,Cost price (K),Annual usage,Lead time (days),Source (local or import),' + MONTHS.join(',') + '\n';

  // Sample list for trying the planner. Made-up figures, labelled as such on screen.
  var SAMPLE = [
    'SKU,Description,Quantity on hand,Cost price (K),Annual usage,Lead time (days),Source,' + MONTHS.join(','),
    'HW-001,Cement 50 kg bag,120,165,4800,3,local,300,280,320,380,420,450,480,500,480,450,420,320',
    'HW-002,IBR roofing sheet 3 m,60,310,900,14,local,,,,,,,,,,,,',
    'HW-003,Solar panel 200 W,12,1450,160,60,import,10,10,12,12,14,14,14,14,14,14,16,16',
    'HW-004,Inverter 3 kVA,15,4200,40,75,import,,,,,,,,,,,,',
    'HW-005,Padlock 50 mm,400,38,300,45,import,,,,,,,,,,,,',
    'HW-006,PVC pipe 110 mm 6 m,80,185,600,7,local,,,,,,,,,,,,',
    'HW-007,Wheelbarrow,35,690,120,21,local,,,,,,,,,,,,',
    'HW-008,White paint 20 L,25,780,260,10,local,,,,,,,,,,,,',
    'HW-009,Door hinges (pair),900,12,400,45,import,,,,,,,,,,,,',
    'HW-010,Tile adhesive 20 kg,40,140,0,10,local,,,,,,,,,,,,',
    'HW-011,Extension cable 5 m,8,160,240,40,import,,,,,,,,,,,,',
    'HW-012,Nails 3 inch 1 kg,150,42,1800,5,local,,,,,,,,,,,,'
  ].join('\n');

  var H, root, settings, lastText = '', lastIsSample = false, data = null;

  function esc(t) { return H.esc(t); }
  function num(n, dp) { return Number(n).toLocaleString('en-US', { minimumFractionDigits: dp || 0, maximumFractionDigits: dp || 0 }); }
  function K(n, dp) { return 'K' + num(n, dp || 0); }
  function pct(n) { return num(n * 100, 1) + '%'; }
  function toNum(v) {
    var s = String(v == null ? '' : v).replace(/[^0-9.\-]/g, '');
    return s === '' || s === '-' || s === '.' ? NaN : Number(s);
  }
  function addDays(n) {
    var d = new Date();
    d.setDate(d.getDate() + Math.max(0, Math.floor(n)));
    return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
  }
  function days(n) { return n === Infinity ? 'no usage' : num(n, 0) + ' day' + (Math.round(n) === 1 ? '' : 's'); }

  /* ---------- Reading the stock list ---------- */
  function parseTable(text) {
    text = String(text || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
    var first = text.split('\n')[0] || '';
    var delim = ['\t', ';', ','].reduce(function (best, d) { return first.split(d).length > first.split(best).length ? d : best; }, ',');
    var rows = [], row = [], cell = '', quoted = false;
    for (var i = 0; i < text.length; i++) {
      var c = text.charAt(i);
      if (quoted) {
        if (c === '"') { if (text.charAt(i + 1) === '"') { cell += '"'; i++; } else quoted = false; } else cell += c;
      } else if (c === '"' && cell === '') quoted = true;
      else if (c === delim) { row.push(cell); cell = ''; }
      else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (x) { return x.trim() !== ''; }); });
  }

  // Which field a header names. Order matters: "Supplier lead time" is a lead time,
  // "Annual usage qty" is usage, "Product code" is a SKU.
  function colType(header) {
    var h = String(header).toLowerCase().trim();
    var m = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(\s*[-'’]?\s*\d{2,4})?$/.exec(h);
    if (m) return MONTHS.map(function (x) { return x.toLowerCase(); }).indexOf(m[1]);
    if (/lead/.test(h)) return 'lead';
    if (/annual|usage|per year|yearly|sold|sales/.test(h)) return 'usage';
    if (/sku|code|part ?no|item ?no/.test(h)) return 'sku';
    if (/source|origin|import|local/.test(h)) return 'source';
    if (/desc|name|product|item/.test(h)) return 'desc';
    if (/on ?hand|qty|quantity|stock|units/.test(h)) return 'qty';
    if (/cost|price/.test(h)) return 'cost';
    return null;
  }
  function parseSource(v) {
    v = String(v).toLowerCase();
    if (/imp|china|abroad|overseas|foreign|international|intl|south africa|dubai|india/.test(v)) return 'import';
    if (/loc|zam|lusaka|domestic|ndola|kitwe/.test(v)) return 'local';
    return null;
  }

  function readItems(text) {
    var rows = parseTable(text), items = [], issues = [], notes = [];
    if (rows.length < 2) return { items: items, issues: ['Add a header row and at least one item.'], notes: notes };
    var cols = rows[0].map(colType);
    var has = function (t) { return cols.indexOf(t) !== -1; };
    var hasMonths = cols.some(function (c) { return typeof c === 'number'; });
    var missing = [];
    if (!has('sku') && !has('desc')) missing.push('SKU or Description');
    if (!has('qty')) missing.push('Quantity on hand');
    if (!has('cost')) missing.push('Cost price');
    if (!has('usage') && !hasMonths) missing.push('Annual usage (or monthly sales columns)');
    if (!has('lead')) missing.push('Lead time (days)');
    if (missing.length) {
      issues.push('We couldn\'t find ' + (missing.length > 1 ? 'these columns' : 'this column') + ': ' + missing.join(', ') + '. Check that the first row has column names like the template.');
      return { items: items, issues: issues, notes: notes };
    }
    rows.slice(1).forEach(function (r, n) {
      var it = { row: n + 2, sku: '', desc: '', qty: NaN, cost: NaN, usage: NaN, lead: NaN, sourceGiven: null, months: [null, null, null, null, null, null, null, null, null, null, null, null] };
      cols.forEach(function (t, i) {
        var v = String(r[i] == null ? '' : r[i]).trim();
        if (typeof t === 'number') { var m = toNum(v); if (!isNaN(m)) it.months[t] = m; }
        else if (t === 'sku' || t === 'desc') it[t] = v.slice(0, 120);
        else if (t === 'source') it.sourceGiven = v ? parseSource(v) : null;
        else if (t) it[t] = toNum(v);
      });
      var label = 'Row ' + it.row + (it.sku || it.desc ? ' (' + (it.sku || it.desc) + ')' : '');
      if (!it.sku && !it.desc) { issues.push(label + ': no SKU or description, so it was skipped.'); return; }
      var monthVals = it.months.filter(function (x) { return x !== null; });
      it.monthCount = monthVals.length;
      if (isNaN(it.usage) && it.monthCount) {
        var sum = monthVals.reduce(function (a, b) { return a + b; }, 0);
        it.usage = it.monthCount === 12 ? sum : sum * 12 / it.monthCount;
        notes.push(label + ': annual usage worked out from ' + it.monthCount + ' month' + (it.monthCount === 1 ? '' : 's') + ' of sales' + (it.monthCount < 12 ? ' (' + num(sum) + ' × 12 ÷ ' + it.monthCount + ' = ' + num(it.usage, 1) + ')' : ' (' + num(sum) + ')') + '.');
      } else if (it.monthCount === 12) {
        var total = monthVals.reduce(function (a, b) { return a + b; }, 0);
        if (it.usage > 0 && Math.abs(total - it.usage) / it.usage > 0.05) notes.push(label + ': the monthly figures add up to ' + num(total) + ' but annual usage says ' + num(it.usage) + '. The planner used annual usage; the months are used only for the seasonal pattern.');
      }
      var bad = [];
      if (isNaN(it.qty) || it.qty < 0) bad.push('quantity on hand');
      if (isNaN(it.cost) || it.cost < 0) bad.push('cost price');
      if (isNaN(it.usage) || it.usage < 0) bad.push('annual usage');
      if (isNaN(it.lead) || it.lead < 0) bad.push('lead time');
      if (bad.length) { issues.push(label + ': ' + bad.join(', ') + ' missing or not a number, so it was skipped.'); return; }
      items.push(it);
    });
    return { items: items, issues: issues, notes: notes };
  }

  /* ---------- The calculations ---------- */
  function analyse(list, s) {
    var month = new Date().getMonth();
    var res = list.map(function (x) {
      var it = {};
      for (var k in x) if (Object.prototype.hasOwnProperty.call(x, k)) it[k] = x[k];
      it.name = x.sku && x.desc ? x.sku + ' · ' + x.desc : (x.sku || x.desc);
      it.stockValue = x.qty * x.cost;
      it.usageValue = x.usage * x.cost;
      it.daily = x.usage / 365;
      it.inferred = x.sourceGiven === null;
      it.imported = it.inferred ? x.lead >= s.importDays : x.sourceGiven === 'import';
      it.extra = it.imported ? s.extraImportDays : 0;
      it.L = x.lead + it.extra;
      it.factor = it.imported ? s.importFactor : s.localFactor;
      it.ltd = it.daily * it.L;                       // demand while waiting for a delivery
      it.ss = it.factor * it.ltd;                      // safety stock
      it.rol = Math.ceil(it.ltd + it.ss - 1e-9);       // reorder level, whole units
      it.max = Math.ceil(it.ltd + it.ss + it.daily * s.reviewDays - 1e-9);
      it.cover = it.daily > 0 ? x.qty / it.daily : Infinity;
      it.dead = it.daily === 0 && x.qty > 0;
      it.excess = it.dead ? x.qty : Math.max(0, x.qty - it.max);
      it.excessCash = it.excess * x.cost;
      it.orderQty = Math.max(0, it.max - x.qty);
      if (s.orderCost > 0 && x.cost > 0 && x.usage > 0 && s.holdingPct > 0) {
        it.holding = x.cost * s.holdingPct / 100;
        it.eoq = Math.ceil(Math.sqrt(2 * x.usage * s.orderCost / it.holding));
      }
      // Seasonal forecast: same months last year (needs all 12 months)
      if (x.monthCount === 12) {
        it.next = [0, 1, 2].map(function (k) { var i = (month + k) % 12; return { m: i, v: x.months[i] }; });
        it.next3 = it.next.reduce(function (a, b) { return a + b.v; }, 0);
        it.dNext = it.next3 / 91;
        var peak = 0;
        x.months.forEach(function (v, i) { if (v > x.months[peak]) peak = i; });
        it.peak = peak;
        it.busy = it.daily > 0 && it.dNext > it.daily * 1.2;
        it.quiet = it.daily > 0 && it.dNext < it.daily * 0.8;
        it.seasonRol = Math.ceil(it.dNext * it.L * (1 + it.factor) - 1e-9);
      }
      // Stockout risk
      if (it.daily === 0) it.risk = null;
      else if (x.qty === 0) it.risk = { level: 'out', label: 'Out of stock' };
      else if (it.cover < it.L) it.risk = { level: 'high', label: 'High risk' };
      else if (x.qty <= it.rol) it.risk = { level: 'order', label: 'Order now' };
      else if (it.busy && x.qty <= it.seasonRol) it.risk = { level: 'season', label: 'Busy season' };
      else it.risk = null;
      return it;
    });

    // ABC on annual usage value
    var total = res.reduce(function (a, b) { return a + b.usageValue; }, 0), cum = 0;
    var byValue = res.slice().sort(function (a, b) { return b.usageValue - a.usageValue; });
    byValue.forEach(function (it, i) {
      it.rank = i + 1;
      it.cumBefore = total ? cum / total : 0;
      cum += it.usageValue;
      it.share = total ? it.usageValue / total : 0;
      it.cum = total ? cum / total : 0;
      it.abc = !total || it.usageValue === 0 ? 'C' : it.cumBefore < 0.8 ? 'A' : it.cumBefore < 0.95 ? 'B' : 'C';
    });

    var stockValue = res.reduce(function (a, b) { return a + b.stockValue; }, 0);
    return {
      items: res, byValue: byValue, totalUsage: total, stockValue: stockValue,
      turnover: stockValue > 0 ? total / stockValue : 0,
      excessCash: res.reduce(function (a, b) { return a + b.excessCash; }, 0),
      atRisk: res.filter(function (it) { return it.risk; }),
      hasMonths: res.some(function (it) { return it.next; })
    };
  }

  function actions(r, s) {
    var list = [];
    r.items.forEach(function (it) {
      if (it.dead) {
        list.push({ cash: it.stockValue, promo: true, html: '<strong>Clear ' + esc(it.name) + '.</strong> No usage in the past year, so all ' + num(it.qty) + ' units (' + K(it.stockValue) + ') are sitting idle. Offer them in a clearance promotion, bundle them with a fast seller, or ask the supplier to take them back for credit.' });
      } else if (it.excess > 0) {
        var monthsToSell = it.excess / it.daily / 30.4;
        if (it.abc === 'C' || it.cover > 180) {
          list.push({ cash: it.excessCash, promo: true, html: '<strong>Discount or bundle ' + esc(it.name) + '</strong> to sell about ' + num(it.excess) + ' extra units (' + K(it.excessCash) + '). At your current rate they would take about ' + num(monthsToSell, 1) + ' months to sell.' });
        } else {
          list.push({ cash: it.excessCash, html: '<strong>Pause reorders of ' + esc(it.name) + '</strong> until stock falls to its reorder level of ' + num(it.rol) + ' units, in about ' + days((it.qty - it.rol) / it.daily) + ' (around ' + addDays((it.qty - it.rol) / it.daily) + '). That lets ' + K(it.excessCash) + ' of extra stock turn back into cash.' });
        }
      }
      // Only the safety stock actually on the shelf can turn back into cash
      var localSs = s.localFactor * it.ltd, held = Math.min(it.qty, it.ss);
      if (it.abc === 'A' && it.imported && s.importFactor > s.localFactor && held > localSs) {
        var save = (held - localSs) * it.cost;
        list.push({ cash: save, html: '<strong>Ask local suppliers to quote for ' + esc(it.name) + '.</strong> If one can match the price, you could keep less safety stock (factor ' + s.importFactor + ' down to ' + s.localFactor + ', or ' + num(held, 1) + ' down to ' + num(localSs, 1) + ' units), freeing about ' + K(save) + ' as you sell through. A shorter import lead time has the same effect.' });
      }
    });
    return list.filter(function (a) { return a.cash > 0; }).sort(function (a, b) { return b.cash - a.cash; }).slice(0, 5);
  }

  function assumptions(r, s, notes) {
    var a = [], sector = sectorOf(s.sector);
    a.push('ABC classes use <strong>annual usage value</strong> (annual usage × cost price), the usual method, not the value of the stock on your shelves today. An item is A while the running total before it is under 80% of the total, B while it is under 95%, and C after that, so the item that crosses 80% counts as A.');
    a.push('Usage is spread evenly over 365 days' + (r.hasMonths ? ' (except in the forecast, which uses your monthly figures)' : '') + '. Lead times are calendar days.');
    a.push('Safety stock = safety factor × the demand during the lead time: ' + s.localFactor + ' for local suppliers and ' + s.importFactor + ' for imports. Reorder levels and order quantities are rounded up to whole units.');
    var inferred = r.items.filter(function (it) { return it.inferred; });
    if (inferred.length) a.push('No source was given for ' + inferred.length + ' item' + (inferred.length === 1 ? '' : 's') + ', so any lead time of ' + s.importDays + ' days or more was treated as an import: ' + inferred.map(function (it) { return esc(it.name) + ' (' + (it.imported ? 'import' : 'local') + ')'; }).join(', ') + '. Add a Source column with "local" or "import" to set this yourself.');
    if (s.extraImportDays > 0) a.push('Imports have ' + s.extraImportDays + ' extra days added to their lead time for border, clearing or transport delays.');
    a.push('The most you should hold (maximum stock) = reorder level + ' + s.reviewDays + ' days of usage, which assumes you reorder about every ' + s.reviewDays + ' days. Anything above that counts as overstock. Items with no usage at all count as overstock in full.');
    a.push('Today\'s stock is used as your average stock for the turnover ratio. If your stock was much higher or lower during the year, the ratio will be off.');
    a.push('Cash tied up is valued at cost price. Selling extra stock at a discount frees less cash than shown. Use the same basis for every cost price, for example all excluding VAT.');
    a.push('The healthy turnover range for ' + esc(sector.name.toLowerCase()) + ' (' + s.low + ' to ' + s.high + ' times a year) is a general retail rule of thumb, not official Zambian industry data. Type your own target in the settings if you have one.');
    if (r.hasMonths) a.push('Forecasts repeat last year\'s figure for the same month. With one year of history, the planner assumes this year follows last year\'s pattern. Three months are taken as 91 days. Items without all 12 months are not forecast.');
    if (s.orderCost > 0) a.push('Economic order quantity uses your ordering cost of ' + K(s.orderCost) + ' per order and a holding cost of ' + s.holdingPct + '% of cost price a year.');
    return a.concat(notes.map(esc));
  }

  /* ---------- Page ---------- */
  function sectorOf(id) { for (var i = 0; i < SECTORS.length; i++) if (SECTORS[i].id === id) return SECTORS[i]; return SECTORS[SECTORS.length - 1]; }
  function loadSettings() {
    var saved = H.store.get('stock-settings', {}) || {}, s = {};
    for (var k in DEFAULTS) if (Object.prototype.hasOwnProperty.call(DEFAULTS, k)) s[k] = Object.prototype.hasOwnProperty.call(saved, k) ? saved[k] : DEFAULTS[k];
    var savedAliases = { grocery: 'essentials', phones: 'tech', fashion: 'womens' };
    if (savedAliases[s.sector] && SECTORS.some(function (x) { return x.id === savedAliases[s.sector]; })) s.sector = savedAliases[s.sector];
    if (!SECTORS.some(function (x) { return x.id === s.sector; })) s.sector = 'other';
    return s;
  }
  function field(id, label, value, attrs, hint) {
    return '<div class="field"><label for="' + id + '">' + label + '</label><input id="' + id + '" type="number" inputmode="decimal" value="' + esc(value) + '" ' + attrs + (hint ? ' aria-describedby="' + id + '-hint"' : '') + '>' +
      (hint ? '<p class="hint" id="' + id + '-hint">' + hint + '</p>' : '') + '</div>';
  }

  function render() {
    var s = settings, saved = H.store.get('stock-data', null);
    root.innerHTML =
      '<section class="sp-card" aria-labelledby="sp-in-title"><h2 id="sp-in-title">1. Your stock list</h2>' +
        '<p>Paste your list straight from Excel or Google Sheets, or upload a CSV file. You need one row per item with these columns: <strong>SKU, Description, Quantity on hand, Cost price, Annual usage, Lead time (days)</strong>. Two more are optional: <strong>Source</strong> ("local" or "import") and monthly sales (<strong>Jan</strong> to <strong>Dec</strong>) for a seasonal forecast.</p>' +
        '<p class="notice notice--secure">Your list stays on this device. The planner works it out in your browser and never sends it to Zed Supply or anyone else.</p>' +
        '<div class="field"><label for="sp-file">Upload a CSV file</label><input id="sp-file" type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" aria-describedby="sp-file-hint"><p class="hint" id="sp-file-hint">In Excel, choose File › Save as › CSV. Excel files (.xlsx) can\'t be read directly, but you can copy the cells and paste them below.</p></div>' +
        '<div class="field"><label for="sp-paste">Or paste your list</label><textarea id="sp-paste" rows="7" spellcheck="false" placeholder="SKU	Description	Quantity on hand	Cost price	Annual usage	Lead time (days)">' + esc(saved || '') + '</textarea></div>' +
        '<div class="check"><input id="sp-keep" type="checkbox"' + (saved ? ' checked' : '') + '><label for="sp-keep">Keep this list on this device for next time</label></div>' +
        '<div class="sp-buttons"><button class="btn btn--primary" type="button" id="sp-run">Analyse my stock</button><button class="btn btn--secondary" type="button" id="sp-sample">Try with sample data</button><button class="btn btn--secondary" type="button" id="sp-template">Download template</button></div>' +
        '<p class="form-status" role="status" tabindex="-1" id="sp-status"></p>' +
      '</section>' +
      '<details class="sp-card sp-settings"><summary><h2>2. Settings</h2><span>Business type, safety factors and targets</span></summary>' +
        '<div class="field"><label for="sp-sector">Type of business</label><select id="sp-sector">' + SECTORS.map(function (x) { return '<option value="' + x.id + '"' + (x.id === s.sector ? ' selected' : '') + '>' + esc(x.name) + '</option>'; }).join('') + '</select></div>' +
        '<div class="field-row">' + field('sp-low', 'Healthy turnover from (times a year)', s.low, 'min="0" step="0.5"') + field('sp-high', 'to (times a year)', s.high, 'min="0" step="0.5"') + '</div>' +
        '<div class="field-row">' + field('sp-lf', 'Safety factor, local suppliers', s.localFactor, 'min="0" max="3" step="0.1"') + field('sp-if', 'Safety factor, imports', s.importFactor, 'min="0" max="3" step="0.1"') + '</div>' +
        '<div class="field-row">' + field('sp-idays', 'Treat as import from (days lead time)', s.importDays, 'min="1" step="1"', 'Used only for items without a Source.') + field('sp-xdays', 'Extra days for imports', s.extraImportDays, 'min="0" step="1"', 'What if the border or shipping is slow? Try 7 or 14.') + '</div>' +
        '<div class="field-row">' + field('sp-review', 'How often you reorder (days)', s.reviewDays, 'min="1" step="1"', 'Sets the most you should hold.') + field('sp-ocost', 'Cost of placing one order (K, optional)', s.orderCost, 'min="0" step="1"', 'Transport, calls, time. Adds an economic order quantity.') + '</div>' +
        field('sp-hold', 'Holding cost (% of cost price a year)', s.holdingPct, 'min="1" max="100" step="1"', 'Storage, damage, theft and the cost of money tied up. Used with the order cost.') +
        '<button class="link-btn" type="button" id="sp-reset">Reset to defaults</button>' +
      '</details>' +
      '<div id="sp-results" aria-live="polite"></div>';

    root.querySelector('#sp-run').addEventListener('click', function () { run(root.querySelector('#sp-paste').value, false); });
    root.querySelector('#sp-sample').addEventListener('click', function () { run(SAMPLE, true); });
    root.querySelector('#sp-template').addEventListener('click', function () { download('stock-planner-template.csv', TEMPLATE); });
    root.querySelector('#sp-file').addEventListener('change', function (e) {
      var f = e.target.files[0];
      if (!f) return;
      if (f.size > 2 * 1024 * 1024) return status('That file is over 2 MB. Save just the stock columns as CSV and try again.', true);
      var rd = new FileReader();
      rd.onload = function () { root.querySelector('#sp-paste').value = rd.result; run(rd.result, false); };
      rd.onerror = function () { status('That file couldn\'t be read. Try saving it again as CSV.', true); };
      rd.readAsText(f);
    });
    root.querySelector('#sp-keep').addEventListener('change', function (e) { if (!e.target.checked) H.store.set('stock-data', null); else if (lastText && !lastIsSample) H.store.set('stock-data', lastText); });
    root.querySelector('#sp-sector').addEventListener('change', function (e) {
      var x = sectorOf(e.target.value);
      root.querySelector('#sp-low').value = x.low; root.querySelector('#sp-high').value = x.high;
      readSettings();
    });
    root.querySelector('.sp-settings').addEventListener('input', function (e) { if (e.target.id !== 'sp-sector') readSettings(); });
    root.querySelector('#sp-reset').addEventListener('click', function () {
      H.store.set('stock-settings', null);
      settings = loadSettings();
      var keep = root.querySelector('#sp-paste').value;
      render();
      root.querySelector('#sp-paste').value = keep;
      root.querySelector('.sp-settings').open = true;
      if (data) draw();
    });
    root.querySelector('#sp-results').addEventListener('click', onResultsClick);
    if (saved) run(saved, false, true);
  }

  function readSettings() {
    var v = function (id, def) { var n = parseFloat(root.querySelector('#' + id).value); return isNaN(n) || n < 0 ? def : n; };
    settings = {
      sector: root.querySelector('#sp-sector').value,
      low: v('sp-low', DEFAULTS.low), high: v('sp-high', DEFAULTS.high),
      localFactor: v('sp-lf', DEFAULTS.localFactor), importFactor: v('sp-if', DEFAULTS.importFactor),
      importDays: Math.max(1, v('sp-idays', DEFAULTS.importDays)), extraImportDays: v('sp-xdays', 0),
      reviewDays: Math.max(1, v('sp-review', DEFAULTS.reviewDays)),
      orderCost: v('sp-ocost', 0) || '', holdingPct: Math.max(1, v('sp-hold', DEFAULTS.holdingPct))
    };
    H.store.set('stock-settings', settings);
    if (data) draw();
  }

  function status(msg, isError) {
    var st = root.querySelector('#sp-status');
    st.className = 'form-status' + (msg ? (isError ? ' is-error' : ' is-success') : '');
    st.textContent = msg;
    if (isError) st.focus();
  }

  function run(text, isSample, quiet) {
    var parsed = readItems(text);
    lastText = text; lastIsSample = isSample;
    if (!parsed.items.length) {
      data = null;
      root.querySelector('#sp-results').innerHTML = '';
      return status(parsed.issues[0] || 'No items found. Check the list has a header row and at least one item.', true);
    }
    data = { items: parsed.items, issues: parsed.issues, notes: parsed.notes, sample: isSample };
    if (!isSample && root.querySelector('#sp-keep').checked) H.store.set('stock-data', text);
    status(quiet ? '' : 'Analysed ' + parsed.items.length + ' item' + (parsed.items.length === 1 ? '' : 's') + (parsed.issues.length ? '. ' + parsed.issues.length + ' row' + (parsed.issues.length === 1 ? ' was' : 's were') + ' skipped (see below).' : '.'), false);
    draw();
    if (!quiet) root.querySelector('#sp-results').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------- Results ---------- */
  function table(caption, heads, rows, numericFrom) {
    return '<div class="sp-table" role="region" tabindex="0" aria-label="' + esc(caption) + ' (scrolls sideways)"><table><caption>' + esc(caption) + '</caption><thead><tr>' +
      heads.map(function (h, i) { return '<th scope="col"' + (i >= numericFrom ? ' class="num"' : '') + '>' + h + '</th>'; }).join('') + '</tr></thead><tbody>' +
      rows.map(function (r) { return '<tr>' + r.map(function (c, i) { return i === 0 ? '<th scope="row">' + c + '</th>' : '<td' + (i >= numericFrom ? ' class="num"' : '') + '>' + c + '</td>'; }).join('') + '</tr>'; }).join('') +
      '</tbody></table></div>';
  }
  function working(lines, intro) {
    return '<details class="sp-working"><summary>Show working</summary>' + (intro ? '<p>' + intro + '</p>' : '') + '<ol>' + lines.map(function (l) { return '<li>' + l + '</li>'; }).join('') + '</ol></details>';
  }
  function badge(cls) { return '<span class="sp-abc sp-abc--' + cls.toLowerCase() + '">' + cls + '</span>'; }
  function riskBadge(r) { return '<span class="sp-risk sp-risk--' + r.level + '">' + esc(r.label) + '</span>'; }
  function section(id, title, body) { return '<section class="sp-card" aria-labelledby="' + id + '"><h2 id="' + id + '">' + title + '</h2>' + body + '</section>'; }

  function draw() {
    var s = settings, r = analyse(data.items, s), out = '', sector = sectorOf(s.sector);
    var A = r.byValue.filter(function (it) { return it.abc === 'A'; });

    if (data.sample) out += '<p class="notice">Sample data: a made-up hardware shop, so you can see what the planner does. Paste your own list above to analyse your stock.</p>';
    if (data.issues.length) out += '<div class="notice"><p><strong>' + data.issues.length + ' row' + (data.issues.length === 1 ? '' : 's') + ' skipped:</strong></p><ul>' + data.issues.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>';

    // Summary
    out += '<ul class="sp-summary" aria-label="Summary">' +
      '<li><strong>' + K(r.stockValue) + '</strong><span>Stock on hand, at cost</span></li>' +
      '<li><strong>' + num(r.turnover, 1) + '×</strong><span>Stock turnover a year</span></li>' +
      '<li><strong>' + K(r.excessCash) + '</strong><span>Cash tied up in overstock</span></li>' +
      '<li><strong>' + r.atRisk.length + '</strong><span>Item' + (r.atRisk.length === 1 ? '' : 's') + ' at risk of running out</span></li></ul>';

    // 1. ABC
    var aShare = A.reduce(function (a, b) { return a + b.share; }, 0);
    out += section('sp-abc', '1. ABC classification',
      '<p><strong>' + A.length + ' of your ' + r.items.length + ' items</strong> (' + pct(A.length / r.items.length) + ' of the list) make up <strong>' + pct(aShare) + '</strong> of your annual usage value of ' + K(r.totalUsage) + ': ' + A.map(function (it) { return esc(it.name); }).join(', ') + '. These deserve the closest watching and the best supplier terms.</p>' +
      table('Items ranked by annual usage value', ['Item', 'Class', 'Annual usage', 'Cost price', 'Usage value', 'Share', 'Running total'],
        r.byValue.map(function (it) { return [esc(it.name), badge(it.abc), num(it.usage), K(it.cost, 2), K(it.usageValue), pct(it.share), pct(it.cum)]; }), 2) +
      working(r.byValue.map(function (it) {
        return esc(it.name) + ': ' + num(it.usage) + ' × ' + K(it.cost, 2) + ' = ' + K(it.usageValue) + '; running total before it ' + pct(it.cumBefore) + ', so class ' + it.abc + '.';
      }), 'Usage value = annual usage × cost price. Items are sorted from highest to lowest value and given a class from the running total before them: under 80% is A, under 95% is B, the rest are C. Total annual usage value = ' + K(r.totalUsage) + '.'));

    // 2. Overstock
    var over = r.items.filter(function (it) { return it.excess > 0; }).sort(function (a, b) { return b.excessCash - a.excessCash; });
    out += section('sp-over', '2. Overstocked items',
      (over.length ? '<p><strong>' + over.length + ' item' + (over.length === 1 ? '' : 's') + '</strong> hold more than you need, with <strong>' + K(r.excessCash) + '</strong> of cash tied up in the extra units.</p>' +
        table('Overstock and cash tied up', ['Item', 'On hand', 'Days of cover', 'Most to hold', 'Extra units', 'Cash tied up'],
          over.map(function (it) { return [esc(it.name) + (it.dead ? ' <span class="sp-risk sp-risk--out">No usage</span>' : ''), num(it.qty), it.dead ? 'no usage' : num(it.cover, 0), it.dead ? '0' : num(it.max), num(it.excess), K(it.excessCash)]; }), 1) +
        working(over.map(function (it) {
          if (it.dead) return esc(it.name) + ': no usage in a year, so all ' + num(it.qty) + ' units × ' + K(it.cost, 2) + ' = ' + K(it.excessCash) + ' are tied up.';
          return esc(it.name) + ': daily usage ' + num(it.usage) + ' ÷ 365 = ' + num(it.daily, 2) + '; days of cover ' + num(it.qty) + ' ÷ ' + num(it.daily, 2) + ' = ' + num(it.cover, 0) + '; most to hold = reorder level ' + num(it.ltd + it.ss, 2) + ' + ' + s.reviewDays + ' × ' + num(it.daily, 2) + ' = ' + num(it.ltd + it.ss + it.daily * s.reviewDays, 2) + ', rounded up to ' + num(it.max) + '; extra ' + num(it.qty) + ' − ' + num(it.max) + ' = ' + num(it.excess) + '; cash ' + num(it.excess) + ' × ' + K(it.cost, 2) + ' = ' + K(it.excessCash) + '.';
        }), 'Most to hold = reorder level + ' + s.reviewDays + ' days of usage. Extra units = on hand − most to hold. Cash tied up = extra units × cost price.')
        : '<p>No item holds more than its reorder level plus ' + s.reviewDays + ' days of usage. Nicely balanced.</p>'));

    // 3. Stockout risk
    var order = { out: 0, high: 1, order: 2, season: 3 };
    var risk = r.atRisk.slice().sort(function (a, b) { return order[a.risk.level] - order[b.risk.level] || a.cover - b.cover; });
    out += section('sp-risk', '3. Risk of running out',
      (risk.length ? '<p><strong>' + risk.length + ' item' + (risk.length === 1 ? '' : 's') + '</strong> need attention. <strong>High risk</strong>: an order placed today would arrive after the stock has run out. <strong>Order now</strong>: stock is at or below its reorder level. <strong>Busy season</strong>: the coming months are busier than usual, so stock is below the seasonal reorder level.</p>' +
        table('Items at risk of running out', ['Item', 'Status', 'On hand', 'Days left', 'Lead time', 'Reorder level', 'Order'],
          risk.map(function (it) { return [esc(it.name), riskBadge(it.risk), num(it.qty), num(it.cover, 0), days(it.L), num(it.risk.level === 'season' ? it.seasonRol : it.rol), num(Math.max(it.orderQty, it.eoq || 0)) + ' units']; }), 2) +
        working(risk.map(function (it) {
          return esc(it.name) + ': days left ' + num(it.qty) + ' ÷ ' + num(it.daily, 2) + ' a day = ' + num(it.cover, 1) + ' against a lead time of ' + num(it.L) + ' days' + (it.extra ? ' (' + num(it.lead) + ' + ' + it.extra + ' extra)' : '') + '; reorder level ' + num(it.rol) + '. Order ' + (it.eoq ? 'the larger of: ' : '') + 'enough to reach the most to hold, ' + num(it.max) + ' − ' + num(it.qty) + ' = ' + num(it.orderQty) + (it.eoq ? '; or the economic order quantity, ' + num(it.eoq) : '') + '.';
        }), 'Days left = on hand ÷ daily usage. High risk: days left is less than the lead time. Order now: stock is at or below the reorder level.') +
        '<p class="sp-buttons"><a class="btn btn--primary" id="sp-wa" href="' + esc(waOrder(risk)) + '" target="_blank" rel="noopener noreferrer">Send this reorder list on WhatsApp</a></p><p class="hint">Opens WhatsApp so you can choose your supplier and check the message before sending.</p>'
        : '<p>Nothing is at risk: every item has more stock than its reorder level.</p>') +
      orderBy(r));

    // 4. Reorder levels for A items
    out += section('sp-rol', '4. Reorder levels for A-class items',
      '<p>Reorder when stock falls to this level. Safety factor ' + s.localFactor + ' for local suppliers, ' + s.importFactor + ' for imports.</p>' +
      table('Suggested reorder levels for A-class items', ['Item', 'Source', 'Daily usage', 'Lead time', 'Lead-time demand', 'Safety stock', 'Reorder level'].concat(s.orderCost > 0 ? ['Order quantity (EOQ)'] : []),
        A.map(function (it) { return [esc(it.name), (it.imported ? 'Import' : 'Local') + (it.inferred ? ' (assumed)' : ''), num(it.daily, 2), days(it.L), num(it.ltd, 1), num(it.ss, 1), '<strong>' + num(it.rol) + '</strong>'].concat(s.orderCost > 0 ? [it.eoq ? num(it.eoq) : '–'] : []); }), 2) +
      working(A.map(function (it) {
        return esc(it.name) + ': daily usage ' + num(it.usage) + ' ÷ 365 = ' + num(it.daily, 4) + '; lead-time demand ' + num(it.daily, 4) + ' × ' + num(it.L) + ' days = ' + num(it.ltd, 2) + '; safety stock ' + it.factor + ' × ' + num(it.ltd, 2) + ' = ' + num(it.ss, 2) + '; reorder level ' + num(it.ltd, 2) + ' + ' + num(it.ss, 2) + ' = ' + num(it.ltd + it.ss, 2) + ', rounded up to <strong>' + num(it.rol) + '</strong>.' +
          (it.eoq ? ' EOQ = √(2 × ' + num(it.usage) + ' × ' + K(s.orderCost) + ' ÷ ' + K(it.holding, 2) + ') = ' + num(Math.sqrt(2 * it.usage * s.orderCost / it.holding), 1) + ', rounded up to ' + num(it.eoq) + '.' : '');
      }), 'Daily usage = annual usage ÷ 365. Lead-time demand = daily usage × lead time. Safety stock = safety factor × lead-time demand. Reorder level = lead-time demand + safety stock.' + (s.orderCost > 0 ? ' Economic order quantity (EOQ) = √(2 × annual usage × order cost ÷ yearly holding cost per unit).' : '')));

    // 5. Turnover
    var verdict = r.turnover < s.low ? 'below the healthy range, so stock is sitting too long and holding cash you could use elsewhere'
      : r.turnover > s.high ? 'above the healthy range, which is good for cash but check you aren\'t running out and losing sales'
      : 'within the healthy range';
    out += section('sp-turn', '5. Stock turnover',
      '<p>You turn your stock over <strong>' + num(r.turnover, 1) + ' times a year</strong>, about every <strong>' + (r.turnover > 0 ? days(365 / r.turnover) : 'never') + '</strong>. For ' + esc(sector.name.toLowerCase()) + ', a range of ' + s.low + ' to ' + s.high + ' times a year is a common rule of thumb, so you are ' + verdict + '.</p>' +
      working(['Cost of goods used in a year = Σ (annual usage × cost price) = ' + K(r.totalUsage) + '.',
        'Stock on hand at cost = Σ (quantity on hand × cost price) = ' + K(r.stockValue) + '.',
        'Turnover = ' + K(r.totalUsage) + ' ÷ ' + K(r.stockValue) + ' = ' + num(r.turnover, 2) + ' times a year.',
        'Days of stock = 365 ÷ ' + num(r.turnover, 2) + ' = ' + (r.turnover > 0 ? num(365 / r.turnover, 0) : '–') + ' days.']));

    // 6. Actions
    var acts = actions(r, s);
    out += section('sp-act', '6. Five actions that free up the most cash',
      acts.length ? '<ol class="sp-actions">' + acts.map(function (a) { return '<li><span class="sp-cash">' + K(a.cash) + '</span><p>' + a.html + (a.promo ? ' <a href="#/seller">Create a promotion in your Seller Centre</a>.' : '') + '</p></li>'; }).join('') + '</ol>' +
        (acts.length < 5 ? '<p class="hint">Only ' + acts.length + ' action' + (acts.length === 1 ? '' : 's') + ' would free up cash. The rest of your stock is already in balance.</p>' : '') +
        '<p class="hint">Amounts are at cost price and are estimates. They overlap with the overstock figures in section 2, so don\'t add them to that total.</p>'
        : '<p>No overstock or idle stock found, so there\'s no cash to free up from stock right now.</p>');

    // Forecast and seasons
    out += forecast(r);

    // Assumptions and tools
    out += section('sp-assume', 'Assumptions', '<ul class="sp-assume">' + assumptions(r, s, data.notes).map(function (a) { return '<li>' + a + '</li>'; }).join('') + '</ul>');
    out += section('sp-tools', 'Take it further',
      '<div class="sp-buttons"><button class="btn btn--secondary" type="button" id="sp-csv">Download results (CSV)</button><button class="btn btn--secondary" type="button" id="sp-ai">Copy for an AI assistant</button></div>' +
      '<p class="hint">"Copy for an AI assistant" copies your list and the questions above, ready to paste into ChatGPT, Claude, Copilot or Gemini for a second opinion. Anything you paste is shared with that service.</p>');

    var box = root.querySelector('#sp-results');
    box.innerHTML = out;
    data.result = r;
  }

  function orderBy(r) {
    var soon = r.items.filter(function (it) { return !it.risk && it.daily > 0 && isFinite(it.cover); })
      .map(function (it) { it.untilRol = (it.qty - it.rol) / it.daily; return it; })
      .filter(function (it) { return it.untilRol <= 60; })
      .sort(function (a, b) { return a.untilRol - b.untilRol; });
    if (!soon.length) return '';
    return '<h3>Coming up in the next 60 days</h3><ul class="sp-assume">' + soon.map(function (it) {
      return '<li><strong>' + esc(it.name) + '</strong>: order by about <strong>' + addDays(it.untilRol) + '</strong> (' + num(it.qty) + ' − ' + num(it.rol) + ' = ' + num(it.qty - it.rol) + ' units above the reorder level ÷ ' + num(it.daily, 2) + ' a day = ' + days(it.untilRol) + ').</li>';
    }).join('') + '</ul>';
  }

  function forecast(r) {
    var f = r.items.filter(function (it) { return it.next; });
    var tips = '<h3>Zambian seasons to plan for</h3><ul class="sp-assume">' +
      '<li><strong>School terms</strong> start around January, May and September, so stationery, uniforms, bags and shoes sell faster in the weeks before.</li>' +
      '<li><strong>The farming season</strong>: seed, fertiliser, sprayers and tools sell most before and during planting, as the rains arrive from about October to December.</li>' +
      '<li><strong>Independence (24 October) and the festive season</strong> in December lift gifts, fashion, food and electronics.</li>' +
      '<li><strong>The rainy season</strong> (about November to April) can slow road deliveries, so try a few extra days of lead time in the settings.</li>' +
      '<li><strong>Imports from China</strong>: many factories close for two to four weeks around Chinese New Year (late January to February), so order earlier.</li></ul>';
    if (!f.length) return section('sp-fc', 'Forecast', '<p>Add monthly sales columns (<strong>Jan</strong> to <strong>Dec</strong>) to your list and the planner will forecast the next three months for each item, find its busiest month and raise reorder levels before a busy season.</p>' + tips);
    var heads = ['Item'].concat(f[0].next.map(function (n) { return MONTHS[n.m]; }), ['Next 3 months', 'Flat average', 'Busiest month', 'Outlook']);
    return section('sp-fc', 'Forecast: the next three months',
      '<p>Based on the same months last year, for the ' + f.length + ' item' + (f.length === 1 ? '' : 's') + ' with 12 months of sales.</p>' +
      table('Three-month forecast', heads, f.map(function (it) {
        var outlook = it.busy ? 'Busier than usual: raise reorder level to ' + num(it.seasonRol) : it.quiet ? 'Quieter than usual: hold less' : 'About usual';
        return [esc(it.name)].concat(it.next.map(function (n) { return num(n.v); }), [num(it.next3), num(it.usage / 4, 0), MONTH_NAMES[it.peak], outlook]);
      }), 1) +
      working(f.map(function (it) {
        return esc(it.name) + ': next 3 months ' + it.next.map(function (n) { return num(n.v); }).join(' + ') + ' = ' + num(it.next3) + ', against a flat ' + num(it.usage) + ' ÷ 4 = ' + num(it.usage / 4, 1) + '. Daily rate ' + num(it.next3) + ' ÷ 91 = ' + num(it.dNext, 2) + ' (usual ' + num(it.daily, 2) + '). Seasonal reorder level ' + num(it.dNext, 2) + ' × ' + num(it.L) + ' days × (1 + ' + it.factor + ') = ' + num(it.dNext * it.L * (1 + it.factor), 2) + ', rounded up to ' + num(it.seasonRol) + '.';
      }), 'Forecast = the same month last year. "Busier" means the next three months run more than 20% above the usual daily rate, "quieter" more than 20% below.') + tips);
  }

  /* ---------- Exports ---------- */
  function waOrder(list) {
    var lines = list.map(function (it) { return '- ' + (it.sku ? it.sku + ' ' : '') + (it.desc || '') + ': ' + num(Math.max(it.orderQty, it.eoq || 0, 1)) + ' units'; });
    return 'https://wa.me/?text=' + encodeURIComponent('Hello, I would like to order:\n' + lines.join('\n') + '\nPlease confirm the price and delivery date. Thank you.');
  }
  function csvCell(v) {
    var t = String(v == null ? '' : v);
    if (/^[=+\-@\t\r]/.test(t)) t = "'" + t;   // stop spreadsheets running a cell as a formula
    return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
  }
  function download(name, text) {
    var url = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }));
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  function resultsCsv(r) {
    var head = ['SKU', 'Description', 'Class', 'On hand', 'Cost price', 'Annual usage', 'Usage value', 'Source', 'Lead time (days)', 'Daily usage', 'Safety stock', 'Reorder level', 'Most to hold', 'Days of cover', 'Extra units', 'Cash tied up', 'Risk', 'Order quantity'];
    var rows = r.byValue.map(function (it) {
      return [it.sku, it.desc, it.abc, it.qty, it.cost.toFixed(2), it.usage, it.usageValue.toFixed(2), (it.imported ? 'import' : 'local') + (it.inferred ? ' (assumed)' : ''), it.L, it.daily.toFixed(4), it.ss.toFixed(2), it.rol, it.max, isFinite(it.cover) ? it.cover.toFixed(1) : '', it.excess, it.excessCash.toFixed(2), it.risk ? it.risk.label : '', it.risk ? Math.max(it.orderQty, it.eoq || 0) : ''];
    });
    return [head].concat(rows).map(function (row) { return row.map(csvCell).join(','); }).join('\r\n');
  }
  function aiPrompt() {
    var s = settings, r = data.result;
    var rows = r.items.map(function (it) { return [it.sku, it.desc, it.qty, it.cost, it.usage, it.lead, it.inferred ? '' : (it.imported ? 'import' : 'local')].map(csvCell).join(','); });
    return 'Here\'s my stock data: SKU, description, quantity on hand, cost price (Kwacha), annual usage, supplier lead time in days, source (local or import, blank if not known). I\'m a ' + sectorOf(s.sector).name.toLowerCase() + ' business in Zambia.\n\n' +
      'SKU,Description,Quantity on hand,Cost price,Annual usage,Lead time (days),Source\n' + rows.join('\n') + '\n\n' +
      'Analyse it and tell me:\n' +
      '1. ABC classification: which items are 80% of my inventory value?\n' +
      '2. Which items are overstocked relative to their usage? Estimate how much cash is tied up in each.\n' +
      '3. Which items are at risk of stockout given their lead times?\n' +
      '4. Calculate a suggested reorder level for each A-class item, using a safety stock factor of ' + s.localFactor + ' for local suppliers and ' + s.importFactor + ' for imports.\n' +
      '5. My stock turnover ratio, and whether that\'s healthy for my industry.\n' +
      '6. The five specific actions that would free up the most cash.\n\n' +
      'Show your working for the calculations so I can check them. Flag any assumption you had to make.';
  }
  function copy(text) {
    var done = function () { H.toast('Copied. Paste it into your AI assistant.'); };
    var fallback = function () {
      var t = document.createElement('textarea');
      t.value = text; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0';
      document.body.appendChild(t); t.select();
      try { document.execCommand('copy'); done(); } catch (e) { H.toast('Copying was blocked. Select the text in your list and copy it yourself.'); }
      t.remove();
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback); else fallback();
  }
  function onResultsClick(e) {
    if (!data || !data.result) return;
    if (e.target.closest('#sp-csv')) download('stock-planner-results.csv', resultsCsv(data.result));
    if (e.target.closest('#sp-ai')) copy(aiPrompt());
  }

  window.ZSStock = {
    mount: function (el, helpers) {
      H = helpers; root = el; data = null;
      settings = loadSettings();
      render();
    }
  };
})();
