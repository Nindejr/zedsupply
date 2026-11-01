// The server function handlers against a real, migrated test database: an order placed over
// HTTP, then its payment webhook delivered twice. Run like concurrency.mjs:
//   npm install --no-save pg && node db/tests/functions.mjs
// Never point it at a database holding real data: it inserts and then deletes fixtures.
import pg from 'pg';
import { createHmac } from 'node:crypto';
import { placeOrder, paymentWebhook } from '../../supabase/functions/_shared/handlers.ts';

const cfg = { host: process.env.PGHOST || 'localhost', port: Number(process.env.PGPORT) || 5432, user: process.env.PGUSER || 'postgres', database: process.env.PGDATABASE || 'zedsupply_test' };
const db = new pg.Client(cfg);
await db.connect();
const results = [];
const report = (name, ok, detail) => { results.push(ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + detail : '')); };
const env = { SUPABASE_ANON_KEY: 'anon', PAYMENT_PROVIDER: 'generic', PAYMENT_WEBHOOK_SECRET: 'whsec' };
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

const hook = JSON.stringify({ transaction_id: 'GEN-1', order_ref: 'ZS-FUNC0001', amount: 500, status: 'successful', method: 'airtel' });
const sig = createHmac('sha256', 'whsec').update(hook).digest('hex');
const first = await (await paymentWebhook(post(hook, { 'x-signature': sig }), deps)).json();
const again = await (await paymentWebhook(post(hook, { 'x-signature': sig }), deps)).json();
const o = (await db.query(`SELECT paid_zmw, status, (SELECT count(*)::int FROM payments p WHERE p.order_id = orders.id) n FROM orders WHERE ref = 'ZS-FUNC0001'`)).rows[0];
report('a webhook delivered twice records one payment and confirms the order', first.payment_status === 'paid' && again.payment_status === 'paid'
  && Number(o.paid_zmw) === 500 && o.status === 'confirmed' && o.n === 1, JSON.stringify(o));

await db.query(`DELETE FROM notifications WHERE order_id IN (SELECT id FROM orders WHERE ref LIKE 'ZS-FUNC%');
  DELETE FROM seller_payouts WHERE seller_id = 'fs'; DELETE FROM payments WHERE provider_ref = 'GEN-1';
  DELETE FROM order_items WHERE product_id = 'FA'; DELETE FROM orders WHERE ref LIKE 'ZS-FUNC%';
  DELETE FROM products WHERE id = 'FA'; DELETE FROM sellers WHERE id = 'fs'; DELETE FROM departments WHERE id = 'ft';`);
await db.end();
console.log(results.every(Boolean) ? 'ALL PASSED' : 'SOME FAILED');
process.exit(results.every(Boolean) ? 0 : 1);
