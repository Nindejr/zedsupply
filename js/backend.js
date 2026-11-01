/* Verified Supabase sessions and server catalogue/checkout. No SDK, secret key or live activation. */
(function () {
  'use strict';
  function create(options) {
    var cfg = options.config, fetcher = options.fetch, storage = options.storage, session = null, profile = null, refresh = null;
    function enabled() { return cfg.enabled === true && /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(cfg.url || '') && !!cfg.key; }
    function save(value) { if (value && !value.expires_at) value.expires_at = Math.floor(Date.now() / 1000) + Number(value.expires_in || 0); session = value; if (!value) profile = null; try { if (value) storage.setItem('zs-auth-session', JSON.stringify(value)); else storage.removeItem('zs-auth-session'); } catch (e) { /* memory-only session */ } }
    async function request(path, body, authenticated, method) {
      if (!enabled()) throw new Error('Secure services are not activated.');
      if (authenticated) await accessToken();
      var headers = { apikey: cfg.key, 'content-type': 'application/json' };
      if (session && session.access_token) headers.authorization = 'Bearer ' + session.access_token;
      var res = await fetcher(cfg.url.replace(/\/$/, '') + path, { method: method || (body === undefined ? 'GET' : 'POST'),
        headers: headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store', signal: AbortSignal.timeout(20000) });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok) {
        if (res.status === 401) save(null);
        var error = new Error(data.error_description || data.msg || data.message || data.error || 'The service could not complete your request.'); error.status = res.status; throw error;
      }
      return data;
    }
    async function accessToken() {
      if (!session) throw new Error('Sign in with a verified account first.');
      if (Number(session.expires_at) * 1000 > Date.now() + 60000) return session.access_token;
      if (!refresh) refresh = request('/auth/v1/token?grant_type=refresh_token', { refresh_token: session.refresh_token }, false).then(function (data) { save(data); return data.access_token; }).catch(function (e) { save(null); throw e; }).finally(function () { refresh = null; });
      return refresh;
    }
    async function identity() {
      await accessToken();
      var user = await request('/auth/v1/user', undefined, true);
      if (!user.email_confirmed_at && !user.phone_confirmed_at) { save(null); throw new Error('Confirm your email or phone before continuing.'); }
      var rows = await request('/rest/v1/users?select=id,name,email,phone,is_staff&auth_id=eq.' + encodeURIComponent(user.id), undefined, true);
      if (!rows[0]) throw new Error('Your verified account is not linked yet. Please contact support.');
      profile = rows[0]; profile.auth_id = user.id; return profile;
    }
    async function initialize() {
      if (!enabled()) return;
      try { session = JSON.parse(storage.getItem('zs-auth-session') || 'null'); } catch (e) { session = null; }
      if (session) { try { await identity(); } catch (e) { save(null); } }
    }
    return {
      enabled: enabled, initialize: initialize, profile: function () { return profile; }, identity: identity,
      sendCode: function (email, name) { return request('/auth/v1/otp', { email: email, create_user: true, data: { name: name } }, false); },
      verifyCode: async function (email, code) { save(await request('/auth/v1/verify', { email: email, token: code, type: 'email' }, false)); return identity(); },
      signOut: async function () { try { if (session) await request('/auth/v1/logout', {}, true); } finally { save(null); } },
      rpc: function (name, body) { return request('/rest/v1/rpc/' + name, body, name !== 'catalogue_page'); },
      read: function (query) { return request('/rest/v1/' + query, undefined, true); },
      write: function (table, body) { return request('/rest/v1/' + table, body, true); },
      placeOrder: function (body) { return request('/functions/v1/place-order', body, true); },
      startPayment: function (body) { return request('/functions/v1/start-payment', body, true); },
      uploadProof: async function (file) {
        if (!profile || !file || file.size > 5242880 || ['image/jpeg','image/png','image/webp','application/pdf'].indexOf(file.type) === -1) throw new Error('Choose a JPEG, PNG, WebP or PDF under 5 MB.');
        await accessToken();
        var extension = file.type === 'application/pdf' ? 'pdf' : file.type.split('/')[1];
        var name = profile.auth_id + '/' + crypto.randomUUID() + '.' + extension;
        var response = await fetcher(cfg.url + '/storage/v1/object/delivery-proofs/' + name, { method: 'POST', headers: { apikey: cfg.key, authorization: 'Bearer ' + session.access_token, 'content-type': file.type }, body: file, cache: 'no-store', signal: AbortSignal.timeout(30000) });
        if (!response.ok) throw new Error('The private delivery evidence could not be uploaded.'); return name;
      }
    };
  }
  function mapProduct(row) {
    var options = { extra: [] }, axes = {}, values = {};
    (row.options || []).forEach(function (axis) {
      var key = axis.kind === 'custom' ? 'custom_' + axis.id : axis.kind;
      axes[axis.id] = key;
      (axis.values || []).forEach(function (v) { values[v.id] = v.label; });
      if (key === 'colour') options.colour = (axis.values || []).map(function (v) { return { name: v.label, hex: v.hex }; });
      else if (key === 'size') options.size = (axis.values || []).map(function (v) { return v.label; });
      else options.extra.push({ key: key, name: axis.name, values: (axis.values || []).map(function (v) { return v.label; }) });
    });
    var variants = (row.variants || []).map(function (v) {
      var out = { sku: v.sku, stock: v.stock_qty, priceZMW: Number(v.price_zmw) || 0, image: v.image || '' };
      (v.values || []).forEach(function (x) { out[axes[x.option_id]] = values[x.value_id]; }); return out;
    });
    return { id: row.id, title: row.title, category: row.department_id, sub: row.subcategory_id || '', seller: row.seller_id,
      brand: row.brand_id || '', source: 'local', priceZMW: Number(row.price_zmw), wasZMW: Number(row.was_zmw) || 0,
      stock: row.stock_qty === 0 ? 'out' : row.stock_status, image: row.image || '', alt: row.alt || row.title,
      tags: row.tags || '', description: row.description || '', added: row.added_on, options: options, variants: variants,
      attributes: { condition: row.condition, conditionNotes: row.condition_notes || '', manufacturer: row.manufacturer || '',
        size: row.size_value ? { value: Number(row.size_value), unit: row.size_unit } : null, ageRange: row.age_ranges || [], specs: row.specs || {}, features: row.key_features || [] },
      inBox: (row.components || []).map(function (c) { return { item: c.name + (c.quantity > 1 ? ' × ' + c.quantity : ''), addonZMW: c.kind === 'addon' ? Number(c.addon_price_zmw) : null }; }),
      images: (row.images || []).map(function (i) { return { src: i.src, alt: i.alt }; }),
      priceTiers: (row.tiers || []).map(function (t) { return { min: t.min_qty, price: Number(t.price_zmw) }; }),
      reviews: [], _server: row };
  }
  var factory = { create: create, mapProduct: mapProduct };
  if (typeof module !== 'undefined' && module.exports) module.exports = factory;
  if (typeof window !== 'undefined') {
    var store; try { store = window.sessionStorage; } catch (e) { store = { getItem: function () {}, setItem: function () {}, removeItem: function () {} }; }
    window.ZSBackend = create({ config: (window.ZS_CATALOGUE.settings.api || {}), fetch: window.fetch.bind(window), storage: store });
    window.ZSBackend.mapProduct = mapProduct;
  }
})();
