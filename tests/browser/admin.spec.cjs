// The admin panel (/admin/) against local stand-ins for Supabase Auth and the database.
// Nothing is activated and no message or money moves.
const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const live = fs.readFileSync('js/catalogue.js', 'utf8').replace("api: { enabled: false, url: '', key: '' }", "api: { enabled: true, url: 'https://test-project.supabase.co', key: 'test-publishable-key' }");
const axe = require.resolve('axe-core/axe.min.js');
const token = aal => 'h.' + Buffer.from(JSON.stringify({ sub: 'staff-auth-id', aal })).toString('base64url') + '.s';

async function setup(page, { roles = ['owner'], staff = true, enrolled = false } = {}) {
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
