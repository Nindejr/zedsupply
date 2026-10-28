const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync('js/product-zoom.js', 'utf8'), sandbox);
const geometry = sandbox.window.ZSProductZoom.geometry;
const box = { left: 100, top: 100, width: 300, height: 300 };
const image = { width: 1200, height: 1200 };
const pane = { width: 500, height: 400 };

test('hover crop follows pointer and stays inside the enlarged image', () => {
  const first = geometry(box, image, pane, { x: 100, y: 100 });
  const last = geometry(box, image, pane, { x: 400, y: 400 });
  assert.equal(first.x, 0);
  assert.equal(first.y, 0);
  assert.equal(last.x, last.width - pane.width);
  assert.equal(last.y, last.height - pane.height);
  assert(last.width > box.width);
});
test('non-square contained photos use actual image pixels, not letterbox space', () => {
  const wide = { width: 1200, height: 600 };
  assert.equal(geometry(box, wide, pane, { x: 250, y: 110 }), null);
  const middle = geometry(box, wide, pane, { x: 250, y: 250 });
  assert.equal(middle.width / middle.height, 2);
  assert(middle.x >= 0 && middle.y >= 0);
});
test('keyboard coordinates clamp at edges and preserve aspect ratio', () => {
  const crop = geometry(box, image, pane, { x: 2, y: -1, normalized: true });
  assert.equal(crop.x, crop.width - pane.width);
  assert.equal(crop.y, 0);
  assert.equal(crop.width / crop.height, 1);
});
test('unloaded images do not produce a magnifier', () => {
  assert.equal(geometry(box, { width: 0, height: 0 }, pane, { x: 250, y: 250 }), null);
});
