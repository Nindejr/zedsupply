#!/usr/bin/env node
/* Keeps each page's Content-Security-Policy in step with its inline scripts.

   The CSP lets an inline <script> run only if its sha256 hash is listed, so editing one without
   updating the hash stops it silently. This lists the hashes of the inline scripts each page
   actually has, and nothing else, in that page's script-src.

     node scripts/csp-hashes.cjs          update the four pages
     node scripts/csp-hashes.cjs --check  report pages that are out of step (used by the tests)

   Run npm run build:storefront afterwards: the shop pages copy help.html's head. */
const fs = require('node:fs');
const crypto = require('node:crypto');
const PAGES = ['index.html', 'help.html', 'privacy.html', '404.html', 'admin/index.html'];

function inlineHashes(html) {
  const out = [];
  for (const m of html.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
    const attrs = m[1] || '';
    if (/\bsrc=/.test(attrs) || /type="application\/(ld\+)?json"/.test(attrs)) continue;
    out.push("'sha256-" + crypto.createHash('sha256').update(m[2], 'utf8').digest('base64') + "'");
  }
  return [...new Set(out)];
}
function listed(html) {
  const csp = (html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/) || [])[1] || '';
  const src = (csp.match(/script-src ([^;]+)/) || [])[1] || '';
  return src.split(/\s+/).filter(t => t.startsWith("'sha256-"));
}
function update(html) {
  const want = inlineHashes(html);
  return html.replace(/(<meta http-equiv="Content-Security-Policy" content="[^"]*?script-src )([^;]+)/, (all, head, src) =>
    head + src.split(/\s+/).filter(t => t && !t.startsWith("'sha256-")).concat(want).join(' '));
}
function check(file, html) {
  const want = inlineHashes(html), have = listed(html);
  const missing = want.filter(h => !have.includes(h)), stale = have.filter(h => !want.includes(h));
  return missing.length || stale.length ? file + ': ' + (missing.length ? missing.length + ' inline script(s) not allowed by the CSP' : '') + (missing.length && stale.length ? '; ' : '') + (stale.length ? stale.length + ' hash(es) for scripts no longer on the page' : '') : '';
}

if (require.main === module) {
  const checking = process.argv.includes('--check');
  const problems = [];
  for (const file of PAGES) {
    const html = fs.readFileSync(file, 'utf8');
    if (checking) { const p = check(file, html); if (p) problems.push(p); continue; }
    const next = update(html);
    if (next !== html) { fs.writeFileSync(file, next); console.log('updated', file); }
  }
  if (checking) { if (problems.length) { console.error(problems.join('\n')); process.exit(1); } console.log('CSP hashes match the inline scripts.'); }
}
module.exports = { inlineHashes, listed, check, PAGES };
