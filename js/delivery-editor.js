/* Zed Supply — the delivery price editor: the rate card (courier, zone, speed, fee, kilograms,
   price per extra kilogram, days, in use), free delivery, same day, the default parcel weight,
   the sending town and closed days. Used by the shop's demo back office (js/main.js) and the
   admin page (/admin/); each saves through its own function: this device in the demo, the
   logged staff functions on the server.

   ZSDeliveryEditor({ esc, couriers: [{ id, name, profile, unlicensed }], towns: [{ name, province }], days })
     → { html(settings), read(form), bind(form, save) } */
(function () {
  'use strict';
  window.ZSDeliveryEditor = function (deps) {
    var esc = deps.esc, COURIERS = deps.couriers || [], TOWNS = deps.towns || [], DAYS = deps.days || ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    var ZD = window.ZS_DELIVERY || null;
    function $(sel, scope) { return (scope || document).querySelector(sel); }
    function $$(sel, scope) { return Array.prototype.slice.call((scope || document).querySelectorAll(sel)); }
    function cleanText(v, max) { return String(v || '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max); }
    function townInfo(name) { var n = String(name || '').trim().toLowerCase(); return TOWNS.filter(function (t) { return t.name.toLowerCase() === n; })[0] || null; }
    function byName(a, b) { return a.name.localeCompare(b.name); }
    var ZONE_NAMES = { town: 'Same town', province: 'Same province', country: 'Elsewhere in Zambia' };
    function deliveryEditorHTML(x) {
      var f = x.freeDelivery || {}, sd = x.sameDay || {}, closed = (x.closedDays || []).map(Number), o = x.origin || {};
      var list = COURIERS.filter(function (c) { return c.profile || !c.unlicensed; }).slice().sort(byName);
      var opts = function (map, cur) { return Object.keys(map).map(function (k) { return '<option value="' + k + '"' + (k === cur ? ' selected' : '') + '>' + esc(map[k]) + '</option>'; }).join(''); };
      var courierOpts = function (cur) { return '<option value="">Any courier: Zed Supply rate</option>' + list.map(function (c) { return '<option value="' + esc(c.id) + '"' + (c.id === cur ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join(''); };
      var row = function (r, i) {
        var n = 'Rate ' + (i + 1), d = r.days || [];
        return '<tr data-rate-row' + (r.id ? ' data-rate-id="' + esc(r.id) + '"' : '') + '>' +
          '<td><select data-f="courier" aria-label="' + n + ': courier">' + courierOpts(r.courier || '') + '</select></td>' +
          '<td><select data-f="zone" aria-label="' + n + ': where it goes">' + opts(ZONE_NAMES, r.zone) + '</select></td>' +
          '<td><select data-f="speed" aria-label="' + n + ': speed">' + opts(ZD ? ZD.NAMES : {}, r.speed) + '</select></td>' +
          '<td><input data-f="fee" type="number" min="0" max="100000" step="0.01" inputmode="decimal" required aria-label="' + n + ': fee in kwacha" value="' + esc(r.fee != null ? Number(r.fee) : '') + '"></td>' +
          '<td><input data-f="kg" type="number" min="0" step="0.1" inputmode="decimal" required aria-label="' + n + ': kilograms included" value="' + esc(r.kg != null ? Number(r.kg) : 5) + '"></td>' +
          '<td><input data-f="perKg" type="number" min="0" step="0.01" inputmode="decimal" required aria-label="' + n + ': kwacha per extra kilogram" value="' + esc(r.perKg != null ? Number(r.perKg) : 0) + '"></td>' +
          '<td><input data-f="min" type="number" min="0" max="60" step="1" inputmode="numeric" aria-label="' + n + ': fewest working days" value="' + esc(d[0] != null ? d[0] : '') + '"></td>' +
          '<td><input data-f="max" type="number" min="0" max="60" step="1" inputmode="numeric" aria-label="' + n + ': most working days" value="' + esc(d[1] != null ? d[1] : '') + '"></td>' +
          '<td><input data-f="active" type="checkbox" aria-label="' + n + ': in use"' + (r.active === false ? '' : ' checked') + '></td>' +
          '<td><button class="link-btn link-btn--danger" type="button" data-rate-remove>Remove<span class="visually-hidden"> ' + n + '</span></button></td></tr>';
      };
      return '<form class="form form--card delivery-editor" id="delivery-editor" novalidate><h2>Delivery prices</h2>' +
        '<p class="hint">Each seller\'s parcel is priced from this card: the fee covers the first kilograms shown, then each further kilogram is added. A courier\'s own price replaces the Zed Supply rate when buyers choose that courier. Same day needs the seller to offer it, a same-day town and an order before the cut-off.</p>' +
        '<div class="cmp" role="region" tabindex="0" aria-label="Delivery rates (scrolls sideways)"><table class="rate-table"><thead><tr><th scope="col">Courier</th><th scope="col">Where</th><th scope="col">Speed</th><th scope="col">Fee (K)</th><th scope="col">Kg included</th><th scope="col">K per extra kg</th><th scope="col">Days from</th><th scope="col">Days to</th><th scope="col">In use</th><th scope="col"><span class="visually-hidden">Remove</span></th></tr></thead>' +
        '<tbody data-rate-body>' + (x.rates || []).map(row).join('') + '</tbody></table></div>' +
        '<button class="btn btn--secondary btn--sm" type="button" data-rate-add>Add a rate</button>' +
        '<fieldset class="field"><legend>Free standard delivery</legend><div class="field-row"><div class="field"><label for="de-free">For items worth at least (K)</label><input id="de-free" type="number" min="0" step="1" inputmode="numeric" value="' + esc(f.min != null ? f.min : '') + '" aria-describedby="de-free-hint"><p class="hint" id="de-free-hint">Leave empty for no free delivery.</p></div>' +
          '<div class="field"><span class="field__label">In these zones</span><div class="checks">' + Object.keys(ZONE_NAMES).map(function (z) { return '<div class="check"><input type="checkbox" id="de-fz-' + z + '" value="' + z + '"' + ((f.zones || []).indexOf(z) !== -1 ? ' checked' : '') + '><label for="de-fz-' + z + '">' + ZONE_NAMES[z] + '</label></div>'; }).join('') + '</div></div></div></fieldset>' +
        '<fieldset class="field"><legend>Same day</legend><div class="field-row"><div class="field"><label for="de-cut">Order by (hour, Zambia time)</label><input id="de-cut" type="number" min="0" max="23" step="1" required value="' + esc(sd.cutoff != null ? sd.cutoff : 11) + '"></div>' +
          '<div class="field"><label for="de-towns">Towns, separated by commas</label><input id="de-towns" maxlength="1000" value="' + esc((sd.towns || []).join(', ')) + '"></div></div></fieldset>' +
        '<fieldset class="field"><legend>Other settings</legend><div class="field-row"><div class="field"><label for="de-kg">Weight to assume for an item without one (kg)</label><input id="de-kg" type="number" min="0.1" max="1000" step="0.1" required value="' + esc(x.defaultKg || 1) + '"></div>' +
          '<div class="field"><label for="de-otown">Items without a seller location are sent from</label><input id="de-otown" maxlength="60" list="de-town-list" value="' + esc(o.town || '') + '"><datalist id="de-town-list">' + TOWNS.map(function (t) { return '<option value="' + esc(t.name) + '">'; }).join('') + '</datalist></div></div>' +
          '<div class="field"><span class="field__label">Closed days (no deliveries)</span><div class="checks">' + DAYS.map(function (dn, i) { return '<div class="check"><input type="checkbox" id="de-cd-' + i + '" value="' + i + '"' + (closed.indexOf(i) !== -1 ? ' checked' : '') + '><label for="de-cd-' + i + '">' + dn + '</label></div>'; }).join('') + '</div></div></fieldset>' +
        '<div class="btn-row"><button class="btn btn--primary" type="submit">Save delivery prices</button></div><p class="form-status" role="status" aria-live="polite"></p>' +
        '<template data-rate-template>' + row({ zone: 'town', speed: 'standard', kg: 5, perKg: 0 }, (x.rates || []).length) + '</template></form>';
    }
    // The editor's values, checked: { rates, removed, freeDelivery, defaultKg, origin, sameDay, closedDays } or { error }
    function readDeliveryEditor(form) {
      var num = function (v) { return v === '' || v == null ? null : Number(v); }, seen = {}, error = '';
      var rates = $$('[data-rate-row]', form).map(function (tr, i) {
        var g = function (k) { return $('[data-f="' + k + '"]', tr); }, r = { id: tr.getAttribute('data-rate-id') || null, courier: g('courier').value || null, zone: g('zone').value, speed: g('speed').value,
          fee: num(g('fee').value), kg: num(g('kg').value), perKg: num(g('perKg').value), active: g('active').checked };
        var lo = num(g('min').value), hi = num(g('max').value), key = [r.courier || '', r.zone, r.speed].join('/');
        r.days = lo != null && hi != null ? [lo, hi] : null;
        if (!error && (r.fee == null || !Number.isFinite(r.fee) || !(r.fee >= 0) || Math.abs(Math.round(r.fee * 100) - r.fee * 100) > 0.000001)) error = 'Rate ' + (i + 1) + ': enter a fee in kwacha.';
        if (!error && (r.kg == null || r.kg < 0 || r.perKg == null || r.perKg < 0)) error = 'Rate ' + (i + 1) + ': enter the kilograms included and the price per extra kilogram.';
        if (!error && ((lo == null) !== (hi == null) || lo > hi)) error = 'Rate ' + (i + 1) + ': enter the working days as fewest and most, or leave both empty.';
        if (!error && seen[key]) error = 'Rate ' + (i + 1) + ' repeats rate ' + seen[key] + ': one rate per courier, zone and speed.';
        seen[key] = i + 1;
        return r;
      });
      var free = num($('#de-free', form).value), cut = num($('#de-cut', form).value), dkg = num($('#de-kg', form).value), town = cleanText($('#de-otown', form).value, 60);
      if (!error && free != null && !(free >= 0)) error = 'Enter the free-delivery amount, or leave it empty.';
      if (!error && (cut == null || cut < 0 || cut > 23 || cut % 1)) error = 'Enter the same-day cut-off as an hour from 0 to 23.';
      if (!error && !(dkg > 0)) error = 'Enter the weight to assume for items without one.';
      if (!error && town && !townInfo(town)) error = 'Choose the sending town from the list.';
      if (error) return { error: error };
      return { rates: rates, removed: (form.getAttribute('data-removed') || '').split(',').filter(Boolean),
        freeDelivery: { min: free, zones: $$('[id^="de-fz-"]:checked', form).map(function (c) { return c.value; }) }, defaultKg: dkg,
        origin: town ? { town: townInfo(town).name, province: townInfo(town).province } : null,
        sameDay: { cutoff: cut, towns: $('#de-towns', form).value.split(',').map(function (t) { return t.trim(); }).filter(Boolean) },
        closedDays: $$('[id^="de-cd-"]:checked', form).map(function (c) { return Number(c.value); }) };
    }
    function bindDeliveryEditor(form, save) {
      var status = $('[role="status"]', form), body = $('[data-rate-body]', form), tpl = $('[data-rate-template]', form);
      form.addEventListener('click', function (e) {
        if (e.target.closest('[data-rate-add]')) { body.insertAdjacentHTML('beforeend', tpl.innerHTML); var last = body.lastElementChild; $('[data-f="fee"]', last).focus(); }
        var rm = e.target.closest('[data-rate-remove]');
        if (rm) { var tr = rm.closest('tr'), id = tr.getAttribute('data-rate-id'); if (id) form.setAttribute('data-removed', (form.getAttribute('data-removed') || '') + ',' + id); tr.remove(); status.textContent = 'Rate removed. Save to keep the change.'; }
      });
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var x = readDeliveryEditor(form), btn = $('button[type="submit"]', form);
        status.className = 'form-status' + (x.error ? ' is-error' : '');
        if (x.error) { status.textContent = x.error; return; }
        btn.disabled = true; status.textContent = 'Saving…';
        Promise.resolve(save(x)).then(function () { status.textContent = 'Delivery prices saved. The cart uses them straight away.'; }, function (err) { status.className = 'form-status is-error'; status.textContent = (err && err.message) || 'Couldn\'t save. Try again.'; })
          .then(function () { btn.disabled = false; });
      });
    }
    return { html: deliveryEditorHTML, read: readDeliveryEditor, bind: bindDeliveryEditor, ZONE_NAMES: ZONE_NAMES };
  };
})();
