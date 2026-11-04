// Crawlable static pages from approved live data. Sample listings are never indexed.
// Each page reuses help.html's head, header, menus and footer, so the catalogue looks and works
// like the rest of the site and picks up any change to them on the next build.
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
const cash = value => 'K' + Number(value).toLocaleString('en-US', { maximumFractionDigits: 2 });

// The shared page: everything before <main> and everything after </main>.
const template = fs.existsSync('help.html') ? fs.readFileSync('help.html', 'utf8') : null;
function chrome() {
  if (!template) return null;
  const head = template.slice(0, template.indexOf('</head>'));
  const top = template.slice(template.indexOf('<body>'), template.indexOf('<main id="main">'));
  const bottom = template.slice(template.indexOf('</main>') + '</main>'.length);
  if (!head || !top || !bottom) throw new Error('help.html no longer has the expected head, <main id="main"> and </main>');
  return { head, top, bottom };
}
const page = chrome();
const setMeta = (html, pattern, replacement) => {
  if (!pattern.test(html)) throw new Error('help.html is missing ' + pattern);
  return html.replace(pattern, replacement);
};

// Pages without approved listings stay out of search results and the sitemap until they have some.
function document(title, description, relative, content, structured, noindex, crumbs) {
  const canonical = url(relative), summary = escape(description.slice(0, 160)), image = structured && structured.image ? structured.image[0] : url('assets/og-image.jpg');
  // Relative links in the shared header and footer (index.html, assets/…) resolve from the site root.
  const root = '../'.repeat(relative.split('/').filter(Boolean).length) || './';
  const breadcrumbs = { '@context':'https://schema.org', '@type':'BreadcrumbList', itemListElement: crumbs.map((c, i) => ({ '@type':'ListItem', position: i + 1, name: c[0], item: url(c[1]) })) };
  const ld = data => '<script type="application/ld+json">' + JSON.stringify(data).replaceAll('<','\\u003c') + '</script>';
  if (!page) {
    return '<!doctype html>\n<html lang="en-ZM"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base href="' + root + '"><title>' + escape(title) + ' | Zed Supply</title>' +
      '<meta name="zed-supply-generated" content="storefront-v1">' + (noindex ? '<meta name="robots" content="noindex,follow">' : '') + '<link rel="canonical" href="' + escape(canonical) + '">' + (structured ? ld(structured) : '') +
      '</head><body><main id="main">' + content + '</main></body></html>\n';
  }
  let head = page.head;
  head = setMeta(head, /<meta charset="utf-8">/, '<meta charset="utf-8">\n  <base href="' + root + '">');
  head = setMeta(head, /<title>[\s\S]*?<\/title>/, '<title>' + escape(title) + ' | Zed Supply</title>\n  <meta name="zed-supply-generated" content="storefront-v1">' + (noindex ? '\n  <meta name="robots" content="noindex,follow">' : ''));
  head = setMeta(head, /<meta name="description" content="[^"]*">/, '<meta name="description" content="' + summary + '">');
  head = setMeta(head, /<link rel="canonical" href="[^"]*">/, '<link rel="canonical" href="' + escape(canonical) + '">');
  for (const name of ['og:title', 'twitter:title']) head = setMeta(head, new RegExp('<meta (property|name)="' + name + '" content="[^"]*">'), '<meta $1="' + name + '" content="' + escape(title) + '">');
  for (const name of ['og:description', 'twitter:description']) head = setMeta(head, new RegExp('<meta (property|name)="' + name + '" content="[^"]*">'), '<meta $1="' + name + '" content="' + summary + '">');
  head = setMeta(head, /<meta property="og:url" content="[^"]*">/, '<meta property="og:url" content="' + escape(canonical) + '">');
  if (structured && structured.image) for (const name of ['og:image', 'twitter:image']) head = setMeta(head, new RegExp('<meta (property|name)="' + name + '" content="[^"]*">'), '<meta $1="' + name + '" content="' + escape(image) + '">');
  // Keep the organisation details; the help page's own breadcrumb and FAQ data don't belong here.
  head = head.replace(/\s*<script type="application\/ld\+json">[\s\S]*?<\/script>/g, block => block.includes('"Organization"') ? block : '');
  head += '  ' + ld(breadcrumbs) + '\n' + (structured ? '  ' + ld(structured) + '\n' : '');
  // In-page links (#main) stay on this page rather than resolving against the root.
  const local = html => html.replace(/href="#(?!\/)/g, 'href="' + relative + '#');
  return head + '</head>\n' + local(page.top) + '<main id="main">\n' + content + '\n  </main>' + local(page.bottom);
}
function hero(eyebrow, title, intro, crumbs) {
  return '<section class="page-hero" aria-labelledby="page-title"><div class="container">' +
    '<nav aria-label="Breadcrumb"><ol class="crumbs">' + crumbs.map((c, i) => '<li>' + (i === crumbs.length - 1 ? '<span aria-current="page">' + escape(c[0]) + '</span>' : '<a href="' + escape(c[1]) + '">' + escape(c[0]) + '</a>') + '</li>').join('') + '</ol></nav>' +
    '<span class="eyebrow">' + escape(eyebrow) + '</span><h1 id="page-title">' + escape(title) + '</h1><p>' + escape(intro) + '</p></div></section>';
}
// A department's published folder: its page name when it has one (see departments in js/catalogue.js)
const pageOf = d => {
  const name = d.page || d.id;
  if (!/^[a-z0-9-]{1,40}$/.test(name)) throw new Error('Invalid department page name: ' + name);
  return name;
};
const artwork = d => d.art3d
  ? '<img src="assets/categories-3d/' + escape(typeof d.art3d === 'string' ? d.art3d : d.id) + '.webp" alt="" width="112" height="112" loading="lazy" decoding="async">'
  : '<img src="assets/icons/' + escape(d.id) + '.svg" alt="" width="48" height="48" loading="lazy" decoding="async">';
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
  const home = ['Home', 'index.html'], shop = ['Catalogue', 'shop/'];
  const departmentOf = p => catalogue.departments.find(d => d.id === (p.category || p.department_id));
  const card = p => {
    const route = 'shop/products/' + p.id + '/', d = departmentOf(p);
    return '<li><article class="pcard"><a class="pmedia" href="' + escape(route) + '" tabindex="-1" aria-hidden="true">' +
      (p.image ? '<img src="' + escape(p.image) + '" alt="" width="600" height="600" loading="lazy" decoding="async">' : '') + '</a>' +
      '<div class="pbody"><a class="ptitle" href="' + escape(route) + '">' + escape(p.title) + '</a>' + (d ? '<p class="pmeta">' + escape(d.name) + '</p>' : '') +
      '<p class="price"><span class="price__now"><span class="visually-hidden">Price </span>' + cash(p.priceZMW || p.price_zmw) + '</span></p>' +
      '<a class="btn btn--primary btn--sm" href="' + escape(route) + '">View details<span class="visually-hidden">: ' + escape(p.title) + '</span></a></div></article></li>';
  };
  for (const department of catalogue.departments) {
    const relative = 'departments/' + pageOf(department) + '/index.html', route = 'shop/departments/' + pageOf(department) + '/';
    const items = products.filter(p => (p.category || p.department_id) === department.id);
    const crumbs = [home, shop, [department.name, route]];
    write(relative, document(department.name, 'Browse ' + department.name + ' from Zed Supply in Zambia. Confirm current stock, delivery and final price before ordering.', route,
      hero('Department', department.name, 'Prices in Zambian Kwacha. Final availability and delivery are confirmed at checkout.', crumbs) +
      '<section class="section"><div class="container">' +
      (items.length ? '<ul class="grid">' + items.map(card).join('') + '</ul>'
        : '<div class="empty"><span class="dept-dir__icon" aria-hidden="true">' + artwork(department) + '</span><p>Approved listings for ' + escape(department.name) + ' will appear here when available.</p></div>') +
      '<div class="btn-row"><a class="btn btn--primary" href="index.html#/dept/' + escape(department.id) + '">Browse current availability</a><a class="btn btn--secondary" href="shop/">All departments</a></div></div></section>',
      null, !items.length, crumbs));
    if (items.length) links.push(url(route));
  }
  for (const p of products) {
    const price = Number(p.priceZMW || p.price_zmw); if (!(price > 0) || !Number.isFinite(price)) throw new Error('Invalid product price: ' + p.id);
    const route = 'shop/products/' + p.id + '/', image = p.image ? url(p.image) : '', d = departmentOf(p);
    const schema = { '@context':'https://schema.org', '@type':'Product', name:p.title, description:p.description || p.title, sku:p.id, url:url(route),
      offers:{ '@type':'Offer', priceCurrency:'ZMW', price:price.toFixed(2), url:url(route) } };
    if (image) schema.image = [image];
    const crumbs = [home, shop].concat(d ? [[d.name, 'shop/departments/' + pageOf(d) + '/']] : []).concat([[p.title, route]]);
    write('products/' + p.id + '/index.html', document(p.title, p.description || p.title, route,
      hero(d ? d.name : 'Product', p.title, 'Check current options, stock and the final delivered price before ordering.', crumbs) +
      '<section class="section"><div class="container duo duo--gap"><div class="pmedia">' + (p.image ? '<img src="' + escape(p.image) + '" width="600" height="600" alt="' + escape(p.alt || p.title) + '">' : '') + '</div>' +
      '<section class="card"><p class="price"><span class="price__now"><span class="visually-hidden">Price </span>' + cash(price) + '</span></p><p>' + escape(p.description || '') + '</p>' +
      '<div class="btn-row"><a class="btn btn--primary" href="index.html#/product/' + escape(p.id) + '">Choose options and order</a>' + (d ? '<a class="btn btn--secondary" href="shop/departments/' + escape(pageOf(d)) + '/">More in ' + escape(d.name) + '</a>' : '') + '</div></section></div></section>',
      schema, false, crumbs));
    links.push(url(route));
  }
  const count = d => products.filter(p => (p.category || p.department_id) === d.id).length;
  write('index.html', document('Shop departments', 'Browse Zed Supply departments and local products in Zambia.', 'shop/',
    hero('Catalogue', 'Shop departments', 'Browse every Zed Supply department. Prices in Zambian Kwacha; availability and delivery are confirmed at checkout.', [home, shop]) +
    '<section class="section"><div class="container"><ul class="dept-dir">' + catalogue.departments.map(d => {
      const n = count(d);
      return '<li class="dept-dir__item"><a class="dept-dir__head" href="shop/departments/' + escape(pageOf(d)) + '/"><span class="dept-dir__icon" aria-hidden="true">' + artwork(d) + '</span><span><strong>' + escape(d.name) + '</strong><small>' + (n ? n + (n === 1 ? ' product' : ' products') : 'Coming soon') + '</small></span></a></li>';
    }).join('') + '</ul></div></section>', null, !products.length, [home, shop]));
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
