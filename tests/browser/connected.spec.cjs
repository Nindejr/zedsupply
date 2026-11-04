// Staging contract tests: all Auth, database and payment endpoints are local stand-ins.
// They validate the integration without activating services or sending messages/money.
const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const source = fs.readFileSync('js/catalogue.js','utf8').replace("api: { enabled: false, url: '', key: '' }", "api: { enabled: true, url: 'https://test-project.supabase.co', key: 'test-publishable-key' }");
const product = { id:'LIVE1',title:'Approved studio lamp',department_id:'tech',subcategory_id:'phones',seller_id:'live-store',price_zmw:100,stock_qty:3,stock_status:'in',
  image:'assets/products/L002.webp',alt:'Studio lamp',options:[],variants:[],components:[],images:[],tiers:[],seller:{id:'live-store',name:'Live store',city:'Lusaka',verified:false} };

const application = {id:'app-1',business:'Kafue Solar Traders',contact_name:'Mwila Banda',phone:'+260977123456',email:'buyer@example.test',town:'Kafue',pacra:null,
  categories:['Solar, Power & Energy'],about:'Solar lamps and panels',status:'new',staff_note:null,seller_id:null,created_at:'2026-11-03T08:00:00Z',updated_at:'2026-11-03T08:00:00Z',decided_at:null};
