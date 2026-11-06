# Connected marketplace implementation and activation

1 November 2026. The owner requested that integrations be built while live
activation remains disabled. No hosted migration, account message, payment,
refund, notification or deployment was performed by this implementation.

## Status of the five priorities

| Priority | Implemented in the repository | Still required to activate |
| --- | --- | --- |
| Verified accounts and checkout | Supabase email OTP, server-confirmed contact identity, tab-scoped session and refresh, account-owned orders, server catalogue mapping, quote-before-order and expected-total rollback. Client prices/user IDs do not authorize checkout. | Apply migrations 017–019 after 016, configure hosted Auth/email delivery, test against staging, supply public configuration and approve activation. |
| Payments, reconciliation and refunds | Stable server payment-attempt references, duplicate/uncertain-attempt protection, verified-account authorization, ZMW/cents validation, immutable payment references, refund ledger with replay/amount checks, full-refund state and unpaid-payout blocking. | Select a provider, implement its actual adapter, validate callbacks/signatures, collection/refund/settlement APIs, idempotency semantics and sandbox outcomes. Generic mapping is a test contract, not a completed provider integration. |
| Delivery and support | Seller/staff fulfilment form, append-only per-seller shipment events, legal transition checks, private proof uploads, complete-order delivery only after all sellers' parcels complete, buyer timeline, account-owned support requests, escalation and staff assignment queue. | Confirm couriers, delivery prices/coverage, receipt-evidence procedures, support ownership and response commitments. Automated courier feeds and full return-label/reverse-logistics integration remain to be connected. |
| Business/policy/VAT | Explicit unverified business settings, VAT display disabled outside demos pending verification, server quote guard for unverified VAT configuration, and `npm run check:launch`. | Actual legal name/address/hours, approved delivery/returns policies and verified VAT status/TPIN. Values cannot be inferred from a logo or a sample catalogue. |
| Crawlable URLs and search | Generated `shop/` department/product HTML, canonical/Open Graph/product metadata, sitemap, sample exclusion, stale-generated-product retirement, indexed server search with bounded cursor pagination. | Approved real product data and a scheduled build/update process; richer server facets and search ranking measurement remain future work. |

## Safe defaults

- `settings.api.enabled` is **false**; URL and publishable key remain empty.
- `settings.payments.prompt` and `contractValidated` remain **false**.
- `PAYMENT_CONTRACT_VALIDATED` must be exactly `true` on the server before
  payment prompts or webhooks are accepted, in addition to provider secrets.
- VAT registration is not asserted for the live storefront. Demo mode retains
  explicitly fictional tax examples. Backend `shop_settings.vat_registration_verified`
  must be reviewed alongside `vat_registered`; quotes and new expected-total
  checkout reject unverified registered-tax settings.
- Buyer protection, lay-by and unsupported payment methods remain disabled
  outside previews. No production guarantee was enabled.
- Server mode ignores prototype profiles and listing overrides. Prototype
  reviews, questions, alerts, address management and unconnected seller/staff
  management are not represented as connected services.

`npm run check:launch` currently exits unsuccessfully by design and identifies
missing business facts and activation prerequisites. Passing it later verifies
configuration completeness only, not hosted security or operational readiness.

## Staging setup

1. Apply migrations **016 → 017 → 018 → 019 → 020 → 021 → 022 → 023 → 024** in order. Deploy handlers only after
   their supporting migrations. Never edit or rerun a previously applied migration
   in a hosted project; these new migrations have only been applied to an isolated
   local test database during this task.
