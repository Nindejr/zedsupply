const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = { module: { exports: {} }, AbortSignal, Date, crypto: require('node:crypto').webcrypto };
vm.runInNewContext(fs.readFileSync('js/backend.js','utf8'),context);
const { create, mapProduct } = context.module.exports;
const config = { enabled: true, url: 'https://test-project.supabase.co', key: 'publishable' };
function setup(responder, cfg = config) {
  const data = new Map(), calls = [];
  const client = create({ config: cfg, storage: { getItem: k => data.get(k), setItem: (k,v) => data.set(k,v), removeItem: k => data.delete(k) },
    fetch: async (url, init) => { calls.push({ url, init }); return responder(url,init); } });
  return { client, data, calls };
}
const answer = (data,status = 200) => new Response(JSON.stringify(data), { status });

test('backend stays inert while activation is disabled', async () => {
  const x = setup(() => { throw new Error('must not call'); }, { ...config, enabled: false });
  await x.client.initialize();
  await assert.rejects(x.client.sendCode('a@example.test','A'), /not activated/);
  assert.equal(x.calls.length, 0);
});
test('an OTP result becomes an account only after server identity and contact confirmation', async () => {
  const x = setup(url => url.endsWith('/verify') ? answer({ access_token:'verified-token',refresh_token:'refresh',expires_in:3600 }) :
    url.endsWith('/user') ? answer({ id:'auth-1',email_confirmed_at:'2026-11-01' }) : answer([{ id:7,name:'Buyer',email:'a@example.test' }]));
  await x.client.verifyCode('a@example.test','123456');
  assert.equal(x.client.profile().id,7);
  assert.equal(x.calls.find(c => c.url.endsWith('/user')).init.headers.authorization,'Bearer verified-token');
  assert(x.data.has('zs-auth-session'));
});
test('unconfirmed contacts cannot obtain an application profile', async () => {
  const x = setup(url => url.endsWith('/verify') ? answer({ access_token:'unconfirmed',refresh_token:'r',expires_in:3600 }) : answer({ id:'auth-1' }));
  await assert.rejects(x.client.verifyCode('a@example.test','123456'), /Confirm your email/);
  assert.equal(x.client.profile(),null);
  assert.equal(x.data.has('zs-auth-session'),false);
});
test('expired sessions clear on rejection and never use local profile storage as identity', async () => {
  const x = setup(() => answer({ msg:'expired' },401));
  x.data.set('zs-auth-session', JSON.stringify({ access_token:'old',refresh_token:'old',expires_at:1 }));
  await x.client.initialize();
  assert.equal(x.client.profile(),null);
  assert.equal(x.data.has('zs-auth-session'),false);
});
test('server variant identities and paid add-ons remain available for checkout mapping', () => {
  const product = mapProduct({ id:'LIVE',title:'Phone',department_id:'tech',seller_id:'seller',price_zmw:'500',stock_qty:2,
    options:[{ id:1,kind:'colour',name:'Colour',values:[{ id:10,label:'Blue',hex:'#0057AE' }] }],
    variants:[{ id:40,sku:'BLUE',stock_qty:2,values:[{option_id:1,value_id:10}] }],
    components:[{ id:80,name:'Cable',kind:'addon',addon_price_zmw:'20.50',quantity:1 }] });
  assert.equal(product.variants[0].colour,'Blue');
  assert.equal(product.inBox[0].addonZMW,20.5);
  assert.equal(product._server.variants[0].id,40);
  assert.equal(product._server.components[0].id,80);
});
