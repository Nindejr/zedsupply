// js/receipt-pdf.js writes receipts as PDF files without a library. These check the file is
// well formed (every object where the cross-reference table says, stream lengths exact), that
// long receipts run onto more pages, and that text the fonts can't show is replaced, not broken.
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const sandbox = {};
vm.runInNewContext(fs.readFileSync('js/receipt-pdf.js', 'utf8'), sandbox);
const PDF = sandbox.ZS_RECEIPT_PDF;
const doc = (rows = 2) => ({ ref: 'ZS-TEST1234', title: 'Order receipt', date: '5 Nov 2026', status: 'Order sent on WhatsApp', payment: 'Payment: MTN MoMo',
  parties: [['Customer', ['Chanda Mwila']], ['Deliver to', ['Kabulonga, Lusaka']], ['Sold by', ['Sample Store A']]],
  rows: Array.from({ length: rows }, (_, i) => ['Solar kit (4 bulbs) ' + i, 'Colour: Black', '1', 'K1,850', 'K1,850']),
  parcels: [['Sample Store A · Express · Arrives Sat 7 Nov', 'K149']], totals: [['Items', 'K1,850'], ['Includes VAT (16%)', 'K255.17', 'vat'], ['Order total', 'K1,999', 'total']],
  foot: ['Zed Supply · Lusaka, Zambia', 'WhatsApp +260 97 905 0042', 'Thank you.'] });
function check(bytes) {
  const s = Buffer.from(bytes).toString('latin1');
  assert.ok(s.startsWith('%PDF-1.4\n'));
  assert.ok(s.trimEnd().endsWith('%%EOF'));
  const start = Number(s.match(/startxref\n(\d+)/)[1]);
  assert.equal(s.slice(start, start + 4), 'xref');
  const count = Number(s.slice(start).match(/^xref\n0 (\d+)/)[1]);
  s.slice(start).split('\n').slice(3, 2 + count).forEach((line, i) => assert.ok(s.startsWith((i + 1) + ' 0 obj', Number(line.slice(0, 10))), 'object ' + (i + 1)));
  for (const m of s.matchAll(/<< \/Length (\d+) >>\nstream\n/g)) assert.ok(s.startsWith('\nendstream', m.index + m[0].length + Number(m[1])), 'stream length');
  return s;
}

test('a receipt PDF is well formed and carries the receipt\'s text', () => {
  const s = check(PDF.write(doc(), null));
  for (const t of ['(Order receipt) Tj', '(No. ZS-TEST1234) Tj', '(Order total) Tj', '(K1,999) Tj', '(Solar kit \\(4 bulbs\\) 0) Tj']) assert.ok(s.includes(t), t);
  assert.ok(s.includes('/Count 1'));
  assert.ok(s.includes('(Zed Supply) Tj'), 'the name stands in for the logo when there is no image');
});

test('long receipts run onto more pages, each numbered', () => {
  const s = check(PDF.write(doc(60), null));
  const pages = Number(s.match(/\/Count (\d+)/)[1]);
  assert.ok(pages >= 3, String(pages));
  assert.ok(s.includes('page ' + pages + ' of ' + pages));
});

test('a logo is embedded as a JPEG image', () => {
  const jpeg = { width: 2, height: 1, bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]) };
  const s = check(PDF.write(doc(), jpeg));
  assert.ok(s.includes('/Subtype /Image /Width 2 /Height 1') && s.includes('/Filter /DCTDecode') && s.includes('/Im1 Do'));
});

test('text the standard fonts can\'t show is replaced, and lines wrap to fit', () => {
  assert.equal(PDF.enc('Lusaka · K5 – “ok” ✓ 𝄞'), 'Lusaka · K5 \u0096 \u0093ok\u0094 ? ?');
  const lines = PDF.wrap('A very long product name that will not fit on a single narrow line at all', 120, true, 10);
  assert.ok(lines.length > 2 && lines.every(l => PDF.width(l, true, 10) <= 120));
  assert.ok(PDF.wrap('Supercalifragilisticexpialidocious', 40, false, 10).every(l => PDF.width(l, false, 10) <= 40));
});
