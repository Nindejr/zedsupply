// The server function handlers against a real, migrated test database: an order placed over
// HTTP, then its payment webhook delivered twice. Run like concurrency.mjs:
//   npm install --no-save pg && node db/tests/functions.mjs
// Never point it at a database holding real data: it inserts and then deletes fixtures.
import pg from 'pg';
import { createHmac } from 'node:crypto';
import { placeOrder, paymentWebhook, courierQuote } from '../../supabase/functions/_shared/handlers.ts';

const cfg = { host: process.env.PGHOST || 'localhost', port: Number(process.env.PGPORT) || 5432, user: process.env.PGUSER || 'postgres', database: process.env.PGDATABASE || 'zedsupply_test' };
const db = new pg.Client(cfg);
await db.connect();
const results = [];
const report = (name, ok, detail) => { results.push(ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + detail : '')); };
const env = { SUPABASE_ANON_KEY: 'anon', PAYMENT_PROVIDER: 'generic', PAYMENT_CONTRACT_VALIDATED: 'true', PAYMENT_WEBHOOK_SECRET: 'whsec' };
const deps = {
  env: name => env[name],
  userIdForToken: async () => null,
  sql: async (text, params) => (await db.query(text, params)).rows,
  fetch
};
const post = (body, headers = {}) => new Request('https://example.supabase.co/functions/v1/x', { method: 'POST', headers: { origin: 'https://nindejr.github.io', ...headers }, body });

await db.query(`INSERT INTO departments (id, name) VALUES ('ft', 'Functions test');
  INSERT INTO sellers (id, name) VALUES ('fs', 'Functions seller');
  INSERT INTO products (id, title, department_id, seller_id, price_zmw, status, stock_qty) VALUES ('FA', 'Kettle', 'ft', 'fs', 250, 'active', 3);`);

let res = await placeOrder(post(JSON.stringify({ ref: 'ZS-FUNC0001', contact_name: 'Guest', recipient_phone: '+260970000009',
  items: [{ product_id: 'FA', quantity: 2, unit_price_zmw: 1 }] })), deps);
let body = await res.json();
report('an order placed over HTTP is priced by the database', res.status === 200 && Number(body.total) === 500, JSON.stringify(body));
res = await placeOrder(post(JSON.stringify({ ref: 'ZS-FUNC0002', contact_name: 'Guest', recipient_phone: '+260970000009', items: [{ product_id: 'FA', quantity: 2 }] })), deps);
body = await res.json();
report('a sold-out item gets the database\'s message', res.status === 409 && /Only 1 left/.test(body.error), JSON.stringify(body));

const hook = JSON.stringify({ transaction_id: 'GEN-1', order_ref: 'ZS-FUNC0001', amount: 500, currency: 'ZMW', status: 'successful', method: 'airtel' });
const sig = createHmac('sha256', 'whsec').update(hook).digest('hex');
const first = await (await paymentWebhook(post(hook, { 'x-signature': sig }), deps)).json();
const again = await (await paymentWebhook(post(hook, { 'x-signature': sig }), deps)).json();
const o = (await db.query(`SELECT paid_zmw, status, (SELECT count(*)::int FROM payments p WHERE p.order_id = orders.id) n FROM orders WHERE ref = 'ZS-FUNC0001'`)).rows[0];
report('a webhook delivered twice records one payment and confirms the order', first.payment_status === 'paid' && again.payment_status === 'paid'
  && Number(o.paid_zmw) === 500 && o.status === 'confirmed' && o.n === 1, JSON.stringify(o));

// Delivery: the courier-quote function prices from the rate card, and checkout charges that fee
await db.query(`INSERT INTO delivery_rates (zone, speed, fee_zmw, included_kg, per_kg_zmw, min_days, max_days) VALUES ('country', 'standard', 150, 5, 12, 3, 7);
  INSERT INTO seller_locations (seller_id, town) VALUES ('fs', 'Kitwe');`);
res = await courierQuote(post(JSON.stringify({ buyer_town: 'Lusaka', items: [{ product_id: 'FA', quantity: 1 }] })), deps);
body = await res.json();
report('courier-quote prices a parcel from the rate card', res.status === 200 && body.total === 150 && body.parcels[0].zone === 'country' && body.quote_id === null, JSON.stringify(body));
await db.query(`UPDATE products SET stock_qty = 3 WHERE id = 'FA'`);
res = await placeOrder(post(JSON.stringify({ ref: 'ZS-FUNC0003', contact_name: 'Guest', recipient_phone: '+260970000009', buyer_town: 'Lusaka', expected_delivery_zmw: 150,
  receipt_email: 'guest@example.com', items: [{ product_id: 'FA', quantity: 1 }] })), deps);
body = await res.json();
const parcels = (await db.query(`SELECT count(*)::int n, sum(fee_zmw)::numeric fee FROM order_parcels WHERE order_id = (SELECT id FROM orders WHERE ref = 'ZS-FUNC0003')`)).rows[0];
report('an order placed over HTTP is charged the quoted delivery', res.status === 200 && Number(body.delivery) === 150 && Number(body.grand_total) === 400 && parcels.n === 1 && Number(parcels.fee) === 150, JSON.stringify(body));
res = await placeOrder(post(JSON.stringify({ ref: 'ZS-FUNC0004', contact_name: 'Guest', recipient_phone: '+260970000009', buyer_town: 'Lusaka', expected_delivery_zmw: 99, items: [{ product_id: 'FA', quantity: 1 }] })), deps);
report('a changed delivery fee is refused with the reason from the database', res.status === 409 && /delivery fee changed/.test((await res.json()).error));

await db.query(`DELETE FROM order_parcels WHERE order_id IN (SELECT id FROM orders WHERE ref LIKE 'ZS-FUNC%');
  DELETE FROM seller_locations WHERE seller_id = 'fs'; DELETE FROM delivery_rates WHERE zone = 'country' AND speed = 'standard' AND courier_id IS NULL AND fee_zmw = 150;`);
await db.query(`DELETE FROM notifications WHERE order_id IN (SELECT id FROM orders WHERE ref LIKE 'ZS-FUNC%');
  DELETE FROM seller_payouts WHERE seller_id = 'fs'; DELETE FROM payments WHERE provider_ref = 'GEN-1';
  DELETE FROM order_items WHERE product_id = 'FA'; DELETE FROM orders WHERE ref LIKE 'ZS-FUNC%';
  DELETE FROM products WHERE id = 'FA'; DELETE FROM sellers WHERE id = 'fs'; DELETE FROM departments WHERE id = 'ft';`);
await db.end();
console.log(results.every(Boolean) ? 'ALL PASSED' : 'SOME FAILED');
process.exit(results.every(Boolean) ? 0 : 1);
