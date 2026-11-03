const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function worker(overrides = {}) {
  const handlers = {}, deleted = [], writes = [];
  const cache = { match: async () => undefined, put: async req => { writes.push(req.url); } };
  const sandbox = {
    URL, Response, location: { origin: 'https://example.com' },
    self: { registration: { scope: 'https://example.com/store/' },
      addEventListener: (name, fn) => { handlers[name] = fn; }, clients: { claim: async () => {} } },
    caches: { keys: async () => ['other-app', 'zs-old', 'zs-20261103-r6'],
      delete: async name => { deleted.push(name); }, open: async () => cache },
    fetch: async () => new Response('fresh'), ...overrides
  };
  vm.runInNewContext(fs.readFileSync('sw.js', 'utf8'), sandbox);
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