2. Configure confirmed email sign-in, an approved sender/SMTP service, hosted
   sign-in limits and appropriate abuse protection. Set the email template to
   include the one-time `{{ .Token }}` code expected by the UI. Confirm the allowed
   site/redirect settings. [Supabase passwordless email documentation](https://supabase.com/docs/guides/auth/auth-email-passwordless)
3. In staging, set `settings.api` to the hosted project URL and **publishable** key
   and `enabled:true`. Never put a secret/service-role key in website files.
   Review the matching backend tax/business configuration with verified facts.
4. Exercise two separate buyer accounts and a store operator. Verify token expiry,
   no cross-account reads, quote changes, unavailable options, duplicate order
   requests and failures during checkout. Quotes roll back their temporary stock,
   orders and notification effects; placing an order reserves stock.
5. Test actual private proof uploads as an operator. A completed shipment needs
   an object in the private `delivery-proofs` bucket; a filename alone is not
   accepted. Uploads use fresh, immutable names. Define evidence retention,
   validation/scanning and orphan cleanup before opening this feature to sellers.
6. Validate the provider contract in its sandbox before setting payment flags.
   Unknown payment attempts are deliberately not retried automatically. Reconcile
   with the provider before marking them failed or confirmed. Staff close a
   prompt that never settled with `staff_close_payment_attempt(attempt, note)`,
   which is logged and can only mark it failed; only the provider's webhook
   confirms money. A webhook that doesn't echo the attempt `reference` settles
   the order's one pending request of the same amount. The current UI
   blocks payment while a delivery fee is unconfirmed. No automated fee-acceptance
   or courier-rating integration has been invented.
7. Connect the provider's confirmed refund events to `app.record_refund()` via a
   trusted server process. The browser cannot execute it. Refund-event records
   represent reconciled evidence; inserting a record does not send funds. Test
   partial/full refunds, duplicate/out-of-order callbacks, payouts and discrepancies.
   Accounting for previously paid-out seller funds still needs an operational process.
8. Confirm policy and company facts, configure support owners/response hours, set
   `allowDemo:false` for the real launch and run configuration, browser, database
   and operational checks before enabling production.

The configured standard rate is consistent with ZRA's published VAT material;
that does not verify **this business's** registration or which supplies are taxable.
Check the actual ZRA record/certificate and appropriate tax treatment before
enabling live VAT. [ZRA VAT guide](https://www.zra.org.zm/wp-content/uploads/2021/05/VAT-Guide-2021.pdf)

## Store teams

Migration 020 lets a store's owners build a team (021 pins a helper's search path). Both are applied to the hosted project.

- **Roles.** Owner (everything, including the team and payouts), Manager (store details, listings,
  prices, offers, promotions, deals, orders, shipments and complaints), Listings (products, prices,
  stock, photos, offers and buyer questions), Dispatch (orders, packing, shipments and delivery
  proof) and Finance (orders, sales and payouts, view only). Every store rule in the database now
  checks the role, not just membership. Existing members keep owner rights; the unused `staff`
  role becomes `manager`.
- **Invitations.** An owner invites an email address with a role from Seller Centre → Store team
  (`#/team`). The invitation shows on My Account only for the account that has **confirmed** that
  email, and expires after 7 days. No email is sent yet: the owner tells the person to sign in.
  Connect an invitation message to the notification sender before relying on that.
- **Safeguards.** Only owners invite, change roles or remove people; anyone can leave. A store
  always keeps at least one owner. Up to 20 people per store, counting open invitations, and 30
  invitations a day. Every change is kept in `seller_team_events`, shown to owners as "Recent
  changes". Zed Supply staff can manage any store's team; their changes are also in `staff_actions`.
- **First owner.** Staff still add a new store's first owner, as before (a `seller_members` row,
  which defaults to owner), or invite them with `seller_invite` while signed in as staff.

`db/tests/team.sql` covers invitations, each role's access, the last-owner rule, expiry, the size
limit and the logs. The demo Seller Centre has a browser-only preview of the same screen.

## Seller applications

Migration 022 replaces the WhatsApp hand-off for seller applications once connected mode is on.
Until then the live site still sends applications to WhatsApp.

- **Applying.** Sell on Zed Supply (`#/sell`) asks the applicant to sign in with their email, then
  stores the application: business, contact, phone (converted to +260…), town, optional PACRA
  number, departments and a description. One open application per account, at most 3 a month.
  The applicant follows it under My Account and can withdraw it while it is open, including
  while updating it after a request for more information.
- **Staff queue.** My Account → Seller applications (`#/staff-applications`) has To review (new
  and under review, oldest first), Awaiting applicant (more information requested), Approved, Not
  approved and Withdrawn views, 25 per page with Next and Previous pages. Search matches business,
  contact person, email, phone (typed as 0977… or +260977…), town and PACRA number. Staff can mark one
  under review, ask for more information or reject (both need a message the applicant sees), or
  approve. Asking for more information lets the applicant update and resubmit the same application.
- **Approval** opens the store in one step: a `sellers` row (verified, using the store ID and name
  staff confirm), with the applicant as its owner. **VAT is off** on new stores; set
  `vat_registered` and the TPIN only after checking them with ZRA. Check the PACRA number on the
  PACRA register before approving; the site does not check it.
- **Records and messages.** Every staff decision is in `staff_actions`. Each decision also queues
  the WhatsApp template `seller_application_update` (see `supabase/functions/README.md`): create it
  in WhatsApp Manager and redeploy `send-notifications`, or those messages are skipped. The
  outcome always shows on My Account.

`db/tests/applications.sql` covers applying, privacy between applicants, the staff decisions,
resubmission, approval opening the store with its owner, withdrawal and the limit.

## Trade buying

Migration 023 adds the first phase of buying for farms, building sites, shops and companies. It
works in demo mode now and on the server once connected mode is on. Migration 023 is not yet
applied to the hosted project.

- **Selling units.** A listing can be sold by the bag, tonne, sheet, m³ and other units
  (`sell_unit`; the list matches `SELL_UNITS` in `js/products.js`). Prices, cart lines and
  WhatsApp messages then say "K185 per bag" and "150 bags".
