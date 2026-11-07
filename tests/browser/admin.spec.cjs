// The admin panel (/admin/) against local stand-ins for Supabase Auth and the database.
// Nothing is activated and no message or money moves.
const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const live = fs.readFileSync('js/catalogue.js', 'utf8').replace("api: { enabled: false, url: '', key: '' }", "api: { enabled: true, url: 'https://test-project.supabase.co', key: 'test-publishable-key' }");
const axe = require.resolve('axe-core/axe.min.js');
const token = aal => 'h.' + Buffer.from(JSON.stringify({ sub: 'staff-auth-id', aal })).toString('base64url') + '.s';

const application = { id: 'app-1', business: 'Kafue Solar Traders', contact_name: 'Mwila Banda', phone: '+260977123456', email: 'buyer@example.test', town: 'Kafue', pacra: null,
  categories: ['Solar, Power & Energy'], about: 'Solar lamps and panels', status: 'new', staff_note: null, seller_id: null, created_at: '2026-11-03T08:00:00Z' };
async function setup(page, { roles = ['owner'], staff = true, enrolled = false, applications = [] } = {}) {
  const calls = [], state = { aal: 'aal1', enrolled };
  await page.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.hostname === '127.0.0.1') {
      if (url.pathname.endsWith('/js/catalogue.js')) return route.fulfill({ contentType: 'application/javascript', body: live });
      return route.continue();
    }
    if (url.hostname !== 'test-project.supabase.co') return route.fulfill({ status: 200, body: '' });
    let body = null; try { body = req.postDataJSON(); } catch (e) { /* none */ }
    calls.push({ path: url.pathname, body, query: url.search });
    const p = url.pathname;
    let data = [];
    if (p === '/auth/v1/otp') data = {};
    else if (p === '/auth/v1/verify') data = { access_token: token('aal1'), refresh_token: 'r1', expires_in: 3600 };
    else if (p === '/auth/v1/user') data = { id: 'staff-auth-id', email_confirmed_at: '2026-11-01T00:00:00Z', factors: state.enrolled ? [{ id: 'f1', factor_type: 'totp', status: 'verified' }] : [] };
    else if (p === '/auth/v1/factors') data = { id: 'f1', type: 'totp', totp: { qr_code: 'data:image/svg+xml;utf-8,<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>', secret: 'JBSWY3DPEHPK3PXP', uri: 'otpauth://totp/x' } };
    else if (p === '/auth/v1/factors/f1/challenge') data = { id: 'c1' };
    else if (p === '/auth/v1/factors/f1/verify') {
      if (body.code !== '123456') return route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ msg: 'Invalid TOTP code entered' }) });
      state.aal = 'aal2'; state.enrolled = true; data = { access_token: token('aal2'), refresh_token: 'r2', expires_in: 3600 };
    }
    else if (p === '/rest/v1/users') data = [{ id: 9, name: 'Mutinta Staff', email: 'staff@example.test', phone: null, is_staff: staff }];
    else if (p === '/rest/v1/rpc/staff_me') data = { staff, mfa_required: true, aal: state.aal, ready: staff && state.aal === 'aal2', roles: staff && state.aal === 'aal2' ? roles : [], name: 'Mutinta Staff' };
    else if (p === '/rest/v1/rpc/staff_dashboard') data = { orders_today: 4, sales_today: 1840, to_confirm: 2, fee_to_quote: 1, to_dispatch: 3, in_transit: 1, payments_to_check: 1, cancellations: 0, returns: 0, complaints: 1, seller_applications: 2, rider_applications: 0, listings_to_review: 1, messages_failed: 1, messages_waiting: 0, staff_actions_today: 5 };
    else if (p === '/rest/v1/orders' && url.search.includes('ref=eq.ZS-ADMIN001')) data = [{ id: 41, ref: 'ZS-ADMIN001', status: 'placed', created_at: '2026-11-07T08:00:00Z', contact_name: 'Chanda Mwila', recipient_phone: '+260970000001', buyer_town: 'Lusaka', deliver_to: 'Kabulonga, Lusaka', fulfilment: 'delivery', total_zmw: 300, delivery_zmw: null, paid_zmw: 0, payment_status: 'unpaid', heavy_delivery: true,
      order_items: [{ id: 1, quantity: 2, unit_price_zmw: 150, product_id: 'SA1', products: { title: 'Cement', seller_id: 'sa-store' } }], order_cancellations: [], payments: [], payment_attempts: [], order_parcels: [{ seller_id: 'sa-store', speed: 'truck', fee_zmw: null }], shipment_events: [] }];
    else if (p === '/rest/v1/orders') data = [{ id: 41, ref: 'ZS-ADMIN001', status: 'placed', created_at: '2026-11-07T08:00:00Z', contact_name: 'Chanda Mwila', recipient_phone: '+260970000001', fulfilment: 'delivery', total_zmw: 300, delivery_zmw: null }];
    else if (p === '/rest/v1/rpc/staff_notifications') data = [{ id: 7, channel: 'whatsapp', to: '+260970000001', template: 'handover_code', status: 'failed', attempts: 5, last_error: 'Provider HTTP 400', created_at: '2026-11-07T08:00:00Z', order_ref: 'ZS-ADMIN001', payload: { ref: 'ZS-ADMIN001' } }];
    else if (p === '/rest/v1/rpc/staff_audit') data = [{ id: 3, action: 'set_delivery_fee', target: 'ZS-ADMIN001', detail: { fee: 350 }, at: '2026-11-07T09:00:00Z', by: 'Mutinta Staff' }];
    else if (p === '/rest/v1/rpc/delivery_settings') data = { rates: [{ id: 1, courier: null, zone: 'town', speed: 'standard', fee: 45, kg: 5, perKg: 5, days: [1, 2], active: true }], freeDelivery: { min: null, zones: [] }, defaultKg: 1, origin: null, sameDay: { cutoff: 11, towns: [] }, closedDays: [0] };
    else if (p === '/rest/v1/seller_applications' || p === '/rest/v1/rider_applications') data = applications;
    else if (p === '/rest/v1/rpc/staff_approve_application') data = body.store_id;
    else if (p === '/rest/v1/rpc/staff_list') data = [{ id: 9, name: 'Mutinta Staff', email: 'staff@example.test', you: true, roles: ['owner'], last_action: '2026-11-07T09:00:00Z' },
      { id: 12, name: 'Bwalya Ops', email: 'ops@example.test', you: false, roles: ['operations'], last_action: null }];
    else if (p === '/rest/v1/rpc/staff_set_roles') data = { email: body.account_email, roles: body.new_roles };
    else if (p === '/rest/v1/shop_settings') data = [{ vat_registered: false, vat_registration_verified: false, vat_rate: 16, vat_included: true, commission_pct: 0, payout_hold_days: 3, cod_max_zmw: 1500, cod_min_delivered: 1,
      layby_enabled: false, layby_deposit_pct: 20, layby_weeks: 8, support_reply_hours: null, staff_mfa_required: true, site_url: 'https://nindejr.github.io/zedsupply/' }];
    else if (p === '/rest/v1/seller_payouts') data = [{ id: 31, seller_id: 'sa-store', amount_zmw: 270, commission_zmw: 30, status: 'due', release_after: '2026-11-06T00:00:00Z', paid_at: null, reference: null, created_at: '2026-11-01T00:00:00Z', sellers: { name: 'Admin test store' }, orders: { ref: 'ZS-ADMIN001' } },
      { id: 32, seller_id: 'sa-store', amount_zmw: 90, commission_zmw: 10, status: 'due', release_after: '2026-11-06T00:00:00Z', paid_at: null, reference: null, created_at: '2026-11-02T00:00:00Z', sellers: { name: 'Admin test store' }, orders: { ref: 'ZS-ADMIN002' } }];
    else if (p === '/rest/v1/rpc/staff_mark_payouts_paid') data = body.payout_ids.length;
    else if (p.startsWith('/rest/v1/rpc/staff_')) data = null;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
  });
  return { calls, state };
}
async function signIn(page) {
  await page.goto('/admin/index.html');
  await page.getByLabel('Staff email').fill('staff@example.test');
  await page.getByRole('button', { name: 'Send code' }).click();
  await page.getByLabel('Email code').fill('123456');
  await page.getByRole('button', { name: 'Continue' }).click();
}

