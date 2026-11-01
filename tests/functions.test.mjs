// The server functions' request handling, with stand-ins for the database, sign-in and WhatsApp.
// db/tests/functions.mjs runs the same handlers against a real test database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { placeOrder, paymentWebhook, sendNotifications, dailyJobs, startPayment, validSignature } from '../supabase/functions/_shared/handlers.ts';

const ORIGIN = 'https://nindejr.github.io';
function fakeDeps(env = {}, rows = () => [{ r: { ok: true } }]) {
  const calls = [];
  return {
    calls,
    env: name => ({ SUPABASE_ANON_KEY: 'anon-key', ...env })[name],
    userIdForToken: async token => (token === 'good-token' ? 42 : null),
    sql: async (text, params) => { calls.push({ text, params }); const r = rows(text, params); if (r instanceof Error) throw r; return r; },
    fetch: async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return new Response('{}', { status: env.FAIL_FETCH ? 500 : 200 }); }
  };
}
const post = (body, headers = {}) => new Request('https://x.supabase.co/functions/v1/f', {
  method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });

test('place-order takes the buyer from the sign-in, never from the body', async () => {
  const d = fakeDeps();
  const res = await placeOrder(post({ ref: 'ZS-ABCD1234', user_id: 1, items: [{ product_id: 'L001', quantity: 2, price: 1 }] }, { authorization: 'Bearer good-token' }), d);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), ORIGIN);
  const sent = JSON.parse(d.calls[0].params[0]);
  assert.equal(sent.user_id, 42);
  assert.deepEqual(sent.items, [{ product_id: 'L001', quantity: 2 }]);   // the browser's price is dropped
});

test('place-order: guests need a name and phone; expired sign-ins are refused', async () => {
  let res = await placeOrder(post({ ref: 'ZS-ABCD1234', items: [{ product_id: 'L001' }] }, { authorization: 'Bearer anon-key' }), fakeDeps());
  assert.equal(res.status, 400);
  res = await placeOrder(post({ ref: 'ZS-ABCD1234', items: [] }, { authorization: 'Bearer stale' }), fakeDeps());
  assert.equal(res.status, 401);
  const d = fakeDeps();
  res = await placeOrder(post({ ref: 'ZS-ABCD1234', contact_name: 'Guest', recipient_phone: '+260970000001', user_id: 9, items: [{ product_id: 'L001' }] }), d);
  assert.equal(res.status, 200);
  assert.equal(JSON.parse(d.calls[0].params[0]).user_id, undefined);
});

test('place-order passes the database\'s own messages on, and hides other errors', async () => {
  const stock = Object.assign(new Error('Only 0 left of Last one'), { code: 'P0001' });
  let res = await placeOrder(post({ ref: 'ZS-ABCD1234', contact_name: 'G', recipient_phone: '+1', items: [{}] }), fakeDeps({}, () => stock));
  assert.equal(res.status, 409);
  assert.equal((await res.json()).error, 'Only 0 left of Last one');
  const crash = Object.assign(new Error('relation "x" does not exist'), { code: '42P01' });
  const quiet = console.error; console.error = () => {};
  res = await placeOrder(post({ ref: 'ZS-ABCD1234', contact_name: 'G', recipient_phone: '+1', items: [{}] }), fakeDeps({}, () => crash));
  console.error = quiet;
  assert.equal(res.status, 500);
  assert.doesNotMatch((await res.json()).error, /relation/);
  assert.equal((await placeOrder(post('not json'), fakeDeps())).status, 400);
  assert.equal((await placeOrder(post('x'.repeat(40000)), fakeDeps())).status, 400);
});