- **Trade quantities.** A listing marked `trade` takes up to 9,999 per order line instead of 99,
  with an optional minimum order (`min_order_qty`) and multiples (`order_step`). Bulk prices reach
  9,999 for trade listings and start above the minimum. `place_order` enforces all of this, so a
  changed browser can't get round it. Carts kept with the account hold up to 9,999.
- **Heavy items.** `heavy_delivery` marks items that go by truck or are collected. Checkout lists
  them with their total weight when sellers give `unit_weight_kg`, and the order is flagged
  `heavy_delivery` so the seller and staff know the delivery fee needs a quote. Payment already
  waits for the delivery fee, so no extra rule is needed.
- **Business details.** Buyers save a business name, optional TPIN (10 digits) and billing
  address in My Account (`set_business_details`), or enter them at checkout. They are copied onto
  the order (`orders.business_*`) and shown on the order and its printable summary, labelled as an
  order summary, not a tax invoice. The `place-order` function passes these three fields through;
  redeploy it with the other edge functions.
- **Sellers** set all of this under "Trade and bulk buying" when adding a product, or with the
  optional `unit, minQty, multiples, heavy, weightKg` columns in the spreadsheet upload.

`db/tests/trade.sql` covers the listing rules, bulk prices, ordering limits, the business details
and the truck flag. Later phases (quote requests, company accounts with approvals, seasonal
pre-orders) are not built.

## Delivery handover codes

Migration 024 gives every order a private 6-digit handover code (`order_handover_codes`), issued
by a trigger when the order is placed. Migration 024 is applied to the hosted project.

- **Only the buyer can read it**, on their order page. Sellers, riders and staff can't, so nobody
  else can confirm a delivery for the buyer. A share link lets the buyer pass it to whoever is
  receiving a gift.
- **The rider or seller enters it** in Store fulfilment once the parcel is in the buyer's hands
  (`record_handover`). It records the delivery, or the collection for collection and pickup orders,
  without photo evidence, marks the event `handover`, and once every store on the order has
  handed over, marks the order delivered, which starts the payout hold.
- **Wrong codes are counted.** After five the code locks and the delivery needs private photo
  evidence through `record_shipment`, which stays available when the buyer can't be there.
- Orders still on their way when 024 is applied get a code too. Codes aren't sent by WhatsApp or
  SMS yet: buyers without an account (guest orders) can't see theirs, so their deliveries use
  photo evidence until a notification template is added.

`db/tests/handover.sql` covers issuing, who can read the codes, the handover itself across two
stores, wrong codes and the lock.

## Delivery fees, receipts and courier tracking

Migration 025 prices delivery on the server and adds receipts and courier tracking. It is not yet
applied to the hosted project.

- **Rate card.** `delivery_rates` holds one row per zone (same town, same province, elsewhere in
  Zambia) and speed (standard, express, same day, truck), with the kilograms the fee includes and
  the price of each further kilogram, and optionally a courier's own price. Each seller's parcel is
  priced on its own. `app.delivery_quote()` and `js/delivery.js` apply the same rule, and
  `tests/delivery.test.cjs` and `db/tests/checkout_delivery.sql` check the same figures, so the
  fee in the cart is the fee charged. The table starts **empty**: until real rates are added,
  delivery stays "quoted before you pay" exactly as before. Add the same rates to
  `settings.delivery.rates` in `js/catalogue.js` so the storefront shows them.
- **Free delivery and same day.** `shop_settings.free_delivery_min_zmw` (empty = off) and
  `free_delivery_zones`; same day needs `same_day_towns`, the seller's `seller_locations.same_day`
  and an order before `same_day_cutoff` (Zambian time) on an open day.
- **Checkout.** `place_order` now stores `delivery_zmw`, `delivery_speed` and one `order_parcels`
  row per seller, and refuses the order if the delivery fee differs from `expected_delivery_zmw`
  (the fee the buyer reviewed). With a fee in place, the buyer can pay at once: staff no longer
  need to confirm it by hand. Parcels with no rate still wait for staff, as before.
- **Couriers' live prices.** The `courier-quote` function prices from the rate card and, for one
  connected courier, asks the courier's API instead (`COURIER_API_URL`, `COURIER_API_KEY`,
  `COURIER_API_COURIER`, `COURIER_CONTRACT_VALIDATED=true` after its sandbox passes). A live price
  is saved for 30 minutes (`delivery_quotes`) and charged only for the same cart and destination.
  No courier is connected yet: none of the couriers listed publishes an API we've verified.