test('staff sign in, set up an authenticator app, and see what needs attention', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const { calls } = await setup(page);
  await signIn(page);
  expect(calls.find(c => c.path === '/auth/v1/otp').body).toEqual({ email: 'staff@example.test', create_user: false });
  // No authenticator yet: set one up
  await expect(page.getByRole('heading', { name: 'Set up your authenticator app' })).toBeVisible();
  await expect(page.locator('.admin-qr')).toBeVisible();
  await expect(page.locator('.admin-key')).toHaveText('JBSWY3DPEHPK3PXP');
  await expect(page.locator('#admin-nav')).toBeHidden();
  await page.getByLabel('6-digit code from the app').fill('654321');
  await page.getByRole('button', { name: 'Finish set-up' }).click();
  await expect(page.locator('#ad-enrol [role="status"]')).toHaveText('Invalid TOTP code entered');
  await page.getByLabel('6-digit code from the app').fill('123 456');
  await page.getByRole('button', { name: 'Finish set-up' }).click();
  // Ready: the dashboard and every section for the owner
  await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
  await expect(page.locator('.admin-tile').filter({ hasText: 'Delivery fees to quote' })).toContainText('1');
  await expect(page.locator('.admin-tile').filter({ hasText: 'Sales today' })).toContainText('K1,840');
  const nav = page.getByRole('navigation', { name: 'Admin sections' });
  for (const s of ['Dashboard', 'Orders', 'Payments', 'Support', 'Applications', 'Listings', 'Delivery prices', 'Messages', 'Audit log']) await expect(nav.getByRole('link', { name: new RegExp('^' + s) })).toBeVisible();
  await expect(page.locator('#admin-who')).toContainText('Mutinta Staff · Owner');
  await page.evaluate(fs.readFileSync(axe, 'utf8'));
  expect(await page.evaluate(async () => (await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } })).violations.map(v => v.id + ': ' + v.nodes.map(n => n.target.join(' ')).slice(0, 3).join(', ')))).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  expect(errors).toEqual([]);
});

