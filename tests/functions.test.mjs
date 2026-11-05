// The server functions' request handling, with stand-ins for the database, sign-in and WhatsApp.
// db/tests/functions.mjs runs the same handlers against a real test database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { placeOrder, paymentWebhook, sendNotifications, dailyJobs, startPayment, validSignature, courierQuote, courierWebhook } from '../supabase/functions/_shared/handlers.ts';

const ORIGIN = 'https://nindejr.github.io';
function fakeDeps(env = {}, rows = () => [{ r: { ok: true } }]) {
  const calls = [];
  return {
    calls,
    env: name => ({ SUPABASE_ANON_KEY: 'anon-key', PAYMENT_CONTRACT_VALIDATED: 'true', ...env })[name],
    userIdForToken: async token => (token === 'good-token' ? 42 : null),
    sql: async (text, params) => { calls.push({ text, params }); const r = rows(text, params); if (r instanceof Error) throw r; return r; },
    fetch: async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return new Response('{}', { status: env.FAIL_FETCH ? 500 : 200 }); }
  };
}
const post = (body, headers = {}) => new Request('https://x.supabase.co/functions/v1/f', {
  method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });

test('place-order rejects oversized carts instead of silently dropping lines', async () => {
  const d = fakeDeps();
  const res = await placeOrder(post({ contact_name: 'Guest', recipient_phone: '+260970000001',
    items: Array.from({ length: 51 }, () => ({ product_id: 'L001', quantity: 1 })) }), d);
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /50/);
  assert.equal(d.calls.length, 0);
});

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
  const body = JSON.stringify({ transaction_id: 'TX-1', order_ref: 'ZS-ABCD1234', amount: 250, currency: 'ZMW', status: 'SUCCESSFUL', method: 'mtn' });
  const sig = createHmac('sha256', 's3cret').update(body).digest('hex');
  assert.equal((await paymentWebhook(post(body), fakeDeps())).status, 503);
  assert.equal((await paymentWebhook(post(body, { 'x-signature': 'deadbeef' }), fakeDeps(env))).status, 401);
  const d = fakeDeps(env, () => [{ r: { payment_status: 'paid' } }]);
  const res = await paymentWebhook(post(body, { 'x-signature': 'sha256=' + sig }), d);
  assert.equal(res.status, 200);
  assert.deepEqual(d.calls[0].params.slice(0, 6), ['generic', 'TX-1', 'ZS-ABCD1234', 250, 'paid', 'mtn']);
  const odd = JSON.stringify({ transaction_id: 'TX-2', order_ref: 'ZS-ABCD1234', amount: 1, currency: 'ZMW', status: 'weird' });
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
  const d = fakeDeps({ CRON_SECRET: 'cron', WHATSAPP_TOKEN: 't', WHATSAPP_PHONE_ID: '123' }, text => (text.includes('claim_notifications()') ? queued : []));
  res = await sendNotifications(post({}, auth), d);
  assert.deepEqual(await res.json(), { configured: true, sent: 1, tried: 2 });
  const msg = d.calls.find(c => c.url).body;
  assert.equal(msg.to, '260971110001');
  assert.equal(msg.template.name, 'payment_received');
  assert.deepEqual(msg.template.components[0].parameters.map(p => p.text), ['ZS-ABCD1234', 'K250.00']);
  assert.ok(d.calls.some(c => c.text && c.text.includes("'skipped'") && c.params[0] === 2));
});

test('requests enforce byte limits even with chunked multibyte JSON', async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    start(c) { c.enqueue(new TextEncoder().encode(JSON.stringify({ notes: '界'.repeat(12000), items: [] }))); },
    cancel() { cancelled = true; }
  });
  const d = fakeDeps();
  const req = new Request('https://x/f', { method: 'POST', body: stream, duplex: 'half' });
  assert.equal((await placeOrder(req, d)).status, 400);
  assert.equal(cancelled, true);
  assert.equal(d.calls.length, 0);
});

