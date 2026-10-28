# Flexible product details and buying choices

The storefront is a static HTML/CSS/JavaScript application. The features below work in the browser prototype; seller edits, carts and new feedback remain local to that browser. PostgreSQL migrations describe the future backend. There are no authenticated product/review API endpoints or shared inventory service yet.

## Seller workflow

Category templates suggest relevant fields without restricting a seller to those suggestions. **Add other relevant product details** exposes additional groups. Empty optional fields stay absent; condition is never silently assumed to be new.

| Detail | Supported behaviour |
| --- | --- |
| Measurement | Numeric size, volume, weight or length with ml, litres, grams, kg, mm, cm, metres or inches. Size choices can also use labels such as S/M/L. A listing uses either a single measured size or selectable size choices. |
| Colour | Display name and hex value; buyers use colour swatches. |
| Brand | Existing brand-store association plus a manufacturer/brand-name field. Different brands belong in separate listings. |
| Age group | Infant, Kid, Teen, Adult and Senior; multiple selections where appropriate. |
| Condition | Optional New, Open box, Refurbished or Used. All non-new items require condition notes describing wear, repairs, packaging or missing parts. |
| Key features | Up to eight factual bullets, each at most 160 characters. |
| Specifications | Flexible named facts: model, material, compatibility, warranty, care, voltage, origin or other relevant information. |
| Included components | Included items and optional add-ons with separate price modifiers. Do not charge again for included items. |
| Additional choices | Up to two named axes, for example Storage, Pack size, Material or Fit. Each permits up to 30 distinct labels. Brands and conditions are separate listings. |
| Inventory | Colour × size × additional choices generate a matrix, capped at 256 combinations. Each combination has a unique SKU, stock and optional price. Existing matching rows retain their data; newly formed combinations start with zero stock. |
| Pricing | Fixed price, or optional buyer commitment pricing with explicit minimum and maximum. Variant prices and optional accessories update the displayed total. Money retains two decimal places. |

Example category guidance:

- Phones/headphones: colour, storage, compatibility, warranty, charger/cable contents and optional accessories.
- Groceries/liquids: net volume/weight, pack size, ingredients, storage instructions and expiry information where relevant.
- Clothing: size, colour, age suitability, material, fit and care.
- Toys: age suitability, dimensions, materials, included pieces and safety information supplied by the seller.
- Solar/hardware: dimensions, capacity/power specifications, compatibility, warranty and installation components.

Only enter facts the seller can substantiate. Attributes do not establish safety certification or suitability by themselves.

## Buyer workflow

Product pages show available choices, SKU/stock, condition notes, features, specifications and included/optional items. Sold-out combinations cannot be purchased. Selection descriptions survive into the cart and WhatsApp order message, including custom choices such as storage or pack size.

Search/category listings expose relevant colour, size/capacity, age, brand-store, manufacturer and condition facets; minimum/maximum price; customer rating; stock; promotion; and buyer-offer eligibility. A measurement-range filter compares equivalent units within one dimension: 1 litre equals 1,000 ml; kilograms are never compared with litres. Custom choice labels are keyword searchable. Dedicated custom-axis filter dropdowns are not implemented.

Combined colour/size/stock/price filters must match the same actual variant. A red/S plus blue/M listing cannot satisfy red/M. Cards show the lowest matching variant price and use “From” for listings with choices.

Buyer commitment controls let a buyer propose an amount within the seller's permitted range. A proposal still requires seller confirmation; moving the slider does not establish an accepted order. Optional add-ons are added to the selected base or proposed unit price, then multiplied by quantity. Stock and final totals must be revalidated by the future server.

Reviews support integer ratings from 1 to 5, a headline/body, average/count and star distribution. Readers can filter by exact stars, keywords and verified status where verified records exist, and sort reviews. Filters do not change the overall summary. New browser feedback is explicitly unverified. Production verified badges require a delivered purchase linked to the authenticated buyer; browser storage cannot supply that proof.

## Data and backend requirements

`js/products.js` centralizes validation, measurement normalization, option matrices, stock matching and prices. Browser data uses `attributes` for condition, condition notes, features, manufacturer, age groups and specifications; `options.extra` for custom axes; and flat custom selections on variant rows.

