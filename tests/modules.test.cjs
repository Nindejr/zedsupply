// js/main.js hands each split-out module (js/checkout.js, js/listing-form.js) the helpers it
// shares. These check every helper a module reads is handed over, and that each page loads the
// modules before main.js, so a missing helper fails here rather than when a buyer opens the page.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const main = fs.readFileSync('js/main.js', 'utf8');
const MODULES = [['js/checkout.js', 'checkout', 'checkoutKit', ['loc']], ['js/listing-form.js', 'listing', 'listingKit', []]];

for (const [file, name, kit, getters] of MODULES) {
  test(file + ' gets every helper it reads from main.js', () => {
    const src = fs.readFileSync(file, 'utf8');
    const reads = new Set([...src.matchAll(/\b([\w$]+) = K\.\1\b/g)].map(m => m[1]).concat([...src.matchAll(/\bK\.([\w$]+)/g)].map(m => m[1])));
    const block = main.match(new RegExp('var ' + kit + ' = \\{([\\s\\S]*?)\\n  \\};'))[1];
    const given = new Set([...block.matchAll(/([\w$]+):/g)].map(m => m[1]).concat(getters));
    assert.deepEqual([...reads].filter(n => !given.has(n)), [], 'read by ' + file + ' but not in ' + kit);
    assert.match(main, new RegExp('window\\.ZSModules\\.' + name + '\\(' + kit + '\\)'));
  });
}

test('every page loads the modules before main.js', () => {
  for (const page of ['index.html', 'help.html', 'privacy.html', '404.html']) {
    const html = fs.readFileSync(page, 'utf8'), at = f => html.indexOf('src="' + f + '?');
    for (const [file] of MODULES) assert.ok(at(file) !== -1 && at(file) < at('js/main.js'), page + ' should load ' + file + ' before js/main.js');
  }
  const sw = fs.readFileSync('sw.js', 'utf8');
  for (const [file] of MODULES) assert.ok(sw.includes("'" + file + "'"), 'sw.js should save ' + file + ' for offline use');
});
