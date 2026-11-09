const { test, expect } = require('@playwright/test');
const axe = require.resolve('axe-core/axe.min.js');

test.beforeEach(async ({ page }) => {
  // No analytics, advertisements, maps or payment provider traffic during local checks.
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    // 404.html points links at the GitHub Pages folder (/zedsupply/); serve that from the local root.
    if (url.hostname === '127.0.0.1' && url.pathname.startsWith('/zedsupply/')) return route.continue({ url: url.href.replace('/zedsupply/', '/') });
    return url.hostname === '127.0.0.1' || url.protocol === 'data:' ? route.continue() : route.fulfill({ status: 200, body: '' });
  });
});

for (const route of ['', '#/departments', '#/search?q=solar', '#/product/L041', '#/cart', '#/account', '#/device', '#/seller', '#/staff', '#/delivery-times', '#/riders', '#/services', 'help.html', 'privacy.html', '404.html', 'shop/', 'shop/departments/solar/', 'shop/departments/enterprise/']) {
  test('usable layout, working artwork and accessible content: ' + (route || 'home'), async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const standalone = route.endsWith('.html') || route.startsWith('shop/');
    const url = standalone ? route + '?demo=1' : 'index.html?demo=1&theme=off' + route;
    await page.goto(url);
    await expect(page.locator('main')).toBeVisible();
    await expect(page.locator('html')).not.toHaveClass(/no-js/);
    // Every page carries the same header and full footer.
    await expect(page.locator('.site-header .search')).toBeVisible();
    await expect(page.locator('.site-footer .footer-cols')).toBeVisible();
    await expect(page.locator('.site-footer .footer-legal')).toBeVisible();
    if (!standalone) await page.waitForFunction(() => !!window.ZS);
    if (route !== '404.html') await expect(page.locator('h1:visible').first()).not.toContainText("We couldn't find that");
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    const broken = await page.locator('img:visible').evaluateAll(images => images.filter(img => img.complete && img.naturalWidth === 0 && img.getAttribute('src')).map(img => img.getAttribute('src')));
    expect(broken).toEqual([]);
    await page.evaluate(require('node:fs').readFileSync(axe, 'utf8'));
    const results = await page.evaluate(async () => (await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } })).violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) })));
    expect(results).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test('catalogue pages link back into the shop from any depth', async ({ page }) => {
  await page.goto('/index.html?demo=0');
  await page.locator('.footer-cols').getByRole('link', { name: 'Browse catalogue' }).click();
  await expect(page).toHaveURL(/\/shop\/$/);
  await page.getByRole('link', { name: /Solar, Power/ }).first().click();
  await expect(page).toHaveURL(/\/shop\/departments\/solar\/$/);
  await expect(page.locator('.page-hero h1')).toHaveText('Solar, Power & Energy');
  expect(await page.locator('.skip-link').getAttribute('href')).toBe('shop/departments/solar/#main');
  await page.locator('.site-footer').getByRole('link', { name: 'Privacy policy' }).first().click();
  await expect(page).toHaveURL(/\/privacy\.html$/);
  await page.goBack();
  await page.locator('.site-logo').click();
  await expect(page).toHaveURL(/\/index\.html$/);
});

test('sign out is at the top of My Account and in the menu on every page', async ({ page }) => {
  await page.goto('/index.html?demo=0#/account');
  await expect(page.locator('[data-sign-out]')).toHaveCount(0);
  await page.locator('#su-name').fill('Test Buyer'); await page.locator('#su-phone').fill('+260970000001');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.locator('.account-bar')).toContainText('Signed in as Test Buyer');
  await expect(page.locator('.account-bar').getByRole('button', { name: 'Sign out' })).toBeInViewport();
  await page.goto('/help.html');
  await expect(page.locator('[data-greet]').first()).toHaveText('Hello, Test');
  await page.locator('.menu-btn').click();
  await page.locator('#drawer').getByRole('button', { name: 'Sign out' }).click();
  await expect(page.locator('#drawer')).not.toHaveAttribute('open', '');
  await expect(page.locator('[data-greet]').first()).toHaveText('Hello, sign in');
  await expect(page.locator('[data-sign-out-item]')).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('zs-user'))).toBe('null');
});

test('offline browsing explains cached stock and prices', async ({ page, context }) => {
  await page.goto('/index.html?demo=1');
  await context.setOffline(true);
  await expect(page.locator('#connection-status')).toBeVisible();
  await expect(page.locator('#connection-status')).toContainText('older prices and stock');
  await context.setOffline(false);
  await expect(page.locator('#connection-status')).toBeHidden();
});

test('device export and deletion preserve preferences and unrelated site data', async ({ page }) => {
  await page.goto('/index.html?demo=0#/device');
  await page.evaluate(() => {
    localStorage.setItem('zs-user', JSON.stringify({ name: 'Test Buyer', phone: '+260970000001' }));
    localStorage.setItem('zs-addresses', JSON.stringify([{ town: 'Lusaka', street: 'Private test street' }]));
    localStorage.setItem('zs-consent', 'denied'); localStorage.setItem('zs-datasaver', 'true');
    localStorage.setItem('other-app', 'untouched');
  });
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download my data' }).click();
  const download = await downloadEvent;
  const stream = await download.createReadStream();
  let raw = '';
  for await (const chunk of stream) raw += chunk;
  const exported = JSON.parse(raw);
  expect(exported.data.user.name).toBe('Test Buyer');
  expect(exported.data.addresses[0].street).toBe('Private test street');
  expect(exported.data['other-app']).toBeUndefined();
  await page.getByLabel('I understand that saved data on this device will be deleted.').check();
  await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Delete saved data on this device' }).click()]);
  const saved = await page.evaluate(() => ({ user: localStorage.getItem('zs-user'), addresses: localStorage.getItem('zs-addresses'),
    consent: localStorage.getItem('zs-consent'), saver: localStorage.getItem('zs-datasaver'), other: localStorage.getItem('other-app') }));
  expect(saved).toEqual({ user: null, addresses: null, consent: 'denied', saver: 'true', other: 'untouched' });
});