async function setup(page, { staff = false, teamRole = 'owner', applications = [] } = {}) {
  const calls = [];
  await page.addInitScript(() => {
    localStorage.setItem('zs-consent','denied');
    localStorage.setItem('zs-user',JSON.stringify({id:999,name:'Untrusted local profile',is_staff:true}));
    localStorage.setItem('zs-location',JSON.stringify({town:'Lusaka',province:'lusaka',area:'Test area',mode:'delivery',remember:true}));
  });
  await page.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.hostname === '127.0.0.1') {
      if (url.pathname.endsWith('/js/catalogue.js')) return route.fulfill({contentType:'application/javascript',body:source});
      return route.continue();
    }
    if (url.hostname !== 'test-project.supabase.co') return route.fulfill({status:200,body:''});
    const body = req.postDataJSON(); calls.push({path:url.pathname,body,headers:req.headers(),query:url.search});
    let data = {};
    if (url.pathname === '/auth/v1/verify') data = {access_token:'verified-test-token',refresh_token:'refresh-test',expires_in:3600};
    else if (url.pathname === '/auth/v1/user') data = {id:'verified-auth-id',email_confirmed_at:'2026-11-01T00:00:00Z'};
    else if (url.pathname === '/rest/v1/users') data = [{id:7,name:'Verified Buyer',email:'buyer@example.test',phone:'+260970000001',is_staff:false}];
    else if (url.pathname === '/rest/v1/rpc/catalogue_page') data = [product];
    else if (url.pathname === '/rest/v1/rpc/checkout_quote') data = {total:100,subtotal:100,vat:0,currency:'ZMW',delivery_pending:true};
    else if (url.pathname === '/functions/v1/place-order') data = {ref:body.ref,total:100,order_id:41};
    else if (url.pathname === '/rest/v1/rpc/my_seller_invites') data = [{id:'invite-1',store:'Live store',role:'dispatch',expires_at:'2026-11-10T00:00:00Z'}];
    else if (url.pathname === '/rest/v1/rpc/seller_respond_invite') data = 'live-store';
    else if (url.pathname === '/rest/v1/seller_members') data = [{seller_id:'live-store',role:'owner'}];
    else if (url.pathname === '/rest/v1/rpc/seller_team') data = {store:{id:'live-store',name:'Live store'},my_role:'owner',
      members:[{user_id:7,name:'Verified Buyer',role:'owner',you:true,email:'buyer@example.test',added_at:'2026-11-01T00:00:00Z'},
        {user_id:8,name:'Packer',role:'dispatch',you:false,email:'packer@example.test',added_at:'2026-11-02T00:00:00Z'}],
      invites:[{id:'invite-2',email:'later@example.test',role:'finance',expires_at:'2026-11-09T00:00:00Z'}],
      log:[{action:'joined',subject:'Packer',role:'dispatch',actor:'Packer',created_at:'2026-11-02T00:00:00Z'}]};
    else if (url.pathname.startsWith('/rest/v1/rpc/seller_')) data = null;
    else if (url.pathname === '/rest/v1/seller_applications') data = applications;
    else if (url.pathname === '/rest/v1/rpc/submit_seller_application') data = 'app-1';
    else if (url.pathname === '/rest/v1/rpc/set_business_details') data = null;
    else if (url.pathname === '/rest/v1/rpc/staff_approve_application') data = body.store_id;
    else if (url.pathname === '/rest/v1/rpc/staff_review_application') data = null;
    else if (url.pathname === '/rest/v1/orders') data = [{id:41,ref:'ZS-LIVE0001',status:'placed',created_at:'2026-11-01T00:00:00Z',total_zmw:100,delivery_zmw:null,paid_zmw:0,payment_status:'unpaid',fulfilment:'delivery',order_items:[{id:81,product_id:'LIVE1',quantity:1,unit_price_zmw:100,order_item_addons:[]}]}];
    else data = [];
    if (url.pathname === '/rest/v1/users') data[0].is_staff = staff;
    // Business details saved with set_business_details come back with the profile
    const biz = calls.filter(c => c.path === '/rest/v1/rpc/set_business_details').pop();
    if (biz && url.pathname === '/rest/v1/users') Object.assign(data[0], {business_name:biz.body.business,business_tpin:biz.body.tpin,business_address:biz.body.address});
    if (url.pathname === '/rest/v1/rpc/seller_team') data.my_role = teamRole;
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
  });
  return calls;
}
async function signIn(page) {
  await page.goto('/index.html?demo=0#/account');
  await page.getByLabel('Your name',{exact:true}).fill('Verified Buyer');
  await page.getByLabel('Email',{exact:true}).fill('buyer@example.test');
  await page.getByRole('button',{name:'Send code',exact:true}).click();
  await page.getByLabel('Email code',{exact:true}).fill('123456');
  await page.getByRole('button',{name:'Verify and sign in',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Hello, Verified Buyer'})).toBeVisible();
}
test('verified sign-in, server search and quote-before-order use trusted identity and pricing', async ({page}) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const calls = await setup(page);
  await signIn(page);
  await page.goto('/index.html?demo=0#/search?q=lamp');
  await expect(page.locator('.pcard')).toHaveCount(1);
  await page.locator('.ptitle').click();
  await expect(page.getByRole('heading',{name:'Approved studio lamp',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Add to cart',exact:true}).click();
  await page.goto('/index.html?demo=0#/cart');
  await expect(page.getByRole('link',{name:'Review server total',exact:true})).toBeVisible();
  await page.getByRole('link',{name:'Review server total',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Review your server total'})).toBeVisible();
  expect(calls.filter(c => c.path.endsWith('/place-order'))).toHaveLength(0);
  await page.getByRole('button',{name:'Place order for K100 in items',exact:true}).click();
  await expect(page.getByRole('heading',{name:/Order ZS-/})).toBeVisible();
  const placed = calls.find(c => c.path.endsWith('/place-order'));
  expect(placed.body.expected_total_zmw).toBe(100);
  expect(placed.body.user_id).toBeUndefined();
  expect(placed.body.items).toEqual([{product_id:'LIVE1',variant_id:null,quantity:1,addons:[],commitment_id:null}]);
  expect(placed.headers.authorization).toBe('Bearer verified-test-token');
  expect(calls.find(c => c.path === '/rest/v1/orders').query).toContain('user_id=eq.7');
  expect(errors).toEqual([]);
});
test('a changed checkout field invalidates the reviewed quote', async ({page}) => {
  const calls = await setup(page); await signIn(page);
  await page.goto('/index.html?demo=0#/product/LIVE1');
  await page.getByRole('button',{name:'Add to cart',exact:true}).click();
  await page.goto('/index.html?demo=0#/cart');
  await page.getByRole('link',{name:'Review server total',exact:true}).click();
  await expect(page.getByRole('button',{name:'Place order for K100 in items',exact:true})).toBeVisible();
  await page.getByLabel('Recipient phone (+260…)').fill('+260970000002');
  await expect(page.getByRole('button',{name:'Place order for K100 in items',exact:true})).toHaveCount(0);
  expect(calls.filter(c => c.path.endsWith('/place-order'))).toHaveLength(0);
});
test('a store invitation is accepted from My Account and owners manage the team', async ({page}) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const calls = await setup(page); await signIn(page);
  const invite = page.locator('#team-invites');
  await expect(invite).toContainText('Live store invited you to join as Dispatch');
  await invite.getByRole('button',{name:'Accept',exact:true}).click();
  await expect(page).toHaveURL(/#\/team\/live-store$/);
  expect(calls.find(c => c.path === '/rest/v1/rpc/seller_respond_invite').body).toEqual({invite:'invite-1',accept:true});
  await expect(page.getByRole('heading',{name:'People on this team'})).toBeVisible();
  await expect(page.locator('main')).toContainText('Your role: Owner');
  await expect(page.locator('main')).toContainText('Packer joined as Dispatch');
  await page.getByLabel('Role for Packer').selectOption('listings');
  await expect.poll(() => calls.find(c => c.path === '/rest/v1/rpc/seller_set_member_role')?.body).toEqual({sid:'live-store',member:8,member_role:'listings'});
  await page.getByLabel('Email',{exact:true}).fill('new@example.test');
  await page.getByLabel('Role',{exact:true}).selectOption('manager');
  await page.getByRole('button',{name:'Send invitation',exact:true}).click();
  await expect.poll(() => calls.find(c => c.path === '/rest/v1/rpc/seller_invite')?.body).toEqual({sid:'live-store',invitee_email:'new@example.test',member_role:'manager'});
  await page.getByRole('button',{name:'Cancel invitation for later@example.test'}).click();
  await expect.poll(() => calls.find(c => c.path === '/rest/v1/rpc/seller_cancel_invite')?.body).toEqual({invite:'invite-2'});
  page.once('dialog', d => d.accept());
  await page.getByRole('button',{name:'Remove Packer'}).click();
  await expect.poll(() => calls.find(c => c.path === '/rest/v1/rpc/seller_remove_member')?.body).toEqual({sid:'live-store',member:8});
  await page.evaluate(fs.readFileSync(require.resolve('axe-core/axe.min.js'),'utf8'));
  expect(await page.evaluate(async () => (await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a','wcag2aa','wcag21aa','wcag22aa'] } })).violations.map(v => v.id))).toEqual([]);
  expect(errors).toEqual([]);
});

test('staff retain team management controls with a non-owner store role', async ({page}) => {
  await setup(page, { staff: true, teamRole: 'dispatch' });
  await signIn(page);
  await page.goto('/index.html?demo=0#/team/live-store');
  await expect(page.locator('main')).toContainText('Your role: Dispatch · Managing as Zed Supply staff');
  await expect(page.getByLabel('Role for Packer')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send invitation', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel invitation for later@example.test' })).toBeVisible();
});

test('a signed-in seller applies from Sell on Zed Supply', async ({page}) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const calls = await setup(page); await signIn(page);
  await page.goto('/index.html?demo=0#/sell');
  await expect(page.getByRole('heading',{name:'Seller application'})).toBeVisible();
  await expect(page.getByLabel('Contact person *')).toHaveValue('Verified Buyer');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.getByLabel('Business name *').fill('Kafue Solar Traders');
  await page.getByLabel('Phone or WhatsApp *').fill('0977 123456');
  await page.locator('#ap-town').fill('Kafue');
  await page.getByLabel('Solar, Power & Energy').check();
  await page.getByLabel(/I agree that Zed Supply may use these details/).check();
  await page.getByRole('button',{name:'Send application',exact:true}).click();
  await expect.poll(() => calls.find(c => c.path === '/rest/v1/rpc/submit_seller_application')?.body).toEqual({business:'Kafue Solar Traders',contact_name:'Verified Buyer',
    phone:'0977 123456',town:'Kafue',pacra:null,categories:['Solar, Power & Energy'],about:null});
  expect(calls.some(c => c.path.includes('formspree') || c.path.includes('wa.me'))).toBe(false);
  expect(errors).toEqual([]);
});
test('an applicant sees a request for more information and updates the application', async ({page}) => {
  const calls = await setup(page, { applications: [{ ...application, status: 'info_needed', staff_note: 'Please add your PACRA number.' }] });
  await signIn(page);
  const box = page.locator('#seller-application');
  await expect(box).toContainText('More information needed');
  await expect(box).toContainText('Please add your PACRA number.');
  await box.getByRole('link',{name:'Update your application'}).click();
  await expect(page.getByRole('heading',{name:'Update your application'})).toBeVisible();
  await expect(page.getByLabel('Business name *')).toHaveValue('Kafue Solar Traders');
  await expect(page.getByLabel('Solar, Power & Energy')).toBeChecked();
  page.once('dialog', d => d.accept());
  await page.getByRole('button',{name:'Withdraw application',exact:true}).click();
  await expect.poll(() => calls.find(c => c.path === '/rest/v1/rpc/withdraw_seller_application')?.body).toEqual({application:'app-1'});
});
test('the staff queue pages through applications and searches them', async ({page}) => {
  const many = Array.from({length: 26}, (_, i) => ({ ...application, id: 'app-' + i, business: 'Shop number ' + i }));
  const calls = await setup(page, { staff: true, applications: many }); await signIn(page);
  const reads = () => calls.filter(c => c.path === '/rest/v1/seller_applications' && !c.query.includes('user_id=eq.')).map(c => decodeURIComponent(c.query));
  await page.goto('/index.html?demo=0#/staff-applications');
  await expect(page.locator('main article')).toHaveCount(25);
  expect(reads().at(-1)).toContain('status=in.(new,review)');
  expect(reads().at(-1)).toContain('order=created_at.asc,id.asc&limit=26&offset=0');
  await expect(page.locator('main')).toContainText('Showing 1–25, oldest first.');
  await page.getByRole('link',{name:'Next page',exact:true}).click();
  await expect.poll(() => reads().at(-1)).toContain('offset=25');
  await expect(page.getByRole('link',{name:'Previous page',exact:true})).toBeVisible();
  await page.getByRole('link',{name:'Awaiting applicant',exact:true}).click();
  await expect.poll(() => reads().at(-1)).toContain('status=in.(info_needed)');
  await page.getByRole('searchbox',{name:'Search applications'}).fill('0977 123456');
  await page.getByRole('button',{name:'Search applications',exact:true}).click();
  await expect.poll(() => reads().at(-1)).toContain('or=(business.ilike."*0977 123456*",contact_name.ilike."*0977 123456*",email.ilike."*0977 123456*",phone.ilike."*977123456*",town.ilike."*0977 123456*",pacra.ilike."*0977 123456*")');
  expect(reads().at(-1)).toContain('offset=0');
  await page.getByRole('searchbox',{name:'Search applications'}).fill('Kafue, (x)"');
  await page.getByRole('button',{name:'Search applications',exact:true}).click();
  await expect.poll(() => reads().at(-1)).toContain('business.ilike."*Kafue x*"');
  await page.getByRole('searchbox',{name:'Search applications'}).fill('shop.co');
  await page.getByRole('button',{name:'Search applications',exact:true}).click();
  await expect.poll(() => reads().at(-1)).toContain('email.ilike."*shop.co*"');
});
test('staff review, ask about and approve seller applications', async ({page}) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const calls = await setup(page, { staff: true, applications: [application] }); await signIn(page);
  await page.getByRole('link',{name:'Seller applications',exact:true}).click();
  const card = page.locator('article', { hasText: 'Kafue Solar Traders' });
  await expect(card).toContainText('+260977123456');
  await expect(card).toContainText('Received');
  await card.getByRole('button',{name:'Mark under review'}).click();
  await expect.poll(() => calls.find(c => c.path === '/rest/v1/rpc/staff_review_application')?.body).toEqual({application:'app-1',decision:'review',note:null});
  await expect(card.getByRole('button',{name:'Mark under review'})).toBeEnabled();
  await card.getByLabel('Message to the applicant',{exact:true}).fill('Please add your PACRA number.');
  await card.getByRole('button',{name:'Ask for more information'}).click();
  await expect.poll(() => calls.filter(c => c.path === '/rest/v1/rpc/staff_review_application')[1]?.body).toEqual({application:'app-1',decision:'info_needed',note:'Please add your PACRA number.'});
  await expect(card.getByLabel('Store ID (used in web addresses)')).toHaveValue('kafue-solar-traders');
  await card.getByRole('button',{name:'Approve and open store'}).click();
  await expect.poll(() => calls.find(c => c.path === '/rest/v1/rpc/staff_approve_application')?.body).toEqual({application:'app-1',store_id:'kafue-solar-traders',store_name:'Kafue Solar Traders',note:null});
  await page.evaluate(fs.readFileSync(require.resolve('axe-core/axe.min.js'),'utf8'));
  expect(await page.evaluate(async () => (await axe.run('main', { runOnly: { type: 'tag', values: ['wcag2a','wcag2aa','wcag21aa','wcag22aa'] } })).violations.map(v => v.id + ' ' + v.nodes.map(n => n.target).join(';')))).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  expect(errors).toEqual([]);
});

test('a business buyer saves their details once and they go with the order', async ({page}) => {
  test.setTimeout(60000);
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const calls = await setup(page);
  await signIn(page);
  await page.getByLabel('Business name',{exact:true}).fill('Mwila Farms');
  await page.getByLabel('TPIN (optional)').fill('12-34');
  await page.getByRole('button',{name:'Save business details'}).click();
  await expect(page.locator('#biz-form .form-status')).toHaveText('Enter the TPIN as 10 digits, or leave it empty.');
  await expect(page.getByLabel('TPIN (optional)')).toBeFocused();
  await page.getByLabel('TPIN (optional)').fill('1234567890');
  await page.getByLabel('Billing address (optional)').fill('Plot 4, Chongwe');
  await page.getByRole('button',{name:'Save business details'}).click();
  await expect.poll(() => calls.filter(c => c.path === '/rest/v1/rpc/set_business_details').length).toBe(1);
  expect(calls.find(c => c.path === '/rest/v1/rpc/set_business_details').body).toEqual({business:'Mwila Farms',tpin:'1234567890',address:'Plot 4, Chongwe'});
  // The refreshed profile carries them, so the account shows them and checkout fills them in
  await expect(page.getByRole('button',{name:'Remove business details'})).toBeVisible();
  await expect(page.getByLabel('Business name',{exact:true})).toHaveValue('Mwila Farms');
  await page.goto('/index.html?demo=0#/search?q=lamp');
  await page.locator('.ptitle').click();
  await page.getByRole('button',{name:'Add to cart',exact:true}).click();
  await page.goto('/index.html?demo=0#/cart');
  await expect(page.getByLabel("I'm buying for a business")).toBeChecked();
  await expect(page.getByLabel('Business name *')).toHaveValue('Mwila Farms');
  await page.getByRole('link',{name:'Review server total',exact:true}).click();
  await page.getByRole('button',{name:/Place order for/}).click();
  await expect.poll(() => calls.filter(c => c.path === '/functions/v1/place-order').length).toBe(1);
  const order = calls.find(c => c.path === '/functions/v1/place-order').body;
  expect([order.business_name, order.business_tpin, order.business_address]).toEqual(['Mwila Farms','1234567890','Plot 4, Chongwe']);
  expect(errors).toEqual([]);
});