test('an enrolled staff member confirms with the app code, quotes a delivery fee, confirms an order and resends a message', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const { calls } = await setup(page, { enrolled: true });
  await signIn(page);
  await expect(page.getByRole('heading', { name: 'Confirm it\'s you' })).toBeVisible();
  await page.getByLabel('6-digit code from your authenticator app').fill('123456');
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
  await page.locator('.admin-tile').filter({ hasText: 'Delivery fees to quote' }).click();
  await expect(page.getByRole('heading', { name: 'Orders', level: 1 })).toBeVisible();
  expect(calls.filter(c => c.path === '/rest/v1/orders').pop().query).toContain('delivery_zmw=is.null');
  await page.getByRole('link', { name: 'ZS-ADMIN001' }).click();
  await expect(page.getByRole('heading', { name: 'Order ZS-ADMIN001' })).toBeVisible();
  await expect(page.getByLabel('Delivery fee (K)')).toBeVisible();
  await page.getByLabel('Delivery fee (K)').fill('350');
  await page.getByLabel('Note (kept in the log)').fill('Truck from the Lusaka depot');
  await page.getByRole('button', { name: 'Set delivery fee' }).click();
  await expect(page.locator('#admin-toast')).toHaveText('Delivery fee set');
  expect(calls.find(c => c.path === '/rest/v1/rpc/staff_set_delivery_fee').body).toEqual({ order_ref: 'ZS-ADMIN001', fee: 350, note: 'Truck from the Lusaka depot' });
  await page.getByRole('button', { name: 'Confirm order' }).click();
  await expect.poll(() => calls.find(c => c.path === '/rest/v1/rpc/staff_order_step') && calls.find(c => c.path === '/rest/v1/rpc/staff_order_step').body).toEqual({ order_id: 41, step: 'confirmed' });
  // Messages: a failed one is sent again; the handover code itself isn't shown
  await page.getByRole('navigation', { name: 'Admin sections' }).getByRole('link', { name: /^Messages/ }).click();
  await expect(page.locator('.admin-table')).toContainText('handover code');
  await page.getByRole('button', { name: 'Send again' }).click();
  await expect.poll(() => (calls.find(c => c.path === '/rest/v1/rpc/staff_retry_notification') || {}).body).toEqual({ notification_id: 7 });
  // Audit log search
  await page.getByRole('navigation', { name: 'Admin sections' }).getByRole('link', { name: 'Audit log' }).click();
  await page.getByLabel('Search the log').fill('ZS-ADMIN001');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect.poll(() => calls.filter(c => c.path === '/rest/v1/rpc/staff_audit').pop().body.search).toBe('ZS-ADMIN001');
  await expect(page.locator('.admin-table')).toContainText('set delivery fee');
  // Delivery prices use the shared editor and the logged staff functions
  await page.getByRole('navigation', { name: 'Admin sections' }).getByRole('link', { name: 'Delivery prices' }).click();
  await page.getByLabel('Rate 1: fee in kwacha').fill('50');
  await page.getByRole('button', { name: 'Save delivery prices' }).click();
  await expect.poll(() => (calls.find(c => c.path === '/rest/v1/rpc/staff_save_delivery_rate') || {}).body).toEqual({ courier: null, zone: 'town', speed: 'standard', fee: 50, included_kg: 5, per_kg: 5, min_days: 1, max_days: 2, active: true });
  expect(errors).toEqual([]);
});