test('a seller builds a team with roles in the Seller Centre preview', async ({ page }) => {
  // The first-visit location tip and cookie notice would otherwise cover the form on a phone
  await page.addInitScript(() => { localStorage.setItem('zs-consent', 'denied'); localStorage.setItem('zs-loc-tip-seen', '1'); });
  await page.goto('/index.html?demo=1&theme=off#/seller');
  await page.getByRole('button', { name: 'Enter Seller Centre' }).click();
  const team = page.locator('#sc-team');
  await expect(team.getByRole('heading', { name: 'Your team' })).toBeVisible();
  await team.getByLabel('Email').fill('Packer@Example.test');
  await team.getByLabel('Role', { exact: true }).selectOption('dispatch');
  await team.getByRole('button', { name: 'Send invitation' }).click();
  await expect(team).toContainText('packer@example.test · invited');
  await team.getByRole('button', { name: 'Mark accepted for packer@example.test' }).click();
  await team.getByLabel('Role for packer@example.test').selectOption('finance');
  await page.reload();
  await expect(page.locator('#sc-team').getByLabel('Role for packer@example.test')).toHaveValue('finance');
  await page.locator('#sc-team').getByLabel('Email').fill('packer@example.test');
  await page.locator('#sc-team').getByRole('button', { name: 'Send invitation' }).click();
  await expect(page.locator('#sc-team .form-status')).toHaveText('That person is already on the team. Change their role instead.');
  await page.locator('#sc-team details summary').click();
  await expect(page.locator('#sc-team .mx-roles')).toContainText('Orders, packing, shipments and delivery proof.');
  await page.evaluate(require('node:fs').readFileSync(axe, 'utf8'));
  const results = await page.evaluate(async () => (await axe.run('#sc-team', { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } })).violations.map(v => v.id));
  expect(results).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});

test('delivery times by town, same-day delivery and seller deadlines', async ({ page }) => {
  // 09:00 on a Wednesday: before the same-day cut-off of 11:00
  await page.clock.setFixedTime(new Date('2026-11-04T07:00:00Z'));
  await page.addInitScript(() => {
    localStorage.setItem('zs-consent', 'denied');
    localStorage.setItem('zs-loc-tip-seen', '1');
    localStorage.setItem('zs-location', JSON.stringify({ town: 'Lusaka', province: 'lusaka', area: '', mode: 'delivery', remember: true }));
  });
  await page.goto('/index.html?demo=1&theme=off#/delivery-times');
  await expect(page.locator('#dt-town')).toHaveValue('Lusaka');
  const times = page.locator('#dt-result');
  await expect(times).toContainText('Same day, from sellers in Lusaka who offer it');
  await expect(times).toContainText('From a seller in Lusaka');
  await expect(times).toContainText('1–2 working days');
  await expect(times).toContainText('From elsewhere in Lusaka Province');
  await page.locator('#dt-town').selectOption('Mongu');
  await expect(times).not.toContainText('Same day');
  await expect(times).toContainText('From elsewhere in Western Province');
  await expect(times).toContainText('No sellers ship from Mongu yet');
  await expect(page.locator('main')).toContainText('Accept your order');
  await expect(page.locator('main')).toContainText('Within 12 hours');
  // A Lusaka seller offering same day: a Lusaka buyer sees "Arrives today" before the cut-off
  await page.goto('/index.html?demo=1&theme=off#/store/store-a');
  const sameDayProduct = await page.locator('.pcard .ptitle').first().getAttribute('href');
  await page.goto('/index.html?demo=1&theme=off' + sameDayProduct);
  await expect(page.locator('.fulfil__main')).toHaveText('Arrives today if you order by 11:00');
  await page.clock.setFixedTime(new Date('2026-11-04T09:00:00Z'));
  await page.reload();
  await expect(page.locator('.fulfil__main')).not.toContainText('Arrives today');
  // The Seller Centre shows the deadlines and the same-day choice
  await page.goto('/index.html?demo=1&theme=off#/seller');
  await page.locator('#sl-store').selectOption('store-a');
  await page.getByRole('button', { name: 'Enter Seller Centre' }).click();
  await expect(page.locator('#sc-deadlines')).toContainText('within 48 hours of accepting it');
  await expect(page.getByLabel('I deliver the same day within my town')).toBeChecked();
});

