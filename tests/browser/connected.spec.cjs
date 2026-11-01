// Staging contract tests: all Auth, database and payment endpoints are local stand-ins.
// They validate the integration without activating services or sending messages/money.
const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const source = fs.readFileSync('js/catalogue.js','utf8').replace("api: { enabled: false, url: '', key: '' }", "api: { enabled: true, url: 'https://test-project.supabase.co', key: 'test-publishable-key' }");
const product = { id:'LIVE1',title:'Approved studio lamp',department_id:'tech',subcategory_id:'phones',seller_id:'live-store',price_zmw:100,stock_qty:3,stock_status:'in',
  image:'assets/products/L002.webp',alt:'Studio lamp',options:[],variants:[],components:[],images:[],tiers:[],seller:{id:'live-store',name:'Live store',city:'Lusaka',verified:false} };

async function setup(page) {
  const calls = [];
  await page.addInitScript(() => {
    localStorage.setItem('zs-consent','denied');
    localStorage.setItem('zs-user',JSON.stringify({id:999,name:'Untrusted local profile',is_staff:true}));
    localStorage.setItem('zs-location',JSON.stringify({town:'Lusaka',province:'lusaka',area:'Test area',mode:'delivery',remember:true}));
  });
  await page.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.hostname === '127.0.0.1') {
      if (url.pathname.endsWith('/js/catalogue.js')) return route.fulfill({contentType:'application/javascript',body:source});
      return route.continue();
    }
    if (url.hostname !== 'test-project.supabase.co') return route.fulfill({status:200,body:''});
    const body = req.postDataJSON(); calls.push({path:url.pathname,body,headers:req.headers(),query:url.search});
    let data = {};
    if (url.pathname === '/auth/v1/verify') data = {access_token:'verified-test-token',refresh_token:'refresh-test',expires_in:3600};
    else if (url.pathname === '/auth/v1/user') data = {id:'verified-auth-id',email_confirmed_at:'2026-11-01T00:00:00Z'};
    else if (url.pathname === '/rest/v1/users') data = [{id:7,name:'Verified Buyer',email:'buyer@example.test',phone:'+260970000001',is_staff:false}];
    else if (url.pathname === '/rest/v1/rpc/catalogue_page') data = [product];
    else if (url.pathname === '/rest/v1/rpc/checkout_quote') data = {total:100,subtotal:100,vat:0,currency:'ZMW',delivery_pending:true};
    else if (url.pathname === '/functions/v1/place-order') data = {ref:body.ref,total:100,order_id:41};
    else if (url.pathname === '/rest/v1/orders') data = [{id:41,ref:'ZS-LIVE0001',status:'placed',created_at:'2026-11-01T00:00:00Z',total_zmw:100,delivery_zmw:null,paid_zmw:0,payment_status:'unpaid',fulfilment:'delivery',order_items:[{id:81,product_id:'LIVE1',quantity:1,unit_price_zmw:100,order_item_addons:[]}]}];
    else data = [];
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
  });
  return calls;
}
async function signIn(page) {
  await page.goto('/index.html?demo=0#/account');
  await page.getByLabel('Your name',{exact:true}).fill('Verified Buyer');
  await page.getByLabel('Email',{exact:true}).fill('buyer@example.test');
  await page.getByRole('button',{name:'Send code',exact:true}).click();
  await page.getByLabel('Email code',{exact:true}).fill('123456');
  await page.getByRole('button',{name:'Verify and sign in',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Hello, Verified Buyer'})).toBeVisible();
}
test('verified sign-in, server search and quote-before-order use trusted identity and pricing', async ({page}) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const calls = await setup(page);
  await signIn(page);
  await page.goto('/index.html?demo=0#/search?q=lamp');
  await expect(page.locator('.pcard')).toHaveCount(1);
  await page.locator('.ptitle').click();
  await expect(page.getByRole('heading',{name:'Approved studio lamp',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Add to cart',exact:true}).click();
  await page.goto('/index.html?demo=0#/cart');
  await expect(page.getByRole('link',{name:'Review server total',exact:true})).toBeVisible();
  await page.getByRole('link',{name:'Review server total',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Review your server total'})).toBeVisible();
  expect(calls.filter(c => c.path.endsWith('/place-order'))).toHaveLength(0);
  await page.getByRole('button',{name:'Place order for K100 in items',exact:true}).click();
  await expect(page.getByRole('heading',{name:/Order ZS-/})).toBeVisible();
  const placed = calls.find(c => c.path.endsWith('/place-order'));
  expect(placed.body.expected_total_zmw).toBe(100);
  expect(placed.body.user_id).toBeUndefined();
  expect(placed.body.items).toEqual([{product_id:'LIVE1',variant_id:null,quantity:1,addons:[],commitment_id:null}]);
  expect(placed.headers.authorization).toBe('Bearer verified-test-token');
  expect(calls.find(c => c.path === '/rest/v1/orders').query).toContain('user_id=eq.7');
  expect(errors).toEqual([]);
});
test('a changed checkout field invalidates the reviewed quote', async ({page}) => {
  const calls = await setup(page); await signIn(page);
  await page.goto('/index.html?demo=0#/product/LIVE1');
  await page.getByRole('button',{name:'Add to cart',exact:true}).click();
  await page.goto('/index.html?demo=0#/cart');
  await page.getByRole('link',{name:'Review server total',exact:true}).click();
  await expect(page.getByRole('button',{name:'Place order for K100 in items',exact:true})).toBeVisible();
  await page.getByLabel('Recipient phone (+260…)').fill('+260970000002');
  await expect(page.getByRole('button',{name:'Place order for K100 in items',exact:true})).toHaveCount(0);
  expect(calls.filter(c => c.path.endsWith('/place-order'))).toHaveLength(0);
});
