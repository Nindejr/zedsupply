const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const sandbox = { window: {} };
for (const file of ['catalogue', 'catalogue-sample']) vm.runInNewContext(fs.readFileSync(`js/${file}.js`, 'utf8'), sandbox);
const S = sandbox.window.ZS_CATALOGUE.settings;
const X = sandbox.window.ZS_SAMPLE;
const provinceIds = S.provinces.map(p => p[0]);

test('provinces and towns are complete and inside Zambia', () => {
  assert.equal(S.provinces.length, 10);
  assert.equal(new Set(provinceIds).size, 10);
  assert.equal(new Set(S.towns.map(t => t[0].toLowerCase())).size, S.towns.length, 'town names are unique');
  for (const [name, province, lat, lng] of S.towns) {
    assert(provinceIds.includes(province), name);
    assert(lat > -18.2 && lat < -8.1 && lng > 21.9 && lng < 33.8, name + ' is inside Zambia');
  }
  for (const id of provinceIds) assert(S.towns.some(t => t[1] === id), id + ' has at least one town');
});

test('delivery settings are well formed', () => {
  for (const [zone, e] of Object.entries(S.delivery.estimates)) {
    assert(['town', 'province', 'country', 'world'].includes(zone), zone);
    if (e !== null) assert(Array.isArray(e) && e.length === 2 && e[0] <= e[1], zone);
  }
  for (const [zone, e] of Object.entries(X.deliveryEstimates)) if (e !== null) assert(e[0] <= e[1], zone);
});

test('demo sellers and regional promotions use known places', () => {
  for (const s of X.sellers) {
    const l = s.location;
    assert(l && S.towns.some(t => t[0] === l.town), s.id + ' has a known town');
    assert(l.deliversTo === 'all' || l.deliversTo.every(p => provinceIds.includes(p)), s.id);
    if (l.collection && l.collection.enabled) assert(l.collection.address, s.id + ' collection needs an address');
  }
  for (const pr of X.promotions) if (pr.areas) assert(pr.areas.length && pr.areas.every(p => provinceIds.includes(p)), pr.id);
});

test('a device position is matched to the nearest town by the storefront code', () => {
  const src = fs.readFileSync('js/main.js', 'utf8');
  const grab = name => src.slice(src.indexOf('  function ' + name + '('), src.indexOf('\n  }\n', src.indexOf('  function ' + name + '(')) + 4);
  const context = { TOWNS: S.towns.map(t => ({ name: t[0], province: t[1], lat: t[2], lng: t[3] })) };
  vm.runInNewContext(grab('kmBetween') + grab('nearestTown'), context);
  const near = (lat, lng) => context.nearestTown(lat, lng);
  assert.equal(near(-12.81, 28.22).town.name, 'Kitwe');                   // central Kitwe
  assert.equal(near(-15.40, 28.32).town.name, 'Lusaka');                  // Lusaka east
  assert.equal(near(-17.85, 25.86).town.province, 'southern');            // Livingstone
  assert(Math.abs(context.kmBetween(-15.417, 28.283, -12.802, 28.213) - 291) < 10, 'Lusaka to Kitwe is about 290 km');
  assert(near(-33.92, 18.42).km > S.location.gpsMaxKm, 'Cape Town is too far to match');
});
