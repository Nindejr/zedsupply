/* Zed Supply — admin panel sections: dashboard, orders, payments, support, applications,
   listings, delivery prices, messages and the audit log. Loaded before js/admin-app.js, which
   supplies the helpers (A.esc, A.rpc, A.read, A.act, …) and runs them.

   Each section lists which staff roles use it (the owner sees all). Hiding a section is only a
   convenience: the server refuses any action a role doesn't allow. */
(function () {
  'use strict';
  var A = window.ZSAdmin = window.ZSAdmin || { sections: [] };
  function section(id, def) { def.id = id; A.sections.push(def); }
  function e(t) { return A.esc(t); }
  function stale(mine) { return mine !== A.ticket(); }
  function field(id, label, input, hint) { return '<div class="field"><label for="' + id + '">' + label + '</label>' + input + (hint ? '<p class="hint">' + hint + '</p>' : '') + '</div>'; }
  function form(id, inner, button, extra) { return '<form class="form admin-form" id="' + id + '"' + (extra || '') + '>' + inner + '<div class="btn-row">' + button + '</div><p class="form-status" role="status"></p></form>'; }
  function bindAll(selector, attr, handler) { A.$$(selector).forEach(function (el) { el.addEventListener(el.tagName === 'FORM' ? 'submit' : 'click', function (ev) { ev.preventDefault(); handler(el, el.getAttribute(attr), ev); }); }); }
  function empty(text) { return '<p class="admin-empty">' + e(text) + '</p>'; }
  function table(head, rows) {
    return rows.length ? '<div class="cmp admin-table" role="region" tabindex="0" aria-label="' + e(head[0]) + ' list (scrolls sideways)"><table><thead><tr>' + head.map(function (h) { return '<th scope="col">' + e(h) + '</th>'; }).join('') +
      '</tr></thead><tbody>' + rows.join('') + '</tbody></table></div>' : '';
  }

  // ---------- Dashboard ----------
  section('dashboard', { title: 'Dashboard', render: function (arg, q, mine) {
    return A.rpc('staff_dashboard').then(function (c) {
      if (stale(mine)) return;
      A.counts = c;
      var tile = function (n, label, href, warn) { return '<li><a class="admin-tile' + (warn && n ? ' is-warn' : '') + '" href="#/' + href + '"><strong>' + e(n) + '</strong><span>' + e(label) + '</span></a></li>'; };
      A.show('Dashboard', '<ul class="admin-tiles">' +
        tile(c.orders_today, 'Orders today', 'orders') + tile(A.kwacha(c.sales_today), 'Sales today', 'orders') +
        tile(c.to_confirm, 'To confirm', 'orders?status=placed', true) + tile(c.fee_to_quote, 'Delivery fees to quote', 'orders?status=quote', true) +
        tile(c.to_dispatch, 'To dispatch', 'orders?status=confirmed') + tile(c.in_transit, 'On the way', 'orders?status=dispatched') +
        tile(c.payments_to_check, 'Payments to check', 'payments', true) + tile(c.cancellations, 'Cancellation requests', 'orders?status=cancel', true) +
        tile(c.complaints, 'Open complaints', 'support', true) + tile(c.returns, 'Returns in progress', 'support') +
        tile(c.seller_applications, 'Seller applications', 'applications', true) + tile(c.rider_applications, 'Rider applications', 'applications?show=riders', true) +
        tile(c.listings_to_review, 'Listings to review', 'listings', true) + tile(c.messages_failed, 'Messages failed', 'messages?status=failed', true) +
        tile(c.messages_waiting, 'Messages waiting', 'messages?status=queued') + tile(c.staff_actions_today, 'Staff actions today', 'audit') + '</ul>');
    });
  } });

  // ---------- Orders ----------
  var ORDER_FIELDS = 'id,ref,status,created_at,contact_name,recipient_phone,buyer_town,deliver_to,fulfilment,total_zmw,delivery_zmw,paid_zmw,payment_status,payment_method,delivery_speed,delivery_source,heavy_delivery,notes,business_name';
  var STATUS_TABS = [['', 'All'], ['placed', 'To confirm'], ['quote', 'Fee to quote'], ['confirmed', 'To dispatch'], ['dispatched', 'On the way'], ['delivered', 'Delivered'], ['cancel', 'Cancellation requested'], ['cancelled', 'Cancelled']];
  section('orders', { title: 'Orders', roles: ['operations', 'support', 'finance'], badge: function (c) { return c.to_confirm + c.fee_to_quote; }, render: function (ref, q, mine) {
    return ref ? orderDetail(ref, mine) : orderList(q, mine);
  } });
  function orderList(q, mine) {
    var st = q.get('status') || '', term = A.term(q.get('q')), page = Math.max(0, Math.min(999, parseInt(q.get('page'), 10) || 0));
    var filter = st === 'quote' ? '&fulfilment=eq.delivery&delivery_zmw=is.null&status=in.(placed,confirmed)'
      : st === 'cancel' ? '&order_cancellations.status=eq.requested' : st ? '&status=eq.' + encodeURIComponent(st) : '';
    var select = ORDER_FIELDS + (st === 'cancel' ? ',order_cancellations!inner(status)' : '');
    var digits = term.replace(/\D/g, ''), phone = digits.length >= 4 ? digits.replace(/^0/, '') : term;
    var search = term ? '&or=' + encodeURIComponent('(ref.ilike."*' + term + '*",contact_name.ilike."*' + term + '*",recipient_phone.ilike."*' + phone + '*")') : '';
    return A.read('orders?select=' + select + filter + search + '&order=created_at.desc&limit=26&offset=' + page * 25).then(function (rows) {
      if (stale(mine)) return;
      var more = rows.length > 25; rows = rows.slice(0, 25);
      var link = function (s2, p) { return '#/orders?status=' + s2 + (term ? '&q=' + encodeURIComponent(term) : '') + (p ? '&page=' + p : ''); };
      A.show('Orders', '<nav class="chips admin-chips" aria-label="Order status">' + STATUS_TABS.map(function (t) { return '<a class="chip" href="' + link(t[0]) + '"' + (t[0] === st ? ' aria-current="page"' : '') + '>' + e(t[1]) + '</a>'; }).join('') + '</nav>' +
        '<form class="admin-search" id="ad-order-search" role="search"><label for="ad-oq">Find an order</label><input id="ad-oq" type="search" maxlength="80" value="' + e(term) + '" placeholder="Reference, name or phone"><button class="btn btn--secondary btn--sm" type="submit">Search</button>' +
          '<button class="btn btn--secondary btn--sm" type="button" id="ad-order-csv">Download CSV</button></form>' +
        (rows.length ? table(['Order', 'Placed', 'Buyer', 'Total', 'Delivery', 'Status'], rows.map(function (o) {
          return '<tr><th scope="row"><a href="#/orders/' + encodeURIComponent(o.ref) + '">' + e(o.ref) + '</a></th><td>' + A.when(o.created_at) + '</td><td>' + e(o.contact_name || '') + '<br><small>' + e(o.recipient_phone || o.buyer_town || '') + '</small></td>' +
            '<td>' + A.kwacha(Number(o.total_zmw) + Number(o.delivery_zmw || 0)) + '</td><td>' + (o.fulfilment !== 'delivery' ? 'Collection' : o.delivery_zmw == null ? A.status('to quote') : A.kwacha(o.delivery_zmw)) + '</td><td>' + A.status(o.status) + '</td></tr>';
        })) : empty(term ? 'No orders match “' + term + '”.' : 'No orders here.')) +
        (page || more ? '<nav class="btn-row" aria-label="More orders">' + (page ? '<a class="btn btn--secondary btn--sm" href="' + link(st, page - 1) + '">Previous</a>' : '') + (more ? '<a class="btn btn--secondary btn--sm" href="' + link(st, page + 1) + '">Next</a>' : '') + '</nav>' : ''));
      A.$('#ad-order-search').addEventListener('submit', function (ev) { ev.preventDefault(); location.hash = '#/orders?status=' + st + '&q=' + encodeURIComponent(A.term(A.$('#ad-oq').value)); });
      A.$('#ad-order-csv').addEventListener('click', function () {
        var b = this;
        A.act(b, function () { return A.read('orders?select=' + select + filter + search + '&order=created_at.desc&limit=1000'); }, function (all) {
          A.csv('zed-supply-orders-' + new Date().toISOString().slice(0, 10) + '.csv', ['Reference', 'Placed', 'Status', 'Buyer', 'Phone', 'Town', 'Fulfilment', 'Items (K)', 'Delivery (K)', 'Paid (K)', 'Payment'],
            all.map(function (o) { return [o.ref, o.created_at, o.status, o.contact_name, o.recipient_phone, o.buyer_town, o.fulfilment, o.total_zmw, o.delivery_zmw, o.paid_zmw, o.payment_status]; }));
        });
      });
    });
  }
  function orderDetail(ref, mine) {
    return A.read('orders?select=' + ORDER_FIELDS + ',order_items(id,quantity,unit_price_zmw,product_id,products(title,seller_id)),order_cancellations(id,reason,status,requested_at,note,refund_zmw),payments(provider,provider_ref,amount_zmw,status,method,created_at),payment_attempts(id,amount_zmw,state,created_at),order_parcels(seller_id,speed,fee_zmw,courier_id,tracking_ref,courier_status),shipment_events(seller_id,status,tracking_ref,note,handover,created_at)&ref=eq.' + encodeURIComponent(ref.toUpperCase()) + '&limit=1').then(function (rows) {
      if (stale(mine)) return;
      var o = rows[0];
      if (!o) { A.show('Order ' + ref, empty('No order with that reference.') + '<p><a href="#/orders">All orders</a></p>'); return; }
      var cx = (o.order_cancellations || []).filter(function (c) { return c.status === 'requested'; })[0];
      var canOps = A.can('operations'), quote = o.fulfilment === 'delivery' && o.delivery_zmw == null && /^(placed|confirmed)$/.test(o.status);
      var events = (o.shipment_events || []).slice().sort(function (a, b) { return a.created_at < b.created_at ? 1 : -1; });
      A.show('Order ' + o.ref, '<p><a href="#/orders">← All orders</a></p>' +
        '<div class="admin-grid"><section class="card"><h2>Summary</h2><dl class="totals">' +
          '<div><dt>Status</dt><dd>' + A.status(o.status) + '</dd></div><div><dt>Placed</dt><dd>' + A.when(o.created_at) + '</dd></div>' +
          '<div><dt>Buyer</dt><dd>' + e(o.contact_name || '') + (o.recipient_phone ? ' · ' + e(o.recipient_phone) : '') + '</dd></div>' +
          '<div><dt>' + (o.fulfilment === 'delivery' ? 'Deliver to' : 'Collection') + '</dt><dd>' + e(o.deliver_to || o.buyer_town || '') + '</dd></div>' +
          (o.business_name ? '<div><dt>Business</dt><dd>' + e(o.business_name) + '</dd></div>' : '') +
          '<div><dt>Items</dt><dd>' + A.kwacha(o.total_zmw) + '</dd></div><div><dt>Delivery</dt><dd>' + (o.fulfilment !== 'delivery' ? 'None' : o.delivery_zmw == null ? 'To quote' : A.kwacha(o.delivery_zmw) + (o.delivery_speed ? ' · ' + e(o.delivery_speed) : '') + (o.delivery_source ? ' · ' + e(o.delivery_source.replace('_', ' ')) : '')) + '</dd></div>' +
          '<div class="is-total"><dt>Paid</dt><dd>' + A.kwacha(o.paid_zmw) + ' · ' + e(o.payment_status) + '</dd></div></dl>' +
          (o.notes ? '<p class="pmeta">Buyer\'s note: ' + e(o.notes) + '</p>' : '') + '</section>' +
        '<section class="card"><h2>Items</h2><ul class="admin-list">' + (o.order_items || []).map(function (i) { return '<li>' + e(i.products ? i.products.title : i.product_id) + ' × ' + e(i.quantity) + ' <span class="pmeta">' + A.kwacha(i.unit_price_zmw * i.quantity) + ' · ' + e(i.products ? i.products.seller_id : '') + '</span></li>'; }).join('') + '</ul>' +
          ((o.order_parcels || []).length ? '<h3>Parcels</h3><ul class="admin-list">' + o.order_parcels.map(function (p) { return '<li>' + e(p.seller_id) + ' · ' + e(p.speed) + ' · ' + (p.fee_zmw == null ? 'to quote' : A.kwacha(p.fee_zmw)) + (p.tracking_ref ? ' · tracking ' + e(p.tracking_ref) : '') + (p.courier_status ? ' · ' + e(p.courier_status.replace(/_/g, ' ')) : '') + '</li>'; }).join('') + '</ul>' : '') + '</section></div>' +
        (canOps ? '<section class="card"><h2>Actions</h2><div class="btn-row">' +
          (o.status === 'placed' ? '<button class="btn btn--primary btn--sm" type="button" data-step="confirmed">Confirm order</button>' : '') +
          (/^(placed|confirmed)$/.test(o.status) ? '<button class="btn btn--secondary btn--sm" type="button" data-step="dispatched">Mark dispatched</button>' : '') +
          (o.status === 'dispatched' ? '<button class="btn btn--secondary btn--sm" type="button" data-step="delivered">Mark delivered</button>' : '') + '</div>' +
          (quote ? form('ad-fee', field('ad-fee-k', 'Delivery fee (K)', '<input id="ad-fee-k" type="number" min="0" max="100000" step="0.01" required>', o.heavy_delivery ? 'Heavy or bulky items: quote the truck delivery.' : '') + field('ad-fee-note', 'Note (kept in the log)', '<input id="ad-fee-note" maxlength="200">'), '<button class="btn btn--primary btn--sm" type="submit">Set delivery fee</button>') : '') +
          '</section>' : '') +
        (cx ? '<section class="card"><h2>Cancellation request</h2><p>' + e(cx.reason) + ' <span class="pmeta">' + A.when(cx.requested_at) + '</span></p>' +
          (canOps ? form('ad-cx', field('ad-cx-refund', 'Refund (K, if paid)', '<input id="ad-cx-refund" type="number" min="0" step="0.01">') + field('ad-cx-note', 'Note to the buyer', '<input id="ad-cx-note" maxlength="300">'),
            '<button class="btn btn--primary btn--sm" type="submit" value="approve">Approve cancellation</button><button class="btn btn--secondary btn--sm" type="submit" value="decline">Decline</button>') : '') + '</section>' : '') +
        '<div class="admin-grid"><section class="card"><h2>Delivery updates</h2>' + (events.length ? '<ol class="admin-list">' + events.map(function (ev) { return '<li>' + A.status(ev.status) + ' ' + e(ev.seller_id) + (ev.handover ? ' · handover code' : '') + (ev.tracking_ref ? ' · ' + e(ev.tracking_ref) : '') + ' <span class="pmeta">' + A.when(ev.created_at) + '</span>' + (ev.note ? '<br><small>' + e(ev.note) + '</small>' : '') + '</li>'; }).join('') + '</ol>' : empty('None yet.')) + '</section>' +
        '<section class="card"><h2>Payments</h2>' + ((o.payments || []).length ? '<ul class="admin-list">' + o.payments.map(function (p) { return '<li>' + A.kwacha(p.amount_zmw) + ' · ' + A.status(p.status) + ' · ' + e(p.provider) + ' ' + e(p.provider_ref) + ' <span class="pmeta">' + A.when(p.created_at) + '</span></li>'; }).join('') + '</ul>' : empty('No payments recorded.')) +
          ((o.payment_attempts || []).length ? '<h3>Payment requests</h3><ul class="admin-list">' + o.payment_attempts.map(function (p) { return '<li>' + A.kwacha(p.amount_zmw) + ' · ' + A.status(p.state) + ' <span class="pmeta">' + A.when(p.created_at) + '</span></li>'; }).join('') + '</ul>' : '') + '</section></div>');
      bindAll('[data-step]', 'data-step', function (b, step) {
        if (step === 'delivered' && !window.confirm('Mark delivered without a handover code or photo? Only do this with other proof, such as the courier\'s confirmation.')) return;
        A.act(b, function () { return A.rpc('staff_order_step', { order_id: o.id, step: step }); }, function () { A.toast('Order ' + o.ref + ': ' + step, 'success'); });
      });
      var fee = A.$('#ad-fee');
      if (fee) fee.addEventListener('submit', function (ev) { ev.preventDefault(); A.act(fee.querySelector('button'), function () { return A.rpc('staff_set_delivery_fee', { order_ref: o.ref, fee: Number(A.$('#ad-fee-k').value), note: A.$('#ad-fee-note').value.trim() || null }); }, function () { A.toast('Delivery fee set', 'success'); }); });
      var cxf = A.$('#ad-cx');
      if (cxf) cxf.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var approve = ev.submitter && ev.submitter.value === 'approve', refund = A.$('#ad-cx-refund').value;
        A.act(ev.submitter || cxf.querySelector('button'), function () { return A.rpc('staff_decide_cancellation', { cancel_id: cx.id, approve: approve, refund: refund === '' ? null : Number(refund), staff_note: A.$('#ad-cx-note').value.trim() || null }); }, function () { A.toast(approve ? 'Cancellation approved' : 'Cancellation declined', 'success'); });
      });
    });
  }

  // ---------- Payments to check ----------
  section('payments', { title: 'Payments', roles: ['finance'], badge: function (c) { return c.payments_to_check; }, render: function (arg, q, mine) {
    return A.read('payment_attempts?select=id,amount_zmw,phone,state,created_at,provider_reference,orders(ref)&state=in.(created,submitted,unknown)&order=created_at.asc&limit=100').then(function (rows) {
      if (stale(mine)) return;
      A.show('Payments', '<p>Payment requests that haven\'t settled. Check each with the payment provider first: close one only when the provider confirms no money was taken. Only the provider\'s confirmation can mark money as received.</p>' +
        (rows.length ? rows.map(function (p) {
          return '<article class="card admin-item"><h2>' + A.kwacha(p.amount_zmw) + ' · order <a href="#/orders/' + encodeURIComponent(p.orders ? p.orders.ref : '') + '">' + e(p.orders ? p.orders.ref : '') + '</a> ' + A.status(p.state) + '</h2>' +
            '<p class="pmeta">Requested ' + A.when(p.created_at) + ' · reference ' + e(p.provider_reference) + ' · ' + e(p.phone) + '</p>' +
            (A.can('finance') ? form('ad-pay-' + p.id, field('ad-pay-note-' + p.id, 'What the provider said', '<input id="ad-pay-note-' + p.id + '" maxlength="300" required>'), '<button class="btn btn--secondary btn--sm" type="submit">Close as not paid</button>', ' data-close-attempt="' + e(p.id) + '"') : '') + '</article>';
        }).join('') : empty('Nothing to check.')));
      bindAll('[data-close-attempt]', 'data-close-attempt', function (f, id) {
        var note = A.$('#ad-pay-note-' + id).value.trim();
        if (note.length < 5) { var st = f.querySelector('[role="status"]'); st.className = 'form-status is-error'; st.textContent = 'Write what the provider said.'; return; }
        A.act(f.querySelector('button'), function () { return A.rpc('staff_close_payment_attempt', { attempt: id, note: note }); }, function () { A.toast('Payment request closed', 'success'); });
      });
    });
  } });

  // ---------- Support: complaints and returns ----------
  var CX_STATUS = [['review', 'Being looked into'], ['seller', 'Waiting for the seller'], ['resolved', 'Resolved'], ['closed', 'Closed']];
  var RET_STATUS = ['approved', 'declined', 'collected', 'received', 'refunded', 'replaced', 'repaired', 'closed'];
  section('support', { title: 'Support', roles: ['support'], badge: function (c) { return c.complaints; }, render: function (arg, q, mine) {
    return Promise.all([
      A.read('complaints?select=id,ref,type,wanted,details,status,created_at,contact_name,contact_phone,reply_due_at,assigned_to,escalated_at,orders(ref)&status=not.in.(resolved,closed)&order=created_at.asc&limit=100'),
      A.read('return_requests?select=id,kind,details,status,quantity,requested_at,refund_zmw,order_items(orders(ref),products(title))&status=not.in.(refunded,replaced,repaired,closed,declined)&order=requested_at.asc&limit=100')
    ]).then(function (r) {
      if (stale(mine)) return;
      var cx = r[0], rt = r[1], can = A.can('support');
      A.show('Support', '<h2>Complaints</h2>' + (cx.length ? cx.map(function (c) {
          return '<article class="card admin-item"><h3>' + e(c.ref) + ' ' + A.status(c.status) + '</h3><p class="pmeta">' + e(String(c.type).replace(/_/g, ' ')) + ' · wants ' + e(c.wanted) + (c.orders ? ' · order <a href="#/orders/' + encodeURIComponent(c.orders.ref) + '">' + e(c.orders.ref) + '</a>' : '') + ' · ' + A.when(c.created_at) + (c.reply_due_at ? ' · reply by ' + A.when(c.reply_due_at) : '') + '</p>' +
            '<p>' + e(c.details) + '</p><p class="pmeta">' + e(c.contact_name || '') + ' ' + e(c.contact_phone || '') + (c.escalated_at ? ' · <strong>escalated</strong>' : '') + ' · ' + (c.assigned_to ? (c.assigned_to === A.myId() ? 'assigned to you' : 'assigned') : 'not assigned') + '</p>' +
            (can && c.assigned_to !== A.myId() ? '<p><button class="btn btn--secondary btn--sm" type="button" data-assign="' + c.id + '">Assign to me</button></p>' : '') +
            (can ? form('ad-cx-' + c.id, field('ad-cxs-' + c.id, 'Status', '<select id="ad-cxs-' + c.id + '">' + CX_STATUS.map(function (s) { return '<option value="' + s[0] + '"' + (s[0] === c.status ? ' selected' : '') + '>' + s[1] + '</option>'; }).join('') + '</select>') +
              field('ad-cxf-' + c.id, 'Finding (shown to the buyer)', '<textarea id="ad-cxf-' + c.id + '" maxlength="1000"></textarea>') +
              '<div class="check"><input type="checkbox" id="ad-cxu-' + c.id + '"><label for="ad-cxu-' + c.id + '">The complaint is upheld</label></div>', '<button class="btn btn--primary btn--sm" type="submit">Save</button>', ' data-complaint="' + c.id + '"') : '') + '</article>';
        }).join('') : empty('No open complaints.')) +
        '<h2>Returns</h2>' + (rt.length ? rt.map(function (x) {
          var item = x.order_items || {};
          return '<article class="card admin-item"><h3>' + e(item.products ? item.products.title : 'Item') + ' × ' + e(x.quantity) + ' ' + A.status(x.status) + '</h3><p class="pmeta">' + e(String(x.kind).replace(/_/g, ' ')) + (item.orders ? ' · order <a href="#/orders/' + encodeURIComponent(item.orders.ref) + '">' + e(item.orders.ref) + '</a>' : '') + ' · ' + A.when(x.requested_at) + '</p><p>' + e(x.details || '') + '</p>' +
            (can ? form('ad-rt-' + x.id, '<div class="field-row">' + field('ad-rts-' + x.id, 'Status', '<select id="ad-rts-' + x.id + '">' + RET_STATUS.map(function (s) { return '<option' + (s === x.status ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select>') +
              field('ad-rtr-' + x.id, 'Refund (K)', '<input id="ad-rtr-' + x.id + '" type="number" min="0" step="0.01" value="' + e(x.refund_zmw == null ? '' : x.refund_zmw) + '">') +
              field('ad-rtm-' + x.id, 'Refund by', '<select id="ad-rtm-' + x.id + '"><option value="">Not yet</option><option value="mobile">Mobile money</option><option value="bank">Bank</option><option value="card">Card</option><option value="cash">Cash</option></select>') + '</div>',
              '<button class="btn btn--primary btn--sm" type="submit">Save</button>', ' data-return="' + x.id + '"') : '') + '</article>';
        }).join('') : empty('No returns in progress.')));
      bindAll('[data-assign]', 'data-assign', function (b, id) { A.act(b, function () { return A.rpc('assign_support_case', { case_id: Number(id), staff_user: A.myId() }); }, function () { A.toast('Assigned to you', 'success'); }); });
      bindAll('[data-complaint]', 'data-complaint', function (f, id) {
        A.act(f.querySelector('button'), function () { return A.rpc('staff_decide_complaint', { cid: Number(id), new_status: A.$('#ad-cxs-' + id).value, finding: A.$('#ad-cxf-' + id).value.trim() || null, was_upheld: A.$('#ad-cxu-' + id).checked || null }); }, function () { A.toast('Complaint updated', 'success'); });
      });
      bindAll('[data-return]', 'data-return', function (f, id) {
        var refund = A.$('#ad-rtr-' + id).value;
        A.act(f.querySelector('button'), function () { return A.rpc('staff_decide_return', { return_id: Number(id), new_status: A.$('#ad-rts-' + id).value, refund: refund === '' ? null : Number(refund), method: A.$('#ad-rtm-' + id).value || null }); }, function () { A.toast('Return updated', 'success'); });
      });
    });
  } });

  // ---------- Applications: sellers and riders ----------
  var APP_STATUS = { new: 'New', review: 'Being reviewed', info_needed: 'Waiting for the applicant', vetting: 'Invited to in-person checks', approved: 'Approved', rejected: 'Not approved', withdrawn: 'Withdrawn' };
  function slug(t) { return String(t || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, ''); }
  var APP_VIEWS = { sellers: [['review', 'To review', 'new,review'], ['info', 'Awaiting applicant', 'info_needed'], ['approved', 'Approved', 'approved'], ['rejected', 'Not approved', 'rejected'], ['withdrawn', 'Withdrawn', 'withdrawn']],
    riders: [['review', 'To review', 'new,review'], ['vetting', 'In-person checks', 'vetting'], ['info', 'Awaiting applicant', 'info_needed'], ['approved', 'Approved', 'approved'], ['rejected', 'Not approved', 'rejected'], ['withdrawn', 'Withdrawn', 'withdrawn']] };
  var APP_SEARCH = { sellers: ['business', 'contact_name', 'email', 'phone', 'town', 'pacra'], riders: ['full_name', 'email', 'phone', 'town', 'areas'] };
  section('applications', { title: 'Applications', roles: ['catalogue', 'operations'], badge: function (c) { return c.seller_applications + c.rider_applications; }, render: function (arg, q, mine) {
    var kind = q.get('show') === 'riders' ? 'riders' : 'sellers', riders = kind === 'riders';
    var views = APP_VIEWS[kind], view = views.filter(function (v) { return v[0] === q.get('view'); })[0] || views[0], waiting = /^(review|info|vetting)$/.test(view[0]);
    var term = A.term(q.get('q')), page = Math.max(0, Math.min(999, parseInt(q.get('page'), 10) || 0));
    // Phones are stored as +260…, so "0977 123456" searches for the digits after the leading 0
    var digits = term.replace(/\D/g, ''), phone = digits.length >= 4 ? digits.replace(/^0/, '') : term;
    var search = term ? '&or=' + encodeURIComponent('(' + APP_SEARCH[kind].map(function (f) { return f + '.ilike."*' + (f === 'phone' ? phone : term) + '*"'; }).join(',') + ')') : '';
    var fields = riders ? 'id,full_name,phone,email,town,areas,vehicle,owns_vehicle,availability,experience,status,staff_note,created_at'
      : 'id,business,contact_name,phone,email,town,pacra,categories,about,status,staff_note,seller_id,created_at';
    var link = function (v, t, p) { return '#/applications?show=' + kind + '&view=' + v + (t ? '&q=' + encodeURIComponent(t) : '') + (p ? '&page=' + p : ''); };
    return A.read((riders ? 'rider_applications' : 'seller_applications') + '?select=' + fields + '&status=in.(' + view[2] + ')' + search + '&order=created_at.' + (waiting ? 'asc' : 'desc') + ',id.asc&limit=26&offset=' + page * 25).then(function (rows) {
      if (stale(mine)) return;
      var more = rows.length > 25; rows = rows.slice(0, 25);
      var can = riders ? A.can('operations') : A.can('catalogue'), open = /^(new|review|info_needed|vetting)$/;
      A.show('Applications', '<nav class="chips admin-chips" aria-label="Who is applying"><a class="chip" href="#/applications"' + (riders ? '' : ' aria-current="page"') + '>Sellers</a><a class="chip" href="#/applications?show=riders"' + (riders ? ' aria-current="page"' : '') + '>Riders</a></nav>' +
        '<nav class="chips admin-chips" aria-label="Applications">' + views.map(function (v) { return '<a class="chip" href="' + link(v[0], term) + '"' + (v === view ? ' aria-current="page"' : '') + '>' + e(v[1]) + '</a>'; }).join('') + '</nav>' +
        (riders ? '<p>Approve a rider only after checking their NRC, licence, police clearance and references in person: invite them to the checks first.</p>' : '<p>Check the business before opening its store: the contact details, and the PACRA number on the PACRA register where one is given.</p>') +
        '<form class="admin-search" id="ad-app-search" role="search"><label for="ad-apq">Search applications</label><input id="ad-apq" type="search" maxlength="80" value="' + e(term) + '" placeholder="' + (riders ? 'Name, email, phone, town or area' : 'Business, contact, email, phone, town or PACRA') + '"><button class="btn btn--secondary btn--sm" type="submit">Search applications</button></form>' +
        '<p role="status">' + (rows.length ? 'Showing ' + (page * 25 + 1) + '–' + (page * 25 + rows.length) + (waiting ? ', oldest first' : ', newest first') + (term ? ' for “' + e(term) + '”' : '') + '.' : '') + '</p>' +
        (rows.length ? rows.map(function (a) {
          var k = e(a.id);
          return '<article class="card admin-item"><h2>' + e(riders ? a.full_name : a.business) + ' ' + A.status(APP_STATUS[a.status] || a.status) + '</h2><dl class="totals">' +
            (riders ? '<div><dt>Phone</dt><dd>' + e(a.phone) + '</dd></div><div><dt>Email</dt><dd>' + e(a.email) + '</dd></div><div><dt>Town</dt><dd>' + e(a.town) + (a.areas ? ' · ' + e(a.areas) : '') + '</dd></div><div><dt>Vehicle</dt><dd>' + e(a.vehicle) + (a.owns_vehicle ? ', own' : '') + '</dd></div><div><dt>Available</dt><dd>' + e((a.availability || []).join(', ') || 'Not given') + '</dd></div>'
              : '<div><dt>Contact</dt><dd>' + e(a.contact_name) + ' · ' + e(a.phone) + '</dd></div><div><dt>Email</dt><dd>' + e(a.email) + '</dd></div><div><dt>Town</dt><dd>' + e(a.town) + '</dd></div><div><dt>PACRA</dt><dd>' + e(a.pacra || 'Not given') + '</dd></div>') +
            '<div><dt>Sent</dt><dd>' + A.when(a.created_at) + '</dd></div></dl>' + (a.about || a.experience ? '<p>' + e(a.about || a.experience) + '</p>' : '') + (a.categories && a.categories.length ? '<p class="pmeta">Sells: ' + e(a.categories.join(', ')) + '</p>' : '') +
            (a.staff_note ? '<p class="notice">Last message: ' + e(a.staff_note) + '</p>' : '') + (a.seller_id ? '<p class="pmeta">Store: ' + e(a.seller_id) + '</p>' : '') +
            (can && open.test(a.status) ? (!riders ? form('ad-ap-' + k, '<div class="field-row">' + field('ad-apid-' + k, 'Store ID (used in web addresses)', '<input id="ad-apid-' + k + '" pattern="[a-z0-9][a-z0-9-]{1,38}[a-z0-9]" maxlength="40" required value="' + e(slug(a.business)) + '">') + field('ad-apn-' + k, 'Store name', '<input id="ad-apn-' + k + '" maxlength="120" required value="' + e(a.business) + '">') + '</div>', '<button class="btn btn--primary btn--sm" type="submit">Approve and open store</button>', ' data-approve="' + k + '"') : '') +
              form('ad-dec-' + k, field('ad-msg-' + k, 'Message to the applicant', '<textarea id="ad-msg-' + k + '" maxlength="1000"></textarea>'),
                (a.status === 'new' ? '<button class="btn btn--secondary btn--sm" type="submit" value="review">Mark under review</button>' : '') +
                '<button class="btn btn--secondary btn--sm" type="submit" value="info_needed">Ask for more information</button>' +
                (riders ? (a.status === 'vetting' ? '<button class="btn btn--primary btn--sm" type="submit" value="approved">Checks passed: approve</button>' : '<button class="btn btn--primary btn--sm" type="submit" value="vetting">Invite to in-person checks</button>') : '') +
                '<button class="btn btn--secondary btn--sm btn--danger" type="submit" value="rejected">Reject</button>', ' data-decide="' + k + '"') : '') + '</article>';
        }).join('') : empty(term ? 'No applications match “' + term + '”.' : page ? 'No more applications.' : 'No applications here.')) +
        (page || more ? '<nav class="btn-row" aria-label="More applications">' + (page ? '<a class="btn btn--secondary btn--sm" href="' + link(view[0], term, page - 1) + '">Previous page</a>' : '') + (more ? '<a class="btn btn--secondary btn--sm" href="' + link(view[0], term, page + 1) + '">Next page</a>' : '') + '</nav>' : ''));
      A.$('#ad-app-search').addEventListener('submit', function (ev) { ev.preventDefault(); location.hash = link(view[0], A.term(A.$('#ad-apq').value)); });
      bindAll('[data-approve]', 'data-approve', function (f, id) {
        A.act(f.querySelector('button'), function () { return A.rpc('staff_approve_application', { application: id, store_id: A.$('#ad-apid-' + id).value.trim(), store_name: A.$('#ad-apn-' + id).value.trim(), note: A.$('#ad-msg-' + id).value.trim() || null }); }, function (store) { A.toast('Store ' + store + ' is open. The applicant is its owner.', 'success'); });
      });
      bindAll('[data-decide]', 'data-decide', function (f, id, ev) {
        var decision = ev.submitter ? ev.submitter.value : 'review', note = A.$('#ad-msg-' + id).value.trim();
        if (decision === 'rejected' && !window.confirm('Reject this application? The applicant sees your message.')) return;
        A.act(ev.submitter || f.querySelector('button'), function () { return A.rpc(riders ? 'staff_review_rider_application' : 'staff_review_application', { application: id, decision: decision, note: note || null }); }, function () { A.toast(decision === 'rejected' ? 'Application rejected' : decision === 'info_needed' ? 'Asked for more information' : 'Saved', 'success'); });
      });
    });
  } });

  // ---------- Listings and sellers ----------
  function listingPhoto(p) {
    var src = '', base = new URL('../', location.href), api = ((window.ZS_CATALOGUE || {}).settings || {}).api || {};
    try {
      var url = new URL(p.image || '', base);
      if (p.image && (url.origin === base.origin || (url.protocol === 'https:' && api.url && url.origin === new URL(api.url).origin))) src = url.href;
    } catch (err) { /* Invalid image URLs use the same visible fallback as missing photos. */ }
    return '<div class="admin-listing-photo">' + (src ? '<a href="' + e(src) + '" target="_blank" rel="noopener noreferrer" aria-label="Open photo of ' + e(p.title) + ' (opens in a new tab)"><img src="' + e(src) + '" alt="' + e(p.title) + '" width="96" height="96" loading="lazy" decoding="async" referrerpolicy="no-referrer"></a>' : '') +
      '<span' + (src ? ' hidden' : '') + '>Photo unavailable</span></div>';
  }
  section('listings', { title: 'Listings', roles: ['catalogue'], badge: function (c) { return c.listings_to_review; }, render: function (arg, q, mine) {
    return Promise.all([
      A.read('products?select=id,title,price_zmw,status,seller_id,department_id,updated_at,image&status=eq.pending&order=updated_at.asc&limit=100'),
      A.read('sellers?select=id,name,city,verified,vat_registered&order=name.asc&limit=200')
    ]).then(function (r) {
      if (stale(mine)) return;
      var can = A.can('catalogue');
      A.show('Listings', '<h2>Waiting for review</h2>' + (r[0].length ? table(['Listing', 'Seller', 'Price', ''], r[0].map(function (p) {
          return '<tr><th scope="row"><div class="admin-listing">' + listingPhoto(p) + '<div>' + e(p.title) + '<br><small>' + e(p.id) + ' · ' + e(p.department_id) + '</small></div></div></th><td>' + e(p.seller_id) + '</td><td>' + A.kwacha(p.price_zmw) + '</td><td>' +
            (can ? '<div class="btn-row"><button class="btn btn--primary btn--sm" type="button" data-moderate="active|' + e(p.id) + '">Approve</button><button class="btn btn--secondary btn--sm btn--danger" type="button" data-moderate="removed|' + e(p.id) + '">Reject</button></div>' : '') + '</td></tr>';
        })) : empty('Nothing waiting. New and changed listings appear here.')) +
        '<h2>Sellers</h2>' + table(['Seller', 'Town', 'Verified', ''], r[1].map(function (s) {
          return '<tr><th scope="row">' + e(s.name) + '<br><small>' + e(s.id) + '</small></th><td>' + e(s.city || '') + '</td><td>' + (s.verified ? A.status('verified') : 'No') + '</td><td>' +
            (can ? '<button class="btn btn--secondary btn--sm" type="button" data-verify="' + (s.verified ? 'no' : 'yes') + '|' + e(s.id) + '">' + (s.verified ? 'Remove verification' : 'Verify') + '</button>' : '') + '</td></tr>';
        })) + '<p class="pmeta">Verify a seller only after checking their PACRA registration, ID and a physical or online presence.</p>');
      A.$$('.admin-listing-photo img').forEach(function (img) {
        var failed = function () { img.parentNode.hidden = true; img.parentNode.nextElementSibling.hidden = false; };
        img.addEventListener('error', failed);
        if (img.complete && !img.naturalWidth) failed();
      });
      bindAll('[data-moderate]', 'data-moderate', function (b, v) { var x = v.split('|'); A.act(b, function () { return A.rpc('staff_moderate_listing', { pid: x[1], new_status: x[0], note: null }); }, function () { A.toast(x[0] === 'active' ? 'Listing approved' : 'Listing rejected', 'success'); }); });
      bindAll('[data-verify]', 'data-verify', function (b, v) { var x = v.split('|'); A.act(b, function () { return A.rpc('staff_verify_seller', { sid: x[1], is_verified: x[0] === 'yes' }); }, function () { A.toast('Saved', 'success'); }); });
    });
  } });

  // ---------- Delivery prices ----------
  // Courier ids as the shop builds them (js/main.js): a profile's own id, else zicta-<licence>
  A.courierList = function () {
    var src = window.ZS_COURIERS || {}, byLic = {}, out = [];
    (src.register || []).forEach(function (r) { var c = { id: 'zicta-' + r[0].replace(/^ZICTA\/P\//, '').replace(/\W+/g, '').toLowerCase(), name: r[1], licence: r[0] }; byLic[r[0]] = c; out.push(c); });
    (src.profiles || []).forEach(function (p) { var c = p.licence && byLic[p.licence]; if (c) { c.id = p.id; c.name = p.name || c.name; c.profile = true; } else out.push({ id: p.id, name: p.name, profile: true, unlicensed: true }); });
    return out;
  };
  section('delivery', { title: 'Delivery prices', roles: ['operations'], render: function (arg, q, mine) {
    return A.rpc('delivery_settings').then(function (x) {
      if (stale(mine)) return;
      var S = (window.ZS_CATALOGUE || {}).settings || {};
      var editor = window.ZSDeliveryEditor({ esc: A.esc, couriers: A.courierList(), towns: (S.towns || []).map(function (t) { return { name: t[0], province: t[1] }; }) });
      A.show('Delivery prices', '<p>These are the prices buyers see in the cart and pay at checkout. Each change is saved to the database and logged with your name.</p>' + editor.html(x));
      editor.bind(document.getElementById('delivery-editor'), function (v) {
        var chain = Promise.resolve();
        // A rate whose route changed is a new rate: remove the old one
        v.rates.forEach(function (r) { var old = (x.rates || []).filter(function (a) { return String(a.id) === String(r.id); })[0]; if (old && ((old.courier || '') !== (r.courier || '') || old.zone !== r.zone || old.speed !== r.speed)) v.removed.push(r.id); });
        v.removed.forEach(function (id) { chain = chain.then(function () { return A.rpc('staff_delete_delivery_rate', { rate_id: Number(id) }); }); });
        v.rates.forEach(function (r) { chain = chain.then(function () { return A.rpc('staff_save_delivery_rate', { courier: r.courier, zone: r.zone, speed: r.speed, fee: r.fee, included_kg: r.kg, per_kg: r.perKg, min_days: r.days ? r.days[0] : null, max_days: r.days ? r.days[1] : null, active: r.active }); }); });
        return chain.then(function () { return A.rpc('staff_set_delivery_settings', { free_min: v.freeDelivery.min, free_zones: v.freeDelivery.zones, default_kg: v.defaultKg, origin_town: v.origin ? v.origin.town : null, origin_province: v.origin ? v.origin.province : null, same_day_cutoff: v.sameDay.cutoff, same_day_towns: v.sameDay.towns, closed_days: v.closedDays }); })
          .then(function () { A.toast('Delivery prices saved', 'success'); setTimeout(A.route, 600); });
      });
    });
  } });

  // ---------- Messages ----------
  var MSG_TABS = [['', 'All'], ['queued', 'Waiting'], ['failed', 'Failed'], ['sent', 'Sent'], ['skipped', 'Skipped']];
  section('messages', { title: 'Messages', roles: ['operations', 'support'], badge: function (c) { return c.messages_failed; }, render: function (arg, q, mine) {
    var st = q.get('status') || '';
    return A.rpc('staff_notifications', { p_status: st || null, p_limit: 100, p_before: null }).then(function (rows) {
      if (stale(mine)) return;
      A.show('Messages', '<p>WhatsApp and email messages to buyers, sellers and riders. Handover codes are never shown here. A message that keeps failing usually means its WhatsApp template or email settings need fixing first.</p>' +
        '<nav class="chips admin-chips" aria-label="Message status">' + MSG_TABS.map(function (t) { return '<a class="chip" href="#/messages?status=' + t[0] + '"' + (t[0] === st ? ' aria-current="page"' : '') + '>' + t[1] + '</a>'; }).join('') + '</nav>' +
        (rows.length ? table(['Message', 'To', 'Status', 'When', ''], rows.map(function (n) {
          return '<tr><th scope="row">' + e(n.template.replace(/_/g, ' ')) + '<br><small>' + e(n.channel) + (n.order_ref ? ' · ' + e(n.order_ref) : '') + '</small></th><td>' + e(n.to) + '</td><td>' + A.status(n.status) + (n.last_error ? '<br><small>' + e(n.last_error) + '</small>' : '') + '</td>' +
            '<td>' + A.when(n.sent_at || n.created_at) + '</td><td>' + (/^(failed|skipped)$/.test(n.status) && A.can('operations') ? '<button class="btn btn--secondary btn--sm" type="button" data-retry="' + n.id + '">Send again</button>' : '') + '</td></tr>';
        })) : empty('No messages here.')));
      bindAll('[data-retry]', 'data-retry', function (b, id) { A.act(b, function () { return A.rpc('staff_retry_notification', { notification_id: Number(id) }); }, function () { A.toast('Queued to send again', 'success'); }); });
    });
  } });

  // ---------- Seller payouts ----------
  var PAYOUT_TABS = [['due', 'Due'], ['held', 'Held'], ['paid', 'Paid'], ['cancelled', 'Cancelled']];
  section('payouts', { title: 'Payouts', roles: ['finance'], render: function (arg, q, mine) {
    var st = (PAYOUT_TABS.filter(function (t) { return t[0] === q.get('status'); })[0] || PAYOUT_TABS[0])[0];
    return A.read('seller_payouts?select=id,seller_id,amount_zmw,commission_zmw,status,release_after,paid_at,reference,created_at,sellers(name),orders(ref)&status=eq.' + st + '&order=' + (st === 'paid' ? 'paid_at.desc' : 'created_at.asc') + '&limit=500').then(function (rows) {
      if (stale(mine)) return;
      var by = {};
      rows.forEach(function (p) { (by[p.seller_id] = by[p.seller_id] || { name: p.sellers ? p.sellers.name : p.seller_id, list: [], total: 0 }).list.push(p); by[p.seller_id].total += Number(p.amount_zmw); });
      var ids = Object.keys(by), can = A.can('finance') && st === 'due';
      A.show('Payouts', '<p>What each seller is owed once a buyer has received their order and the hold has passed (' + (st === 'due' ? 'due now' : st) + '). Pay sellers by bank or mobile money, then record the transfer here so the seller sees it.</p>' +
        '<nav class="chips admin-chips" aria-label="Payout status">' + PAYOUT_TABS.map(function (t) { return '<a class="chip" href="#/payouts?status=' + t[0] + '"' + (t[0] === st ? ' aria-current="page"' : '') + '>' + t[1] + '</a>'; }).join('') + '</nav>' +
        (rows.length ? '<p><button class="btn btn--secondary btn--sm" type="button" id="ad-payout-csv">Download CSV</button></p>' : '') +
        (ids.length ? ids.map(function (sid) {
          var g = by[sid];
          return '<article class="card admin-item"><h2>' + e(g.name) + ' <span class="pmeta">' + A.kwacha(g.total) + ' · ' + g.list.length + (g.list.length === 1 ? ' order' : ' orders') + '</span></h2>' +
            table(['Order', 'Amount', 'Commission', st === 'paid' ? 'Paid' : st === 'held' ? 'Released after' : 'Since'], g.list.map(function (p) {
              return '<tr><th scope="row">' + (p.orders ? '<a href="#/orders/' + encodeURIComponent(p.orders.ref) + '">' + e(p.orders.ref) + '</a>' : '') + '</th><td>' + A.kwacha(p.amount_zmw) + '</td><td>' + A.kwacha(p.commission_zmw) + '</td><td>' +
                (st === 'paid' ? A.when(p.paid_at) + (p.reference ? '<br><small>' + e(p.reference) + '</small>' : '') : st === 'held' ? A.when(p.release_after) : A.when(p.created_at)) + '</td></tr>';
            })) +
            (can ? form('ad-pay-' + e(sid), field('ad-payref-' + e(sid), 'Transfer reference', '<input id="ad-payref-' + e(sid) + '" maxlength="120" required placeholder="e.g. the bank or mobile money reference">'), '<button class="btn btn--primary btn--sm" type="submit">Record ' + A.kwacha(g.total) + ' as paid</button>', ' data-payout="' + e(sid) + '"') : '') + '</article>';
        }).join('') : empty('No payouts here.')));
      bindAll('[data-payout]', 'data-payout', function (f, sid) {
        if (!window.confirm('Record ' + A.kwacha(by[sid].total) + ' to ' + by[sid].name + ' as paid? Do this only after the money has been sent.')) return;
        A.act(f.querySelector('button'), function () { return A.rpc('staff_mark_payouts_paid', { payout_ids: by[sid].list.map(function (p) { return p.id; }), transfer_reference: A.$('#ad-payref-' + sid).value.trim() }); }, function () { A.toast('Payout recorded', 'success'); });
      });
      var csv = A.$('#ad-payout-csv');
      if (csv) csv.addEventListener('click', function () { A.csv('zed-supply-payouts-' + st + '-' + new Date().toISOString().slice(0, 10) + '.csv', ['Seller', 'Store ID', 'Order', 'Amount (K)', 'Commission (K)', 'Status', 'Release after', 'Paid', 'Reference'], rows.map(function (p) { return [p.sellers ? p.sellers.name : '', p.seller_id, p.orders ? p.orders.ref : '', p.amount_zmw, p.commission_zmw, p.status, p.release_after, p.paid_at, p.reference]; })); });
    });
  } });

  // ---------- Staff and roles (owner) ----------
  var ROLES = [['owner', 'Owner', 'Everything, including staff and settings'], ['operations', 'Operations', 'Orders, delivery fees and prices, riders, resending messages'], ['support', 'Support', 'Complaints, returns and support cases'], ['catalogue', 'Catalogue', 'Listings, sellers and seller applications'], ['finance', 'Finance', 'Payment requests and seller payouts']];
  function roleChecks(prefix, have) { return '<div class="checks admin-roles">' + ROLES.map(function (r) { return '<div class="check"><input type="checkbox" id="' + prefix + r[0] + '" value="' + r[0] + '"' + (have.indexOf(r[0]) !== -1 ? ' checked' : '') + '><label for="' + prefix + r[0] + '">' + r[1] + ' <small>' + r[2] + '</small></label></div>'; }).join('') + '</div>'; }
  section('staff', { title: 'Staff', roles: ['owner'], render: function (arg, q, mine) {
    return A.rpc('staff_list').then(function (rows) {
      if (stale(mine)) return;
      A.show('Staff', '<p>Who can use the admin panel, and what each person can do. Everyone also confirms sign-ins with an authenticator app. If someone loses their phone, remove their authenticator in Supabase (Authentication → Users), and they set it up again at their next sign-in.</p>' +
        rows.map(function (u, i) {
          return '<article class="card admin-item"><h2>' + e(u.name || u.email) + (u.you ? ' <span class="pmeta">(you)</span>' : '') + '</h2><p class="pmeta">' + e(u.email) + (u.last_action ? ' · last action ' + A.when(u.last_action) : '') + '</p>' +
            form('ad-staff-' + i, '<fieldset class="field"><legend>Roles</legend>' + roleChecks('ad-r' + i + '-', u.roles || []) + '</fieldset>', '<button class="btn btn--primary btn--sm" type="submit" value="save">Save roles</button><button class="btn btn--secondary btn--sm btn--danger" type="submit" value="remove">Remove from staff</button>', ' data-staff="' + e(u.email) + '" data-i="' + i + '"') + '</article>';
        }).join('') +
        '<section class="card"><h2>Add a staff member</h2><p class="pmeta">They need to sign in to the shop once with their email first, so the account exists.</p>' +
        form('ad-staff-new', field('ad-staff-email', 'Their email', '<input id="ad-staff-email" type="email" maxlength="254" required>') + '<fieldset class="field"><legend>Roles</legend>' + roleChecks('ad-rn-', []) + '</fieldset>', '<button class="btn btn--primary btn--sm" type="submit">Add to staff</button>') + '</section>');
      var save = function (f, email, roles, done) { A.act(f.querySelector('button'), function () { return A.rpc('staff_set_roles', { account_email: email, new_roles: roles }); }, done); };
      bindAll('[data-staff]', 'data-staff', function (f, email, ev) {
        var remove = ev.submitter && ev.submitter.value === 'remove', i = f.getAttribute('data-i');
        var roles = remove ? [] : A.$$('[id^="ad-r' + i + '-"]:checked').map(function (c) { return c.value; });
        if ((remove || !roles.length) && !window.confirm('Remove ' + email + ' from staff? They lose access to the admin panel straight away.')) return;
        save(f, email, roles, function () { A.toast(roles.length ? 'Roles saved' : email + ' removed from staff', 'success'); });
      });
      var add = A.$('#ad-staff-new');
      add.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var roles = A.$$('[id^="ad-rn-"]:checked').map(function (c) { return c.value; }), st = add.querySelector('[role="status"]');
        if (!roles.length) { st.className = 'form-status is-error'; st.textContent = 'Choose at least one role.'; return; }
        save(add, A.$('#ad-staff-email').value.trim(), roles, function () { A.toast('Added to staff', 'success'); });
      });
    });
  } });

  // ---------- Shop settings (owner) ----------
  section('settings', { title: 'Settings', roles: ['owner'], render: function (arg, q, mine) {
    return A.read('shop_settings?select=*&limit=1').then(function (rows) {
      if (stale(mine)) return;
      var s = rows[0] || {};
      var num = function (k, label, attrs, hint) { return field('ad-set-' + k, label, '<input id="ad-set-' + k + '" data-k="' + k + '" type="number" ' + attrs + ' value="' + e(s[k] == null ? '' : s[k]) + '">', hint); };
      var tick = function (k, label, hint) { return '<div class="check"><input type="checkbox" id="ad-set-' + k + '" data-k="' + k + '"' + (s[k] ? ' checked' : '') + '><label for="ad-set-' + k + '">' + label + (hint ? ' <small>' + hint + '</small>' : '') + '</label></div>'; };
      A.show('Settings', '<p>How the shop charges and pays. Each change is logged with what it was before. Delivery prices have their own section.</p>' +
        form('ad-settings', '<fieldset class="field"><legend>VAT</legend>' + tick('vat_registered', 'Zed Supply is registered for VAT with ZRA') +
            tick('vat_registration_verified', 'The registration and TPIN have been checked against ZRA\'s record', 'Online orders aren\'t accepted while VAT is on but not checked') +
            '<div class="field-row">' + num('vat_rate', 'VAT rate (%)', 'min="0" max="30" step="0.01" required') + '</div>' + tick('vat_included', 'Listed prices include VAT') + '</fieldset>' +
          '<fieldset class="field"><legend>Sellers</legend><div class="field-row">' + num('commission_pct', 'Commission (%)', 'min="0" max="50" step="0.01" required') + num('payout_hold_days', 'Days to hold a payout after delivery', 'min="0" max="60" step="1" required') + '</div></fieldset>' +
          '<fieldset class="field"><legend>Paying</legend><div class="field-row">' + num('cod_max_zmw', 'Cash on delivery up to (K)', 'min="0" max="100000" step="1" required') + num('cod_min_delivered', 'Delivered orders before cash on delivery', 'min="0" max="50" step="1" required') + '</div>' +
            tick('layby_enabled', 'Lay-by is available') + '<div class="field-row">' + num('layby_deposit_pct', 'Lay-by deposit (%)', 'min="5" max="90" step="1" required') + num('layby_weeks', 'Weeks to finish paying', 'min="1" max="26" step="1" required') + '</div></fieldset>' +
          '<fieldset class="field"><legend>Support and staff</legend><div class="field-row">' + num('support_reply_hours', 'Hours to reply to a complaint', 'min="1" max="336" step="1"', 'Leave empty if no reply time is promised yet.') + '</div>' +
            tick('staff_mfa_required', 'Staff confirm sign-ins with an authenticator app', 'Strongly recommended: switch off only while setting up') +
            field('ad-set-site_url', 'Site address', '<input id="ad-set-site_url" data-k="site_url" type="url" maxlength="200" required value="' + e(s.site_url || '') + '">', 'Used in email links, starting https:// and ending with /') + '</fieldset>',
          '<button class="btn btn--primary" type="submit">Save settings</button>'));
      var f = A.$('#ad-settings');
      f.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var changes = {};
        A.$$('[data-k]', f).forEach(function (el) {
          var k = el.getAttribute('data-k'), v = el.type === 'checkbox' ? el.checked : el.type === 'number' ? (el.value === '' ? null : Number(el.value)) : el.value.trim();
          if (String(v) !== String(s[k] == null ? (el.type === 'checkbox' ? false : null) : (el.type === 'number' ? Number(s[k]) : s[k]))) changes[k] = v;
        });
        if (!Object.keys(changes).length) { A.toast('Nothing changed'); return; }
        if (changes.staff_mfa_required === false && !window.confirm('Let staff sign in without an authenticator app? Anyone who gets into a staff email account could then use the admin panel.')) return;
        A.act(f.querySelector('button'), function () { return A.rpc('staff_set_shop_settings', { changes: changes }); }, function () { A.toast('Settings saved', 'success'); });
      });
    });
  } });

  // ---------- Audit log ----------
  section('audit', { title: 'Audit log', render: function (arg, q, mine) {
    var term = A.term(q.get('q')), before = parseInt(q.get('before'), 10) || null;
    return A.rpc('staff_audit', { search: term || null, p_before: before, p_limit: 50 }).then(function (rows) {
      if (stale(mine)) return;
      A.show('Audit log', '<p>' + (A.can('owner') && (A.me.roles || []).indexOf('owner') !== -1 ? 'Every staff action, newest first.' : 'Your own staff actions, newest first. The owner sees everyone\'s.') + '</p>' +
        '<form class="admin-search" id="ad-audit-search" role="search"><label for="ad-aq">Search the log</label><input id="ad-aq" type="search" maxlength="80" value="' + e(term) + '" placeholder="Action, order, store or person"><button class="btn btn--secondary btn--sm" type="submit">Search</button>' +
          (rows.length ? '<button class="btn btn--secondary btn--sm" type="button" id="ad-audit-csv">Download CSV</button>' : '') + '</form>' +
        (rows.length ? table(['Action', 'On', 'By', 'When', 'Detail'], rows.map(function (a) {
          return '<tr><th scope="row">' + e(a.action.replace(/_/g, ' ')) + '</th><td>' + e(a.target) + '</td><td>' + e(a.by || a.by_email || '') + '</td><td>' + A.when(a.at) + '</td><td><small>' + e(JSON.stringify(a.detail || {})).slice(0, 160) + '</small></td></tr>';
        })) : empty('No actions found.')) +
        (rows.length === 50 ? '<p><a class="btn btn--secondary btn--sm" href="#/audit?q=' + encodeURIComponent(term) + '&before=' + rows[rows.length - 1].id + '">Older</a></p>' : ''));
      A.$('#ad-audit-search').addEventListener('submit', function (ev) { ev.preventDefault(); location.hash = '#/audit?q=' + encodeURIComponent(A.term(A.$('#ad-aq').value)); });
      var ac = A.$('#ad-audit-csv');
      if (ac) ac.addEventListener('click', function () { A.csv('zed-supply-audit-' + new Date().toISOString().slice(0, 10) + '.csv', ['When', 'By', 'Email', 'Action', 'On', 'Detail'], rows.map(function (a) { return [a.at, a.by, a.by_email, a.action, a.target, JSON.stringify(a.detail || {})]; })); });
    });
  } });
})();