test('signed webhooks reject null, arrays and nonfinite amounts without database work', async () => {
  for (const body of ['null', '[]', '{"transaction_id":"T","order_ref":"ZS-ABCD1234","amount":"Infinity","status":"paid"}']) {
    const d = fakeDeps({ PAYMENT_PROVIDER: 'generic', PAYMENT_WEBHOOK_SECRET: 'secret' });
    const sig = createHmac('sha256', 'secret').update(body).digest('hex');
    const res = await paymentWebhook(post(body, { 'x-signature': sig }), d);
    assert.equal(res.status, 400);
    assert.equal(d.calls.length, 0);
    assert.equal(res.headers.get('cache-control'), 'no-store');
  }
});

test('notification transport failures release the claim and allow the remaining batch to send', async () => {
  const d = fakeDeps({ CRON_SECRET: 'cron', WHATSAPP_TOKEN: 't', WHATSAPP_PHONE_ID: '123' }, sql =>
    sql.includes('claim_notifications()') ? [1, 2].map(id => ({ id, claim_token: 'lease-' + id, to_address: '+260971110001', template: 'order_confirmed', payload: { ref: 'ZS-ABCD1234' } })) : []);
  let count = 0;
  d.fetch = async () => { if (++count === 1) throw new Error('timeout'); return new Response('{}'); };
  const res = await sendNotifications(post({}, { authorization: 'Bearer cron' }), d);
  assert.equal((await res.json()).sent, 1);
  assert.ok(d.calls.some(c => c.text.includes('Delivery interrupted') && c.params[1] === 'lease-1'));
  assert.ok(d.calls.some(c => c.text.includes("status = 'sent'") && c.params[1] === 'lease-2'));
});

test('expired payment sign-ins never fall back to guest authorization', async () => {
  const d = fakeDeps({ PAYMENT_API_URL: 'https://pay.example', PAYMENT_API_KEY: 'k' });
  const res = await startPayment(post({ order_ref: 'ZS-ABCD1234', phone: '+260971110001' }, { authorization: 'Bearer expired' }), d);
  assert.equal(res.status, 401);
  assert.equal(d.calls.length, 0);
});

test('payments stay off until provider acceptance and reject foreign currency events', async () => {
  const body = JSON.stringify({transaction_id:'T-1',order_ref:'ZS-ABCD1234',amount:100,currency:'USD',status:'paid'});
  const sig = createHmac('sha256','secret').update(body).digest('hex');
  const env = {PAYMENT_PROVIDER:'generic',PAYMENT_WEBHOOK_SECRET:'secret'};
  assert.equal((await paymentWebhook(post(body,{'x-signature':sig}),fakeDeps({...env,PAYMENT_CONTRACT_VALIDATED:'false'}))).status,503);
  const d = fakeDeps(env);
  assert.equal((await paymentWebhook(post(body,{'x-signature':sig}),d)).status,400);
  assert.equal(d.calls.length,0);
});

test('replayed payment attempts never send another provider prompt', async () => {
  const d = fakeDeps({PAYMENT_API_URL:'https://pay.example',PAYMENT_API_KEY:'key'}, () => [{r:{id:'attempt',reference:'stable-reference',amount:100,send:false,state:'unknown'}}]);
  const res = await startPayment(post({order_ref:'ZS-ABCD1234',phone:'+260970000001',attempt_key:'PAY-12345678'},{authorization:'Bearer good-token'}),d);
  assert.equal(res.status,200);
  assert.equal((await res.json()).replayed,true);
  assert.equal(d.calls.some(c => c.url),false);
});

test('daily jobs need the schedule\'s secret', async () => {
  assert.equal((await dailyJobs(post({}), fakeDeps())).status, 401);
  const res = await dailyJobs(post({}, { authorization: 'Bearer cron' }), fakeDeps({ CRON_SECRET: 'cron' }, () => [{ n: 2 }]));
  assert.deepEqual(await res.json(), { payouts_released: 2, laybys_expired: 2 });
});

