const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const sharp = require('sharp');
const crypto = require('node:crypto');
const sandbox = { window: {} };
for (const file of ['catalogue', 'catalogue-sample']) vm.runInNewContext(fs.readFileSync('js/' + file + '.js', 'utf8'), sandbox);

test('catalogue artwork references resolve to local production assets', () => {
  function walk(value) {
    if (typeof value === 'string' && /^assets\/.+\.(webp|png|jpg|svg)$/.test(value)) assert(fs.existsSync(value), value);
    else if (value && typeof value === 'object') Object.values(value).forEach(walk);
  }
  walk(sandbox.window.ZS_CATALOGUE); walk(sandbox.window.ZS_SAMPLE);
});

test('demo product artwork stays square, 600 pixels and within the 80 KB budget', async () => {
  for (const product of sandbox.window.ZS_SAMPLE.products.filter(p => p.image && p.image.startsWith('assets/products/'))) {
    const meta = await sharp(product.image).metadata();
    assert.equal(meta.format, 'webp', product.id);
    assert.equal(meta.width, 600, product.id); assert.equal(meta.height, 600, product.id);
    assert(fs.statSync(product.image).size < 80000, product.image);
  }
});

test('department artwork retains real transparency and established framing', async () => {
  for (const file of fs.readdirSync('assets/categories-3d').filter(f => f.endsWith('.webp'))) {
    const path = 'assets/categories-3d/' + file, image = sharp(path), meta = await image.metadata();
    assert.equal(meta.width, meta.height, path);
    assert(meta.width >= 200 && meta.width <= 256, path);
    assert(meta.hasAlpha, path);
    assert((await image.stats()).channels[3].min < 255, path + ' must contain transparent pixels');
    assert(fs.statSync(path).size < 80000, path);
  }
});

test('all public sample artwork exports carry the reviewed pixel branding', () => {
  const manifest = JSON.parse(fs.readFileSync('assets/branding-manifest.json','utf8'));
  const paths = [];
  for (const dir of ['assets/products','assets/categories-3d','assets/banners']) {
    paths.push(...fs.readdirSync(dir,{recursive:true}).filter(f => f.endsWith('.webp')).map(f => (dir + '/' + f).replaceAll('\\','/')).filter(p => dir !== 'assets/products' || p.startsWith('assets/products/demo/') || manifest.assets.some(a => a.path === p) || sandbox.window.ZS_SAMPLE.products.some(product => product.image === p)));
  }
  assert.equal(manifest.assets.length,paths.length);
  for (const path of paths) {
    const asset = manifest.assets.find(a => a.path === path);
    assert(asset,path);
    assert.equal(asset.branding,'ZED SUPPLY / ZS');
    assert.equal(asset.sha256,crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex'),path);
    assert.notEqual(asset.sourceSha256,asset.sha256,path);
  }
});
