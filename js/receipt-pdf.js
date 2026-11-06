/* Zed Supply — receipt as a PDF file.

   Builds an A4 PDF in the browser from the receipt's text blocks (receiptDoc() in js/main.js):
   the logo on a navy header, the Zambian flag stripe and gold line, the status band, customer,
   delivery and seller details, the items, each parcel, the totals with the gold total bar, and
   the contact footer, over as many pages as it needs. No outside library: the standard
   Helvetica fonts, and the logo as a JPEG made on a canvas. Loaded only when a buyer downloads.

   ZS_RECEIPT_PDF.build(doc, { logo: 'assets/…' }) → Promise<Uint8Array>
   ZS_RECEIPT_PDF.write(doc, logoJpeg|null) → Uint8Array (no browser needed; used by the tests) */
(function (root) {
  'use strict';
  var W = 595.28, H = 841.89, M = 40;
  // Advance widths (1/1000 em) of the standard Helvetica fonts for ASCII 32–126
  var HELV = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
  var BOLD = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];
  // Characters outside ASCII that the fonts' WinAnsi encoding has
  var WIN = { 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93, 0x201D: 0x94, 0x2026: 0x85, 0x20AC: 0x80, 0x2212: 0x2D };
  var COL = { navy: [10, 42, 102], text: [26, 34, 56], muted: [74, 86, 112], blue: [0, 87, 174], green: [26, 107, 14], bandGreen: [238, 247, 232],
    line: [227, 230, 234], foot: [240, 244, 250], gold: [245, 197, 66], goldDark: [231, 174, 52], ink: [42, 28, 0], white: [255, 255, 255],
    zmGreen: [25, 138, 0], zmRed: [222, 32, 16], zmBlack: [0, 0, 0], zmOrange: [239, 125, 0] };

  // Text in the fonts' encoding; anything they can't show becomes "?"
  function enc(s) {
    var out = '';
    s = String(s == null ? '' : s);
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c >= 32 && c < 127) out += s[i];
      else if (WIN[c]) out += String.fromCharCode(WIN[c]);
      else if (c >= 0xA0 && c <= 0xFF) out += s[i];
      else if (c >= 0xD800 && c <= 0xDBFF) { out += '?'; i++; }
      else if (c === 9 || c === 10) out += ' ';
      else out += '?';
    }
    return out;
  }
  function width(s, bold, size) {
    var t = enc(s), w = 0, table = bold ? BOLD : HELV;
    for (var i = 0; i < t.length; i++) { var c = t.charCodeAt(i); w += c >= 32 && c <= 126 ? table[c - 32] : c === 0xB7 ? 278 : c === 0xD7 ? 584 : 556; }
    return w * size / 1000;
  }
  function wrap(s, max, bold, size) {
    var words = String(s || '').split(/\s+/).filter(Boolean), lines = [], cur = '';
    words.forEach(function (w) {
      var next = cur ? cur + ' ' + w : w;
      if (width(next, bold, size) <= max) { cur = next; return; }
      if (cur) lines.push(cur);
      // A single word longer than the line is cut to fit
      while (width(w, bold, size) > max) { var k = w.length; while (k > 1 && width(w.slice(0, k), bold, size) > max) k--; lines.push(w.slice(0, k)); w = w.slice(k); }
      cur = w;
    });
    if (cur) lines.push(cur);
    return lines.length ? lines : [''];
  }
  function str(s) { return '(' + enc(s).replace(/[\\()]/g, function (c) { return '\\' + c; }) + ')'; }
  function rgb(c) { return (c[0] / 255).toFixed(3) + ' ' + (c[1] / 255).toFixed(3) + ' ' + (c[2] / 255).toFixed(3); }

  function write(doc, logo) {
    var pages = [], ops = [], y = 0, LINE = 13;
    var fy = function (top) { return (H - top).toFixed(2); };
    var rect = function (x, top, w, h, c) { ops.push(rgb(c) + ' rg ' + x.toFixed(2) + ' ' + (H - top - h).toFixed(2) + ' ' + w.toFixed(2) + ' ' + h.toFixed(2) + ' re f'); };
    var text = function (s, x, top, opt) {
      opt = opt || {};
      var size = opt.size || 10, bold = !!opt.bold, w = width(s, bold, size);
      var left = opt.align === 'right' ? x - w : opt.align === 'center' ? x - w / 2 : x;
      ops.push('BT /' + (bold ? 'F2' : 'F1') + ' ' + size + ' Tf ' + rgb(opt.color || COL.text) + ' rg ' + left.toFixed(2) + ' ' + fy(top + size * 0.8) + ' Td ' + str(s) + ' Tj ET');
    };
    var newPage = function () { if (ops.length) pages.push(ops); ops = []; y = M; };
    var room = function (h) { if (y + h > H - M - 24) { newPage(); return true; } return false; };

    // Header: logo on navy, the title and reference on the right
    ops = [];
    rect(0, 0, W, 96, COL.navy);
    if (logo) ops.push('q 182 0 0 46 ' + M + ' ' + fy(24 + 46) + ' cm /Im1 Do Q');
    else text('Zed Supply', M, 34, { size: 22, bold: true, color: COL.white });
    text(doc.title || 'Order receipt', W - M, 22, { size: 18, bold: true, color: COL.white, align: 'right' });
    text('No. ' + doc.ref, W - M, 46, { size: 10, bold: true, color: COL.white, align: 'right' });
    text(doc.date || '', W - M, 61, { size: 10, color: COL.white, align: 'right' });
    if (doc.sample) { var sw = width('DEMO ORDER', true, 7.5) + 10; rect(W - M - sw, 75, sw, 13, [255, 243, 196]); text('DEMO ORDER', W - M - 5, 78, { size: 7.5, bold: true, color: [90, 67, 0], align: 'right' }); }
    // The Zambian flag's colours, then the gold line
    rect(0, 96, W * 0.64, 6, COL.zmGreen); rect(W * 0.64, 96, W * 0.12, 6, COL.zmRed); rect(W * 0.76, 96, W * 0.12, 6, COL.zmBlack); rect(W * 0.88, 96, W * 0.12, 6, COL.zmOrange);
    rect(0, 102, W, 2, COL.goldDark);
    rect(0, 104, W, 24, COL.bandGreen);
    text(doc.status || '', M, 111, { size: 9.5, bold: true, color: COL.green });
    text(doc.payment || '', W - M, 111, { size: 9.5, bold: true, color: COL.green, align: 'right' });
    y = 144;

    // Customer, where it goes, who sold it
    var colW = (W - 2 * M - 24) / 3, tallest = 0;
    (doc.parties || []).forEach(function (p, i) {
      var x = M + i * (colW + 12), yy = y;
      text(String(p[0]).toUpperCase(), x, yy, { size: 7.5, bold: true, color: COL.blue }); yy += 13;
      (p[1] || []).forEach(function (line) { wrap(line, colW, false, 9.5).forEach(function (l) { text(l, x, yy, { size: 9.5 }); yy += 12.5; }); });
      tallest = Math.max(tallest, yy - y);
    });
    y += tallest + 14;

    // Items
    var priced = !doc.hide, qtyX = priced ? W - M - 210 : W - M - 60, itemW = qtyX - M - 12;
    var tableHead = function () {
      text('ITEM', M, y, { size: 7.5, bold: true, color: COL.muted }); text('QTY', qtyX, y, { size: 7.5, bold: true, color: COL.muted });
      if (priced) { text('PRICE', W - M - 85, y, { size: 7.5, bold: true, color: COL.muted, align: 'right' }); text('AMOUNT', W - M, y, { size: 7.5, bold: true, color: COL.muted, align: 'right' }); }
      y += 12; rect(M, y, W - 2 * M, 1.5, COL.navy); y += 7;
    };
    tableHead();
    (doc.rows || []).forEach(function (r) {
      var title = wrap(r[0], itemW, true, 9.5), sub = r[1] ? wrap(r[1], itemW, false, 8) : [], qty = wrap(r[2], priced ? 95 : 55, false, 9.5);
      var h = Math.max(title.length * 12.5 + sub.length * 10.5, qty.length * 12.5) + 8;
      if (room(h)) tableHead();
      var yy = y;
      title.forEach(function (l) { text(l, M, yy, { size: 9.5, bold: true }); yy += 12.5; });
      sub.forEach(function (l) { text(l, M, yy, { size: 8, color: COL.muted }); yy += 10.5; });
      qty.forEach(function (l, i) { text(l, qtyX, y + i * 12.5, { size: 9.5 }); });
      if (priced) { text(r[3], W - M - 85, y, { size: 9.5, align: 'right' }); text(r[4], W - M, y, { size: 9.5, align: 'right' }); }
      y += h - 4; rect(M, y, W - 2 * M, 0.7, COL.line); y += 6;
    });

    // Each parcel
    if ((doc.parcels || []).length) {
      room(30); y += 6;
      text('DELIVERY', M, y, { size: 7.5, bold: true, color: COL.blue }); y += 13;
      doc.parcels.forEach(function (p) {
        var lines = wrap(p[0], W - 2 * M - 110, false, 9);
        room(lines.length * 12 + 4);
        lines.forEach(function (l, i) { text(l, M, y + i * 12, { size: 9 }); });
        if (p[1]) text(p[1], W - M, y, { size: 9, bold: true, align: 'right' });
        y += lines.length * 12 + 3;
      });
    }

    // Totals, with the total on the gold bar
    if ((doc.totals || []).length) {
      room(doc.totals.length * 15 + 30); y += 10;
      var tx = W - M - 240;
      doc.totals.forEach(function (t) {
        if (t[2] === 'total') {
          y += 4; rect(tx, y - 5, 240, 26, COL.gold); rect(tx, y - 5, 240, 2, [255, 244, 194]);
          text(t[0], tx + 10, y + 2, { size: 12, bold: true, color: COL.ink }); text(t[1], W - M - 10, y + 2, { size: 12, bold: true, color: COL.ink, align: 'right' }); y += 26;
        } else {
          var small = t[2] === 'vat', c = t[2] === 'save' ? COL.green : COL.text;
          text(t[0], tx, y, { size: small ? 8.5 : 9.5, color: COL.muted }); text(t[1], W - M, y, { size: small ? 8.5 : 9.5, bold: !small, color: c, align: 'right' }); y += small ? 13 : 15;
        }
      });
    }
    if (doc.note) { room(20); y += 8; text(doc.note, M, y, { size: 9, color: COL.muted }); y += 14; }

    // Contact footer
    var footLines = [];
    (doc.foot || []).forEach(function (f, i) { wrap(f, W - 2 * M - 24, i === 0, i === 2 ? 8 : 8.5).forEach(function (l) { footLines.push([l, i]); }); });
    var fh = footLines.length * 12 + 20;
    room(fh + 16); y += 16;
    rect(M, y, W - 2 * M, fh, COL.foot); rect(M, y, W - 2 * M, 0.7, [220, 223, 228]);
    footLines.forEach(function (f, i) { text(f[0], M + 12, y + 10 + i * 12, { size: f[1] === 2 ? 8 : 8.5, bold: f[1] === 0, color: f[1] === 2 ? COL.muted : COL.text }); });
    pages.push(ops);

    // Page numbers, now the count is known
    pages.forEach(function (p, i) {
      var label = 'Zed Supply receipt ' + doc.ref + ' · page ' + (i + 1) + ' of ' + pages.length;
      p.push('BT /F1 7.5 Tf ' + rgb(COL.muted) + ' rg ' + (W / 2 - width(label, false, 7.5) / 2).toFixed(2) + ' 20 Td ' + str(label) + ' Tj ET');
    });

    // The file: catalogue, page tree, fonts, logo, then each page and its content
    var objs = [], kids = [], first = logo ? 6 : 5;
    pages.forEach(function (p, i) { kids.push((first + i * 2) + ' 0 R'); });
    objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
    objs[2] = '<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + pages.length + ' >>';
    objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
    objs[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
    if (logo) objs[5] = { head: '<< /Type /XObject /Subtype /Image /Width ' + logo.width + ' /Height ' + logo.height + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + logo.bytes.length + ' >>', bytes: logo.bytes };
    pages.forEach(function (p, i) {
      var n = first + i * 2, content = p.join('\n');
      objs[n] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + W + ' ' + H + '] /Resources << /Font << /F1 3 0 R /F2 4 0 R >>' + (logo ? ' /XObject << /Im1 5 0 R >>' : '') + ' >> /Contents ' + (n + 1) + ' 0 R >>';
      objs[n + 1] = { head: '<< /Length ' + content.length + ' >>', bytes: content };
    });
    var parts = [], size = 0, offsets = [];
    var add = function (chunk) {
      var b = typeof chunk === 'string' ? latin1(chunk) : chunk;
      parts.push(b); size += b.length;
    };
    add('%PDF-1.4\n%âãÏÓ\n');
    for (var n = 1; n < objs.length; n++) {
      offsets[n] = size;
      var o = objs[n];
      if (typeof o === 'string') add(n + ' 0 obj\n' + o + '\nendobj\n');
      else { add(n + ' 0 obj\n' + o.head + '\nstream\n'); add(o.bytes); add('\nendstream\nendobj\n'); }
    }
    var xref = size, table = 'xref\n0 ' + objs.length + '\n0000000000 65535 f \n';
    for (n = 1; n < objs.length; n++) table += ('0000000000' + offsets[n]).slice(-10) + ' 00000 n \n';
    add(table + 'trailer\n<< /Size ' + objs.length + ' /Root 1 0 R /Info << /Title ' + str('Zed Supply ' + (doc.title || 'receipt') + ' ' + doc.ref) + ' /Producer (Zed Supply) >> >>\nstartxref\n' + xref + '\n%%EOF\n');
    var out = new Uint8Array(size), at = 0;
    parts.forEach(function (b) { out.set(b, at); at += b.length; });
    return out;
  }
  function latin1(s) { var b = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 255; return b; }

  // The logo as a JPEG on the header's navy, so it keeps its edges without transparency
  function logoJpeg(src) {
    return new Promise(function (ok) {
      if (!src || typeof document === 'undefined') return ok(null);
      var img = new Image();
      img.onload = function () {
        try {
          var c = document.createElement('canvas'), w = img.naturalWidth || 379, h = img.naturalHeight || 96, x = c.getContext('2d');
          c.width = w * 2; c.height = h * 2; x.fillStyle = '#0A2A66'; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height);
          var data = atob(c.toDataURL('image/jpeg', 0.92).split(',')[1]);
          ok({ width: c.width, height: c.height, bytes: latin1(data) });
        } catch (e) { ok(null); }
      };
      img.onerror = function () { ok(null); };
      img.src = src;
    });
  }

  root.ZS_RECEIPT_PDF = {
    write: write, width: width, wrap: wrap, enc: enc,
    build: function (doc, opts) { return logoJpeg(opts && opts.logo).then(function (logo) { return write(doc, logo); }); }
  };
})(this);