test('start-payment asks for the deposit on a new lay-by, and only for the buyer\'s own order', async () => {
  const env = { PAYMENT_API_URL: 'https://pay.example/collect', PAYMENT_API_KEY: 'k' };
  assert.equal((await startPayment(post({ order_ref: 'ZS-ABCD1234', phone: '+260971110001' }), fakeDeps())).status, 503);
  const order = [{ r: { id: 'attempt-id', reference: 'ZS-ABCD1234-ATTEMPT', amount: 600, send: true, state: 'created' } }];
  let d = fakeDeps(env, () => order);
  let res = await startPayment(post({ order_ref: 'ZS-ABCD1234', phone: '0971110001' }, { authorization: 'Bearer good-token' }), d);
  assert.equal(res.status, 400);   // needs the full +260 number
  res = await startPayment(post({ order_ref: 'ZS-ABCD1234', phone: '+260971110001', attempt_key: 'PAY-12345678' }, { authorization: 'Bearer good-token' }), d);
  assert.equal(res.status, 200);
  assert.equal(d.calls.find(c => c.url).body.amount, 600);
  d = fakeDeps(env, () => order);
  res = await startPayment(post({ order_ref: 'ZS-ABCD1234', phone: '+260971110001' }), d);
  assert.equal(res.status, 401);   // a phone number is not verified account authorization
  assert.ok(!d.calls.some(c => c.url));
});

// ---------- Courier quotes, courier tracking and email receipts ----------
const rateQuote = { speed: 'express', total: 383, pending: false, parcels: [
  { seller_id: 'da', zone: 'town', speed: 'express', fee: 93, free: false, pending: false, weight_kg: 6, from_town: 'Lusaka', from_province: 'lusaka', to_town: 'Lusaka', to_province: 'lusaka' },
  { seller_id: 'db', zone: 'country', speed: 'express', fee: 290, free: false, pending: false, weight_kg: 1, from_town: 'Kitwe', from_province: 'copperbelt', to_town: 'Lusaka', to_province: 'lusaka' }] };
const quoteDeps = (env = {}, courierReply = { amount: 120, currency: 'ZMW', min_days: 1, max_days: 2 }) => {
  const d = fakeDeps(env, text => text.includes('save_delivery_quote') ? [{ id: 'quote-1' }] : text.includes('delivery_quote') ? [{ q: structuredClone(rateQuote) }] : []);
  d.fetch = async (url, init) => { d.calls.push({ url, body: JSON.parse(init.body) }); return new Response(JSON.stringify(courierReply), { status: 200 }); };
  return d;
};
const LIVE = { COURIER_API_URL: 'https://courier.example/rates', COURIER_API_KEY: 'k', COURIER_API_COURIER: 'zampost', COURIER_CONTRACT_VALIDATED: 'true' };

test('courier-quote prices the cart from the rate card, passing only known fields', async () => {
  const d = quoteDeps();
  const res = await courierQuote(post({ buyer_town: 'Lusaka', delivery_speed: 'express', user_id: 9, items: [{ product_id: 'DA1', quantity: 3, price: 1 }] }), d);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.deepEqual([body.total, body.quote_id, body.parcels[0].source], [383, null, 'rate_card']);
  const sent = JSON.parse(d.calls[0].params[0]);
  assert.deepEqual(sent.items, [{ product_id: 'DA1', quantity: 3 }]);
  assert.equal(sent.user_id, undefined);
  assert.equal(d.calls.some(c => c.url), false, 'no courier is asked without a connected courier');
  assert.equal((await courierQuote(post({ items: [] }), quoteDeps())).status, 400);
});