test('roles decide which sections show, and a buyer account is refused', async ({ page }) => {
  await setup(page, { roles: ['support'], enrolled: true });
  await signIn(page);
  await page.getByLabel('6-digit code from your authenticator app').fill('123456');
  await page.getByRole('button', { name: 'Confirm' }).click();
  const nav = page.getByRole('navigation', { name: 'Admin sections' });
  await expect(nav.getByRole('link', { name: /^Support/ })).toBeVisible();
  await expect(nav.getByRole('link', { name: /^Delivery prices/ })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: /^Payments/ })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: /^Listings/ })).toHaveCount(0);
  await page.goto('/admin/index.html#/orders/ZS-ADMIN001');
  await expect(page.getByRole('heading', { name: 'Order ZS-ADMIN001' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm order' })).toHaveCount(0);
  await expect(page.getByLabel('Delivery fee (K)')).toHaveCount(0);
});

test('a buyer account is refused, and without the connection the page explains', async ({ page, context }) => {
  await setup(page, { staff: false });
  await signIn(page);
  await expect(page.getByRole('heading', { name: 'Staff only' })).toBeVisible();
  await expect(page.locator('#admin-nav')).toBeHidden();
  const plain = await context.newPage();
  await plain.goto('/admin/index.html');
  await expect(plain.getByRole('heading', { name: 'Admin panel' })).toBeVisible();
  await expect(plain.locator('main')).toContainText('works once the shop is connected');
  expect(await plain.evaluate(() => document.querySelector('meta[name="robots"]').content)).toBe('noindex, nofollow');
});

async function confirmApp(page) {
  await page.getByLabel('6-digit code from your authenticator app').fill('123456');
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
}
const navTo = (page, name) => page.getByRole('navigation', { name: 'Admin sections' }).getByRole('link', { name: new RegExp('^' + name) }).click();

test('listing moderation shows real photos, opens the original, and explains missing or broken images', async ({ page }) => {
  await setup(page, { enrolled: true });
  await page.route('**/rest/v1/products?**', route => route.fulfill({ json: [
    { id: 'photo-1', title: 'Studio product', price_zmw: 150, seller_id: 'store', department_id: 'tech', image: 'assets/products/C001.webp' },
    { id: 'photo-2', title: 'Missing photo', price_zmw: 150, seller_id: 'store', department_id: 'tech', image: '' },
    { id: 'photo-3', title: 'Broken photo', price_zmw: 150, seller_id: 'store', department_id: 'tech', image: 'assets/products/missing-review-photo.webp' },
    { id: 'photo-4', title: 'Unsafe photo', price_zmw: 150, seller_id: 'store', department_id: 'tech', image: 'javascript:alert(1)' },
    { id: 'photo-5', title: 'Hosted photo', price_zmw: 150, seller_id: 'store', department_id: 'tech', image: 'https://test-project.supabase.co/storage/v1/object/public/products/photo.webp' }
  ] }));
  await page.route('**/storage/v1/object/public/products/photo.webp', route => route.fulfill({ contentType: 'image/webp', body: fs.readFileSync('assets/products/C001.webp') }));
  await signIn(page); await confirmApp(page); await navTo(page, 'Listings');
  const image = page.getByRole('img', { name: 'Studio product', exact: true });
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate(img => img.naturalWidth)).toBe(600);
  await expect(page.getByRole('link', { name: 'Open photo of Studio product (opens in a new tab)', exact: true })).toHaveAttribute('href', /\/assets\/products\/C001.webp$/);
  await expect.poll(() => page.getByRole('img', { name: 'Hosted photo', exact: true }).evaluate(img => img.naturalWidth)).toBe(600);
  for (const title of ['Missing photo', 'Broken photo', 'Unsafe photo']) {
    await expect(page.locator('tr', { has: page.getByRole('rowheader').filter({ hasText: title }) }).getByText('Photo unavailable')).toBeVisible();
  }
  await page.evaluate(fs.readFileSync(axe, 'utf8'));
  expect(await page.evaluate(async () => (await axe.run('main', { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } })).violations.map(v => v.id))).toEqual([]);
});