test('until rider sign-up opens, the live site marks it and the services directory coming soon', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('zs-consent', 'denied'));
  await page.goto('/index.html?demo=0&theme=off#/riders');
  await expect(page.getByRole('heading', { name: 'Deliver with Zed Supply', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign-up opens soon' })).toBeDisabled();
  await expect(page.locator('#view form')).toHaveCount(0);
  await expect(page.locator('main')).toContainText('A police clearance certificate');
  await page.goto('/index.html?demo=1&theme=off#/services');
  await expect(page.getByRole('heading', { name: 'Services', level: 1 })).toBeVisible();
  await expect(page.locator('main')).toContainText('Solar installation and repairs');
  await expect(page.locator('main')).toContainText('Coming in a later phase');
  await expect(page.locator('#view form')).toHaveCount(0);
  await expect(page.locator('.site-footer a[href="index.html#/services"]')).toHaveText('Services (coming soon)');
});

test('the demo order shows a handover code while it is out for delivery', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('zs-consent', 'denied'));
  await page.goto('/index.html?demo=1&theme=off#/order/ZS-DEMO01');
  await expect(page.locator('.handover__code')).toHaveText('482 913');
  await expect(page.locator('.handover')).toContainText('Zed Supply staff will never ask you for it');
  await expect(page.locator('.handover .tag-sample')).toHaveText('Demo');
});

test('the Kinetic Comet saves products, stays gold after reload and removes them from the wishlist', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('zs-consent', 'denied'));
  await page.goto('/index.html?demo=1&theme=off#/product/L041');
  const comet = page.locator('[data-like="L041"]');
  await expect(comet).toHaveAttribute('aria-pressed', 'false');
  await expect(comet.locator('.comet__fill')).toBeHidden();
  await expect(comet.locator('.comet__tail')).toHaveAttribute('d', 'm2 16 6-4m-4 9 5-5');
  await comet.focus();
  await page.keyboard.press('Space');
  await expect(comet).toHaveAttribute('aria-pressed', 'true');
  await expect(comet.locator('.comet__fill')).toBeVisible();
  expect(await comet.evaluate(el => getComputedStyle(el).color)).toBe('rgb(138, 98, 20)');
  await page.reload();
  await expect(comet).toHaveAttribute('aria-pressed', 'true');
  await expect(comet.locator('.comet__fill')).toBeVisible();
  const paintId = await comet.locator('linearGradient').getAttribute('id');
  await expect(comet.locator('.comet__fill')).toHaveAttribute('fill', 'url(#' + paintId + ')');
  await page.goto('/index.html?demo=1&theme=off#/wishlist');
  await expect(comet).toHaveAttribute('aria-pressed', 'true');
  await comet.click();
  await expect(page.locator('main')).toContainText('Tap the comet on any product');
  await expect(page.locator('[data-count="wish"]').first()).toHaveText('0');
});

test('icon buttons name themselves on hover and focus, and colours match their meaning', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/index.html?demo=1&theme=off');
  const tip = page.locator('.tip');
  await page.locator('a.hact[aria-label^="Wishlist"]').hover();
  await expect(tip).toHaveText('Wishlist, 0 items');
  await expect(tip).toHaveAttribute('aria-hidden', 'true');
  await page.keyboard.press('Escape');
  await expect(tip).toBeHidden();
  await page.locator('.like').first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  await page.locator('.like').first().hover();
  await expect(tip).toHaveText('Save to wishlist');
  await page.locator('.ptitle').first().hover();
  await expect(tip).toBeHidden();
  // Escape also cancels the delay before a hint becomes visible.
  await page.locator('.like').first().dispatchEvent('pointerover', { pointerType: 'mouse' });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(450);
  await expect(tip).toBeHidden();
  // Scrolling during the delay must not leave a hint at an obsolete position.
  await page.locator('.like').first().dispatchEvent('pointerover', { pointerType: 'mouse' });
  await page.evaluate(() => window.dispatchEvent(new Event('scroll')));
  await page.waitForTimeout(450);
  await expect(tip).toBeHidden();
  await page.keyboard.press('Tab');
  await page.locator('a.hact[aria-label^="Wishlist"]').focus();
  await expect(tip).toBeVisible();
  await expect(tip).toHaveText('Wishlist, 0 items');
  await page.keyboard.press('Escape');
  // No hint ever shows code
  expect(await page.evaluate(() => [...document.querySelectorAll('[title],[aria-label]')].map(e => (e.getAttribute('title') || '') + (e.getAttribute('aria-label') || '')).filter(t => /function|=>|\[object|undefined/.test(t)))).toEqual([]);
  expect(await page.evaluate(() => ['Delivered', 'Out for delivery', 'Cancellation requested', 'Not approved', 'cancel approved', 'cancel declined', 'Withdrawn', 'live', 'ended'].map(ZS.statusClass)))
    .toEqual(['status status--ok', 'status status--wait', 'status status--wait', 'status status--bad', 'status status--bad', 'status', 'status', 'status status--ok', 'status']);
  await page.evaluate(() => window.ZS.toast('That variation does not have enough stock.', 'error'));
  await expect(page.locator('#toast')).toHaveClass(/toast--error/);
  await expect(page.locator('#toast')).toHaveAttribute('aria-live', 'assertive');
  await page.evaluate(() => window.ZS.toast('Signed out'));
  await expect(page.locator('#toast')).toHaveClass('toast is-on');
  await expect(page.locator('#toast')).toHaveAttribute('aria-live', 'polite');
  await page.locator('.ptitle').first().click();
  await page.getByRole('button', { name: 'Add to cart', exact: true }).first().click();
  await expect(page.locator('#toast')).toHaveClass(/toast--success/);
  await page.goto('/index.html?demo=1&theme=off#/cart');
  await expect(page.locator('[data-remove]').first()).toHaveClass(/link-btn--danger/);
  expect(['rgb(164, 22, 26)', 'rgb(255, 154, 165)']).toContain(await page.locator('[data-remove]').first().evaluate(el => getComputedStyle(el).color));
});

