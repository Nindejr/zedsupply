// js/delivery.js prices delivery in the browser; app.delivery_quote() prices it on the server.
// These cases use the same rate card and expect the same fees as db/tests/checkout_delivery.sql,
// so a change to one rule that isn't made in the other fails here or there.
const { test } = require('node:test');
const assert = require('node:assert/strict');
// Loaded as the browser loads it: a plain script that sets window.ZS_DELIVERY
const sandboxD = { window: {} };
require('node:vm').runInNewContext(require('node:fs').readFileSync('js/delivery.js', 'utf8'), sandboxD);
const D = sandboxD.ZS_DELIVERY;
// Arrays from the script's own context compare by value only after a copy
const same = (a, b, m) => assert.deepEqual(JSON.parse(JSON.stringify(a)), b, m);

const rates = [
  { zone: 'town', speed: 'standard', fee: 45, kg: 5, perKg: 5, days: [1, 2] },
  { zone: 'town', speed: 'express', fee: 85, kg: 5, perKg: 8, days: [1, 1] },
  { zone: 'town', speed: 'same_day', fee: 120, kg: 5, perKg: 10 },
  { zone: 'country', speed: 'standard', fee: 150, kg: 5, perKg: 12, days: [3, 7] },
  { zone: 'country', speed: 'express', fee: 290, kg: 5, perKg: 20, days: [2, 3] },
  { courier: 'zampost', zone: 'country', speed: 'standard', fee: 125, kg: 5, perKg: 10, days: [4, 8] },
  { zone: 'town', speed: 'truck', fee: 450, kg: 500, perKg: 0.6, days: [1, 3] }
];
// Three 2 kg kettles from a Lusaka store; one lamp without a weight (1 kg) from Kitwe
const parcels = [{ id: 'da', zone: 'town', kg: 6 }, { id: 'db', zone: 'country', kg: 1 }];
const q = (extra = {}) => D.quote({ rates, parcels, itemsTotal: 500, free: {}, ...extra });
const fee = (r, id) => r.parcels.find(p => p.id === id).fee;

test('each parcel is priced by zone, speed and weight over what the rate includes', () => {
  const r = q();
  assert.equal(fee(r, 'da'), 50);
  assert.equal(fee(r, 'db'), 150);
  assert.equal(r.total, 200);
  assert.equal(q({ speed: 'express' }).total, 93 + 290);
  assert.equal(D.feeFor({ fee: 45, kg: 5, perKg: 5 }, 5.01), 50, 'part of a kilogram counts as one');
  assert.equal(D.feeFor({ fee: 45, kg: 5, perKg: 5 }, 5), 45);
});

test('a courier\'s own price replaces Zed Supply\'s on its route only', () => {
  const r = q({ courier: 'zampost' });
  assert.equal(fee(r, 'db'), 125);
  assert.equal(fee(r, 'da'), 50);
  assert.equal(r.parcels.find(p => p.id === 'db').courier, 'zampost');
});

test('same day needs the seller to offer it; otherwise the parcel goes express and says so', () => {
  const r = q({ speed: 'same_day', parcels: [{ id: 'da', zone: 'town', kg: 6, sameDay: true }, { id: 'db', zone: 'country', kg: 1 }] });
  const a = r.parcels.find(p => p.id === 'da'), b = r.parcels.find(p => p.id === 'db');
  same([a.speed, a.fee, a.days], ['same_day', 130, [0, 0]]);
  same([b.speed, b.note], ['express', 'fallback']);
});

test('standard delivery is free above the threshold in its zones, and the gap is shown below it', () => {
  const free = { min: 500, zones: ['town', 'province'] };
  let r = q({ free, itemsTotal: 600 });
  assert.equal(fee(r, 'da'), 0);
  assert.equal(r.parcels.find(p => p.id === 'da').free, true);
  assert.equal(fee(r, 'db'), 150, 'not across the country');
  assert.equal(r.freeGap, null);
  r = q({ free, itemsTotal: 499 });
  assert.equal(fee(r, 'da'), 50);
  assert.equal(r.freeGap, 1);
  assert.equal(fee(q({ free, itemsTotal: 600, speed: 'express' }), 'da'), 93, 'free delivery is for standard only');
  r = D.quote({ rates, parcels: [{ id: 'da', zone: 'town', kg: 1 }], itemsTotal: 900, free });
  assert.equal(r.total, 0);
  assert.equal(r.free, true);
});

test('heavy items go by truck; an unknown place or a missing rate waits for a quote', () => {
  assert.equal(D.quote({ rates, parcels: [{ id: 'da', zone: 'town', kg: 100, heavy: true }], itemsTotal: 0 }).total, 450);
  let r = D.quote({ rates, parcels: [{ id: 'db', zone: 'country', kg: 50, heavy: true }], itemsTotal: 0 });
  assert.equal(r.pending, true);
  assert.equal(r.total, null);
  assert.equal(r.parcels[0].note, 'truck');
  r = D.quote({ rates, parcels: [{ id: 'da', zone: '', kg: 1 }], itemsTotal: 0 });
  same([r.pending, r.parcels[0].note], [true, 'location']);
});

test('the speeds offered are the ones every parcel can actually use', () => {
  const speeds = o => D.options(o).map(x => x.speed);
  same(speeds({ rates, parcels, itemsTotal: 0 }), ['standard', 'express']);
  same(speeds({ rates, parcels: [{ id: 'da', zone: 'town', kg: 1, sameDay: true }], itemsTotal: 0 }), ['standard', 'express', 'same_day']);
  same(speeds({ rates: [], parcels, itemsTotal: 0 }), [], 'no rate card, no choices');
});

test('the sample rate card is complete and matches the zones and speeds the server accepts', () => {
  const fs = require('node:fs'), vm = require('node:vm');
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync('js/catalogue-sample.js', 'utf8'), sandbox);
  const X = sandbox.window.ZS_SAMPLE, ids = new Set();
  sandbox.window = {};
  vm.runInNewContext(fs.readFileSync('js/couriers.js', 'utf8'), sandbox);
  sandbox.window.ZS_COURIERS.profiles.forEach(p => ids.add(p.id));
  for (const r of X.deliveryRates) {
    assert.ok(['town', 'province', 'country'].includes(r.zone), JSON.stringify(r));
    assert.ok(['standard', 'express', 'same_day', 'truck'].includes(r.speed), JSON.stringify(r));
    assert.ok(r.fee >= 0 && r.kg >= 0 && (r.perKg || 0) >= 0, JSON.stringify(r));
    if (r.courier) assert.ok(ids.has(r.courier), 'unknown courier ' + r.courier);
    if (r.days) assert.ok(r.days[0] <= r.days[1], JSON.stringify(r));
  }
  for (const zone of ['town', 'province', 'country']) assert.ok(X.deliveryRates.some(r => r.zone === zone && r.speed === 'standard' && !r.courier), zone);
  const keys = X.deliveryRates.map(r => [r.courier || '', r.zone, r.speed].join('/'));
  assert.equal(new Set(keys).size, keys.length, 'one rate per courier, zone and speed, as the server requires');
});
