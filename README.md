# zedsupply

Zed Supply, an online marketplace for Lusaka, Zambia: https://nindejr.github.io/zedsupply/

See [product features and implementation brief](PRODUCT-FEATURES.md) for seller
attributes, variants, buyer filters, reviews and the remaining backend work.

See [production readiness](PRODUCTION-READINESS.md) for what's needed to launch: what works now,
what to fill in before launch, and the server work for a self-service marketplace.

See [the marketplace review](MARKETPLACE-REVIEW.md) for the current capability
comparison, security findings, visual standards and prioritized development work.

See [global marketplace ideas](GLOBAL-MARKETPLACE-IDEAS.md) for patterns from China,
India, Southeast Asia, Korea and Latin America, and [integration readiness](INTEGRATION-READINESS.md)
for the new account, checkout, payment, fulfilment/support and search foundations.
Live activation remains disabled pending verified business facts and staging acceptance.

## Demo catalogue

Open `index.html?demo=1` to explore 55 local sample listings across all 26
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

All 113 sample product, department and banner exports carry pixel-level Zed Supply / ZS
branding. `npm run brand:artwork` applies the approved exact overlay idempotently;
private unmarked originals remain in unpublished `Business/brand-assets/artwork-originals/`.
`assets/branding-manifest.json` records export hashes and the artwork tests enforce coverage.

The category directory supports text and group filtering and shows subcategory
product counts. Search, store, brand and promotion listings include department
and subcategory filters where relevant. Stock planner department names follow
the catalogue; turnover targets remain editable retail assumptions.

Use Node.js 24 or newer. Run `npm ci`, then `npm test` for the regression suite,
including request handlers and artwork checks. Run `npx playwright install chromium`
once, then `npm run test:browser` for layout, artwork, device privacy, offline
messaging and automated WCAG 2.2 checks in light and dark mode. To use installed
Chrome locally, set `PLAYWRIGHT_CHANNEL=chrome` instead of downloading Chromium.
`.github/workflows/quality.yml` runs storefront and isolated PostgreSQL checks on
pushes and pull requests. Database checks must never target a live database;
see [the database instructions](db/README.md).

Under My Account, **Data on this device** lets visitors export or explicitly
delete saved personal details, activity and seller work. Signing out removes
the profile only. WhatsApp messages and business records require a separate request.

## Product image magnifier

Product detail pages include a side-panel image magnifier on screens wide enough
for it and with a mouse or trackpad. Hover over the photo to inspect details;
the original photo stays at its normal size. Keyboard users can focus the image,
press Enter or Space, pan with arrow keys, and close with Escape.

The magnifier follows the selected variant photo, respects data saver, and is
disabled on narrow/touch-only layouts and missing images. It reuses the product
photo; larger, sharper source photos provide better inspection detail.

Run its coordinate tests with `node --test tests/product-zoom.test.cjs`.
