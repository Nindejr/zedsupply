const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function worker(overrides = {}) {
  const source = fs.readFileSync('sw.js', 'utf8');
  const version = source.match(/var VERSION = '([^']+)'/)[1];
  const handlers = {}, deleted = [], writes = [];
  const cache = { match: async () => undefined, put: async req => { writes.push(req.url); } };
  const sandbox = {
    URL, Response, location: { origin: 'https://example.com' },
    self: { registration: { scope: 'https://example.com/store/' },
      addEventListener: (name, fn) => { handlers[name] = fn; }, clients: { claim: async () => {} } },
    caches: { keys: async () => ['other-app', 'zs-old', version],
      delete: async name => { deleted.push(name); }, open: async () => cache },
    fetch: async () => new Response('fresh'), ...overrides
  };
  vm.runInNewContext(source, sandbox);
  return { handlers, deleted, writes, cache };
}

function request(w, path, destination = '', mode = 'cors') {
  const pending = [];
  let response;
  w.handlers.fetch({ request: { url: 'https://example.com' + path, method: 'GET', destination, mode },
    waitUntil: p => pending.push(p), respondWith: p => { response = p; } });
  return { pending, response };
}

test('activation preserves unrelated application caches', async () => {
  const w = worker();
  let done;
  w.handlers.activate({ waitUntil: p => { done = p; } });
  await done;
  assert.deepEqual(w.deleted, ['zs-old']);
});

test('worker leaves requests outside its application scope alone', () => {
  const w = worker();
  assert.equal(request(w, '/another-app/main.js').response, undefined);
});

test('cached images return immediately and refresh within the event lifetime', async () => {
  const w = worker();
  w.cache.match = async () => new Response('cached');
  const e = request(w, '/store/photo.webp', 'image');
  assert.equal(await (await e.response).text(), 'cached');
  await Promise.all(e.pending);
  assert.deepEqual(w.writes, ['https://example.com/store/photo.webp']);
});

test('cache write failures do not discard successful network responses', async () => {
  const w = worker();
  w.cache.put = async () => { throw new Error('quota'); };
  const e = request(w, '/store/main.js');
  assert.equal(await (await e.response).text(), 'fresh');
  await Promise.all(e.pending);
});

test('offline navigation returns an error response when no shell is cached', async () => {
  const w = worker({ fetch: async () => { throw new Error('offline'); } });
  const e = request(w, '/store/', '', 'navigate');
  assert.equal((await e.response).type, 'error');
  await Promise.all(e.pending);
});

const dated = (body, ms) => new Response(body, { headers: { date: new Date(Date.now() - ms).toUTCString() } });
function counting() { let n = 0; return { get count() { return n; }, fetch: async () => { n++; return new Response('fresh'); } }; }

test('a saved image less than a week old is used without downloading it again', async () => {
  const net = counting();
  const w = worker({ fetch: net.fetch });
  w.cache.match = async () => dated('cached', 60 * 60 * 1000);
  const e = request(w, '/store/photo.webp', 'image');
  assert.equal(await (await e.response).text(), 'cached');
  await Promise.all(e.pending);
  assert.equal(net.count, 0);
  assert.deepEqual(w.writes, []);
});

test('with Data saver on, images are neither refreshed nor saved', async () => {
  const net = counting();
  const w = worker({ fetch: net.fetch });
  let done; w.handlers.message({ data: { type: 'datasaver', on: true }, waitUntil: p => { done = p; } }); await done;
  w.writes.length = 0;
  w.cache.match = async req => (String(req).includes('zs-settings') ? undefined : dated('old', 30 * 24 * 60 * 60 * 1000));
  let e = request(w, '/store/old.webp', 'image');
  assert.equal(await (await e.response).text(), 'old');
  await Promise.all(e.pending);
  assert.equal(net.count, 0, 'an old saved copy is still used, without a download');
  w.cache.match = async () => undefined;
  e = request(w, '/store/new.webp', 'image');
  assert.equal(await (await e.response).text(), 'fresh');
  await Promise.all(e.pending);
  assert.deepEqual(w.writes, [], 'nothing new is saved');
});

test('the browser\'s Save-Data setting counts as Data saver', async () => {
  const w = worker();
  w.cache.match = async () => undefined;
  const pending = []; let response;
  w.handlers.fetch({ request: { url: 'https://example.com/store/p.webp', method: 'GET', destination: 'image', mode: 'no-cors', headers: new Headers({ 'save-data': 'on' }) },
    waitUntil: p => pending.push(p), respondWith: p => { response = p; } });
  assert.equal(await (await response).text(), 'fresh');
  await Promise.all(pending);
  assert.deepEqual(w.writes, []);
});

test('only the newest 150 images are kept; the store\'s own files are left alone', async () => {
  const w = worker();
  const keys = ['https://example.com/store/index.html', 'https://example.com/store/js/main.js']
    .concat(Array.from({ length: 151 }, (_, i) => 'https://example.com/store/p' + i + '.webp')).map(url => ({ url }));
  const removed = [];
  Object.assign(w.cache, { match: async () => undefined, keys: async () => keys, delete: async k => { removed.push(k.url); } });
  const e = request(w, '/store/p151.webp', 'image');
  await e.response; await Promise.all(e.pending);
  assert.deepEqual(removed, ['https://example.com/store/p0.webp']);
});