test('trade buyers order by the bag, sellers set minimums and heavy items get a truck quote', async ({ page }) => {
  // A whole buyer and seller journey: slower machines need more than the default 30 seconds
  test.setTimeout(60000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  // The cookie notice and the location tip are answered, so they don't cover the buy box on a phone
  await page.addInitScript(() => { localStorage.setItem('zs-consent', 'denied'); localStorage.setItem('zs-loc-tip-seen', 'true'); });
  // A wholesale buyer: 150 bags reach the 100+ bulk price
  await page.goto('/index.html?demo=1&theme=off#/product/L053');
  const box = page.locator('.buybox');
  await expect(box.locator('.trade-terms')).toContainText('Order up to 9,999 bags at a time');
  await expect(box.locator('.trade-terms')).toContainText('Price per bag');
  await expect(box.locator('.tiers')).toContainText('100+ bags');
  const qty = page.getByLabel('Quantity (bags)');
  await expect(qty).toHaveAttribute('max', '9999');
  await qty.fill('150');
  await qty.dispatchEvent('input');
  await expect(page.locator('#buy-now')).toHaveAttribute('data-wa-message', /Quantity: 150 bags/);
  await expect(box.locator('.tiers li.is-on')).toContainText('100+ bags');
  await page.locator('#pdp-add').click();
  await page.goto('/index.html?demo=1&theme=off#/cart');
  await expect(page.locator('.line__price')).toContainText('150 bags, K142 per bag');

  // A seller lists cement: minimum 20, in tens, heavy, with a bulk price for 100+
  await page.goto('/index.html?demo=1&theme=off#/seller');
  await page.getByRole('button', { name: 'Enter Seller Centre' }).click();
  await page.goto('/index.html?demo=1&theme=off#/listing/new');
  await page.locator('#lf-title').fill('Cement, 50 kg bag');
  await page.locator('#lf-category').selectOption('hardware');
  await page.locator('#lf-priceZMW').fill('200');
  await page.locator('#lf-sellUnit').selectOption('bag');
  await page.locator('#lf-unitWeightKg').fill('50');
  await page.getByRole('switch', { name: 'Sell in trade quantities' }).check();
  await page.locator('#lf-minQty').fill('25');
  await page.locator('#lf-qtyStep').fill('10');
  await page.getByRole('switch', { name: 'Heavy or bulky: needs truck delivery' }).check();
  await page.getByRole('button', { name: 'Add a bulk price' }).click();
  await page.locator('#lf-tm-0').fill('100');
  await page.locator('#lf-tp-0').fill('190');
  await page.getByRole('button', { name: 'Add product' }).click();
  await expect(page.locator('#lf-errors')).toContainText('Make the minimum order a multiple of 10');
  await page.locator('#lf-minQty').fill('20');
  await page.getByRole('button', { name: 'Add product' }).click();
  await expect(page).toHaveURL(/#\/listing\/U[A-Z0-9]+\?saved=1/);
  const id = decodeURIComponent(page.url().match(/#\/listing\/([^?]+)/)[1]);

  // Quick-add respects the minimum too, rather than trying to add a single bag.
  await page.goto('/index.html?demo=1&theme=off#/search?q=Cement');
  await page.locator('[data-add="' + id + '"]').click();
  await expect(page.locator('#toast')).toContainText('20 bags × Cement, 50 kg bag');
  await page.goto('/index.html?demo=1&theme=off#/cart');
  await expect(page.locator('.line').filter({ hasText: 'Cement, 50 kg bag' }).locator('.line__price')).toContainText('20 bags');
  await page.locator('[data-remove="' + id + '"]').click();

  // The buyer sees the rules; the quantity snaps to the minimum and multiples
  await page.goto('/index.html?demo=1&theme=off#/product/' + id);
  await expect(page.locator('.trade-terms')).toContainText('Minimum order 20 bags · in multiples of 10 · 50 kg per bag');
  await expect(page.locator('.trade-terms__freight')).toBeVisible();
  await expect(page.getByLabel('Quantity (bags)')).toHaveValue('20');
  await page.getByLabel('Quantity (bags)').fill('25');
  await page.getByLabel('Quantity (bags)').dispatchEvent('input');
  await expect(page.locator('#pdp-add')).toBeDisabled();
  await expect(page.locator('#pdp-add')).toHaveText('Choose a quantity from 20 to 9,990 bags, in multiples of 10');
  // The "Product added" message from the Seller Centre can sit over the stepper on a phone
  await expect(page.locator('#toast')).not.toHaveClass(/is-on/, { timeout: 10000 });
  await page.getByRole('button', { name: 'Increase quantity' }).click();
  await expect(page.getByLabel('Quantity (bags)')).toHaveValue('30');
  await page.locator('#pdp-add').click();

  // Checkout: truck delivery and business details reach the order and its summary
  await page.goto('/index.html?demo=1&theme=off#/cart');
  await expect(page.locator('#co-freight')).toContainText('Cement, 50 kg bag (30 bags), about 1.5 tonnes');
  await page.getByLabel('I\'m buying for a business').check();
  await page.getByLabel('Business name *').fill('Mwila Farms');
  await page.getByLabel('TPIN (optional)').fill('12345');
  await page.getByLabel('Your name *').fill('Chanda Mwila');
  await page.evaluate(() => window.ZS.store.set('loc', { town: 'Lusaka', area: 'Kabulonga', province: 'lusaka', mode: 'delivery' }));
  const send = page.locator('#checkout');
  await page.locator('#co-review').click();
  await expect(page.locator('#co-biz-err')).toHaveText('Enter the TPIN as 10 digits, or leave it empty.');
  await expect(page.locator('#co-review-dialog')).not.toBeVisible();
  await page.getByLabel('TPIN (optional)').fill('1234567890');
  await expect(send).toHaveAttribute('data-wa-message', /Business: Mwila Farms, TPIN 1234567890/);
  await expect(send).toHaveAttribute('data-wa-message', /Truck delivery needed: Cement, 50 kg bag \(30 bags\)/);
  // A message still showing over the page would count as covering its controls
  await expect(page.locator('#toast')).not.toHaveClass(/is-on/, { timeout: 10000 });
  await page.evaluate(require('node:fs').readFileSync(axe, 'utf8'));
  const results = await page.evaluate(async () => (await axe.run('main', { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } })).violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target.join(' ') + ': ' + n.failureSummary) })));
  expect(results).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  expect(errors).toEqual([]);
});

