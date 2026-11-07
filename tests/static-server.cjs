// Local-only browser test server. It never serves business files, keys, source control or SQL.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg' };
http.createServer((req, res) => {
  let name;
  try { name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/+/, '') || 'index.html'; }
  catch { res.writeHead(400).end(); return; }
  if (name.endsWith('/')) name += 'index.html';
  const file = path.resolve(root, name);
  const relative = path.relative(root, file).split(path.sep).join('/');
  if (!file.startsWith(root + path.sep) || !/^(assets\/|css\/|js\/|shop\/(?:index\.html|(?:departments|products)\/[a-zA-Z0-9_-]+\/index\.html)$|(?:index|help|privacy|404)\.html$|admin\/index\.html$|sw\.js$|manifest\.webmanifest$)/.test(relative)) {
    res.writeHead(404).end(); return;
  }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' }); res.end(data);
  });
}).listen(Number(process.env.PORT) || 4173, '127.0.0.1');
