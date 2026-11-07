#!/usr/bin/env node
/* One release version for the whole site.

   Every page loads its scripts and stylesheet with ?v=<release>, and sw.js names its cache
   zs-<release>. If any page is missed, browsers mix old and new files. This moves them all at once:

     npm run release            next version: today's date and the next r-number, e.g. 20261107-r24
     npm run release -- 20261107-r30   a version you choose

   It updates index.html, help.html, privacy.html, 404.html, admin/index.html and sw.js, refreshes the pages'
   Content-Security-Policy hashes, then rebuilds the shop pages, which copy help.html's head.
   tests/release.test.cjs fails if any page or the service worker disagree. */
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const PAGES = ['index.html', 'help.html', 'privacy.html', '404.html', 'admin/index.html'];

function current() {
  const m = fs.readFileSync('sw.js', 'utf8').match(/var VERSION = 'zs-([\w.-]+)'/);
  if (!m) throw new Error('sw.js has no VERSION');
  return m[1];
}
function next(now = new Date()) {
  const r = Number((current().match(/-r(\d+)$/) || [])[1]) || 0;
  const day = now.getFullYear() + String(now.getMonth() + 1).padStart(2, '0') + String(now.getDate()).padStart(2, '0');
  return day + '-r' + (r + 1);
}

if (require.main === module) {
  const from = current(), to = process.argv[2] || next();
  if (!/^[\w.-]{3,40}$/.test(to)) { console.error('Use letters, numbers, dots and dashes, e.g. 20261107-r24'); process.exit(1); }
  for (const file of PAGES) {
    // Only the release's own version: icons keep their separate ?v= numbers
    const html = fs.readFileSync(file, 'utf8'), out = html.split('?v=' + from).join('?v=' + to);
    fs.writeFileSync(file, out);
  }
  const sw = fs.readFileSync('sw.js', 'utf8');
  fs.writeFileSync('sw.js', sw.replace(/var VERSION = 'zs-[\w.-]+'/, "var VERSION = 'zs-" + to + "'"));
  execFileSync(process.execPath, ['scripts/csp-hashes.cjs'], { stdio: 'inherit' });
  execFileSync(process.execPath, ['scripts/build-storefront.cjs'], { stdio: 'inherit' });
  console.log('Release ' + from + ' → ' + to);
}
module.exports = { current, next };
