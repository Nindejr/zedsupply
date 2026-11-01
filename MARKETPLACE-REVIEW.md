# Zed Supply marketplace review

Follow-up implementation: [global marketplace ideas](GLOBAL-MARKETPLACE-IDEAS.md)
and [integration readiness](INTEGRATION-READINESS.md) record the subsequent branding
and connected-service work. The owner has now approved pixel branding on sample
artwork, superseding the earlier unmarked artwork approach. Live activation stays off.

Reviewed 1 November 2026. Scope: repository code, catalogue, product model, CSS,
brand and artwork references, offline worker, SQL migrations and security rules,
server handlers, automated checks, and public marketplace documentation. This is
a development assessment, not a penetration test, legal opinion, or certification.
Hosted configuration, live transactions, backups and seller operations were not
verified or changed. Recommendations below are proposed work unless listed as
implemented in this review.

## Position and most important decision

Zed Supply is a Zambia-first, multi-seller marketplace for households and business
buyers, with ZMW prices, local discovery, optional collection, mobile money and
WhatsApp ordering. Its useful distinction is supporting everyday and SME buying
on limited connectivity. Preserve this identity instead of copying the scale or
visual density of a global marketplace.

The repository contains a capable storefront and substantial backend foundations.
It is not yet an integrated self-service marketplace: `settings.api.url` and `key`
are empty, account creation records details locally, and checkout creates a
WhatsApp message. Setting an API URL alone will not connect the missing workflows.
Migrations 014–015 and the server functions already implement significant order,
stock and payment logic; they need authenticated frontend integration and
provider-specific operational validation, rather than a duplicate implementation.

## Comparison and remaining work

