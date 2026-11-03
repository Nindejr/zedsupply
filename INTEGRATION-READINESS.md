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

1. Apply migrations **016 → 017 → 018 → 019 → 020 → 021 → 022** in order. Deploy handlers only after
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
  The applicant follows it under My Account and can withdraw it while it is open.
- **Staff queue.** My Account → Seller applications (`#/staff-applications`) lists waiting
  applications oldest first, with Approved, Not approved and Withdrawn views. Staff can mark one
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
