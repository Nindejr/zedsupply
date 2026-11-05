// The receipt builders in js/main.js, run on their own with stand-ins for the page helpers.
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const src = fs.readFileSync('js/main.js', 'utf8');
const grab = name => {
  const start = src.indexOf('  function ' + name + '(');
  return src.slice(start, src.indexOf('\n  }\n', start) + 4);
};
const ctx = {
  VAT: { rate: 16, included: true }, S: { business: {} }, esc: x => String(x), kwacha: n => 'K' + n.toFixed(2), niceDate: x => x,
  speedName: () => 'Standard', sellerName: () => 'Store', parcelLine: () => 'Store · Standard', feeText: n => 'K' + n.toFixed(2),
  vatActive: () => false, shopPhone: () => '+260970000000', siteAddress: () => 'example.test'
};
vm.runInNewContext(grab('receiptHTML') + grab('receiptText'), ctx);
const model = { ref: 'ZS-RECEIPT1', date: '2026-11-05', status: 'Placed', mode: 'delivery', lines: [{ title: 'Lamp', qty: '1', each: 100, total: 100, seller: 'Store' }],
  sub: 100, vat: 10, vatRate: 10, vatIncluded: false, total: 155, delivery: { fee: 45, pending: false, speed: 'standard', parcels: [{ seller: 'store', speed: 'standard', fee: 45 }] } };

test('the gift receipt leaves out item, delivery and total prices, on paper and when shared', () => {
  const m = { ...model, gift: { noPrice: true }, giftReceipt: true };
  for (const result of [ctx.receiptHTML(m), ctx.receiptText(m)]) {
    assert.match(result, /Lamp/);
    assert.doesNotMatch(result, /K\d|Price<|Amount<|Order total|VAT/);
  }
});

test('the buyer\'s own receipt keeps its prices even when the parcel leaves them out', () => {
  const m = { ...model, gift: { noPrice: true } };
  assert.match(ctx.receiptHTML(m), /K155\.00/);
  assert.match(ctx.receiptText(m), /Order total: K155\.00/);
});

test('a receipt keeps the VAT rate and inclusion the order was placed with', () => {
  assert.match(ctx.receiptHTML(model), /VAT \(10%\)/);
  assert.doesNotMatch(ctx.receiptHTML(model), /Includes VAT/);
  assert.match(ctx.receiptText(model), /VAT 10%: K10.00/);
});