The benchmark is the combination of discovery, trustworthy product information,
reliable transactions and effective after-sales service. For example, eBay ties
buyer protection to eligible purchases and payment methods, delivery evidence,
case deadlines and escalation. A badge alone does not provide that capability.
[eBay policy](https://www.ebay.com/help/policies/ebay/ebay?id=4210)

Takealot supports delivery or pickup and return collection or drop-off through
pickup points. These are useful regional service patterns; their presence here
requires actual locations, fulfilment agreements and return operations.
[Takealot terms](https://terms-and-policies.takealot.com/terms-conditions/),
[returns policy](https://terms-and-policies.takealot.com/)

| Area | What Zed Supply has | Gap and recommended next implementation |
| --- | --- | --- |
| Discovery | 26 departments, subcategories, search, typo suggestions, attribute/price/stock/rating filters | Server-side indexed, paginated search; URL-preserved facets; useful no-results recovery; validate ranking with real buyer searches |
| Product information | Rich specifications, condition notes, variants, stock/SKUs, add-ons, offer ranges, zoom | Published data completeness checks; approved actual-item photos; provenance and update dates; compatibility/size guides and warranty evidence |
| Product comparison | Seller comparisons and comparison tools | Like-for-like total delivered cost and availability; normalize pack sizes and compatible variants; show missing data explicitly |
| Accounts | Browser-only profile; database Auth links and ownership rules | Real verified sign-in, recovery, session expiry, cross-device persistence; staff MFA and step-up checks for sensitive operations |
| Checkout | Guest-friendly WhatsApp handoff, options retained, server repricing/locking code | Cart adapter calling the existing server function; show server totals before acceptance; recover interrupted checkout without duplicate orders |
| Payments | Mobile-money selection; signed generic webhook and payment ledger foundations | Choose and validate an actual provider, currency/amount verification, stable payment-attempt idempotency, settlement reconciliation, refunds and failure recovery |
| Guest order access | Local order lookup; server payment handler uses order reference and phone for guests | Verified contact or a short-lived, high-entropy order-access token; a phone number is identifying information, not strong authentication |
| Delivery | Town/province matching, collection options, estimates and preferred slots | Real coverage/rates, seller-specific shipment records, courier tracking events, failed delivery flow and proof of delivery/collection |
| Buyer protection | Preview copy, payout holds and complaint logic in the backend | Provider-supported funds flow, published eligibility and exclusions, evidence collection, deadlines, escalation and a tested refund process before enabling |
| Returns | Forms, references, policy placeholders and schema | Return authorization, item-level eligibility, return labels/drop-off instructions, receipt inspection and visible refund status |
| Seller operations | Listing editor, CSV import, promotions, stock planner, performance/trust foundations | Authenticated onboarding, pending-review publication, inventory sync, fulfilment queues, statements, fee disclosure and verified payout details |
| Trust and reviews | Sample trust figures, explicit unverified local reviews; purchase-linked database rules | Serve only computed verified figures from the backend; moderation, abuse reporting, seller response and appeal; explain verification criteria |
| Notifications | Local alerts/searches, queued WhatsApp templates, durable claims added in this review | Connect opt-ins and event producers; approve templates; monitor queues, provider receipt IDs and delivery outcomes; reconcile ambiguous sends |
| Privacy | Consent controls, masked personal fields, device export/deletion added | Authenticated server export/deletion requests, retention jobs, staff access logs, tested restoration and vendor data-flow review |
| Accessibility | Semantic controls, focus handling, keyboard zoom, reduced motion and dark mode | Manual keyboard and screen-reader journeys, text reflow/zoom and error recovery; automated checks cannot establish full conformance |
| Performance | WebP, lazy images, system fonts, data saver and offline worker | Field performance measurement, responsive product thumbnails/srcset, bounded offline cache, paginated catalogue and search as inventory grows |
| SEO and sharing | Metadata and organization structured data; hash routes | Crawlable product/category URLs with rendered content, matching canonical/Open Graph data, real availability/price structured data and a product sitemap |
| Security operations | CSP meta tags, input checks, RLS, moderation, signed webhooks and tests | Server security headers, per-actor rate limits, dependency/secret scanning, security monitoring, least-privilege deployment roles and response playbooks |
| Reliability | Stock and repeat-order concurrency tests; CI added | Staging provider sandbox, deploy/rollback checks, uptime alerts, restore drills, reconciliation dashboards and an owner for incidents |
| Business procurement | Bulk prices, requests, seller tools | Quote-to-order workflow, company purchasing roles, purchase-order references and approved invoicing; validate demand before building credit terms |
| Language | Translation menu/framework, English available | Native-speaker-reviewed local-language content for complete buying and support journeys; translated static navigation alone is insufficient |

## Improvements implemented in this review

- **Notification concurrency:** migration 016 persists a processing lease and a
  unique claim token. Overlapping jobs cannot reclaim a batch in flight; expired
  workers cannot overwrite a later claim. Ten-minute expiry supports recovery;
  five attempts bound retries. Provider requests have a 15-second timeout.
- **Request boundaries:** JSON bodies are counted in bytes while reading, before
  full allocation/parsing. Signed webhooks reject null/array payloads and nonfinite
  payment amounts. Payment calls reject expired sign-ins instead of falling back
  to guest authorization. API responses carry `Cache-Control: no-store` and
  `X-Content-Type-Options: nosniff`; provider failures do not log response bodies.
- **Shared-device privacy:** `#/device`, reachable from My Account and the privacy
  page, exports saved data and offers explicit confirmed deletion. Deletion uses
  an application-key allowlist and preserves consent, language, data saver and
  unrelated storage. It does not claim to erase WhatsApp or business records.
  Corrected the previous statement implying sign-out deleted all local activity.
- **Honest offline browsing:** an accessible status notice explains that cached
  prices and stock may be older and availability must be confirmed after reconnecting.
- **Photo reliability:** review submissions wait for photo preparation; a stale
  asynchronous photo result cannot overwrite a newer selection or another form.
  A storage failure keeps the form open and reports the failure instead of
  claiming the review was saved.
- **Touch accessibility:** category-directory subcategory links now have 44-pixel
  minimum height, addressing the WCAG 2.2 target-size finding in browser checks.
- **Artwork integrity:** replaced the L041 listing's inaccurate alphabet render
  with a 600 × 600, approximately 19 KB shape-puzzle render and aligned the title,
  alt text, tags, description and included components. The existing 3D lighting,
  materials and near-white product background are retained. Prompt provenance is
  in `assets/artwork-prompts.json`.
- **Release checks:** pinned development dependencies, lockfile, unit/handler and
  artwork tests, light/dark browser accessibility and layout checks, device privacy
  and offline checks, and GitHub Actions jobs for storefront and PostgreSQL rules,
  migrations, seed repeatability and concurrency. No runtime framework was added.

The earlier review's service-worker scope/cache fixes and oversized-cart rejection
remain in place. No hosted migration, payment, notification, publication or real
customer-data deletion was performed in this review.

Validation: 47 Node regression/handler/artwork checks and 26 Chrome browser checks
passed. Browser checks cover 11 page types in mobile light/dark mode, with axe
WCAG 2.2 rules, plus offline and device-export/deletion flows. Six existing database
concurrency cases, three HTTP/database scenarios and the new notification lease
checks passed on an isolated PostgreSQL 18 database rebuilt with all 16 migrations
and all seven SQL suites. The reference seed applied twice successfully. Contact
sheets were inspected for 26 department images, 55 product files and 32 banner
files, alongside desktop/mobile storefront screenshots. Temporary review artifacts
are removed after verification. Hosted CI itself has not been run by this review.

## Visual and content direction

Keep the original dimensional ZS wordmark, navy/blue foundation, green action
colour, teal decoration and restrained gold promotion accents. Existing product,
department and seasonal-banner references have a coherent polished 3D direction.
Avoid replacing it wholesale or using flat symbols as primary department artwork.
Retain SVGs for controls and data-saver fallbacks. System fonts avoid an additional
network dependency; an optional brand typeface should justify its download cost.

| Surface | Production standard and improvement |
| --- | --- |
| Product imagery | Complete item, consistent scale, accurate colour/materials, 600-pixel near-white square render for illustrative samples; real sellers supply approved actual-item photos. Provide wear/detail/packaging shots for used goods. Generated artwork cannot prove real stock or condition. |
| Department imagery | Transparent, dimensional blue/teal/green compositions; existing assets are square at 200–256 pixels. New artwork follows the 256-pixel guide. Tests enforce transparency, framing and the 80 KB budget. |
| Promotional banners | Keep separate desktop/mobile compositions and HTML copy. Prioritize legibility and one clear offer; no baked-in sample labels, fake scarcity or invented discount history. |
| Icons | Use the established interface SVG family, accessible names and consistent stroke/size. Never rely on a colour or emoji alone to communicate a transaction state. |
| CSS | Keep shared colour/spacing tokens, visible focus, dark-mode contrast and large touch targets. Audit repeated one-off styles before expanding the visual system. |
| Brand content | Complete real service areas, support hours, seller fees, returns terms and verified company details. Reconcile stale private brand notes with the implemented categories, system fonts and current seasonal dates. |
| Catalogue quality | Require department/subcategory consistency, actual contents, condition, variant-specific photos and current stock. Reject unsupported certification, warranty or safety claims. |

All referenced catalogue artwork is checked for file existence. Product dimensions,
format and size budgets and actual department transparency are checked automatically.
Human review remains necessary for subject accuracy, composition and authenticity.

## Delivery order and acceptance gates

### 1. Close launch blockers

Connect verified sign-in and the existing checkout function in a staging environment.
Keep staff and seller roles assigned on the server. Wire APIs through explicit
adapters so product options, add-ons, addresses and commitments retain their meaning.
Verify cross-account access denial and token expiry through complete browser flows.

Before enabling automated payments: integrate the chosen provider's documented
signature and status formats, authenticate guest order access, rate-limit prompts,
use a persisted payment-attempt key, reconcile settlement and test full/partial
refunds and duplicate/out-of-order callbacks. Never retry an uncertain payment
blindly. Durable notification claims improve concurrency but do not promise
exactly-once external delivery after ambiguous provider failures.

Complete delivery prices and policy placeholders. `settings.vat.registered` is
currently true while the TPIN is a placeholder: verify the real business status
and correct the live configuration before accepting taxable orders. This review
does not infer registration or change tax policy. Keep buyer protection, lay-by
and unsupported payment methods disabled until their operational prerequisites
have been verified.

Use a hosting configuration capable of response headers for `frame-ancestors`,
HSTS and MIME protection. A meta CSP and JavaScript frame guard do not replace
those headers. Configure rate limits for sign-in, guest checkout, questions,
uploads, CSV imports and payments at the service boundary. Treat the backend's
security-definer functions and service credentials as privileged entry points.

### 2. Make fulfilment and support observable

Connect shipment events, return/complaint conversations and refund status to the
authenticated order. Add a staff queue with case ownership and overdue actions;
log privileged decisions and verify changes to payout destinations. Add alerts
for payment mismatches, stuck notification claims and paid orders without a
fulfilment update. Test restore and rollback procedures against isolated data.

### 3. Improve discovery and scale from evidence

Introduce crawlable URLs, product metadata, server search and pagination. Measure
real device performance before optimizing: target good Core Web Vitals at the
75th percentile (LCP ≤2.5 s, INP ≤200 ms, CLS ≤0.1). No field performance result
is claimed here. [Google thresholds](https://developers.google.com/speed/docs/insights/v5/about)

Test low-bandwidth mobile browsing, keyboard-only checkout, screen-reader forms,
200–400% zoom, long names and error recovery. WCAG 2.2 AA is the accessibility
target; automatic axe scans cover only part of it.
[W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/)

Use OWASP ASVS 5.0 as a security verification backlog, with a documented threat
model and evidence for identity, ownership, file handling, payments and privileged
operations. Passing regression tests is not an ASVS compliance claim.
[OWASP ASVS](https://asvs.owasp.org/)

## Ways to outperform familiar marketplace patterns

These are proposed differentiators, not claims about all competitors:

1. **A clear delivered-cost comparison:** show item, selected options, delivery,
   applicable tax and total before commitment; name any cost still awaiting a
   quote instead of presenting an incomplete number as final.
2. **Evidence behind trust:** explain what was verified, when stock was updated,
   what a warranty covers and how seller statistics are calculated. Separate
   sample content, seller claims and transaction-backed facts.
3. **Good service on a weak connection:** preserve cart choices and support an
   intentional WhatsApp handoff while clearly identifying stale offline data.
   Revalidate every stock/price decision on the server before an order is accepted.
4. **Useful product compatibility:** normalized sizes, pack quantities, voltage,
   solar compatibility and model fit can reduce avoidable returns. Missing details
   should trigger a question or quote, not an unsupported recommendation.
5. **Visible resolution:** give each delivery or return problem an owner, next
   action and due date, with accessible escalation. Measure actual resolution
   outcomes before advertising a service promise.
6. **Respectful choice:** retain guest checkout, device privacy controls, reduced
   motion, data saver and clear opt-ins. Avoid manipulative urgency, hidden fees,
   preselected extras and unsubstantiated ratings.

Implement and measure these foundations before personalization, loyalty schemes,
credit, advertising expansion or AI shopping recommendations. The immediate
competitive opportunity is dependable local commerce with clear evidence and
costs, supported by the visual system already established.
