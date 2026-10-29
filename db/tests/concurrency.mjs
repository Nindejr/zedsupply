// Concurrency tests: two live connections to a migrated test database, interleaved on purpose.
// Needs a real PostgreSQL server (PGlite has only one connection) and the pg client:
//   npm install --no-save pg        (node_modules/ is git-ignored)
//   node db/tests/concurrency.mjs
// Connects as PGUSER (default postgres) to PGDATABASE (default zedsupply_test) on PGHOST:PGPORT
// (default localhost:5432); the password comes from pgpass.conf or PGPASSWORD.
// Never point it at a database holding real data: it inserts and then deletes fixtures.
import pg from 'pg';
const cfg = { host: process.env.PGHOST || 'localhost', port: Number(process.env.PGPORT) || 5432, user: process.env.PGUSER || 'postgres', database: process.env.PGDATABASE || 'zedsupply_test' };
const A = new pg.Client(cfg), B = new pg.Client(cfg), S = new pg.Client(cfg);
await Promise.all([A.connect(), B.connect(), S.connect()]);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const report = (name, ok, detail) => { results.push(ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + detail : '')); };
// Runs B's statement while A's transaction is open; B may block until A finishes
async function race(aSql, bSql) {
  await A.query('BEGIN'); await B.query('BEGIN');
  await A.query(aSql);
  let bErr = null;
  const bDone = B.query(bSql).then(() => null, e => e);
  await sleep(300);                      // B is now either done or waiting on A's lock
  await A.query('COMMIT');
  bErr = await bDone;
  if (bErr) await B.query('ROLLBACK'); else { try { await B.query('COMMIT'); } catch (e) { bErr = e; } }
  return bErr;
}

// Fixtures, committed so both connections see them
await S.query(`
  INSERT INTO departments (id, name) VALUES ('rt', 'Race test');
  INSERT INTO sellers (id, name) VALUES ('rs', 'Race seller');
  INSERT INTO users (id, name, phone) SELECT g, 'Buyer ' || g, '+26099' || g FROM generate_series(7001, 7004) g;
  INSERT INTO products (id, title, department_id, seller_id, price_zmw, pricing_mode, commit_min_zmw, commit_max_zmw)
    VALUES ('RP', 'Race product', 'rt', 'rs', 100, 'commit', 80, 100);
  INSERT INTO orders (id, user_id, status) VALUES (7101, 7001, 'delivered'), (7102, 7002, 'delivered'), (7103, 7003, 'placed'), (7104, 7003, 'placed');
  INSERT INTO order_items (id, order_id, product_id, quantity, unit_price_zmw) VALUES (7201, 7101, 'RP', 1, 100), (7202, 7102, 'RP', 1, 100);
`);

// 1. Two reviews of the same product at the same moment: the rating cache must count both
let err = await race(
  `INSERT INTO reviews (product_id, user_id, order_item_id, rating, review_title, review_body) VALUES ('RP', 7001, 7201, 5, 'Great', 'Works well')`,
  `INSERT INTO reviews (product_id, user_id, order_item_id, rating, review_title, review_body) VALUES ('RP', 7002, 7202, 2, 'Poor', 'Broke quickly')`);
let r = (await S.query(`SELECT total_reviews_count n, average_rating avg, rating_counts c FROM products WHERE id = 'RP'`)).rows[0];
report('simultaneous reviews keep the rating cache right', !err && r.n === 2 && Number(r.avg) === 3.5 && r.c.join() === '0,1,0,0,1', err ? err.message : `count ${r.n}, average ${r.avg}, stars ${r.c}`);

// 2. One buyer, two offers on the same item at once: only one may stay open
err = await race(
  `INSERT INTO price_commitments (id, product_id, buyer_id, amount_zmw) VALUES (7301, 'RP', 7003, 90)`,
  `INSERT INTO price_commitments (id, product_id, buyer_id, amount_zmw) VALUES (7302, 'RP', 7003, 95)`);
let n = (await S.query(`SELECT count(*)::int n FROM price_commitments WHERE buyer_id = 7003 AND status = 'pending'`)).rows[0].n;
report('a buyer has one open offer per item, even when sent twice at once', n === 1 && !!err, `${n} open; second attempt: ${err ? err.code + ' ' + err.message : 'accepted'}`);

// 3. The same accepted offer used in two orders at once: only one order may redeem it
await S.query(`UPDATE price_commitments SET status = 'accepted' WHERE id = 7301`);
err = await race(
  `INSERT INTO order_items (id, order_id, product_id, quantity, unit_price_zmw, commitment_id, price_source) VALUES (7203, 7103, 'RP', 1, 90, 7301, 'commit')`,
  `INSERT INTO order_items (id, order_id, product_id, quantity, unit_price_zmw, commitment_id, price_source) VALUES (7204, 7104, 'RP', 1, 90, 7301, 'commit')`);
n = (await S.query(`SELECT count(*)::int n FROM order_items WHERE commitment_id = 7301`)).rows[0].n;
report('an accepted offer is redeemed once, even by two orders at once', n === 1 && !!err, `${n} order(s) used it; second: ${err ? err.code + ' ' + err.message : 'accepted'}`);

// 4. A buyer with 9 saved addresses saves two more at the same moment: the limit is 10
await S.query(`INSERT INTO user_addresses (user_id, label, town) SELECT 7004, 'Address ' || g, 'Lusaka' FROM generate_series(1, 9) g`);
err = await race(
  `INSERT INTO user_addresses (user_id, label, town) VALUES (7004, 'Tenth A', 'Lusaka')`,
  `INSERT INTO user_addresses (user_id, label, town) VALUES (7004, 'Tenth B', 'Lusaka')`);
n = (await S.query(`SELECT count(*)::int n FROM user_addresses WHERE user_id = 7004`)).rows[0].n;
report('the 10-address limit holds when two are saved at once', n === 10, `${n} saved; second attempt: ${err ? err.message : 'accepted'}`);

// Remove the fixtures (the cascade takes their orders, reviews, offers and addresses)
await S.query(`DELETE FROM reviews WHERE product_id = 'RP'; DELETE FROM order_items WHERE product_id = 'RP';
  DELETE FROM price_commitments WHERE product_id = 'RP'; DELETE FROM orders WHERE id BETWEEN 7101 AND 7104;
  DELETE FROM user_addresses WHERE user_id BETWEEN 7001 AND 7004; DELETE FROM users WHERE id BETWEEN 7001 AND 7004;
  DELETE FROM products WHERE id = 'RP'; DELETE FROM sellers WHERE id = 'rs'; DELETE FROM departments WHERE id = 'rt';`);
await Promise.all([A.end(), B.end(), S.end()]);
console.log(results.every(Boolean) ? 'ALL PASSED' : 'SOME FAILED');
process.exit(results.every(Boolean) ? 0 : 1);
