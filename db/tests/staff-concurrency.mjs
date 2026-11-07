// Two owners stepping down on separate connections must leave one owner.
// Run only on an isolated, migrated test database, with the same PG* settings as test:db.
import pg from 'pg';
import assert from 'node:assert/strict';

const cfg = { host: process.env.PGHOST || 'localhost', port: Number(process.env.PGPORT) || 5432,
  user: process.env.PGUSER || 'postgres', database: process.env.PGDATABASE || 'zedsupply_test' };
const clients = [new pg.Client(cfg), new pg.Client(cfg), new pg.Client(cfg)];
const [a, b, setup] = clients;
const ids = ['00000000-0000-0000-0000-00000000e031', '00000000-0000-0000-0000-00000000e032'];
const emails = ['owner-a@role-race.test', 'owner-b@role-race.test'];
try {
  await Promise.all(clients.map(client => client.connect()));
  await setup.query(`INSERT INTO auth.users (id, email, email_confirmed_at)
    VALUES ($1, $2, now()), ($3, $4, now())`, [ids[0], emails[0], ids[1], emails[1]]);
  await setup.query('UPDATE users SET is_staff = true WHERE email = ANY($1)', [emails]);
  await setup.query(`INSERT INTO staff_roles (user_id, role) SELECT id, 'owner' FROM users WHERE email = ANY($1)`, [emails]);
  for (const [index, client] of [a, b].entries()) {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: ids[index], role: 'authenticated', aal: 'aal2' })]);
    await client.query('SET LOCAL ROLE authenticated');
  }
  await a.query(`SELECT public.staff_set_roles($1, '{support}')`, [emails[0]]);
  let settled = false;
  const second = b.query(`SELECT public.staff_set_roles($1, '{support}')`, [emails[1]])
    .then(() => null, error => error).finally(() => { settled = true; });
  // Wait until the second request finishes or the server reports it waiting on the first.
  for (let tries = 0; tries < 100 && !settled; tries++) {
    const result = await setup.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1', [b.processID]);
    if (result.rows[0]?.wait_event_type === 'Lock') break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  await a.query('COMMIT');
  const error = await second;
  await b.query(error ? 'ROLLBACK' : 'COMMIT');
  const remaining = await setup.query(`SELECT count(*)::int AS n FROM staff_roles r JOIN users u ON u.id = r.user_id
    WHERE r.role = 'owner' AND u.is_staff AND u.email = ANY($1)`, [emails]);
  assert.match(error?.message || '', /must always have one/);
  assert.equal(remaining.rows[0].n, 1);
  console.log('PASS simultaneous staff role changes preserve the last owner');
} finally {
  await Promise.all([a, b].map(client => client.query('ROLLBACK').catch(() => {})));
  await setup.query('DELETE FROM staff_actions WHERE staff_id IN (SELECT id FROM users WHERE email = ANY($1))', [emails]);
  await setup.query('DELETE FROM users WHERE email = ANY($1)', [emails]);
  await setup.query('DELETE FROM auth.users WHERE id = ANY($1::uuid[])', [ids]);
  await Promise.all(clients.map(client => client.end()));
}