test('checkout prices delivery as choices change, reviews the order, then gives a branded receipt', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  // 09:00 on a Wednesday in Zambia, so the delivery dates are fixed
  await page.clock.setFixedTime(new Date('2026-11-04T07:00:00Z'));
  await page.addInitScript(() => {
    localStorage.setItem('zs-consent', 'denied');
    localStorage.setItem('zs-loc-tip-seen', '1');
    localStorage.setItem('zs-location', JSON.stringify({ town: 'Lusaka', area: 'Kabulonga', province: 'lusaka', mode: 'delivery' }));
    // Paper from a Lusaka store (12.5 kg) and a sprayer from Kitwe: two parcels
    localStorage.setItem('zs-cart', JSON.stringify([{ id: 'L001', qty: 1 }, { id: 'L012', qty: 1 }]));
  });
  await page.goto('/index.html?demo=1&theme=off#/cart');
  const totals = page.locator('#co-totals');
  // Standard: K45 + 8 kg over at K5 for the Lusaka parcel, K150 from Kitwe
  await expect(page.locator('label[for="co-speed-standard"]')).toContainText('K235');
  await expect(totals).toContainText('Delivery · Standard (2 parcels)K235');
  await expect(totals).toContainText('Order totalK1,139');
  await expect(page.locator('#co-free')).toContainText('Add K596 more for FREE standard delivery');
  // Express adds to the total at once
  await page.locator('label[for="co-speed-express"]').click();
  await expect(totals).toContainText('Delivery · Express (2 parcels)K439');
  await expect(totals).toContainText('Order totalK1,343');
  // A courier's own price changes its parcel's fee
  await page.locator('label[for="co-speed-standard"]').click();
  await page.locator('label[for="co-ship-zampost"]').click();
  await expect(totals).toContainText('Sample Store B · StandardK125');
  // Collecting removes the Lusaka parcel's fee; the Kitwe seller doesn't offer collection, so it still delivers
  await page.getByLabel('I\'ll collect it from the sellers').check();
  await expect(totals).toContainText('Delivery · StandardK125Order totalK1,029');
  await page.getByLabel('Deliver it to me').check();
  await expect(totals).toContainText('Delivery · Standard');
  // Review: nothing can be placed without a name, and a bad email is caught
  await page.getByLabel('Email (optional)').fill('not-an-email');
  await page.locator('#co-review').click();
  await expect(page.locator('#co-name-err')).toHaveText('Enter your name.');
  await page.getByLabel('Your name *').fill('Chanda Mwila');
  await page.locator('#co-review').click();
  await expect(page.locator('#co-rc-err')).toContainText('Enter an email address');
  await page.getByLabel('Email (optional)').fill('chanda@example.com');
  await page.locator('#co-review').click();
  const dialog = page.getByRole('dialog', { name: 'Review your order' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Kabulonga, Lusaka');
  await expect(dialog).toContainText('Sample Store B · Standard · Arrives Mon 9 Nov – Fri 13 Nov · Zampost EMS');
  await page.evaluate(require('node:fs').readFileSync(axe, 'utf8'));
  const a11y = await page.evaluate(async () => (await axe.run('#co-review-dialog', { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } })).violations.map(v => v.id));
  expect(a11y).toEqual([]);
  // Placing the order opens WhatsApp with the delivery and total, and the receipt is ready
  await page.context().route('https://wa.me/**', route => route.fulfill({ body: 'WhatsApp' }));
  const [wa] = await Promise.all([page.context().waitForEvent('page'), dialog.getByRole('link', { name: 'Place order · K1,114' }).click()]);
  const message = new URL(wa.url()).searchParams.get('text');
  expect(message).toContain('Delivery (Standard): K210 [Sample Store A standard K85; Sample Store B standard K125]');
  expect(message).toContain('Order total: K1,114');
  await wa.close();
  await expect(page).toHaveURL(/#\/order\/ZS-[A-Z0-9]{8}\?placed=1$/);
  await expect(page.getByText('Thank you, your order is placed')).toBeVisible();
  await expect(page.locator('.parcels')).toContainText('Your 2 parcels');
  await expect(page.locator('.receipt-actions').getByRole('link', { name: /Send to WhatsApp/ })).toHaveAttribute('href', /^https:\/\/wa\.me\/\?text=Zed%20Supply/);
  await expect(page.locator('.receipt-actions').getByRole('link', { name: 'Email receipt' })).toHaveAttribute('href', /^mailto:chanda@example\.com\?subject=Zed%20Supply%20receipt%20ZS-/);
  await page.locator('.receipt-actions').getByRole('link', { name: 'View receipt' }).click();
  const receipt = page.locator('#receipt');
  await expect(receipt.getByRole('heading', { name: 'Order receipt' })).toBeVisible();
  await expect(receipt.locator('.receipt__head img')).toHaveAttribute('alt', 'Zed Supply');
  await expect(receipt).toContainText('Chanda Mwila');
  await expect(receipt.locator('tbody tr')).toHaveCount(2);
  await expect(receipt.locator('.is-total')).toContainText('K1,114');
  await expect(receipt).toContainText('it is not a tax invoice');
  await page.evaluate(() => { window.printed = 0; window.print = () => { window.printed++; }; });
  await page.getByRole('button', { name: 'Print', exact: true }).click();
  expect(await page.evaluate(() => window.printed)).toBe(1);
  // The receipt prints on its own: nothing else on the page is shown on paper
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.site-header')).toBeHidden();
  await expect(page.locator('.receipt-actions')).toBeHidden();
  await expect(receipt).toBeVisible();
  await page.emulateMedia({ media: 'screen' });
  const a11yReceipt = await page.evaluate(async () => (await axe.run('main', { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } })).violations.map(v => v.id + ': ' + v.nodes.map(n => n.target.join(' ')).join(', ')));
  expect(a11yReceipt).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  expect(errors).toEqual([]);
});

