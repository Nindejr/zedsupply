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

for (const route of ['', '#/departments', '#/search?q=solar', '#/product/L041', '#/cart', '#/account', '#/device', '#/seller', '#/staff', 'help.html', 'privacy.html', '404.html', 'shop/', 'shop/departments/solar/']) {
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
