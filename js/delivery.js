/* Zed Supply — delivery fees.

   One rule for the cart, the review window, the receipt and the server: each seller sends its
   own parcel, so each parcel is priced from the rate card for how far it travels (zone) and how
   fast (speed), plus a charge per kilogram over what the rate includes. The database applies the
   same rule in app.delivery_quote() (supabase/migrations, checkout_delivery), so the fee a buyer
   sees is the fee they're charged. tests/delivery.test.cjs checks both stay in step.

   rates: [{ zone, speed, fee, kg, perKg, days: [fewest, most], courier }]
     zone   'town' (same town), 'province' (same province) or 'country' (elsewhere in Zambia)
     speed  'standard', 'express', 'same_day', or 'truck' for heavy and bulky items
     fee    kwacha for the first `kg` kilograms; perKg for each further kilogram or part of one
     courier  optional: a courier's own price for that zone and speed. Without one, the
              Zed Supply rate applies whichever courier carries it.
   free: { min, zones } — standard delivery is free in these zones once the items reach `min`.

   A parcel that can't go at the chosen speed drops to the next one (same day → express →
   standard) and says so; one with no rate, or with an unknown zone, is left to be quoted. */
(function (root) {
  'use strict';
  var SPEEDS = ['standard', 'express', 'same_day'];
  var NAMES = { standard: 'Standard', express: 'Express', same_day: 'Same day', truck: 'Truck delivery' };
  var FALLBACK = { same_day: 'express', express: 'standard' };

  function money(n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; }

  // The courier's own rate when there is one, otherwise Zed Supply's
  function rateFor(rates, zone, speed, courier) {
    var own = null, house = null;
    (rates || []).forEach(function (r) {
      if (!r || r.active === false || r.zone !== zone || r.speed !== speed) return;
      if (r.courier) { if (courier && r.courier === courier) own = r; } else house = r;
    });
    return own || house;
  }

  function feeFor(rate, kg) {
    var extra = Math.max(0, Math.ceil(money((Number(kg) || 0) - (Number(rate.kg) || 0))));
    return money(Number(rate.fee) + extra * (Number(rate.perKg) || 0));
  }

  function freeHere(o, zone) {
    var f = o.free || {};
    return f.min != null && Number(f.min) >= 0 && (f.zones || []).indexOf(zone) !== -1;
  }

  // One parcel: { id, zone, kg, heavy, sameDay } at the speed asked for
  function priceParcel(o, parcel, asked) {
    var out = { id: parcel.id, zone: parcel.zone || '', kg: money(parcel.kg || 0), asked: asked, speed: parcel.heavy ? 'truck' : asked,
      fee: null, free: false, days: null, pending: false, note: '', courier: '' };
    if (!out.zone) { out.pending = true; out.note = 'location'; return out; }
    if (out.speed === 'same_day' && !parcel.sameDay) { out.speed = 'express'; out.note = 'fallback'; }
    var rate = rateFor(o.rates, out.zone, out.speed, o.courier);
    while (!rate && FALLBACK[out.speed]) { out.speed = FALLBACK[out.speed]; out.note = 'fallback'; rate = rateFor(o.rates, out.zone, out.speed, o.courier); }
    if (!rate) { out.pending = true; out.note = parcel.heavy ? 'truck' : 'no-rate'; return out; }
    out.courier = rate.courier || '';
    out.days = out.speed === 'same_day' ? [0, 0] : rate.days || null;
    if (out.speed === 'standard' && freeHere(o, out.zone) && money(o.itemsTotal) >= Number(o.free.min)) { out.fee = 0; out.free = true; }
    else out.fee = feeFor(rate, out.kg);
    return out;
  }

  /* quote({ rates, parcels, speed, courier, itemsTotal, free }) →
       { speed, parcels: [...], total (null while any parcel waits for a quote), pending, free,
         freeGap: kwacha more for free standard delivery (null when it doesn't apply) } */
  function quote(o) {
    var asked = SPEEDS.indexOf(o.speed) === -1 ? 'standard' : o.speed;
    var parcels = (o.parcels || []).map(function (p) { return priceParcel(o, p, asked); });
    var pending = parcels.some(function (p) { return p.pending; });
    var total = pending ? null : money(parcels.reduce(function (n, p) { return n + p.fee; }, 0));
    var gap = null, f = o.free || {};
    if (f.min != null && money(o.itemsTotal) < Number(f.min) && parcels.some(function (p) { return !p.pending && p.speed === 'standard' && freeHere(o, p.zone); }))
      gap = money(Number(f.min) - money(o.itemsTotal));
    return { speed: asked, parcels: parcels, total: total, pending: pending, free: parcels.length > 0 && total === 0, freeGap: gap };
  }

  /* The speeds worth offering for this cart: a speed is offered when every parcel that isn't a
     truck delivery can actually go that way. Returns [{ speed, name, quote }]. */
  function options(o) {
    if (!(o.rates || []).length) return [];
    return SPEEDS.map(function (s) {
      var q = quote(Object.assign({}, o, { speed: s }));
      var ok = !q.pending ? q.parcels.every(function (p) { return p.speed === 'truck' || p.speed === s; }) : s === 'standard';
      return ok ? { speed: s, name: NAMES[s], quote: q } : null;
    }).filter(Boolean);
  }

  root.ZS_DELIVERY = { SPEEDS: SPEEDS, NAMES: NAMES, rateFor: rateFor, feeFor: feeFor, quote: quote, options: options };
})(this);