- **Tracking.** A seller's tracking number at dispatch reaches the parcel. A connected courier
  posts events to `courier-webhook` (signed with `COURIER_WEBHOOK_SECRET`), recorded once each
  (`courier_tracking_events`) and shown to the buyer; "out for delivery", "delivered" and "failed"
  also queue a `parcel_update` message. A courier's "delivered" doesn't complete the order: the
  handover code or photo evidence still does, so payouts aren't released on a courier's word.
- **Receipts.** `order_receipt()` (buyer or staff only) feeds the receipt page, which prints or
  saves as PDF on its own. `send_receipt()` queues it to a Zambian WhatsApp number or an email
  address, five times a day per order. A `receipt_email` given at checkout is sent automatically.
  Email goes through `send-notifications` once `EMAIL_API_KEY` and `EMAIL_FROM` are set (Resend's
  API by default; `EMAIL_API_URL` for another provider with the same format). WhatsApp needs the
  `order_receipt` and `parcel_update` templates approved first.

## Delivery prices in one place, guest handover codes and rider sign-up

Migration 028 is not yet applied to the hosted project.

- **One source for delivery prices.** The database's rate card and delivery settings are the only
  place prices live. The storefront loads them at start (`delivery_settings()`), so the cart shows
  exactly what checkout charges; `js/catalogue.js` no longer holds prices. Without a connection
  the fee is confirmed on WhatsApp, as before. Demo mode uses the sample card.
- **Staff edit them on the site.** My Account → Delivery prices (`#/staff-delivery`, staff only):
  rates per courier, zone and speed, free delivery, same-day towns and cut-off, closed days, the
  default parcel weight and the sending town for items without a seller location. Changes go
  through `staff_save_delivery_rate`, `staff_delete_delivery_rate` and
  `staff_set_delivery_settings`, which check them and log each one in `staff_actions`; direct
  writes to `delivery_rates` are no longer allowed.
- **Couriers' live prices in the cart.** Choosing a courier asks `courier-quote`; when that
  courier is connected, its price replaces the rate card, is held for 30 minutes and is charged
  at checkout (`delivery_quote_id`).
- **Handover codes for guests.** The code goes on WhatsApp to the order's phone when it's
  dispatched (template `handover_code`), and `place-order` returns it to a guest straight after
  ordering. The storefront's connected checkout still asks buyers to sign in, so guest orders come
  from WhatsApp orders that staff record or from other channels using `place-order`.
- **Receipts as PDF files.** "Download PDF" builds an A4 PDF in the browser (`js/receipt-pdf.js`),
  with the same design and logo; Print stays available.
- **Rider sign-up**, behind `settings.riders.open` (off). Riders apply from a verified account;
  staff (`#/staff-riders`) review, ask for more, invite them to in-person checks and only then
  approve: the database refuses an approval that skips the checks. No ID or licence numbers are
  collected online. The checks listed are proposals: confirm them before opening sign-up.
  Template `rider_application_update` tells riders each decision.

## Native catalogue pages

Run `npm run build:storefront` after approved catalogue changes. It currently
generates 26 department pages plus the department index, and zero product pages
because the live catalogue is empty. It never indexes sample listings.

For server-managed listings, export an approved public snapshot and set
`STOREFRONT_SNAPSHOT` to its local JSON path when building. Product objects may
use the current catalogue field names or the supported database names. Supply
`SITE_URL` for a different HTTPS production origin. Rebuild on publication/removal
and price/content changes. The generator removes only previously generated HTML
listed in its manifest and bearing its ownership marker, preserving unrelated files.

The frontend uses indexed `catalogue_page()` reads rather than downloading the
entire catalogue for search. Cursor pagination has a bounded page size and active
listing visibility. Dedicated server filters for every rich product attribute and
advanced relevance tuning are not yet implemented.

## Validation boundaries and next work

Local verification completed with 56 Node regression tests, 30 light/dark Chrome
browser cases, all 19 migrations, all eight SQL suites, concurrency tests and
repeatable reference seeds. Branding coverage includes 113 exports and their
hashes; department alpha and image budgets remain checked. Hosted services and
provider contracts were not exercised. The launch check fails intentionally
while required facts and approvals remain absent.

Node and browser contract tests cover disabled activation, verified contact checks,
expired sessions, variant/add-on identifiers, quote review/invalidation, trusted
checkout identity and pricing, branding exports and static-page safety. New SQL
tests exercise ownership, rollback, shipment evidence, support escalation,
payment attempts and refund limits on PostgreSQL. Browser service responses are
mocked; they do not prove the hosted Auth/provider configuration works.

Before production, complete actual provider/courier acceptance, robust payment
and settlement monitoring, guest access tokens if guest online payment is added,
unpaid reservation-expiry policy, recovery after a tab is closed during submission,
support conversations and reverse logistics, server-backed review/address/alert
management, upload scanning/retention, staff MFA and deployment headers/rate limits.
These are explicit remaining tasks, not hidden behind working interface previews.
