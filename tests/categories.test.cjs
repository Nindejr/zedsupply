const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const sandbox = { window: {} };
for (const file of ['catalogue', 'catalogue-sample', 'products']) {
  vm.runInNewContext(fs.readFileSync(`js/${file}.js`, 'utf8'), sandbox);
}
const D = sandbox.window.ZS_CATALOGUE;
const P = sandbox.window.ZSProduct;
const ctx = { departments: D.departments, brands: [], products: [] };
const draft = () => ({ title: 'Phone', seller: 'test', category: 'tech', sub: 'phones', priceZMW: 100, stock: 'in' });

test('every department has two valid, illustrated local demo products in different subcategories', () => {
  const X = sandbox.window.ZS_SAMPLE;
  const local = X.products.filter(p => p.source !== 'china');
  assert.equal(new Set(X.products.map(p => p.id)).size, X.products.length);
  for (const d of D.departments) {
    const items = local.filter(p => p.category === d.id);
    assert(items.length >= 2, d.id + ' needs at least two sample products');
    assert(new Set(items.map(p => p.sub)).size >= 2, d.id + ' needs different subcategories');
  }
  for (const p of local) {
    assert.equal(p.sample, true, p.id);
    assert(X.sellers.some(s => s.id === p.seller), p.id);
    assert.equal(P.validate(p, { departments: D.departments, brands: X.brands, products: X.products }).length, 0, p.id);
    assert(fs.existsSync(p.image), p.image);
    assert(p.demoSales.every(n => Number.isInteger(n) && n >= 0), p.id);
  }
  assert.equal(D.products.some(p => p.sample), false, 'live catalogue must not contain demo listings');
});

test('sample promotions reference products owned by their seller', () => {
  const X = sandbox.window.ZS_SAMPLE;
  for (const pr of X.promotions) {
    assert.equal(pr.sample, true);
    for (const id of pr.products) {
      const p = X.products.find(p => p.id === id);
      assert(p, id);
      assert.equal(p.seller, pr.seller, pr.id + ': ' + id);
    }
    if (pr.demoDays) assert(pr.demoDays[0] <= 0 && pr.demoDays[1] > 0);
  }
});

test('stock planner follows all departments and migrates saved sector choices without losing targets', () => {
  const source = fs.readFileSync('js/stock-planner.js', 'utf8').replace('  window.ZSStock = {',
    '  window.plannerTest = { sectors: SECTORS, load: function(saved) { H = { store: { get: function() { return saved; } } }; return loadSettings(); } };\n  window.ZSStock = {');
  const context = { window: { ZS_CATALOGUE: D } };
  vm.runInNewContext(source, context);
  const planner = context.window.plannerTest;
  for (const d of D.departments) assert(planner.sectors.some(s => s.id === d.id && s.name === d.name), d.id);
  for (const [before, after] of [['grocery', 'essentials'], ['phones', 'tech'], ['fashion', 'womens'], ['pets', 'pets'], ['missing', 'other']]) {
    const settings = planner.load({ sector: before, low: 7, high: 12 });
    assert.equal(settings.sector, after);
    assert.equal(settings.low, 7);
    assert.equal(settings.high, 12);
  }
});

test('category identifiers, product subcategories and artwork are consistent', () => {
  assert.equal(new Set(D.departments.map(d => d.id)).size, D.departments.length);
  const groups = new Set(D.departmentGroups.map(g => g[0]));
  for (const d of D.departments) {
    assert(groups.has(d.group), d.id);
    assert(D.attributeTemplates[d.id], d.id);
    assert(fs.existsSync(`assets/icons/${d.id}.svg`), d.id);
    if (d.art3d) assert(fs.existsSync(`assets/categories-3d/${typeof d.art3d === 'string' ? d.art3d : d.id}.webp`), d.id);
    assert.equal(new Set(d.subs.map(s => s[0])).size, d.subs.length, d.id);
  }
  for (const p of D.products.concat(sandbox.window.ZS_SAMPLE.products)) {
    const d = D.departments.find(d => d.id === p.category);
    assert(d, p.id);
    if (p.sub) assert(d.subs.some(s => s[0] === p.sub), p.id);
  }
});

test('subcategory validation supports raw and normalized catalogue entries', () => {
  for (const departments of [D.departments, D.departments.map(d => ({ ...d, subs: d.subs.map(s => ({ id: s[0], name: s[1] })) }))]) {
    const context = { ...ctx, departments };
    assert.equal(P.validate(draft(), context).length, 0);
    assert.equal(P.validate({ ...draft(), sub: '' }, context).length, 0);
    assert(P.validate({ ...draft(), category: 'solar' }, context).some(e => e.field === 'sub'));
  }
});

test('creating, editing and clearing a listing preserves its category selection', () => {
  let entries = [];
  const api = P.listings({ get: () => entries, set: (key, value) => { entries = value; return true; } });
  const created = api.create(draft(), ctx);
  assert.equal(created.ok, true);
  assert.equal(api.get(created.product.id).sub, 'phones');
  const updated = api.update(created.product.id, { ...draft(), category: 'solar', sub: 'panels' }, ctx);
  assert.equal(updated.ok, true);
  assert.equal(updated.product.sub, 'panels');
  const cleared = api.update(created.product.id, { ...draft(), sub: '' }, ctx);
  assert.equal(cleared.ok, true);
  assert.equal(api.get(created.product.id).sub, '');
  assert.match(P.catalogueEntry(updated.product), /sub: 'panels'/);
});

test('seller comparisons stay within the selected department and subcategory', () => {
  const source = fs.readFileSync('js/main.js', 'utf8');
  const start = source.indexOf('  function multiSellerGroups(');
  const end = source.indexOf('\n  // Compare list:', start);
  const products = [
    { id: 'a', match: 'shared', category: 'tech', sub: 'phones', seller: 'one', price: 100 },
    { id: 'b', match: 'shared', category: 'tech', sub: 'phones', seller: 'two', price: 120 },
    { id: 'c', match: 'shared', category: 'tech', sub: 'audio', seller: 'three', price: 80 },
    { id: 'd', match: 'shared', category: 'solar', sub: 'lights', seller: 'four', price: 60 }
  ];
  const context = {
    localProducts: products,
    sameItem: p => products.filter(x => x.id !== p.id && x.match === p.match),
    priceOf: p => ({ now: p.price })
  };
  vm.runInNewContext(source.slice(start, end), context);
  const filtered = context.multiSellerGroups('tech', 'phones');
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].items.length, 2);
  assert.equal(filtered[0].from, 100);
  assert.equal(context.multiSellerGroups('tech', 'audio').length, 0);
  assert.equal(context.multiSellerGroups('tech')[0].items.length, 3);
});
