// One release version everywhere, and every inline script allowed by its page's CSP.
// A missed page would serve a mix of old and new files; a stale hash stops a script silently.
// scripts/release.cjs moves the version; scripts/csp-hashes.cjs refreshes the hashes.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { check } = require('../scripts/csp-hashes.cjs');

function pages(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(d => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? pages(p) : p.endsWith('.html') ? [p] : [];
  });
}
const all = ['index.html', 'help.html', 'privacy.html', '404.html'].concat(fs.existsSync('shop') ? pages('shop') : []);
const release = fs.readFileSync('sw.js', 'utf8').match(/var VERSION = 'zs-([\w.-]+)'/)[1];

test('every page loads its scripts and stylesheet at the service worker\'s release', () => {
  const off = [];
  for (const file of all) {
    const html = fs.readFileSync(file, 'utf8');
    const tokens = [...html.matchAll(/(?:src|href)="[^"]*\b(?:js|css)\/[\w.-]+\.(?:js|css)\?v=([\w.-]+)"/g)].map(m => m[1]);
    assert.ok(tokens.length > 0 || !/<script src="[^"]*js\//.test(html), file + ' loads scripts without a version');
    tokens.filter(t => t !== release).forEach(t => off.push(file + ': ' + t));
  }
  assert.deepEqual(off, [], 'pages on another release than sw.js (' + release + '). Run npm run release.');
});

test('every inline script is allowed by its page\'s Content-Security-Policy, and no stale hashes remain', () => {
  const problems = all.map(file => check(file, fs.readFileSync(file, 'utf8'))).filter(Boolean);
  assert.deepEqual(problems, [], 'Run node scripts/csp-hashes.cjs, then npm run build:storefront.');
});

test('the next release is today\'s date and the next number', () => {
  const { next } = require('../scripts/release.cjs');
  const n = Number(release.match(/-r(\d+)$/)[1]);
  assert.equal(next(new Date(2026, 10, 7)), '20261107-r' + (n + 1));
});