test('free standard delivery once the items reach the threshold, and same day where the seller offers it', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-04T07:00:00Z'));
  await page.addInitScript(() => {
    localStorage.setItem('zs-consent', 'denied');
    localStorage.setItem('zs-loc-tip-seen', '1');
    localStorage.setItem('zs-location', JSON.stringify({ town: 'Lusaka', area: 'Kabulonga', province: 'lusaka', mode: 'delivery' }));
    localStorage.setItem('zs-cart', JSON.stringify([{ id: 'L001', qty: 4 }]));
  });
  await page.goto('/index.html?demo=1&theme=off#/cart');
  await expect(page.locator('#co-free')).toContainText('Your order qualifies for FREE standard delivery');
  await expect(page.locator('label[for="co-speed-standard"]')).toContainText('FREE');
  await expect(page.locator('#co-totals')).toContainText('Delivery · StandardFREE');
  // Sample Store A offers same day in Lusaka, and it's before the 11:00 cut-off
  await expect(page.locator('label[for="co-speed-same_day"]')).toContainText('Arrives today');
  await page.locator('label[for="co-speed-same_day"]').click();
  await expect(page.locator('#co-totals')).toContainText('Delivery · Same day');
  await expect(page.locator('#co-free')).toContainText('if you choose Standard');
});

test('the demo order shows its courier, tracking number and courier updates', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('zs-consent', 'denied'));
  await page.goto('/index.html?demo=1&theme=off#/order/ZS-DEMO01');
  const parcel = page.locator('.parcel');
  await expect(parcel).toContainText('Courier: FedEx');
  await expect(parcel).toContainText('Tracking number SAMPLE-7712345601');
  await expect(parcel.locator('.track-events li').first()).toContainText('Out for delivery');
  await expect(parcel.locator('.track-events li')).toHaveCount(4);
  await expect(parcel.getByRole('link', { name: /Track with/ })).toHaveCount(0);
  await expect(page.locator('.summary .totals')).toContainText('Delivery · ExpressK290');
  await page.goto('/index.html?demo=1&theme=off#/receipt/ZS-DEMO01');
  await expect(page.locator('#receipt')).toContainText('Paid');
  await expect(page.locator('#receipt .is-total')).toContainText('K2,140');
});

test('staff change delivery prices in the back office and the cart reprices straight away', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    localStorage.setItem('zs-consent', 'denied');
    localStorage.setItem('zs-loc-tip-seen', '1');
    localStorage.setItem('zs-location', JSON.stringify({ town: 'Lusaka', area: 'Kabulonga', province: 'lusaka', mode: 'delivery' }));
    localStorage.setItem('zs-cart', JSON.stringify([{ id: 'L001', qty: 1 }]));
  });
  await page.goto('/index.html?demo=1&theme=off#/cart');
  // Sample: K45 for 5 kg, then K5 for each of the 8 extra kilograms of paper
  await expect(page.locator('label[for="co-speed-standard"]')).toContainText('K85');
  await page.goto('/index.html?demo=1&theme=off#/staff/delivery');
  const editor = page.locator('#delivery-editor');
  await expect(editor.getByRole('heading', { name: 'Delivery prices' })).toBeVisible();
  await editor.getByLabel('Rate 1: fee in kwacha').fill('60');
  // One rate per courier, zone and speed
  await editor.getByRole('button', { name: 'Add a rate' }).click();
  const added = editor.locator('[data-rate-row]').last();
  await added.locator('[data-f="fee"]').fill('70');
  await editor.getByRole('button', { name: 'Save delivery prices' }).click();
  await expect(editor.locator('[role="status"]')).toContainText('repeats rate 1');
  await added.getByRole('button', { name: /Remove/ }).click();
  await editor.getByLabel('For items worth at least (K)').fill('');
  await editor.getByRole('button', { name: 'Save delivery prices' }).click();
  await expect(editor.locator('[role="status"]')).toContainText('Delivery prices saved');
  await page.evaluate(require('node:fs').readFileSync(axe, 'utf8'));
  expect(await page.evaluate(async () => (await axe.run('#delivery-editor', { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } })).violations.map(v => v.id + ': ' + v.nodes.map(n => n.target.join(' ')).slice(0, 3).join(', ')))).toEqual([]);
  // The cart uses the new price at once, and it survives a reload
  await page.goto('/index.html?demo=1&theme=off#/cart');
  await expect(page.locator('label[for="co-speed-standard"]')).toContainText('K100');
  await expect(page.locator('#co-free')).toBeEmpty();
  await page.reload();
  await expect(page.locator('#co-totals')).toContainText('Delivery · StandardK100');
  // Back to the sample card
  await page.goto('/index.html?demo=1&theme=off#/staff/delivery');
  await page.getByRole('button', { name: 'Go back to the sample prices' }).click();
  await page.goto('/index.html?demo=1&theme=off#/cart');
  await expect(page.locator('label[for="co-speed-standard"]')).toContainText('K85');
  expect(errors).toEqual([]);
});

