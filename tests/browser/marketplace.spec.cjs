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
  await page.clock.setFixedTime(new Date('2026-11-04T09:00:00'));
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
  // The Seller Centre shows the deadlines and the same-day choice
  await page.goto('/index.html?demo=1&theme=off#/seller');
  await page.locator('#sl-store').selectOption('store-a');
  await page.getByRole('button', { name: 'Enter Seller Centre' }).click();
  await expect(page.locator('#sc-deadlines')).toContainText('within 48 hours of accepting it');
  await expect(page.getByLabel('I deliver the same day within my town')).toBeChecked();
});

test('rider sign-up and the services directory are marked coming soon', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('zs-consent', 'denied'));
  await page.goto('/index.html?demo=1&theme=off#/riders');
  await expect(page.getByRole('heading', { name: 'Deliver with Zed Supply', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign-up opens soon' })).toBeDisabled();
  await expect(page.locator('#view form')).toHaveCount(0);
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
  await send.evaluate(a => a.removeAttribute('target'));
  await send.click();
  await expect(page.locator('#co-biz-err')).toHaveText('Enter the TPIN as 10 digits, or leave it empty.');
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
