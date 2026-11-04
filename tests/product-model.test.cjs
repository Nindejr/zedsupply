const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync('js/products.js', 'utf8'), sandbox);
const P = sandbox.window.ZSProduct;
const ctx = { departments: [{ id: 'tech' }], brands: [], products: [] };
const draft = () => ({ title: 'Test', seller: 'test', category: 'tech', priceZMW: 10.25, stock: 'in',
  options: { colour: [{ name: 'Blue', hex: '#0057AE' }], size: ['M'] },
  variants: [{ sku: 'TEST-M', colour: 'Blue', size: 'M', stock: 2, priceZMW: 11.25, image: 'blue.webp' }],
  inBox: [{ item: 'Cable' }, { item: 'Case', addonZMW: 0.75 }], commit: { min: 8.25, max: 10.25 } });

test('seller validation, saved entry and buyer quote preserve cents', () => {
  const d = draft();
  assert.equal(P.validate(d, ctx).length, 0);
  const p = P.clean(d);
  assert.equal(p.priceZMW, 10.25);
  assert.equal(p.variants[0].priceZMW, 11.25);
  assert.equal(p.variants[0].image, 'blue.webp');
  const q = P.quote(p, 10.25, { addons: [1], commit: 8.35 });
  assert.equal(q.commit, 8.35);
  assert.equal(q.each, 9.10);
  assert.match(P.describe(p, { commit: 8.35 }), /8\.35/);
});
test('invalid amounts, measured sizes and malformed stock are rejected', () => {
  let d = draft(); d.priceZMW = 0.001;
  assert(P.validate(d, ctx).some(e => e.field === 'priceZMW'));
  d = draft(); d.variants[0].stock = '2oops';
  assert(P.validate(d, ctx).some(e => e.field === 'variants'));
  d = draft(); d.options.size = [{ value: -1, unit: 'l' }];
  assert(P.validate(d, ctx).some(e => e.field === 'sizes'));
});
test('matrix generates every combination and preserves per-variant data', () => {
  const o = { colour: [{ name: 'Light blue' }, { name: 'Light green' }], size: ['M', 'L'] };
  const matrix = P.matrix(o, [{ colour: 'Light blue', size: 'M', sku: 'KEEP', stock: 3, priceZMW: 10.25, image: 'blue.webp' }]);
  assert.equal(matrix.length, 4);
  assert.equal(matrix[0].sku, 'KEEP');
  assert.equal(matrix[0].stock, 3);
  assert.equal(matrix[0].image, 'blue.webp');
  assert.notEqual(P.skuFor('Test', matrix[0]), P.skuFor('Test', matrix[2]));
  assert.notEqual(P.comboKey({ colour: 'A|B', size: 'C' }), P.comboKey({ colour: 'A', size: 'B|C' }));
});
test('add-ons are not counted twice and price never exceeds selected retail price', () => {
  const d = draft();
  assert.equal(P.quote(d, 10.25, { addons: [1, 1], commit: 20 }).each, 11);
  assert.equal(P.commitRange(d, 8), null);
});
test('prototype update rejects an unknown product ID', () => {
  const api = P.listings({ get: () => [], set: () => true });
  assert.equal(api.update('missing', draft(), ctx).ok, false);
  assert.equal(api.create(draft(), ctx).ok, true);
});
test('trade listings set units, minimum orders and multiples within the server limits', () => {
  const trade = Object.assign(draft(), { trade: true, sellUnit: 'bag', minQty: 20, qtyStep: 10, heavy: true, unitWeightKg: 50,
    priceTiers: [{ min: 100, price: 9.5 }, { min: 1000, price: 9 }] });
  assert.equal(P.validate(trade, ctx).length, 0);
  const p = P.clean(trade);
  assert.equal(p.trade, true); assert.equal(p.minQty, 20); assert.equal(p.qtyStep, 10); assert.equal(p.heavy, true); assert.equal(p.unitWeightKg, 50);
  const r = P.orderRules(p);
  assert.deepEqual([r.min, r.step, r.max, r.heavy, r.weight], [20, 10, 9990, true, 50]);
  assert.equal(P.qtyAllowed(p, 30), true);
  assert.equal(P.qtyAllowed(p, 25), false);
  assert.equal(P.qtyAllowed(p, 10), false);
  assert.equal(P.qtyAllowed(p, 10000), false);
  assert.equal(P.fitQty(p, 3), 20);
  assert.equal(P.fitQty(p, 26), 30);
  assert.equal(P.fitQty(p, 50000), 9990);
  assert.equal(P.qtyText(p, 1), '1 bag');
  assert.equal(P.qtyRuleText(p), 'Minimum order 20 bags · in multiples of 10');
  // Ordinary listings keep 1 to 99, by the item
  const plain = P.clean(draft());
  assert.equal(P.orderRules(plain).max, 99);
  assert.equal(P.qtyAllowed(plain, 100), false);
  assert.equal(P.qtyText(plain, 2), '2 items');
  assert.equal(P.qtyRuleText(plain), '');
});
test('trade settings are checked as the database checks them', () => {
  const errs = d => P.validate(Object.assign(draft(), d), ctx).map(e => e.field);
  assert(errs({ minQty: 5 }).includes('minQty'));
  assert(errs({ trade: true, minQty: 15, qtyStep: 10 }).includes('minQty'));
  assert(errs({ trade: true, minQty: 0 }).includes('minQty'));
  assert(errs({ trade: true, qtyStep: 1.5 }).includes('qtyStep'));
  assert(errs({ sellUnit: 'barrel' }).includes('sellUnit'));
  assert(errs({ unitWeightKg: -1 }).includes('unitWeightKg'));
  assert(errs({ trade: 'yes' }).includes('minQty'));
  // Bulk prices: above 99 needs trade, and they start above the minimum order
  assert(errs({ priceTiers: [{ min: 100, price: 9 }] }).includes('priceTiers'));
  assert(!errs({ trade: true, priceTiers: [{ min: 100, price: 9 }] }).includes('priceTiers'));
  assert(errs({ trade: true, minQty: 20, priceTiers: [{ min: 20, price: 9 }] }).includes('priceTiers'));
  // Without trade, the trade-only fields are not saved
  const p = P.clean(Object.assign(draft(), { trade: false, sellUnit: 'pack' }));
  assert.equal(p.trade, undefined); assert.equal(p.minQty, undefined); assert.equal(p.sellUnit, 'pack');
});