test('courier-quote asks a connected courier for its live price and saves the quote', async () => {
  const d = quoteDeps(LIVE);
  const body = await (await courierQuote(post({ buyer_town: 'Lusaka', courier_id: 'zampost', items: [{ product_id: 'DA1' }, { product_id: 'DB1' }] }), d)).json();
  assert.equal(body.quote_id, 'quote-1');
  assert.deepEqual(body.parcels.map(p => [p.fee, p.source]), [[120, 'courier_api'], [120, 'courier_api']]);
  assert.equal(body.total, 240);
  const ask = d.calls.find(c => c.url && c.body.origin.town === 'Kitwe').body;
  assert.deepEqual([ask.destination.town, ask.weight_kg, ask.currency], ['Lusaka', 1, 'ZMW']);
  // A different courier, an unvalidated contract or a bad answer leaves the rate card in place
  for (const [env, choice, answer] of [[LIVE, 'dhl', undefined], [{ ...LIVE, COURIER_CONTRACT_VALIDATED: '' }, 'zampost', undefined],
    [LIVE, 'zampost', { amount: 120, currency: 'USD' }], [LIVE, 'zampost', { amount: -5, currency: 'ZMW' }], [LIVE, 'zampost', { amount: 1.234, currency: 'ZMW' }]]) {
    const r = await (await courierQuote(post({ courier_id: choice, items: [{ product_id: 'DA1' }] }), quoteDeps(env, answer))).json();
    assert.deepEqual([r.total, r.quote_id], [383, null], JSON.stringify([choice, answer]));
  }
});

test('courier-webhook needs the courier\'s signature, maps its statuses and records each event once', async () => {
  const env = { COURIER_WEBHOOK_SECRET: 'cwsec', COURIER_WEBHOOK_COURIER: 'dropsync', COURIER_CONTRACT_VALIDATED: 'true' };
  const event = JSON.stringify({ event_id: 'ev-1', tracking_number: 'TRK-0001', status: 'Out_For_Delivery', location: 'Lusaka', occurred_at: '2026-11-05T09:00:00Z' });
  const sign = b => createHmac('sha256', 'cwsec').update(b).digest('hex');
  assert.equal((await courierWebhook(post(event, { 'x-signature': sign(event) }), fakeDeps({}))).status, 503);
  assert.equal((await courierWebhook(post(event, { 'x-signature': 'bad' }), fakeDeps(env))).status, 401);
  const d = fakeDeps(env, () => [{ r: { recorded: true } }]);
  const res = await courierWebhook(post(event, { 'x-signature': sign(event) }), d);
  assert.equal(res.status, 200);
  assert.deepEqual(d.calls[0].params.slice(0, 4), ['dropsync', 'ev-1', 'TRK-0001', 'out_for_delivery']);
  const odd = JSON.stringify({ event_id: 'ev-2', tracking_number: 'TRK-0001', status: 'teleported' });
  assert.equal((await courierWebhook(post(odd, { 'x-signature': sign(odd) }), fakeDeps(env))).status, 400);
  const unknown = Object.assign(new Error('Unknown tracking number'), { code: 'P0001' });
  assert.equal((await courierWebhook(post(event, { 'x-signature': sign(event) }), fakeDeps(env, () => unknown))).status, 422);
});

test('send-notifications emails receipts when an email provider is set up, separately from WhatsApp', async () => {
  const queued = [{ id: 7, claim_token: 'lease-7', to_address: 'buyer@example.com', template: 'order_receipt', payload: { ref: 'ZS-ABCD1234', name: 'Chanda <b>', total: 883 } },
    { id: 8, claim_token: 'lease-8', to_address: 'buyer@example.com', template: 'back_in_stock', payload: {} }];
  const d = fakeDeps({ CRON_SECRET: 'cron', EMAIL_API_KEY: 'ek', EMAIL_FROM: 'Zed Supply <orders@example.com>' }, (text, params) => (text.includes('claim_notifications($1)') && params[0] === 'email' ? queued : []));
  const res = await sendNotifications(post({}, { authorization: 'Bearer cron' }), d);
  assert.deepEqual(await res.json(), { configured: false, sent: 0, email: { sent: 1, tried: 2 } });
  const mail = d.calls.find(c => c.url);
  assert.equal(mail.url, 'https://api.resend.com/emails');
  assert.deepEqual(mail.body.to, ['buyer@example.com']);
  assert.match(mail.body.subject, /ZS-ABCD1234/);
  assert.match(mail.body.html, /Chanda &lt;b&gt;/);
  assert.match(mail.body.text, /K883\.00/);
  assert.ok(d.calls.some(c => c.text && c.text.includes('No email template') && c.params[0] === 8));
});
