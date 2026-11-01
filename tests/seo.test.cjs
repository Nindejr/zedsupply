const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {execFileSync} = require('node:child_process');

test('crawlable pages escape product data, exclude samples and retire only owned outputs', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'zs-seo-test-'));
  const script = path.resolve('scripts/build-storefront.cjs');
  try {
    fs.mkdirSync(path.join(directory,'js'));
    const data = {departments:[{id:'tech',name:'Technology'},{id:'pets',name:'Pets'}],products:[
      {id:'REAL1',category:'tech',title:'Lamp <script>alert(1)</script>',description:'Safe <description>',priceZMW:100},
      {id:'SAMPLE1',category:'tech',title:'Sample lamp',priceZMW:50,sample:true}]};
    const write = () => fs.writeFileSync(path.join(directory,'js/catalogue.js'),'window.ZS_CATALOGUE = ' + JSON.stringify(data));
    const build = () => execFileSync(process.execPath,[script],{cwd:directory,env:{...process.env,SITE_URL:'https://shop.example.test/',STOREFRONT_SNAPSHOT:''},stdio:'pipe'});
    write(); build();
    const html = fs.readFileSync(path.join(directory,'shop/products/REAL1/index.html'),'utf8');
    assert.match(html,/Lamp &lt;script&gt;/);
    assert.match(html,/https:\/\/shop\.example\.test\/shop\/products\/REAL1\//);
    assert.equal((html.match(/<script/g) || []).length,1,'only JSON-LD is emitted');
    assert.equal(fs.existsSync(path.join(directory,'shop/products/SAMPLE1/index.html')),false);
    const sitemap = fs.readFileSync(path.join(directory,'sitemap.xml'),'utf8');
    assert(!sitemap.includes('SAMPLE1')); assert(!sitemap.includes('#/'));
    assert(sitemap.includes('/departments/tech/') && !sitemap.includes('/departments/pets/'),'only departments with listings are in the sitemap');
    assert.match(fs.readFileSync(path.join(directory,'shop/departments/pets/index.html'),'utf8'),/noindex,follow/);
    assert.doesNotMatch(fs.readFileSync(path.join(directory,'shop/departments/tech/index.html'),'utf8'),/noindex/);
    fs.writeFileSync(path.join(directory,'shop/unrelated.html'),'User-owned file');
    data.products = []; write(); build();
    assert.equal(fs.existsSync(path.join(directory,'shop/products/REAL1/index.html')),false);
    assert.equal(fs.readFileSync(path.join(directory,'shop/unrelated.html'),'utf8'),'User-owned file');
  } finally {
    if (path.dirname(directory) !== path.resolve(os.tmpdir()) || !path.basename(directory).startsWith('zs-seo-test-')) throw new Error('Unexpected cleanup target');
    fs.rmSync(directory,{recursive:true,force:true});
  }
});
