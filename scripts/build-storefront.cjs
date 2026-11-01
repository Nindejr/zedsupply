// Crawlable static pages from approved live data. Sample listings are never indexed.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync('js/catalogue.js', 'utf8'), sandbox);
const catalogue = sandbox.window.ZS_CATALOGUE;
const base = new URL(process.env.SITE_URL || 'https://nindejr.github.io/zedsupply/');
if (base.protocol !== 'https:') throw new Error('SITE_URL must use HTTPS');
const output = path.resolve('shop');
const outputManifest = path.join(output, 'generated-manifest.json');
const generated = [];
const escape = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const url = relative => new URL(relative, base).href;
const cash = value => 'K' + Number(value).toLocaleString('en-ZM', { maximumFractionDigits: 2 });
// Pages without approved listings stay out of search results and the sitemap until they have some.
function document(title, description, relative, content, structured, noindex) {
  const canonical = url(relative);
  return '<!doctype html>\n<html lang="en-ZM"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'; style-src \'self\'; img-src \'self\' https://*.supabase.co; base-uri \'none\'; object-src \'none\'; form-action \'none\'; upgrade-insecure-requests">' +
    '<meta name="zed-supply-generated" content="storefront-v1">' + (noindex ? '<meta name="robots" content="noindex,follow">' : '') + '<meta name="referrer" content="strict-origin-when-cross-origin"><title>' + escape(title) + ' | Zed Supply</title><meta name="description" content="' + escape(description.slice(0,160)) + '">' +
    '<link rel="canonical" href="' + escape(canonical) + '"><meta property="og:title" content="' + escape(title) + '"><meta property="og:url" content="' + escape(canonical) + '"><meta property="og:description" content="' + escape(description.slice(0,160)) + '">' +
    '<meta property="og:image" content="' + escape(structured && structured.image ? structured.image[0] : url('assets/og-image.jpg')) + '"><link rel="stylesheet" href="' + escape(url('css/style.css?v=20261101-r3')) + '"><link rel="icon" href="' + escape(url('assets/favicon.svg')) + '">' +
    (structured ? '<script type="application/ld+json">' + JSON.stringify(structured).replaceAll('<','\\u003c') + '</script>' : '') +
    '</head><body><a class="skip-link" href="#content">Skip to content</a><header class="site-header"><div class="container"><a href="' + escape(url('index.html')) + '" aria-label="Zed Supply home"><img src="' + escape(url('assets/brand/logo-original-3d-dark.webp')) + '" width="190" height="48" alt="Zed Supply"></a></div></header>' +
    '<main class="container section" id="content">' + content + '</main><footer class="site-footer"><div class="container"><p><a href="' + escape(url('help.html')) + '">Help and returns</a> · <a href="' + escape(url('privacy.html')) + '">Privacy</a></p></div></footer></body></html>\n';
}
function write(relative, html) {
  const file = path.resolve(output, relative);
  if (!file.startsWith(output + path.sep)) throw new Error('Invalid output path');
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, html);
  generated.push(relative.replaceAll('\\','/'));
}
async function main() {
  const previous = fs.existsSync(outputManifest) ? JSON.parse(fs.readFileSync(outputManifest,'utf8')).files : [];
  let products = catalogue.products;
  if (process.env.STOREFRONT_SNAPSHOT) products = JSON.parse(fs.readFileSync(process.env.STOREFRONT_SNAPSHOT, 'utf8'));
  products = products.filter(p => !p.sample && (!p.status || p.status === 'active') && /^[a-zA-Z0-9_-]{1,80}$/.test(p.id));
  const links = [url(''), url('help.html'), url('privacy.html')];
  if (products.length) links.push(url('shop/'));
  const card = p => '<li class="card"><a href="' + escape(url('shop/products/' + p.id + '/')) + '">' + escape(p.title) + '</a><p>' + cash(p.priceZMW || p.price_zmw) + '</p></li>';
  for (const department of catalogue.departments) {
    const relative = 'departments/' + department.id + '/index.html', route = 'shop/departments/' + department.id + '/';
    const items = products.filter(p => (p.category || p.department_id) === department.id);
    write(relative, document(department.name, 'Browse ' + department.name + ' from Zed Supply in Zambia. Confirm current stock, delivery and final price before ordering.', route,
      '<h1>' + escape(department.name) + '</h1><p>Prices in Zambian Kwacha. Final availability and delivery are confirmed at checkout.</p><ul class="grid">' + items.map(card).join('') + '</ul>' +
      (!items.length ? '<p>Approved listings will appear here when available.</p>' : '') + '<p><a class="btn btn--primary" href="' + escape(url('index.html#/dept/' + department.id)) + '">Browse current availability</a></p>', null, !items.length));
    if (items.length) links.push(url(route));
  }
  for (const p of products) {
    const price = Number(p.priceZMW || p.price_zmw); if (!(price > 0) || !Number.isFinite(price)) throw new Error('Invalid product price: ' + p.id);
    const route = 'shop/products/' + p.id + '/', image = p.image ? url(p.image) : '';
    const schema = { '@context':'https://schema.org', '@type':'Product', name:p.title, description:p.description || p.title, sku:p.id, url:url(route),
      offers:{ '@type':'Offer', priceCurrency:'ZMW', price:price.toFixed(2), url:url(route) } };
    if (image) schema.image = [image];
    write('products/' + p.id + '/index.html', document(p.title, p.description || p.title, route,
      '<p><a href="' + escape(url('shop/')) + '">All departments</a></p><h1>' + escape(p.title) + '</h1><div class="duo"><div>' + (image ? '<img src="' + escape(image) + '" width="600" height="600" alt="' + escape(p.alt || p.title) + '">' : '') + '</div><section class="card"><p><strong>' + cash(price) + '</strong></p><p>' + escape(p.description || '') + '</p><p>Check current options, stock and the final delivered price before ordering.</p><a class="btn btn--primary" href="' + escape(url('index.html#/product/' + p.id)) + '">Choose options and order</a></section></div>', schema));
    links.push(url(route));
  }
  write('index.html', document('Shop departments', 'Browse Zed Supply departments and local products in Zambia.', 'shop/', '<h1>Shop departments</h1><ul class="tiles">' + catalogue.departments.map(d => '<li><a href="' + escape(url('shop/departments/' + d.id + '/')) + '"><strong>' + escape(d.name) + '</strong></a></li>').join('') + '</ul>', null, !products.length));
  for (const relative of previous.filter(name => !generated.includes(name))) {
    const file = path.resolve(output,relative);
    if (!file.startsWith(output + path.sep) || !file.endsWith('.html')) throw new Error('Invalid stale output path');
    if (fs.existsSync(file) && fs.readFileSync(file,'utf8').includes('name="zed-supply-generated" content="storefront-v1"')) fs.unlinkSync(file);
  }
  fs.writeFileSync(outputManifest, JSON.stringify({ files: generated },null,2) + '\n');
  fs.writeFileSync('sitemap.xml', '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + links.map(link => '  <url><loc>' + escape(link) + '</loc></url>').join('\n') + '\n</urlset>\n');
  console.log('Built ' + catalogue.departments.length + ' crawlable department pages and ' + products.length + ' approved product pages.');
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
