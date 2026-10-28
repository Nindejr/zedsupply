# zedsupply

Zed Supply, an online marketplace for Lusaka, Zambia: https://nindejr.github.io/zedsupply/

## Product image magnifier

Product detail pages include a side-panel image magnifier on screens wide enough
for it and with a mouse or trackpad. Hover over the photo to inspect details;
the original photo stays at its normal size. Keyboard users can focus the image,
press Enter or Space, pan with arrow keys, and close with Escape.

The magnifier follows the selected variant photo, respects data saver, and is
disabled on narrow/touch-only layouts and missing images. It reuses the product
photo; larger, sharper source photos provide better inspection detail.

Run its coordinate tests with `node --test tests/product-zoom.test.cjs`.
