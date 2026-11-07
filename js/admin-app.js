/* Zed Supply — admin panel (/admin/): sign-in, the second sign-in step, navigation and shared
   helpers. The sections themselves are in js/admin-sections.js.

   Security lives on the server, not here. Every read is limited by row-level security and every
   change goes through a logged staff_* function that checks the person's staff role (migration
   029). Staff need an authenticator app code as well as the email code (aal2) before the server
   shows them anything; this page only guides them through that and hides what their roles can't
   use. */
(function () {
  'use strict';
  var B = window.ZSBackend, S = (window.ZS_CATALOGUE || {}).settings || {};
  var A = window.ZSAdmin = window.ZSAdmin || { sections: [] };
  var main = document.getElementById('admin-main'), nav = document.getElementById('admin-nav'), who = document.getElementById('admin-who');
  var ROLE_NAMES = { owner: 'Owner', operations: 'Operations', support: 'Support', catalogue: 'Catalogue', finance: 'Finance' };
  var ticket = 0;

  // ---------- Helpers shared with the sections ----------
  A.esc = function (t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  A.kwacha = function (n) {
    var v = Math.round((Number(n) + Number.EPSILON) * 100) / 100;
    return 'K' + v.toLocaleString('en-US', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 });
  };
  A.when = function (iso) {
    if (!iso) return '';
    try { return new Date(iso).toLocaleString('en-GB', { timeZone: 'Africa/Lusaka', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (e) { return String(iso); }
  };
  A.$ = function (sel, scope) { return (scope || document).querySelector(sel); };
  A.$$ = function (sel, scope) { return Array.prototype.slice.call((scope || document).querySelectorAll(sel)); };
  A.can = function (role) { var r = (A.me && A.me.roles) || []; return r.indexOf('owner') !== -1 || (role ? r.indexOf(role) !== -1 : r.length > 0); };
  A.canAny = function (roles) { return !roles || !roles.length || roles.some(function (r) { return A.can(r); }); };
  A.toast = function (msg, kind) {
    var t = document.getElementById('admin-toast');
    t.textContent = msg; t.className = 'admin-toast is-on' + (kind ? ' admin-toast--' + kind : '');
    clearTimeout(A.toast.timer); A.toast.timer = setTimeout(function () { t.className = 'admin-toast'; }, 5000);
  };
  A.status = function (text) {
    var t = String(text || '').toLowerCase();
    var tone = /cancel|fail|reject|declin|not approved|unknown|removed/.test(t) ? 'bad' : /deliver|approved|resolved|paid|sent|active|confirmed|refunded|closed/.test(t) ? 'ok' : 'wait';
    return '<span class="status status--' + tone + '">' + A.esc(text) + '</span>';
  };
  A.show = function (title, html) { main.innerHTML = '<h1>' + A.esc(title) + '</h1>' + html; document.title = title + ' | Admin | Zed Supply'; };
  A.ticket = function () { return ticket; };
  A.section = function (id, def) { def.id = id; A.sections.push(def); };
  // Runs a staff action from a button or form: disables it, reports the server's message, then refreshes
  A.act = function (control, work, done) {
    var status = control.closest('form') ? control.closest('form').querySelector('[role="status"]') : null;
    control.disabled = true; if (status) { status.className = 'form-status'; status.textContent = ''; }
    return Promise.resolve().then(work).then(function (r) { if (done) done(r); route(); }, function (err) {
      var msg = (err && err.message) || 'That didn’t work. Try again.';
      if (status) { status.className = 'form-status is-error'; status.textContent = msg; } else A.toast(msg, 'error');
    }).then(function () { control.disabled = false; });
  };
  A.rpc = function (name, body) { return B.rpc(name, body || {}); };
  A.myId = function () { var p = B.profile(); return p ? p.id : null; };
  /* A CSV file from rows of values. A cell that starts with = + - @ gets a leading ' so a
     spreadsheet shows it as text instead of running it as a formula. */
  A.csv = function (name, header, rows) {
    var cell = function (v) { var t = v == null ? '' : String(v); if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; return /[",\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
    var text = '\ufeff' + [header].concat(rows).map(function (r) { return r.map(cell).join(','); }).join('\r\n');
    var url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' })), a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    A.toast('Downloaded ' + rows.length + (rows.length === 1 ? ' row' : ' rows'), 'success');
  };
  A.read = function (q) { return B.read(q); };
  // Text from a search box, safe inside a PostgREST filter
  A.term = function (v) { return String(v || '').replace(/[^\p{L}\p{N}@+.' -]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 80); };

  // ---------- Signing in ----------
  function signInHTML(step) {
    return '<div class="admin-sign"><h1>Staff sign-in</h1>' + (step === 'code'
      ? '<form class="form form--card" id="ad-verify"><p>Enter the code we emailed you.</p><div class="field"><label for="ad-code">Email code</label><input id="ad-code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6,10}" maxlength="10" required></div><button class="btn btn--primary" type="submit">Continue</button><p class="form-status" role="status"></p></form>'
      : '<form class="form form--card" id="ad-email"><p>Sign in with your staff email. We send a one-time code; no password.</p><div class="field"><label for="ad-mail">Staff email</label><input id="ad-mail" type="email" autocomplete="email" maxlength="254" required></div><button class="btn btn--primary" type="submit">Send code</button><p class="form-status" role="status"></p></form>') +
      '<p class="pmeta">Then you confirm it\'s you with an authenticator app (such as Google Authenticator or Microsoft Authenticator). <a href="../index.html">Back to the shop</a></p></div>';
  }
  function bindForm(id, work) {
    var f = document.getElementById(id); if (!f) return;
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = f.querySelector('button[type="submit"]'), st = f.querySelector('[role="status"]');
      btn.disabled = true; st.className = 'form-status'; st.textContent = '';
      Promise.resolve().then(work).catch(function (err) { st.className = 'form-status is-error'; st.textContent = (err && err.message) || 'That didn’t work. Try again.'; btn.disabled = false; });
    });
  }
  var email = '';
  function askEmail() {
    nav.hidden = true; who.innerHTML = '';
    main.innerHTML = signInHTML('email');
    bindForm('ad-email', function () {
      email = document.getElementById('ad-mail').value.trim();
      return B.sendCode(email, '', true).then(function () { main.innerHTML = signInHTML('code'); A.$('#ad-code').focus(); bindForm('ad-verify', function () { return B.verifyCode(email, A.$('#ad-code').value.trim()).then(boot); }); });
    });
  }
  // The second step: enrol an authenticator app once, then enter its code each time
  function secondStep() {
    nav.hidden = true; whoHTML();
    main.innerHTML = '<p role="status">Checking your authenticator app…</p>';
    return B.factors().then(function (factors) {
      var ready = factors.filter(function (f) { return f.status === 'verified'; })[0];
      if (ready) {
        main.innerHTML = '<div class="admin-sign"><h1>Confirm it\'s you</h1><form class="form form--card" id="ad-totp"><div class="field"><label for="ad-totp-code">6-digit code from your authenticator app</label><input id="ad-totp-code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]{6,7}" maxlength="7" required></div><button class="btn btn--primary" type="submit">Confirm</button><p class="form-status" role="status"></p></form>' +
          '<p class="pmeta">Lost your phone? Ask the owner to reset your authenticator in Supabase.</p></div>';
        A.$('#ad-totp-code').focus();
        bindForm('ad-totp', function () { return B.verifyTotp(ready.id, A.$('#ad-totp-code').value).then(boot); });
        return;
      }
      return B.enrollTotp('Zed Supply admin ' + new Date().toISOString().slice(0, 16)).then(function (f) {
        var qr = f.totp && /^data:image\/svg\+xml/.test(f.totp.qr_code) ? f.totp.qr_code : '';
        main.innerHTML = '<div class="admin-sign"><h1>Set up your authenticator app</h1><ol class="admin-steps"><li>Open an authenticator app on your phone, such as Google Authenticator or Microsoft Authenticator.</li>' +
          '<li>Scan this code' + (qr ? '' : '') + ', or type the key into the app.</li><li>Enter the 6-digit code the app shows.</li></ol>' +
          (qr ? '<img class="admin-qr" src="' + A.esc(qr) + '" alt="QR code for your authenticator app" width="200" height="200">' : '') +
          '<p>Key: <code class="admin-key">' + A.esc(f.totp ? f.totp.secret : '') + '</code></p>' +
          '<form class="form form--card" id="ad-enrol"><div class="field"><label for="ad-enrol-code">6-digit code from the app</label><input id="ad-enrol-code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]{6,7}" maxlength="7" required></div><button class="btn btn--primary" type="submit">Finish set-up</button><p class="form-status" role="status"></p></form></div>';
        bindForm('ad-enrol', function () { return B.verifyTotp(f.id, A.$('#ad-enrol-code').value).then(boot); });
      });
    });
  }
  function whoHTML() {
    var me = A.me || {}, p = B.profile() || {};
    who.innerHTML = '<span>' + A.esc(me.name || p.name || p.email || '') + (me.roles && me.roles.length ? ' · ' + me.roles.map(function (r) { return ROLE_NAMES[r] || r; }).join(', ') : '') + '</span>' +
      '<button class="btn btn--secondary btn--sm" type="button" id="ad-signout">Sign out</button>';
    document.getElementById('ad-signout').onclick = function () { B.signOut().then(function () { A.me = null; askEmail(); }, function () { A.me = null; askEmail(); }); };
  }

  // ---------- Navigation ----------
  function allowed() { return A.sections.filter(function (s) { return A.canAny(s.roles); }); }
  function drawNav(current) {
    nav.hidden = false;
    nav.innerHTML = '<ul>' + allowed().map(function (s) {
      var n = s.badge && A.counts ? s.badge(A.counts) : 0;
      return '<li><a href="#/' + s.id + '"' + (s.id === current ? ' aria-current="page"' : '') + '>' + A.esc(s.title) + (n ? ' <span class="badge">' + n + '</span>' : '') + '</a></li>';
    }).join('') + '<li><a href="../index.html">Back to the shop</a></li></ul>';
  }
  function route() {
    if (!A.me || !A.me.ready) return;
    var h = location.hash.replace(/^#\/?/, ''), parts = h.split('?'), path = parts[0].split('/'), q = new URLSearchParams(parts[1] || '');
    var list = allowed(), s = list.filter(function (x) { return x.id === path[0]; })[0] || list[0];
    var mine = ++ticket;
    drawNav(s.id);
    main.innerHTML = '<p role="status">Loading…</p>';
    Promise.resolve().then(function () { return s.render(decodeURIComponent(path[1] || ''), q, mine); }).catch(function (err) {
      if (mine !== ticket) return;
      main.innerHTML = '<h1>' + A.esc(s.title) + '</h1><p class="form-status is-error" role="alert">' + A.esc((err && err.message) || 'This couldn’t be loaded.') + '</p>';
      if (err && err.status === 401) boot();
    }).then(function () { if (mine === ticket) main.focus({ preventScroll: true }); });
  }
  A.route = route;

  // ---------- Start ----------
  function boot() {
    if (!B || !B.enabled()) {
      main.innerHTML = '<h1>Admin panel</h1><p class="notice">The admin panel works once the shop is connected to its database (<code>settings.api</code> in js/catalogue.js). Until then, use the demo back office in the shop with <code>?demo=1</code>.</p>';
      return Promise.resolve();
    }
    if (!B.profile()) { askEmail(); return Promise.resolve(); }
    return A.rpc('staff_me').then(function (me) {
      A.me = me;
      if (!me.staff) {
        main.innerHTML = '<h1>Staff only</h1><p>This account isn\'t a Zed Supply staff account. <a href="../index.html">Back to the shop</a></p>';
        whoHTML(); return;
      }
      if (!me.ready) return secondStep();
      if (!me.roles.length) { whoHTML(); main.innerHTML = '<h1>No staff role yet</h1><p>Ask the owner to give your account a role: operations, support, catalogue or finance.</p>'; return; }
      whoHTML();
      return A.rpc('staff_dashboard').then(function (c) { A.counts = c; }, function () { A.counts = null; }).then(route);
    });
  }
  window.addEventListener('hashchange', route);
  if (B) B.initialize().then(boot, boot); else boot();
})();