test('a receipt downloads as a real PDF file with the order on it', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('zs-consent', 'denied'));
  await page.goto('/index.html?demo=1&theme=off#/receipt/ZS-DEMO01');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download PDF' }).click()]);
  expect(download.suggestedFilename()).toBe('Zed-Supply-receipt-ZS-DEMO01.pdf');
  const pdf = require('node:fs').readFileSync(await download.path()).toString('latin1');
  expect(pdf.startsWith('%PDF-1.4')).toBe(true);
  for (const text of ['(Order receipt) Tj', '(No. ZS-DEMO01) Tj', '(K2,140) Tj', '(Solar home lighting kit, 4 bulbs) Tj', '(DEMO ORDER) Tj']) expect(pdf).toContain(text);
  expect(pdf).toContain('/Subtype /Image');   // the logo
  // Every object is where the cross-reference table says it is
  const start = Number(pdf.match(/startxref\n(\d+)/)[1]), count = Number(pdf.slice(start).match(/^xref\n0 (\d+)/)[1]);
  const offsets = pdf.slice(start).split('\n').slice(3, 2 + count).map(l => Number(l.slice(0, 10)));
  expect(offsets.every((o, i) => pdf.startsWith((i + 1) + ' 0 obj', o))).toBe(true);
  await expect(page.locator('#toast')).toContainText('Receipt downloaded as a PDF');
  // The order page has the same download
  await page.goto('/index.html?demo=1&theme=off#/order/ZS-DEMO01');
  const [again] = await Promise.all([page.waitForEvent('download'), page.locator('.receipt-actions').getByRole('button', { name: 'Download PDF' }).click()]);
  expect(again.suggestedFilename()).toBe('Zed-Supply-receipt-ZS-DEMO01.pdf');
});

test('riders apply, and staff approve only after the in-person checks', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    localStorage.setItem('zs-consent', 'denied');
    localStorage.setItem('zs-loc-tip-seen', '1');
  });
  await page.goto('/index.html?demo=1&theme=off#/riders');
  await expect(page.getByRole('heading', { name: 'What you need' })).toBeVisible();
  await expect(page.locator('[aria-labelledby="rd-need-title"]')).toContainText('A police clearance certificate');
  const form = page.locator('#rider-apply');
  await form.getByLabel('Full name *').fill('Mutale Phiri');
  await form.getByLabel('Phone or WhatsApp *').fill('0977 123456');
  await form.getByLabel('Town *').fill('Lusaka');
  await form.getByLabel('How would you deliver? *').selectOption('motorbike');
  await form.getByLabel('Weekdays').check();
  for (const label of [/18 or over/, /smartphone with WhatsApp/, /police clearance/, /assess my application/]) await form.getByLabel(label).check();
  await form.getByRole('button', { name: 'Send application' }).click();
  await expect(form.locator('[role="status"]')).toHaveText('You need a valid driving licence for a motorbike.');
  await form.getByLabel(/valid driving licence/).check();
  await page.evaluate(require('node:fs').readFileSync(axe, 'utf8'));
  expect(await page.evaluate(async () => (await axe.run('main', { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } })).violations.map(v => v.id))).toEqual([]);
  await form.getByRole('button', { name: 'Send application' }).click();
  await expect(page.locator('#rd-status-title')).toBeVisible();
  await expect(page.locator('.card')).toContainText('Received');
  // Staff: no approval until the rider has been invited to the checks
  await page.goto('/index.html?demo=1&theme=off#/staff/riders');
  const decide = page.locator('#mx-rider-decide');
  await expect(decide.getByRole('button', { name: /approve/ })).toHaveCount(0);
  await decide.getByRole('button', { name: 'Invite to in-person checks' }).click();
  await expect(decide.locator('[role="status"]')).toHaveText('Write a message to the rider.');
  await page.getByLabel('Message to the rider').fill('Come to our Lusaka office on Monday at 10:00 with your NRC, licence and police clearance.');
  await decide.getByRole('button', { name: 'Invite to in-person checks' }).click();
  await expect(page.locator('.card .status')).toContainText('Invited to in-person checks');
  await page.locator('#mx-rider-decide').getByRole('button', { name: 'Checks passed: approve' }).click();
  await page.goto('/index.html?demo=1&theme=off#/riders');
  await expect(page.locator('.card')).toContainText('Approved to deliver');
  await expect(page.locator('.card')).toContainText('Come to our Lusaka office');
  expect(errors).toEqual([]);
});

