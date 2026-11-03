/* Connected buyer journeys. Demo mode always retains its isolated sample experience. */
(function () {
  'use strict';
  var ext = window.ZSExt = window.ZSExt || { hooks: {}, views: {} }, B = window.ZSBackend, ready = {}, navigation = 0;
  function Z() { return window.ZS; }
  function active() { return B && B.enabled() && Z() && !Z().S.isSample; }
  function esc(value) { return Z().esc(value); }
  function errorHTML(error) { return '<p class="form-status is-error" role="alert">' + esc(error.message) + '</p>'; }
  function show(body, title) { Z().show(Z().crumbs([[title]]) + Z().head(esc(title)) + body, title); }
  function account() {
    var p = B.profile();
    if (p) {
      show('<section class="card"><h2>Hello, ' + esc(p.name || p.email || 'shopper') + '</h2><p>Your contact is verified. Orders and support requests below are stored securely for this account.</p>' +
        '<div class="btn-row"><a class="btn btn--primary" href="#/orders">Your orders</a><a class="btn btn--secondary" href="#/complaints">Support requests</a><a class="btn btn--secondary" href="#/team">Store team</a><a class="btn btn--secondary" href="#/fulfilment">Store fulfilment</a>' + (p.is_staff ? '<a class="btn btn--secondary" href="#/staff-support">Staff support queue</a>' : '') + '<a class="btn btn--secondary" href="#/device">Data on this device</a>' +
        '<button class="btn btn--secondary" id="secure-signout" type="button">Sign out</button></div><p class="form-status" role="status"></p></section><div id="team-invites"></div>', 'My Account');
      teamInvites();
      document.getElementById('secure-signout').onclick = async function () { this.disabled = true; try { await B.signOut(); } catch (e) { /* local tokens are cleared even when logout is unavailable */ } ready = {}; Z().refreshCounts(); Z().route(); };
      return;
    }
    show('<div class="duo"><form class="form form--card" id="secure-signin"><h2>Sign in with a one-time code</h2><p>We send a code to your email. Your session stays in this tab until you sign out or close it.</p>' +
      '<div class="field"><label for="secure-name">Your name</label><input id="secure-name" autocomplete="name" maxlength="60" required></div>' +
      '<div class="field"><label for="secure-email">Email</label><input id="secure-email" type="email" autocomplete="email" maxlength="254" required></div>' +
      '<button class="btn btn--primary" type="submit">Send code</button><p class="form-status" role="status"></p></form>' +
      '<form class="form form--card" id="secure-verify" hidden><h2>Enter your code</h2><label for="secure-code">Email code</label><input id="secure-code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6,10}" maxlength="10" required>' +
      '<button class="btn btn--primary" type="submit">Verify and sign in</button><p class="form-status" role="status"></p></form></div>', 'My Account');
    var email = '';
    bind('secure-signin', async function (form) {
      email = document.getElementById('secure-email').value.trim();
      await B.sendCode(email, document.getElementById('secure-name').value.trim());
      form.querySelector('[role="status"]').textContent = 'If delivery is available, your code is on its way. Check your inbox and spam folder.';
      document.getElementById('secure-verify').hidden = false; document.getElementById('secure-code').focus();
    });
    bind('secure-verify', async function () { await B.verifyCode(email, document.getElementById('secure-code').value.trim()); Z().refreshCounts(); Z().route(); });
  }
  function bind(id, action) {
    var form = document.getElementById(id);
    form.onsubmit = async function (e) {
      e.preventDefault(); var button = form.querySelector('button[type="submit"]'), status = form.querySelector('[role="status"]');
      button.disabled = true; status.textContent = '';
      try { await action(form); } catch (err) { status.textContent = err.message; status.classList.add('is-error'); }
      finally { button.disabled = false; }
    };
  }
  function requireUser() { if (B.profile()) return true; show('<p>Sign in to see your secure account records.</p><a class="btn btn--primary" href="#/account">Sign in</a>', 'Sign in required'); return false; }
  ext.hooks.serverCheckout = function (checkout) {
    if (!active()) return;
    var box = document.getElementById('server-checkout-review');
    if (!B.profile()) { box.innerHTML = '<p><a href="#/account">Sign in with a verified account to place this order.</a></p>'; return; }
    if (!/^\+?260\d{9}$/.test(checkout.recipient_phone)) { box.innerHTML = '<p role="alert">Enter a recipient phone number in +260 format.</p>'; return; }
    var payload = Object.assign({}, checkout);
    try {
      payload.items = checkout.items.map(function (it) {
        var row = it.p._server;
        if (!row) throw new Error('Reload this listing from the server before ordering.');
        var variant = (row.variants || []).find(function (v) { return v.sku === it.sku; });
        if (it.opt && it.opt.commit && !it.opt.commitmentId) throw new Error('A proposed price needs an accepted seller offer before checkout.');
        if ((row.options || []).length && !variant) throw new Error('Choose an available variation for each item.');
        return { product_id: row.id, variant_id: variant ? variant.id : null, quantity: it.qty,
          addons: ((it.opt && it.opt.addons) || []).map(function (i) { var component = row.components[i]; if (!component || component.kind !== 'addon') throw new Error('Review your selected add-ons.'); return component.id; }),
          commitment_id: it.opt && it.opt.commitmentId || null };
      });
    } catch (e) { box.innerHTML = errorHTML(e); return; }
    var quoteId = ++navigation;
    box.innerHTML = '<p role="status">Checking current prices and stock…</p>';
    B.rpc('checkout_quote', { p: payload }).then(function (quote) {
      if (quoteId !== navigation || !box.isConnected) return;
      box.innerHTML = '<section class="notice"><h3>Review your server total</h3><p>Items and applicable tax: <strong>' + Z().kwacha(Number(quote.total)) + '</strong></p>' +
        '<p>' + (quote.delivery_pending ? 'Delivery is still to be confirmed. This is not a final delivered price; payment stays unavailable until delivery is quoted.' : 'Collection order. Delivery is not required.') + '</p>' +
        '<p>Stock is checked again when you place the order.</p><button class="btn btn--primary" type="button" id="confirm-server-order">Place order for ' + Z().kwacha(Number(quote.total)) + ' in items</button><p role="status"></p></section>';
      payload.expected_total_zmw = Number(quote.total);
      document.getElementById('confirm-server-order').onclick = async function () {
        var button = this, status = box.querySelector('[role="status"]'); button.disabled = true;
        try {
          var order = await B.placeOrder(payload);
          Z().clearCheckout(); location.hash = '#/order/' + encodeURIComponent(order.ref);
        } catch (e) { status.textContent = e.message + ' Retry uses the same order reference.'; button.disabled = false; }
      };
    }).catch(function (error) { if (quoteId === navigation && box.isConnected) box.innerHTML = errorHTML(error); });
  };
  function invalidateQuote(e) {
    if (!active() || !e.target.closest('#checkout-steps')) return;
    var box = document.getElementById('server-checkout-review');
    if (box && box.innerHTML) { navigation++; box.innerHTML = '<p>Order details changed. Review the server total again before placing it.</p>'; }
  }
  document.addEventListener('input', invalidateQuote); document.addEventListener('change', invalidateQuote);
  async function catalogue(path, query, ticket) {
    var department = path[0] === 'dept' ? path[1] : query.get('dept') || null, term = query.get('q') || '', after = query.get('after') || '';
    var rows = await B.rpc('catalogue_page', { search: term, department: department, after_id: after, page_size: 25 });
    if (ticket !== navigation) return;
    var more = rows.length > 24; rows = rows.slice(0, 24); Z().ingest(rows);
    var title = term ? 'Results for “' + term + '”' : department ? Z().dept(department).name : 'Search products';
    show('<form class="form" id="server-search"><div class="field"><label for="server-query">Search products</label><input id="server-query" maxlength="100" value="' + esc(term) + '"></div>' +
      '<div class="field"><label for="server-dept">Department</label><select id="server-dept"><option value="">All departments</option>' + Z().D.departments.map(function (d) { return '<option value="' + esc(d.id) + '"' + (d.id === department ? ' selected' : '') + '>' + esc(d.name) + '</option>'; }).join('') + '</select></div>' +
      '<button class="btn btn--primary" type="submit">Search</button></form><p role="status">' + (rows.length ? 'Showing ' + rows.length + ' results on this page.' : 'No matching listings. Try fewer words or another department.') + '</p>' +
      '<ul class="grid">' + Z().cards(rows.map(function (r) { return Z().product(r.id); })) + '</ul>' +
      (more ? '<a class="btn btn--secondary" href="#/search?q=' + encodeURIComponent(term) + (department ? '&dept=' + encodeURIComponent(department) : '') + '&after=' + encodeURIComponent(rows[rows.length - 1].id) + '">Next page</a>' : ''), title);
    document.getElementById('server-search').onsubmit = function (e) { e.preventDefault(); location.hash = '#/search?q=' + encodeURIComponent(document.getElementById('server-query').value.trim()) + '&dept=' + encodeURIComponent(document.getElementById('server-dept').value); };
  }
  async function orders(ref, ticket) {
    if (!requireUser()) return;
    var rows = await B.read('orders?select=id,ref,status,created_at,total_zmw,delivery_zmw,paid_zmw,payment_status,fulfilment,order_items(id,product_id,quantity,unit_price_zmw,order_item_addons(price_zmw))&user_id=eq.' + B.profile().id + (ref ? '&ref=eq.' + encodeURIComponent(ref) : '') + '&order=created_at.desc&limit=50');
    if (ticket !== navigation) return;
    if (!ref) { show('<ul class="orders">' + rows.map(function (o) { return '<li><a class="order-row" href="#/order/' + encodeURIComponent(o.ref) + '"><strong>' + esc(o.ref) + '</strong><span>' + esc(o.status) + ' · ' + Z().kwacha(Number(o.total_zmw) + Number(o.delivery_zmw || 0)) + '</span></a></li>'; }).join('') + '</ul>' + (!rows.length ? '<p>No server orders yet.</p>' : ''), 'Your orders'); return; }
    var o = rows[0]; if (!o) throw new Error('No order was found for your account.');
    var events = await B.read('shipment_events?select=id,status,tracking_ref,note,created_at&order_id=eq.' + o.id + '&order=created_at.asc&limit=100');
    var refunds = await B.read('refund_events?select=amount_zmw,payments!inner(order_id)&payments.order_id=eq.' + o.id + '&limit=100');
    if (ticket !== navigation) return;
    show('<section class="card"><h2>' + esc(o.ref) + '</h2><p>Order: ' + esc(o.status) + ' · Payment: ' + esc(o.payment_status) + '</p><dl class="totals"><div><dt>Items total</dt><dd>' + Z().kwacha(Number(o.total_zmw)) + '</dd></div><div><dt>Delivery</dt><dd>' + (o.delivery_zmw === null ? 'Awaiting confirmation; no final payment total yet' : Z().kwacha(Number(o.delivery_zmw))) + '</dd></div><div><dt>Paid</dt><dd>' + Z().kwacha(Number(o.paid_zmw)) + '</dd></div></dl>' +
      '<ul>' + o.order_items.map(function (i) { return '<li>' + esc(i.product_id) + ' × ' + i.quantity + ' · ' + Z().kwacha((Number(i.unit_price_zmw) + i.order_item_addons.reduce(function (sum, a) { return sum + Number(a.price_zmw); }, 0)) * i.quantity) + '</li>'; }).join('') + '</ul>' +
      '<p>Reconciled refunds: ' + Z().kwacha(refunds.reduce(function (sum, r) { return sum + Number(r.amount_zmw); }, 0)) + '</p>' +
      '<h2>Delivery updates</h2><ol>' + events.map(function (ev) { return '<li>' + esc(ev.status) + ' · ' + esc(ev.tracking_ref || '') + '<p>' + esc(ev.note || '') + '</p></li>'; }).join('') + '</ol>' + (!events.length ? '<p>No delivery updates have been recorded yet.</p>' : '') +
      '<a class="btn btn--secondary" href="#/complaints?order=' + encodeURIComponent(o.ref) + '">Return or report a problem</a>' +
      ((Z().S.payments || {}).prompt && (o.fulfilment === 'collection' || o.delivery_zmw !== null) && o.status !== 'cancelled' && Number(o.total_zmw) + Number(o.delivery_zmw || 0) > Number(o.paid_zmw) ? '<form id="server-pay" class="form"><label for="pay-phone">Mobile number (+260…)</label><input id="pay-phone" type="tel" required pattern="\\+?260[0-9]{9}"><button type="submit" class="btn btn--primary">Request payment prompt</button><p role="status"></p></form>' : '') + '</section>', 'Order ' + o.ref);
    // One key per page view: a retry after a dropped connection replays the same request.
    var attemptKey = 'PAY-' + crypto.randomUUID();
    if (document.getElementById('server-pay')) bind('server-pay', async function (form) { await B.startPayment({ order_ref: o.ref, phone: document.getElementById('pay-phone').value, attempt_key: attemptKey }); form.querySelector('[role="status"]').textContent = 'Payment request submitted. Do not repeat it while its status is being confirmed.'; });
  }
  async function support(query, ticket) {
    if (!requireUser()) return;
    var records = await B.read('complaints?select=id,ref,status,details,reply_due_at,escalated_at,complaint_messages(author,body,created_at)&user_id=eq.' + B.profile().id + '&order=created_at.desc&limit=50');
    if (ticket !== navigation) return;
    show('<form class="form form--card" id="server-case"><h2>Return or report a problem</h2><p>Your request is saved to your account. Staff will review the details before approving a return or refund.</p>' +
      '<label for="case-order">Order reference (optional)</label><input id="case-order" value="' + esc(query.get('order') || '') + '" maxlength="15">' +
      '<label for="case-type">What happened?</label><select id="case-type"><option value="not_received">Order not received</option><option value="damaged">Item damaged</option><option value="wrong">Wrong item</option><option value="faulty">Item faulty</option><option value="other">Other problem</option></select>' +
      '<label for="case-details">Details</label><textarea id="case-details" minlength="10" maxlength="1000" required></textarea><label for="case-want">Preferred outcome</label><select id="case-want"><option value="refund">Refund</option><option value="replace">Replacement</option><option value="repair">Repair</option><option value="fix">Help resolving the issue</option></select>' +
      '<button class="btn btn--primary" type="submit">Send request</button><p class="form-status" role="status"></p></form>' +
      '<section class="section"><h2>Your requests</h2>' + records.map(function (c) { return '<article class="card"><h3>' + esc(c.ref) + ' · ' + esc(c.status) + '</h3><p>' + esc(c.details) + '</p>' + (c.reply_due_at ? '<p>Reply due: ' + esc(new Date(c.reply_due_at).toLocaleDateString('en-GB')) + '</p>' : '') +
        (c.complaint_messages || []).map(function (m) { return '<p><strong>' + esc(m.author) + ':</strong> ' + esc(m.body) + '</p>'; }).join('') +
        (!/resolved|closed/.test(c.status) && !c.escalated_at ? '<button class="btn btn--secondary" type="button" data-escalate-case="' + c.id + '">Ask staff to review</button>' : '') + '</article>'; }).join('') + '</section>', 'Support requests');
    bind('server-case', async function () { await B.rpc('open_support_case', { order_ref: document.getElementById('case-order').value.trim() || null, problem: document.getElementById('case-type').value, outcome: document.getElementById('case-want').value, detail: document.getElementById('case-details').value.trim() }); Z().route(); });
    document.querySelectorAll('[data-escalate-case]').forEach(function (button) { button.onclick = async function () { button.disabled = true; try { await B.rpc('escalate_support_case', { case_id: Number(button.dataset.escalateCase) }); Z().route(); } catch (e) { Z().toast(esc(e.message)); button.disabled = false; } }; });
  }
  async function fulfilment(ticket) {
    if (!requireUser()) return;
    var members = await B.read('seller_members?select=seller_id&user_id=eq.' + B.profile().id);
    if (ticket !== navigation) return;
    if (!members.length && !B.profile().is_staff) throw new Error('This account has no store fulfilment role.');
    show('<form class="form form--card" id="shipment-form"><h2>Record a shipment event</h2><p>Record actual events only. Delivery and collection require private receipt evidence; stock and payout decisions are checked by the server.</p>' +
      '<label for="shipment-order">Order reference</label><input id="shipment-order" required maxlength="15">' +
      '<label for="shipment-store">Store ID</label><input id="shipment-store" required value="' + esc(members[0] ? members[0].seller_id : '') + '">' +
      '<label for="shipment-state">Event</label><select id="shipment-state"><option value="packed">Packed</option><option value="dispatched">Dispatched</option><option value="delivery_failed">Delivery failed</option><option value="delivered">Delivered</option><option value="collected">Collected</option></select>' +
      '<label for="shipment-tracking">Tracking reference (optional)</label><input id="shipment-tracking" maxlength="120">' +
      '<label for="shipment-note">Buyer-visible note (optional)</label><textarea id="shipment-note" maxlength="500"></textarea>' +
      '<label for="shipment-proof">Private receipt evidence (required for delivery or collection)</label><input id="shipment-proof" type="file" accept="image/jpeg,image/png,image/webp,application/pdf">' +
      '<button class="btn btn--primary" type="submit">Save event</button><p class="form-status" role="status"></p></form>', 'Store fulfilment');
    bind('shipment-form', async function (form) {
      var state = document.getElementById('shipment-state').value, evidence = null;
      if (state === 'delivered' || state === 'collected') evidence = await B.uploadProof(document.getElementById('shipment-proof').files[0]);
      await B.rpc('record_shipment', { order_ref: document.getElementById('shipment-order').value.trim(), store_id: document.getElementById('shipment-store').value.trim(), new_status: state,
        tracking: document.getElementById('shipment-tracking').value.trim() || null, message: document.getElementById('shipment-note').value.trim() || null, evidence: evidence });
      form.querySelector('[role="status"]').textContent = 'Shipment event saved.';
    });
  }
  /* ---------- Store teams ---------- */
  // Roles come from js/marketplace.js (ZSExt.teamRoles); the server checks them (migration 020).
  function teamEvent(l) {
    var who = esc(l.subject), by = esc(l.actor), role = esc(roleName(l.role));
    return { invited: by + ' invited ' + who + ' as ' + role, invite_cancelled: by + ' cancelled the invitation for ' + who, joined: who + ' joined as ' + role,
      declined: who + ' declined the invitation', role_changed: by + ' made ' + who + ' ' + role, removed: by + ' removed ' + who, left: who + ' left the team' }[l.action] || esc(l.action);
  }
  function roleName(id) { var r = (ext.teamRoles || []).filter(function (x) { return x[0] === id; })[0]; return r ? r[1] : id; }
  function roleOptions(chosen) { return (ext.teamRoles || []).map(function (r) { return '<option value="' + r[0] + '"' + (r[0] === chosen ? ' selected' : '') + '>' + esc(r[1]) + '</option>'; }).join(''); }
  function when(value) { return esc(new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })); }
  function rpcButton(button, name, body, done) {
    button.disabled = true;
    B.rpc(name, body).then(done).catch(function (e) { Z().toast(esc(e.message)); button.disabled = false; });
  }
  // Invitations for this account's confirmed email, shown on My Account
  function teamInvites() {
    B.rpc('my_seller_invites', {}).then(function (list) {
      var box = document.getElementById('team-invites');
      if (!box || !list.length) return;
      box.innerHTML = '<section class="card"><h2>Store invitations</h2><ul class="orders">' + list.map(function (i) {
        return '<li class="order-row"><span><strong>' + esc(i.store) + '</strong> invited you to join as <strong>' + esc(roleName(i.role)) + '</strong><br><span class="pmeta">Expires ' + when(i.expires_at) + '</span></span>' +
          '<span class="btn-row"><button class="btn btn--primary btn--sm" type="button" data-invite-accept="' + esc(i.id) + '">Accept</button><button class="btn btn--secondary btn--sm" type="button" data-invite-decline="' + esc(i.id) + '">Decline</button></span></li>';
      }).join('') + '</ul></section>';
      box.querySelectorAll('[data-invite-accept]').forEach(function (b) { b.onclick = function () { rpcButton(b, 'seller_respond_invite', { invite: b.dataset.inviteAccept, accept: true }, function (sid) { Z().toast('You\'ve joined the team'); location.hash = '#/team/' + encodeURIComponent(sid); }); }; });
      box.querySelectorAll('[data-invite-decline]').forEach(function (b) { b.onclick = function () { rpcButton(b, 'seller_respond_invite', { invite: b.dataset.inviteDecline, accept: false }, function () { Z().toast('Invitation declined'); Z().route(); }); }; });
    }).catch(function () { /* the account page works without its invitations */ });
  }
  async function team(storeId, ticket) {
    if (!requireUser()) return;
    var me = B.profile(), mine = await B.read('seller_members?select=seller_id,role&user_id=eq.' + me.id);
    if (ticket !== navigation) return;
    var sid = storeId || (mine.length === 1 ? mine[0].seller_id : '');
    if (!sid) {
      if (!mine.length && !me.is_staff) throw new Error('This account isn\'t on a store team. Ask the store owner to invite your email address, then sign in with it to accept.');
      show((mine.length ? '<ul class="orders">' + mine.map(function (m) { return '<li><a class="order-row" href="#/team/' + encodeURIComponent(m.seller_id) + '"><strong>' + esc(m.seller_id) + '</strong><span>' + esc(roleName(m.role)) + '</span></a></li>'; }).join('') + '</ul>' : '') +
        (me.is_staff ? '<form class="form form--card" id="team-open"><h2>Open a store\'s team</h2><label for="team-store">Store ID</label><input id="team-store" required maxlength="60"><button class="btn btn--primary" type="submit">Open</button><p class="form-status" role="status"></p></form>' : ''), 'Store team');
      if (me.is_staff) bind('team-open', async function () { location.hash = '#/team/' + encodeURIComponent(document.getElementById('team-store').value.trim()); });
      return;
    }
    var t = await B.rpc('seller_team', { sid: sid });
    if (ticket !== navigation) return;
    var manage = t.my_role === 'owner' || (!t.my_role && me.is_staff);
    show('<p>' + esc(t.store ? t.store.name : sid) + ' · ' + (t.my_role ? 'Your role: <strong>' + esc(roleName(t.my_role)) + '</strong>' : 'Viewing as Zed Supply staff') + '</p>' +
      '<section class="card"><h2>People on this team</h2><ul class="orders">' + t.members.map(function (m) {
        var label = esc(m.name) + (m.you ? ' (you)' : '');
        return '<li class="order-row"><span><strong>' + label + '</strong><br><span class="pmeta">' + (m.email ? esc(m.email) + ' · ' : '') + esc(roleName(m.role)) + ' · since ' + when(m.added_at) + '</span></span><span class="btn-row">' +
          (manage ? '<label class="visually-hidden" for="team-role-' + m.user_id + '">Role for ' + label + '</label><select id="team-role-' + m.user_id + '" data-team-role="' + m.user_id + '">' + roleOptions(m.role) + '</select>' : '') +
          (m.you ? '<button class="btn btn--secondary btn--sm" type="button" data-team-remove="' + m.user_id + '">Leave team</button>'
            : manage ? '<button class="btn btn--secondary btn--sm" type="button" data-team-remove="' + m.user_id + '">Remove<span class="visually-hidden"> ' + label + '</span></button>' : '') + '</span></li>';
      }).join('') + '</ul><p class="hint">A store always keeps at least one owner. Make someone else an owner before you step down or leave.</p></section>' +
      (manage ? '<div class="duo duo--gap"><form class="form form--card" id="team-invite"><h2>Invite someone</h2><p>They sign in at My Account with this email and accept within 7 days. A store can have up to 20 people, counting open invitations.</p>' +
        '<label for="team-email">Email</label><input id="team-email" type="email" required maxlength="254" autocomplete="off">' +
        '<label for="team-new-role">Role</label><select id="team-new-role">' + roleOptions('listings') + '</select>' +
        '<button class="btn btn--primary" type="submit">Send invitation</button><p class="form-status" role="status"></p></form>' +
        '<section class="card"><h2>Open invitations</h2>' + (t.invites.length ? '<ul class="orders">' + t.invites.map(function (i) {
          return '<li class="order-row"><span><strong>' + esc(i.email) + '</strong><br><span class="pmeta">' + esc(roleName(i.role)) + ' · expires ' + when(i.expires_at) + '</span></span><button class="btn btn--secondary btn--sm" type="button" data-team-cancel="' + esc(i.id) + '">Cancel<span class="visually-hidden"> invitation for ' + esc(i.email) + '</span></button></li>';
        }).join('') + '</ul>' : '<p>No open invitations.</p>') + '</section></div>' : '') +
      (ext.teamRoleGuide ? ext.teamRoleGuide() : '') +
      (manage && t.log.length ? '<section class="card"><h2>Recent changes</h2><ul>' + t.log.map(function (l) { return '<li>' + when(l.created_at) + ': ' + teamEvent(l) + '</li>'; }).join('') + '</ul></section>' : ''), 'Store team');
    document.querySelectorAll('[data-team-role]').forEach(function (sel) { sel.onchange = function () {
      sel.disabled = true;
      B.rpc('seller_set_member_role', { sid: sid, member: Number(sel.dataset.teamRole), member_role: sel.value }).then(function () { Z().toast('Role updated'); Z().route(); })
        .catch(function (e) { Z().toast(esc(e.message)); Z().route(); });
    }; });
    document.querySelectorAll('[data-team-remove]').forEach(function (b) { b.onclick = function () {
      var self = t.members.some(function (m) { return m.you && String(m.user_id) === b.dataset.teamRemove; });
      if (!window.confirm(self ? 'Leave this store\'s team? You lose access straight away.' : 'Remove this person from the team? They lose access straight away.')) return;
      rpcButton(b, 'seller_remove_member', { sid: sid, member: Number(b.dataset.teamRemove) }, function () { Z().toast(self ? 'You left the team' : 'Removed from the team'); if (self) location.hash = '#/account'; else Z().route(); });
    }; });
    document.querySelectorAll('[data-team-cancel]').forEach(function (b) { b.onclick = function () { rpcButton(b, 'seller_cancel_invite', { invite: b.dataset.teamCancel }, function () { Z().toast('Invitation cancelled'); Z().route(); }); }; });
    if (manage) bind('team-invite', async function () {
      await B.rpc('seller_invite', { sid: sid, invitee_email: document.getElementById('team-email').value.trim(), member_role: document.getElementById('team-new-role').value });
      Z().toast('Invitation saved. Ask them to sign in with that email to accept.'); Z().route();
    });
  }
  async function staffSupport(ticket) {
    if (!requireUser()) return;
    if (!B.profile().is_staff) throw new Error('Staff access is required.');
    var cases = await B.read('complaints?select=id,ref,status,details,escalated_at,assigned_to&status=not.in.(resolved,closed)&order=created_at.asc&limit=100');
    if (ticket !== navigation) return;
    show('<p>Open support requests, oldest first. Assign a case before recording a review. Refund decisions require provider reconciliation; this queue does not send money.</p>' + cases.map(function (c) { return '<article class="card"><h2>' + esc(c.ref) + (c.escalated_at ? ' · Escalated' : '') + '</h2><p>' + esc(c.details) + '</p><p>Assigned staff ID: ' + esc(c.assigned_to || 'Unassigned') + '</p><button class="btn btn--secondary" type="button" data-take-case="' + c.id + '">Assign to me</button></article>'; }).join(''), 'Staff support queue');
    document.querySelectorAll('[data-take-case]').forEach(function (button) { button.onclick = async function () { button.disabled = true; try { await B.rpc('assign_support_case', { case_id: Number(button.dataset.takeCase), staff_user: B.profile().id }); Z().route(); } catch (e) { Z().toast(esc(e.message)); button.disabled = false; } }; });
  }
  ext.hooks.route = function (path, query) {
    if (!active()) return false;
    var ticket = ++navigation;
    if (path[0] === 'account') { account(); return true; }
    if (path[0] === 'cart') {
      var missing = Z().cart().map(function (line) { return line.id; }).filter(function (id) { return !Z().product(id) || !Z().product(id)._server; });
      if (!missing.length) return false;
      show('<p role="status">Refreshing your cart listings…</p>', 'Cart');
      Promise.all(missing.map(function (id) { return B.rpc('catalogue_page', { product_id: id, page_size: 1 }); })).then(function (pages) {
        if (ticket !== navigation) return;
        if (pages.some(function (rows) { return !rows.length; })) throw new Error('An item in your cart is no longer available. Remove it before ordering.');
        Z().ingest([].concat.apply([], pages)); Z().route();
      }).catch(function (e) { if (ticket === navigation) show(errorHTML(e), 'Cart unavailable'); });
      return true;
    }
    if (path[0] === 'seller') { show('<p>Your store team and shipments use secure server records. Listing, promotion and store-detail tools are awaiting their authenticated integration.</p><div class="btn-row"><a class="btn btn--primary" href="#/team">Store team</a><a class="btn btn--secondary" href="#/fulfilment">Store fulfilment</a><a class="btn btn--secondary" href="#/account">My Account</a></div>', 'Seller Centre'); return true; }
    if (['staff', 'addresses', 'alerts'].indexOf(path[0]) !== -1) { show('<p>This account uses secure server records. These management tools are awaiting their authenticated integration.</p><a class="btn btn--secondary" href="#/account">My Account</a>', 'Secure account tools'); return true; }
    if (['search', 'dept', 'orders', 'order', 'complaints', 'product', 'fulfilment', 'staff-support', 'team'].indexOf(path[0]) === -1) return false;
    if (path[0] === 'product' && ready[path[1]]) return false;
    show('<p role="status">Loading secure marketplace data…</p>', 'Loading');
    var action = path[0] === 'team' ? team(path[1] ? decodeURIComponent(path[1]) : '', ticket) : path[0] === 'fulfilment' ? fulfilment(ticket) : path[0] === 'staff-support' ? staffSupport(ticket) : path[0] === 'search' || path[0] === 'dept' ? catalogue(path, query, ticket) : path[0] === 'orders' || path[0] === 'order' ? orders(path[1], ticket) : path[0] === 'complaints' ? support(query, ticket) :
      B.rpc('catalogue_page', { product_id: path[1], page_size: 1 }).then(function (rows) { if (ticket !== navigation) return; if (!rows.length) throw new Error('This listing is not available.'); Z().ingest(rows); ready[path[1]] = true; Z().route(); });
    Promise.resolve(action).catch(function (error) { if (ticket === navigation) show(errorHTML(error) + '<a class="btn btn--secondary" href="#/account">My Account</a>', 'Request unavailable'); });
    return true;
  };
})();
