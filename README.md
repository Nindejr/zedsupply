# zedsupply

Zed Supply, an online marketplace for Lusaka, Zambia: https://nindejr.github.io/zedsupply/

See [product features and implementation brief](PRODUCT-FEATURES.md) for seller
attributes, variants, buyer filters, reviews and the remaining backend work.

## Demo catalogue

Open `index.html?demo=1` to explore 53 local sample listings across all 25
departments, with at least two products in different subcategories per department.
Two additional overseas samples are available when `chinaOrdering` is enabled.
Use `?demo=0` to exit; sample content loads only in demo mode.

Demo entries live in `js/catalogue-sample.js`. Product artwork in
`assets/products/demo/` uses realistic 3D studio renders, exported as 600 × 600
WebP images. Department compositions use transparent 3D WebP artwork in
`assets/categories-3d/`; SVG icons are data-saver fallbacks. Sample labels stay
in the interface. Follow [the artwork guide](assets/ARTWORK.md) for additions. Prices,
specifications, sales and promotions are fictional. `demoSales` supplies this
month and last month's sales; `demoDays` keeps selected sample promotions active
relative to the viewing date. Dated seasonal examples keep their calendar dates.

The category directory supports text and group filtering and shows subcategory
product counts. Search, store, brand and promotion listings include department
and subcategory filters where relevant. Stock planner department names follow
the catalogue; turnover targets remain editable retail assumptions.

Run the regression suite with `node --test tests/*.test.cjs`.

## Product image magnifier

Product detail pages include a side-panel image magnifier on screens wide enough
for it and with a mouse or trackpad. Hover over the photo to inspect details;
the original photo stays at its normal size. Keyboard users can focus the image,
press Enter or Space, pan with arrow keys, and close with Escape.

The magnifier follows the selected variant photo, respects data saver, and is
disabled on narrow/touch-only layouts and missing images. It reuses the product
photo; larger, sharper source photos provide better inspection detail.

Run its coordinate tests with `node --test tests/product-zoom.test.cjs`.
