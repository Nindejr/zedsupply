// Exact branding of existing artwork, explicitly requested by the owner.
// Originals are private source material in git-ignored Business/, never public derivatives.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const backupRoot = path.join(root, 'Business', 'brand-assets', 'artwork-originals');
const manifestPath = path.join(root, 'assets', 'branding-manifest.json');

function overlay(width, height, department) {
  const font = department ? Math.max(12, Math.round(width / 13)) : Math.max(16, Math.round(Math.min(width, height) / 22));
  const stepX = department ? width * 0.55 : Math.max(180, width / 3);
  const stepY = department ? height * 0.4 : Math.max(110, height / 3);
  let text = '';
  for (let y = stepY / 2; y < height + stepY; y += stepY) {
    for (let x = -stepX / 3; x < width + stepX; x += stepX) {
      text += `<text x="${x}" y="${y}" transform="rotate(-24 ${x} ${y})">${department ? 'ZS' : 'ZED SUPPLY'}</text>`;
    }
  }
  const stamp = department ? '' : `<g font-family="Arial, sans-serif" text-anchor="end"><text x="${width - width * .035}" y="${height - height * .035}" font-size="${font * .9}" font-weight="700" fill="#0A2A66" stroke="#fff" stroke-width="${font * .12}" paint-order="stroke" opacity=".75">ZS · ZED SUPPLY</text></g>`;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><g font-family="Arial, sans-serif" font-size="${font}" font-weight="700" fill="#0A2A66" stroke="#fff" stroke-width="${font * .055}" paint-order="stroke" opacity="${department ? '.28' : '.15'}">${text}</g>${stamp}</svg>`);
}

async function main() {
  const previous = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')).assets : [];
  const catalogue = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root,'js/catalogue-sample.js'),'utf8'),catalogue);
  const samplePaths = new Set();
  function sampleImages(value) {
    if (typeof value === 'string' && value.startsWith('assets/products/') && value.endsWith('.webp')) samplePaths.add(value);
    else if (value && typeof value === 'object') Object.values(value).forEach(sampleImages);
  }
  sampleImages(catalogue.window.ZS_SAMPLE.products);
  const rows = [];
  for (const dir of ['assets/products', 'assets/categories-3d', 'assets/banners']) {
    for (const name of fs.readdirSync(path.join(root, dir), { recursive: true }).filter(n => n.endsWith('.webp'))) {
      const relative = (dir + '/' + name).replaceAll('\\', '/');
      if (dir === 'assets/products' && !samplePaths.has(relative) && !relative.startsWith('assets/products/demo/') && !previous.some(r => r.path === relative)) continue;
      const target = path.join(root, relative), original = path.join(backupRoot, relative);
      if (!target.startsWith(root + path.sep) || !original.startsWith(backupRoot + path.sep)) throw new Error('Invalid artwork path');
      const hash = crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
      const old = previous.find(r => r.path === relative);
      // Idempotent: an already branded export is never stamped again.
      if (old && old.sha256 === hash) { rows.push(old); continue; }
      if (!fs.existsSync(original)) { fs.mkdirSync(path.dirname(original), { recursive: true }); fs.copyFileSync(target, original); }
      else if (old && old.sha256 !== hash) throw new Error('Artwork changed since branding: review before replacing ' + relative);
      const source = fs.readFileSync(original), meta = await sharp(source).metadata();
      let mark = await sharp(overlay(meta.width, meta.height, dir.includes('categories'))).png().toBuffer();
      // Mask text to the original silhouette; no text or square is added to transparent space.
      if (meta.hasAlpha) mark = await sharp(mark).composite([{ input: source, blend: 'dest-in' }]).png().toBuffer();
      let output;
      for (const quality of [84, 80, 76, 72, 68]) {
        output = await sharp(source).composite([{ input: mark }]).webp({ quality, alphaQuality: 100 }).toBuffer();
        if (!dir.includes('products') && !dir.includes('categories') || output.length < 80000) break;
      }
      if ((dir.includes('products') || dir.includes('categories')) && output.length >= 80000) throw new Error('Artwork exceeds budget: ' + relative);
      fs.writeFileSync(target, output);
      rows.push({ path: relative, branding: 'ZED SUPPLY / ZS', method: 'pixel-composite-v1', width: meta.width, height: meta.height,
        bytes: output.length, sourceSha256: crypto.createHash('sha256').update(source).digest('hex'), sha256: crypto.createHash('sha256').update(output).digest('hex') });
    }
  }
  fs.writeFileSync(manifestPath, JSON.stringify({ brand: 'Zed Supply', version: 1, assets: rows }, null, 2) + '\n');
  console.log('Branded ' + rows.length + ' artwork files; private originals retained under Business/brand-assets/artwork-originals.');
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