test('pending admin reads cannot redraw private content after sign-out', async ({ page }) => {
  await setup(page, { enrolled: true });
  await signIn(page); await confirmApp(page);
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  let requested = false;
  await page.route('**/rest/v1/orders?**', async route => {
    requested = true;
    await pending;
    await route.fulfill({ json: [{ id: 41, ref: 'PRIVATE-ORDER', contact_name: 'Private buyer', status: 'placed' }] });
  });
  await navTo(page, 'Orders');
  await expect.poll(() => requested).toBe(true);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Staff sign-in' })).toBeVisible();
  await Promise.all([page.waitForResponse(response => response.url().includes('/rest/v1/orders?')), Promise.resolve().then(release)]);
  await expect(page.getByRole('heading', { name: 'Staff sign-in' })).toBeVisible();
  await expect(page.locator('#admin-nav')).toBeHidden();
  await expect(page.locator('main')).not.toContainText('PRIVATE-ORDER');
});

test('status colours distinguish completed work from unpaid and in-progress work', async ({ page }) => {
  await setup(page, { enrolled: true });
  await signIn(page); await confirmApp(page);
  const classes = await page.evaluate(() => Object.fromEntries(['paid', 'unpaid', 'active', 'inactive', 'delivered', 'delivery pending', 'verified', 'failed'].map(status => {
    const node = document.createElement('div'); node.innerHTML = window.ZSAdmin.status(status);
    return [status, node.firstChild.className];
  })));
  for (const status of ['paid', 'active', 'delivered', 'verified']) expect(classes[status]).toContain('status--ok');
  for (const status of ['unpaid', 'inactive', 'delivery pending']) expect(classes[status]).toContain('status--wait');
  expect(classes.failed).toContain('status--bad');
});

