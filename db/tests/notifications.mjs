// Only run on a migrated, isolated test database; never a live marketplace database.
import pg from 'pg';
import assert from 'node:assert/strict';
import { sendNotifications } from '../../supabase/functions/_shared/handlers.ts';

const cfg = { host: process.env.PGHOST || 'localhost', port: Number(process.env.PGPORT) || 5432,
  user: process.env.PGUSER || 'postgres', database: process.env.PGDATABASE || 'zedsupply_test' };
const a = new pg.Client(cfg), b = new pg.Client(cfg);
await Promise.all([a.connect(), b.connect()]);
const ids = [];
try {
  const inserted = await a.query(`INSERT INTO notifications (to_address, template, payload)
    VALUES ('+260970000001', 'order_confirmed', '{"ref":"ZS-LEASE001"}') RETURNING id`);
  ids.push(inserted.rows[0].id);
  let began;
  const started = new Promise(resolve => { began = resolve; });
  let resume;
  const blocked = new Promise(resolve => { resume = resolve; });
  let sends = 0;
  const env = { CRON_SECRET: 'test', WHATSAPP_TOKEN: 'test', WHATSAPP_PHONE_ID: 'test' };
  const deps = client => ({ env: k => env[k], userIdForToken: async () => null,
    sql: async (sql, params) => (await client.query(sql, params)).rows,
    fetch: async () => { sends++; began(); await blocked; return new Response('{}'); } });
  const req = () => new Request('https://test/f', { method: 'POST', headers: { authorization: 'Bearer test' } });
  const first = sendNotifications(req(), deps(a));
  await started;
  try {
    const second = await sendNotifications(req(), deps(b));
    assert.equal((await second.json()).tried, 0, 'overlapping worker must not reclaim a sending message');
  } finally { resume(); await first; }
  assert.equal(sends, 1);
  const reset = await a.query(`UPDATE notifications SET status = 'processing', attempts = 1,
    claimed_at = now() - interval '11 minutes', claim_token = gen_random_uuid() WHERE id = $1 RETURNING claim_token`, ids);
  const reclaimed = await b.query('SELECT * FROM app.claim_notifications()');
  assert.equal(reclaimed.rows.length, 1);
  assert.equal(reclaimed.rows[0].attempts, 2);
  assert.notEqual(reclaimed.rows[0].claim_token, reset.rows[0].claim_token);
  const stale = await a.query(`UPDATE notifications SET status = 'sent' WHERE id = $1 AND claim_token = $2`, [ids[0], reset.rows[0].claim_token]);
  assert.equal(stale.rowCount, 0, 'expired worker must not overwrite the new claim');
  await a.query(`UPDATE notifications SET attempts = 5, claimed_at = now() - interval '11 minutes' WHERE id = $1`, ids);
  assert.equal((await b.query('SELECT * FROM app.claim_notifications()')).rows.length, 0);
  assert.equal((await a.query('SELECT status FROM notifications WHERE id = $1', ids)).rows[0].status, 'failed');
  await a.query('SET ROLE authenticated');
  await assert.rejects(a.query('SELECT * FROM app.claim_notifications()'), { code: '42501' });
  await a.query('RESET ROLE');
  console.log('PASS notification overlap, lease recovery, attempt limit and restricted execution');
} finally {
  await a.query('RESET ROLE');
  if (ids.length) await a.query('DELETE FROM notifications WHERE id = ANY($1::bigint[])', [ids]);
  await Promise.all([a.end(), b.end()]);
}