test('payment webhooks need the right signature and record each payment', async () => {
  const env = { PAYMENT_PROVIDER: 'generic', PAYMENT_WEBHOOK_SECRET: 's3cret' };
  const body = JSON.stringify({ transaction_id: 'TX-1', order_ref: 'ZS-ABCD1234', amount: 250, status: 'SUCCESSFUL', method: 'mtn' });
  const sig = createHmac('sha256', 's3cret').update(body).digest('hex');
  assert.equal((await paymentWebhook(post(body), fakeDeps())).status, 503);
  assert.equal((await paymentWebhook(post(body, { 'x-signature': 'deadbeef' }), fakeDeps(env))).status, 401);
  const d = fakeDeps(env, () => [{ r: { payment_status: 'paid' } }]);
  const res = await paymentWebhook(post(body, { 'x-signature': 'sha256=' + sig }), d);
  assert.equal(res.status, 200);
  assert.deepEqual(d.calls[0].params.slice(0, 6), ['generic', 'TX-1', 'ZS-ABCD1234', 250, 'paid', 'mtn']);
  const odd = JSON.stringify({ transaction_id: 'TX-2', order_ref: 'ZS-ABCD1234', amount: 1, status: 'weird' });
  assert.equal((await paymentWebhook(post(odd, { 'x-signature': createHmac('sha256', 's3cret').update(odd).digest('hex') }), fakeDeps(env))).status, 400);
  assert.equal(await validSignature('s3cret', body, sig.slice(0, -1) + (sig.endsWith('0') ? '1' : '0')), false);
});

test('notifications wait until WhatsApp is set up, then send approved templates', async () => {
  const auth = { authorization: 'Bearer cron' };
  assert.equal((await sendNotifications(post({}), fakeDeps({ CRON_SECRET: 'cron' }))).status, 401);
  let res = await sendNotifications(post({}, auth), fakeDeps({ CRON_SECRET: 'cron' }));
  assert.deepEqual(await res.json(), { configured: false, sent: 0 });
  const queued = [{ id: 1, to_address: '+260971110001', template: 'payment_received', payload: { ref: 'ZS-ABCD1234', amount: 250 } },
    { id: 2, to_address: '+260971110002', template: 'mystery', payload: {} }];
  const d = fakeDeps({ CRON_SECRET: 'cron', WHATSAPP_TOKEN: 't', WHATSAPP_PHONE_ID: '123' }, text => (text.includes('RETURNING') ? queued : []));
  res = await sendNotifications(post({}, auth), d);
  assert.deepEqual(await res.json(), { configured: true, sent: 1, tried: 2 });
  const msg = d.calls.find(c => c.url).body;
  assert.equal(msg.to, '260971110001');
  assert.equal(msg.template.name, 'payment_received');
  assert.deepEqual(msg.template.components[0].parameters.map(p => p.text), ['ZS-ABCD1234', 'K250.00']);
  assert.ok(d.calls.some(c => c.text && c.text.includes("'skipped'") && c.params[0] === 2));
});

test('daily jobs need the schedule\'s secret', async () => {
  assert.equal((await dailyJobs(post({}), fakeDeps())).status, 401);
  const res = await dailyJobs(post({}, { authorization: 'Bearer cron' }), fakeDeps({ CRON_SECRET: 'cron' }, () => [{ n: 2 }]));
  assert.deepEqual(await res.json(), { payouts_released: 2, laybys_expired: 2 });
});

test('start-payment asks for the deposit on a new lay-by, and only for the buyer\'s own order', async () => {
  const env = { PAYMENT_API_URL: 'https://pay.example/collect', PAYMENT_API_KEY: 'k' };
  assert.equal((await startPayment(post({ order_ref: 'ZS-ABCD1234', phone: '+260971110001' }), fakeDeps())).status, 503);
  const order = [{ id: 1, user_id: 42, recipient_phone: null, status: 'placed', owed: '3000', payment_plan: 'layby', deposit_zmw: '600', paid_zmw: '0' }];
  let d = fakeDeps(env, () => order);
  let res = await startPayment(post({ order_ref: 'ZS-ABCD1234', phone: '0971110001' }, { authorization: 'Bearer good-token' }), d);
  assert.equal(res.status, 400);   // needs the full +260 number
  res = await startPayment(post({ order_ref: 'ZS-ABCD1234', phone: '+260971110001' }, { authorization: 'Bearer good-token' }), d);
  assert.equal(res.status, 200);
  assert.equal(d.calls.find(c => c.url).body.amount, 600);
  d = fakeDeps(env, () => order);
  res = await startPayment(post({ order_ref: 'ZS-ABCD1234', phone: '+260971110001' }), d);
  assert.equal(res.status, 404);   // a guest can't pay for someone's account order
  assert.ok(!d.calls.some(c => c.url));
});