test('applications page through, filter by status and search, as the old staff screen did', async ({ page }) => {
  const many = Array.from({ length: 26 }, (_, i) => ({ ...application, id: 'app-' + i, business: 'Shop number ' + i }));
  const { calls } = await setup(page, { enrolled: true, applications: many });
  await signIn(page); await confirmApp(page);
  const reads = () => calls.filter(c => c.path === '/rest/v1/seller_applications').map(c => decodeURIComponent(c.query));
  await navTo(page, 'Applications');
  await expect(page.locator('main article')).toHaveCount(25);
  expect(reads().at(-1)).toContain('status=in.(new,review)');
  expect(reads().at(-1)).toContain('order=created_at.asc,id.asc&limit=26&offset=0');
  await expect(page.locator('main')).toContainText('Showing 1–25, oldest first.');
  await page.getByRole('link', { name: 'Next page', exact: true }).click();
  await expect.poll(() => reads().at(-1)).toContain('offset=25');
  await expect(page.getByRole('link', { name: 'Previous page', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Awaiting applicant', exact: true }).click();
  await expect.poll(() => reads().at(-1)).toContain('status=in.(info_needed)');
  await page.getByRole('searchbox', { name: 'Search applications' }).fill('0977 123456');
  await page.getByRole('button', { name: 'Search applications', exact: true }).click();
  await expect.poll(() => reads().at(-1)).toContain('or=(business.ilike."*0977 123456*",contact_name.ilike."*0977 123456*",email.ilike."*0977 123456*",phone.ilike."*977123456*",town.ilike."*0977 123456*",pacra.ilike."*0977 123456*")');
  expect(reads().at(-1)).toContain('offset=0');
  await page.getByRole('searchbox', { name: 'Search applications' }).fill('Kafue, (x)"');
  await page.getByRole('button', { name: 'Search applications', exact: true }).click();
  await expect.poll(() => reads().at(-1)).toContain('business.ilike."*Kafue x*"');
  // Riders have their own views, including the in-person checks
  await page.getByRole('link', { name: 'Riders', exact: true }).click();
  await expect(page.getByRole('link', { name: 'In-person checks', exact: true })).toBeVisible();
});

test('staff review, ask about and approve a seller application', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const { calls } = await setup(page, { enrolled: true, applications: [application] });
  await signIn(page); await confirmApp(page);
  await navTo(page, 'Applications');
  const card = page.locator('article', { hasText: 'Kafue Solar Traders' });
  await expect(card).toContainText('+260977123456');
  await card.getByRole('button', { name: 'Mark under review' }).click();
  await expect.poll(() => (calls.find(c => c.path === '/rest/v1/rpc/staff_review_application') || {}).body).toEqual({ application: 'app-1', decision: 'review', note: null });
  // The list reloads after each decision; wait for it before typing
  await expect.poll(() => calls.filter(c => c.path === '/rest/v1/seller_applications').length).toBe(2);
  await card.getByLabel('Message to the applicant', { exact: true }).fill('Please add your PACRA number.');
  await card.getByRole('button', { name: 'Ask for more information' }).click();
  await expect.poll(() => (calls.filter(c => c.path === '/rest/v1/rpc/staff_review_application')[1] || {}).body).toEqual({ application: 'app-1', decision: 'info_needed', note: 'Please add your PACRA number.' });
  await expect.poll(() => calls.filter(c => c.path === '/rest/v1/seller_applications').length).toBe(3);
  await expect(card.getByLabel('Store ID (used in web addresses)')).toHaveValue('kafue-solar-traders');
  await card.getByRole('button', { name: 'Approve and open store' }).click();
  await expect.poll(() => (calls.find(c => c.path === '/rest/v1/rpc/staff_approve_application') || {}).body).toEqual({ application: 'app-1', store_id: 'kafue-solar-traders', store_name: 'Kafue Solar Traders', note: null });
  await expect(page.locator('#admin-toast')).toContainText('Store kafue-solar-traders is open');
  expect(errors).toEqual([]);
});

test('changing a delivery rate\'s route removes its old price, and the editor then holds the saved rates', async ({ page }) => {
  const { calls } = await setup(page, { enrolled: true });
  await signIn(page); await confirmApp(page);
  await page.route('**/rest/v1/rpc/delivery_settings', route => route.fulfill({ json: { rates: [{ id: 1, courier: null, zone: 'town', speed: 'standard', fee: 45, kg: 5, perKg: 5, days: [1, 2], active: true },
    { id: 2, courier: null, zone: 'town', speed: 'express', fee: 85, kg: 5, perKg: 8, days: [1, 1], active: true }], freeDelivery: { min: null, zones: ['town'] }, defaultKg: 1, origin: null, sameDay: { cutoff: 11, towns: [] }, closedDays: [0] } }));
  await navTo(page, 'Delivery prices');
  const editor = page.locator('#delivery-editor');
  await editor.getByLabel('Rate 1: where it goes').selectOption('province');
  await editor.getByLabel('Rate 1: fee in kwacha').fill('19.90');
  await editor.getByRole('button', { name: 'Remove Rate 2' }).click();
  await editor.getByLabel('For items worth at least (K)').fill('1500');
  await page.unroute('**/rest/v1/rpc/delivery_settings');
  await page.route('**/rest/v1/rpc/delivery_settings', route => route.fulfill({ json: { rates: [{ id: 9, courier: null, zone: 'province', speed: 'standard', fee: 19.9, kg: 5, perKg: 5, days: [1, 2], active: true }],
    freeDelivery: { min: 1500, zones: ['town'] }, defaultKg: 1, origin: null, sameDay: { cutoff: 11, towns: [] }, closedDays: [0] } }));
  await editor.getByRole('button', { name: 'Save delivery prices' }).click();
  await expect(page.locator('#admin-toast')).toHaveText('Delivery prices saved');
  expect(calls.filter(c => c.path.endsWith('/staff_delete_delivery_rate')).map(c => c.body.rate_id)).toEqual([2, 1]);
  expect(calls.find(c => c.path.endsWith('/staff_save_delivery_rate')).body).toEqual({ courier: null, zone: 'province', speed: 'standard', fee: 19.9, included_kg: 5, per_kg: 5, min_days: 1, max_days: 2, active: true });
  expect(calls.find(c => c.path.endsWith('/staff_set_delivery_settings')).body).toEqual({ free_min: 1500, free_zones: ['town'], default_kg: 1, origin_town: null, origin_province: null, same_day_cutoff: 11, same_day_towns: [], closed_days: [0] });
  // After saving, the editor shows the database's rates, so saving again deletes nothing more
  await expect(page.locator('#delivery-editor [data-rate-id="9"]')).toHaveCount(1);
  await page.locator('#delivery-editor').getByRole('button', { name: 'Save delivery prices' }).click();
  await expect.poll(() => calls.filter(c => c.path.endsWith('/staff_save_delivery_rate')).length).toBe(2);
  expect(calls.filter(c => c.path.endsWith('/staff_delete_delivery_rate'))).toHaveLength(2);
});

test('the owner manages staff roles and shop settings; finance records a payout; lists download as CSV', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const { calls } = await setup(page, { enrolled: true });
  await signIn(page); await confirmApp(page);
  // Staff
  await navTo(page, 'Staff');
  const ops = page.locator('article', { hasText: 'ops@example.test' });
  await expect(ops.getByLabel(/^Operations/)).toBeChecked();
  await ops.getByLabel(/^Support/).check();
  await ops.getByRole('button', { name: 'Save roles' }).click();
  await expect.poll(() => (calls.find(c => c.path === '/rest/v1/rpc/staff_set_roles') || {}).body).toEqual({ account_email: 'ops@example.test', new_roles: ['operations', 'support'] });
  // Each save reloads the list; wait for it before using the page again
  await expect.poll(() => calls.filter(c => c.path === '/rest/v1/rpc/staff_list').length).toBe(2);
  const add = page.locator('#ad-staff-new');
  await add.getByLabel('Their email').fill('new@example.test');
  await add.getByRole('button', { name: 'Add to staff' }).click();
  await expect(add.locator('[role="status"]')).toHaveText('Choose at least one role.');
  await add.getByLabel(/^Finance/).check();
  await add.getByRole('button', { name: 'Add to staff' }).click();
  await expect.poll(() => calls.filter(c => c.path === '/rest/v1/rpc/staff_set_roles').at(-1).body).toEqual({ account_email: 'new@example.test', new_roles: ['finance'] });
  await expect.poll(() => calls.filter(c => c.path === '/rest/v1/rpc/staff_list').length).toBe(3);
  page.once('dialog', d => d.accept());
  await page.locator('article', { hasText: 'ops@example.test' }).getByRole('button', { name: 'Remove from staff' }).click();
  await expect.poll(() => calls.filter(c => c.path === '/rest/v1/rpc/staff_set_roles').at(-1).body).toEqual({ account_email: 'ops@example.test', new_roles: [] });
  // Settings: only what changed is sent
  await navTo(page, 'Settings');
  await page.getByLabel('Commission (%)').fill('12.5');
  await page.getByLabel('Lay-by is available').check();
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect.poll(() => (calls.find(c => c.path === '/rest/v1/rpc/staff_set_shop_settings') || {}).body).toEqual({ changes: { commission_pct: 12.5, layby_enabled: true } });
  // Payouts: one seller's due payouts, with the transfer reference
  await navTo(page, 'Payouts');
  const store = page.locator('article', { hasText: 'Admin test store' });
  await expect(store).toContainText('K360');
  await store.getByLabel('Transfer reference').fill('MTN-778899');
  page.once('dialog', d => d.accept());
  await store.getByRole('button', { name: 'Record K360 as paid' }).click();
  await expect.poll(() => (calls.find(c => c.path === '/rest/v1/rpc/staff_mark_payouts_paid') || {}).body).toEqual({ payout_ids: [31, 32], transfer_reference: 'MTN-778899' });
  // CSV: a formula-looking cell is kept as text
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download CSV' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^zed-supply-payouts-due-\d{4}-\d{2}-\d{2}\.csv$/);
  const csv = fs.readFileSync(await download.path(), 'utf8');
  expect(csv.split('\r\n')[0]).toBe('\ufeffSeller,Store ID,Order,Amount (K),Commission (K),Status,Release after,Paid,Reference');
  expect(csv).toContain('Admin test store,sa-store,ZS-ADMIN001,270,30,due');
  await page.evaluate(fs.readFileSync(axe, 'utf8'));
  expect(await page.evaluate(async () => (await axe.run('main', { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } })).violations.map(v => v.id))).toEqual([]);
  expect(errors).toEqual([]);
});