test('after an order, the buyer chooses whether bought items leave the wishlist, and the wishlist shows what was bought', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.clock.setFixedTime(new Date('2026-11-04T07:00:00Z'));
  await page.addInitScript(() => {
    localStorage.setItem('zs-consent', 'denied');
    localStorage.setItem('zs-loc-tip-seen', '1');
    localStorage.setItem('zs-location', JSON.stringify({ town: 'Lusaka', area: 'Kabulonga', province: 'lusaka', mode: 'delivery' }));
    // Only on the first load, so reloads see what the test did
    if (localStorage.getItem('zs-wish') === null) {
      localStorage.setItem('zs-wish', JSON.stringify(['L001', 'L012']));
      localStorage.setItem('zs-cart', JSON.stringify([{ id: 'L001', qty: 1 }]));
    }
  });
  // Adding to the cart doesn't take it off the wishlist; the wishlist says it's in the cart
  await page.goto('/index.html?demo=1&theme=off#/wishlist');
  const paper = page.locator('.pcard').filter({ hasText: 'A4 copy paper' });
  await expect(paper.locator('.wish-tag--cart')).toHaveText('In your cart');
  await expect(page.locator('.wish-tag--bought')).toHaveCount(0);
  // Order it
  await page.goto('/index.html?demo=1&theme=off#/cart');
  await page.getByLabel('Your name *').fill('Chanda Mwila');
  await page.locator('#co-review').click();
  await page.context().route('https://wa.me/**', route => route.fulfill({ body: 'WhatsApp' }));
  const [wa] = await Promise.all([page.context().waitForEvent('page'), page.getByRole('dialog').getByRole('link', { name: /Place order/ }).click()]);
  await wa.close();
  await expect(page).toHaveURL(/\?placed=1$/);
  // The confirmation asks once, without blocking anything
  const ask = page.locator('[data-wish-prompt]');
  await expect(ask).toContainText('You bought something from your wishlist: A4 copy paper, box of 5 reams.');
  await expect(page.getByText('Thank you, your order is placed')).toBeVisible();
  await ask.getByRole('button', { name: 'Remove from wishlist' }).click();
  await expect(ask).toContainText('Removed from your wishlist.');
  await expect(ask.getByRole('button', { name: 'Undo' })).toBeFocused();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('zs-wish')))).toEqual(['L012']);
  await ask.getByRole('button', { name: 'Undo' }).click();
  await expect(ask).toHaveText('Back on your wishlist.');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('zs-wish')).sort())).toEqual(['L001', 'L012']);
  await page.evaluate(require('node:fs').readFileSync(axe, 'utf8'));
  expect(await page.evaluate(async () => (await axe.run('main', { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } })).violations.map(v => v.id))).toEqual([]);
  // Keeping it is remembered: the question isn't asked again for this order
  await page.reload();
  await page.locator('[data-wish-prompt]').getByRole('button', { name: 'Keep on wishlist' }).click();
  await expect(page.locator('[data-wish-prompt]')).toHaveText('Kept on your wishlist.');
  await page.reload();
  await expect(page.locator('[data-wish-prompt]')).toHaveCount(0);
  // The wishlist shows it was bought, and bought items can be cleared in one go, with undo
  await page.goto('/index.html?demo=1&theme=off#/wishlist');
  await expect(paper.locator('.wish-tag--bought')).toHaveText('Bought 4 Nov 2026');
  await expect(paper.locator('.wish-tag--cart')).toHaveCount(0);
  await expect(paper.getByRole('button', { name: /Add to cart/ })).toBeVisible();
  await page.getByRole('button', { name: 'Remove bought items' }).click();
  await expect(page.locator('.pcard')).toHaveCount(1);
  await expect(page.locator('#toast')).toContainText('Removed 1 item from your wishlist.');
  await page.locator('#toast').getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.pcard')).toHaveCount(2);
  expect(errors).toEqual([]);
});

test('Google Analytics and Clarity download only after Accept, and never with Data saver on', async ({ page, context }) => {
  // Every request the page makes is seen here, whichever handler answers it
  const seen = [];
  page.on('request', r => { if (/googletagmanager\.com|clarity\.ms|google-analytics\.com/.test(r.url())) seen.push(r.url()); });
  await context.route(/googletagmanager\.com|clarity\.ms|google-analytics\.com/, route => route.fulfill({ body: '', contentType: 'application/javascript' }));
  await page.goto('/index.html?theme=off');
  await expect(page.locator('.consent')).toBeVisible();
  await page.waitForTimeout(500);
  expect(seen).toEqual([]);   // nothing before a choice
  await page.locator('.consent').getByRole('button', { name: 'Decline' }).click();
  await page.reload();
  await page.waitForTimeout(500);
  expect(seen).toEqual([]);   // nothing after Decline
  await page.evaluate(() => { localStorage.removeItem('zs-consent'); });
  await page.reload();
  await page.locator('.consent').getByRole('button', { name: 'Accept' }).click();
  await expect.poll(() => seen.some(u => u.includes('gtag/js?id=G-E2MC1NELGE')) && seen.some(u => u.includes('clarity.ms/tag/z47hop4420'))).toBe(true);
  // Accepted, but with Data saver on: still nothing
  seen.length = 0;
  await page.evaluate(() => localStorage.setItem('zs-datasaver', 'true'));
  await page.reload();
  await page.waitForTimeout(500);
  expect(seen).toEqual([]);
});