Example choice data:

```json
{
  "attributes": {
    "manufacturer": "Example manufacturer",
    "condition": "open_box",
    "conditionNotes": "Opened packaging; unused unit and listed accessories present.",
    "features": ["USB-C charging"],
    "ageRange": ["adult"]
  },
  "options": {
    "extra": [{"key": "custom_storage", "name": "Storage", "values": ["128 GB", "256 GB"]}]
  },
  "variants": [
    {"custom_storage": "128 GB", "sku": "PHONE-128", "stock": 3, "priceZMW": 2500},
    {"custom_storage": "256 GB", "sku": "PHONE-256", "stock": 2, "priceZMW": 2900}
  ]
}
```

This is a choice-data fragment, not a complete product payload. Keep normal title, department, seller, base price and other required listing fields.

Migrations 001–003 supply product/options/variant relationships, components, commitments, delivered purchases and review aggregates. Migration **004_product_details.sql** adds optional `condition`, `condition_notes`, validated `key_features`, expanded category-template fields and manufacturer/condition indexes. Existing custom option rows can represent additional axes; the future API must map browser keys/labels to their relational IDs.

Remaining production work:

1. Connect PostgreSQL and authentication; define identity mapping and seller ownership.
2. Implement validated create/update/read product and category-template endpoints, plus server-side filtering.
3. Implement offer submission/acceptance/expiry, server-calculated prices and transactional inventory reservation with idempotency.
4. Connect reviews to delivered order items, enforce the existing one-review-per-buyer/product rule and update cached aggregates. Repeated purchases do not create extra product votes.
5. Import real catalogue/template data, enforce upload permissions and protect historical order snapshots. Run native PostgreSQL concurrency tests before production.

See [database design and constraints](db/README.md). None of these endpoints is claimed to be implemented by this static-site change.

## Explicit implementation prompt for subsequent work

> Extend Zed Supply using its existing HTML/CSS/vanilla JavaScript frontend and proposed PostgreSQL schema. Preserve the current navy/blue/gold glass styling, accessibility, cart messages and side-panel image magnifier. Do not replace the stack or fabricate product claims. Build on the shared product model and migrations 001–004.
>
> Give sellers optional, category-suggested attributes; metric size and label sizes; named hex colours; manufacturer; age checkboxes; condition with required non-new notes; factual feature bullets; flexible specifications; included and priced optional accessories; and colour/size plus at most two custom option axes. Generate at most 256 combinations with unique SKU, stock and optional price. Preserve matching rows during edits and initialize new combinations at zero stock.
>
> Show corresponding buyer choices, factual details and stock. Preserve selections and add-on descriptions through checkout. Support fixed pricing and seller-bounded buyer commitments; an offer requires explicit seller acceptance. Compare equivalent measurement units, and require combined filters to match one actual variant. Never silently change brand, condition or checkout price.
>
> Implement authenticated APIs and database transactions separately from browser storage. Validate ownership, all selected IDs, prices, offer bounds and stock on the server. Link integer 1–5 reviews to the authenticated buyer's delivered purchase, enforce one product vote per buyer, and maintain cached aggregates. Never mark browser-only feedback verified.
>
> Acceptance examples: 1.7 litres and 1,700 ml match the same volume range; red/S and blue/M do not match red/M; changing 128 GB to 256 GB selects its own SKU/stock/price; a K1,000 unit plus a K100 accessory at quantity two totals K2,200; a used item without condition notes is rejected; a 5.5-star review is rejected; review filters leave the overall summary unchanged. Verify meaningful model, database and browser workflows and report remaining backend limitations explicitly.

## Reference and review routes

Amazon references informed related-product variation families, factual listing details and review navigation: [variation listings](https://sell.amazon.com/blog/amazon-variation-listing), [product listings](https://sell.amazon.com/blog/amazon-product-listings), and [review filters](https://www.aboutamazon.com/news/retail/amazon-customer-reviews-star-ratings). Buyer commitment pricing is Zed Supply's own requested workflow.

Use `index.html?demo=1&theme=off#/product/L005` for pack-size variants and open-box details, and `#/search` for measurement/condition/price filters. Demo data is labelled sample data. Seller listings are saved only on the current device.
