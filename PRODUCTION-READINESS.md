# Production readiness

Reviewed 29 October 2026. Leaves out the business and legal steps (PACRA registration, TPIN and VAT registration, street address, hosting and domain), and lists only the technical work.

## Where things stand

Zed Supply works in production today as a **WhatsApp-ordered storefront**. Zed Supply edits the catalogue in `js/catalogue.js`. Buyers browse, search, filter, set their location, see delivery estimates and send itemised orders on WhatsApp. Zed Supply staff then confirm the price, delivery and payment.

The marketplace features are **prototypes that live only in each visitor's browser**:

- sellers listing and editing their own products
- buyer accounts
- order tracking
- reviews
- complaints
- saved addresses
- seller promotions, deals and store locations

They can't work for real until a server stores them. The database for that server is designed and tested (migrations 001–010 pass on PostgreSQL 18, including concurrency and row-level security tests), but nothing connects the website to it yet.

So there are two possible launches:

1. **Stage 1, WhatsApp marketplace (close to ready).** Zed Supply manages the catalogue and every order. This needs only the "Before launch" list below.
2. **Stage 2, self-service marketplace.** Sellers manage their own stores and buyers have real accounts. This also needs the backend work further down.

## Fixed in this review

| Issue | Why it mattered | Fix |
| --- | --- | --- |
| Order and complaint references came from the clock, using only the last 6 characters | They repeated every ~25 days, so two orders could share a number, confusing tracking, complaints and refunds | 8 random characters from the browser's secure generator, without look-alike characters: about 850 billion possibilities (`newRef` in `js/main.js`) |
| The seller application and contact forms discarded what people typed while no form service was connected | Lost leads | They now offer "Send them on WhatsApp" with the details filled in. The card-number guard still runs first. |
| Scripts and stylesheet had no version | After an update, a visitor could get a mix of old and new files, causing errors | `?v=20261029` on every page, and on files loaded later. Change it on every page when releasing. |
| `?demo=1` showed sample sellers to anyone | Could confuse real customers after launch | `settings.allowDemo: false` turns demo mode off |

## Before launch (no server needed)

| Item | Where | Notes |
| --- | --- | --- |
| Delivery times by distance | `settings.delivery.estimates`, `cutoff` | Without them, buyers see "confirmed on WhatsApp" instead of dates |
| Delivery areas, times and costs; opening hours; team names and roles; seller fees | help centre and Seller Centre placeholders | Shown to buyers and sellers as `[ … ]` until filled in |
| Returns policy | help centre, `orderOptions.returns` | Interim; review with legal advice |
| Card payments | `paymentMethods` (`provider`, `enabled`) | Off until a licensed payment provider account is open |
| Form service | `FORMSPREE_ENDPOINT_HERE` in `help.html` and `js/main.js` | Optional now that forms fall back to WhatsApp |
| Advertising and analytics IDs | `js/ad-tags.js` | Placeholders are skipped safely; fill in or leave |
| Real products, photos and sellers | `js/catalogue.js` | 600 × 600 photos of the real items; then set `allowDemo: false` |
| Regenerate demo image L041 | `assets/products/demo/L041.webp` | Wrong letters in the generated puzzle; demo only |
| Release routine | every page | Bump `?v=` and run the tests: `node --test tests/*.test.cjs` |

## Self-service marketplace (needs a server)

These need the backend. They're listed in the order they depend on each other.

1. **Accounts and sign-in.** Sign-in by phone with a one-time code (SMS or WhatsApp), with buyer, seller and staff roles. Today an "account" is a name stored in one browser.
2. **API on the tested database.** Create, read and update for listings, orders, offers, reviews, complaints, addresses, cancellations, returns and seller locations.
   - The server must repeat the checks in `js/products.js` and never trust prices or stock sent from the browser.
   - Row-level rules must stop a seller seeing another seller's data.
   - The address-limit race shows why these rules belong in the database.
3. **Orders on the server.** The server should:
   - create the order and its reference, checking the reference is unused
   - recompute prices, deals, VAT and add-ons
   - reserve stock in the same transaction
   - notify the seller
   - drive the tracking timeline that is currently a fixed demo

   WhatsApp can stay as the conversation channel.
4. **Payments.** A licensed provider's API for mobile money and cards, with payment confirmations sent back by the provider (webhooks), reconciliation and refunds. Today payment is arranged by hand on WhatsApp.
5. **Notifications.** Automatic order, cancellation and complaint messages through the WhatsApp Business API, SMS or email. Today the buyer sends a pre-filled message.
6. **Back office for staff:**
   - verifying sellers
   - moderating listings, including the medicines rule
   - handling complaints, cancellations, returns and refunds
   - VAT figures for returns
7. **Photo storage.** Seller photos are now stored in the browser. They need server storage with size and type checks.
8. **Catalogue size.** The whole catalogue loads as one file, which is fine up to a few hundred products. Beyond that, search and listings need to come from the server, a page at a time.
9. **Search-engine visibility.** Product and category pages use `#/` addresses, which search engines don't index, and the sitemap lists 3 pages. A marketplace needs real product addresses (server-rendered or pre-built pages), product structured data and a sitemap of products.
10. **Security:**
    - HTTP headers from the host: Content-Security-Policy with `frame-ancestors`, HSTS, `X-Content-Type-Options`. A `<meta>` tag can't set these.
    - Rate limits and spam protection on sign-in, forms and complaints.
    - Secrets kept on the server, never in the website files.
11. **Personal data.** Encrypted storage and backups, retention periods, access logs and a way to export or delete a person's data. This supports the Data Protection Act 2021 obligations.
12. **Monitoring.** Error reporting from browsers and the server, uptime checks, and tested backup restores.
13. **Automated checks.** Run the JavaScript tests and the PostgreSQL migrations and tests (including `db/tests/concurrency.mjs`) on every push, for example with GitHub Actions and a PostgreSQL service.

## Backend: Supabase (free plan)

Review correction: migration 012 adds verified-contact account linking, removes privileged
access when an Auth identity is deleted, moderates product child-content edits, makes
public product photo paths immutable, and removes unnecessary whole-table privileges.
Migration 013 grants the table rights the security rules expect, which new Supabase projects
no longer give by default. Apply both migrations to the hosted project and enable email/phone confirmation in its
Auth settings before connecting real accounts. Local configuration changes do not change
the hosted project's settings. Staff and store access must be assigned by an administrator
after the person's identity has been verified; see `db/README.md`.

Zed Supply uses Supabase: managed PostgreSQL with sign-in, file storage and server functions. The website stays static and calls Supabase directly. The project is set up in `supabase/`.

**Done:**

- Migrations 001–010 are in `supabase/migrations`.
- Migration 010 adds:
  - sign-in linked to the `users` table, by phone, email or both
  - store members and staff
  - row-level security on every table
  - listing moderation
  - promotions, deals and vouchers
  - storage buckets for product photos and complaint files
- `supabase/seed.sql` loads departments, places and listing templates.

**Next:**

1. A server function that creates orders, and a skeleton for payment webhooks.
2. Sign-in and live data on the website.
3. Deployment.

Free plan limits to plan around:

| Area | Limit |
| --- | --- |
| Database | 500 MB |
| File storage | 1 GB |
| Data transfer | 5 GB a month |
| Monthly active users | 50,000 |
| Backups | None |
| Inactivity | The project pauses after a week without activity |
| Built-in email | Only a few messages an hour |

- Product photos stay small: 1 MB each at most, WebP preferred.
- Built-in email is too few for real sign-ups, so connect a free SMTP sender before launch.
- Phone codes need an SMS provider, which charges per message; email codes are free.
- Upgrade to a paid plan before taking real orders, for backups and to stop pausing.

**Keys and passwords:**

| Item | Where it can go |
| --- | --- |
| Project URL | Public: safe in the website |
| Publishable (anon) key | Public: safe in the website; row-level security is what protects the data |
| Database password | Never in the website or the repository |
| Secret (service_role) key | Never in the website or the repository; it ignores row-level security |

## Scale and reliability review (30 October 2026)

Checked against a large-store checklist (availability, consistency, security, checkout). Zed Supply is a static website on GitHub Pages's CDN with Supabase (managed PostgreSQL) behind it, on free plans. That suits the current size. The aim is to make checkout and data **correct** now and to move to bigger infrastructure only when traffic shows it's needed.

### Implemented foundations

Migration 014 prepares database functions; the storefront still uses local browser storage and WhatsApp checkout. Server checkout, verified sign-in, cart synchronisation and database search are not connected to the website yet. Stock reservation and server-calculated prices therefore apply only to orders placed through the future verified server endpoint. Guest retries must also be authorised by that endpoint; matching a phone number is not proof of ownership.

| Checklist item | How Zed Supply covers it |
| --- | --- |
| No overselling when many buy the last item | `app.place_order()` (migration 014) locks each product or variation row, checks stock and takes it in one transaction, in a fixed order to reduce deadlock risk. Stock can't go below zero. Tested with five buyers ordering the last item at once. Cancelling gives the stock back, once. |
| Charged once on double click or dropped connection | The order reference doubles as an idempotency key: sending the same order again returns the first one. Tested with the same order sent twice at once. The website's order link also ignores a second click. Payments must use the same reference as the provider's idempotency key (Stage 2). |
| Prices can't be tampered with | The database function works out prices, promotions (by province), deals, accepted offers, add-ons, vouchers and VAT from the database, excluding sellers marked as not VAT-registered. The browser sends only product, variation, quantity and choices. |
| Guest checkout | Orders can be placed without an account, with a name and phone number. The WhatsApp checkout needs no account already. |
| Carts on every device | `cart_items` keeps a signed-in buyer's cart. The website will sync it at sign-in (Stage 3). |
| Data security | HTTPS everywhere (GitHub Pages and Supabase). Sign-in by one-time code, so there are no passwords to store. Row-level security on every table, with tests for each role. Card numbers are never stored: the checkout warns if one is typed, and card payments will use a provider's hosted page. |
| API abuse | Supabase limits sign-in and code requests. Migration 014 limits how fast one account can post complaints, messages, reviews, offers, cancellations, returns and listings. |
| Input sanitising | The API uses parameterised queries, so SQL injection doesn't apply. The website escapes everything it shows (`esc()`), and the database limits text lengths. |
| Fast, light pages | WebP images sized for their slots, lazy loading, a CDN for every file, versioned files for caching. |
| Search that forgives typos | `search_products()` uses trigram matching on titles and tags ("solr panel" finds "solar panel"), with an index. Filters by colour, size, price, rating and condition already exist in the browser. |
| Indexes | Added the missing indexes that the security rules and joins use. |
| Graceful degradation | The storefront is static, so it keeps working if Supabase is down. Stage 3 must keep that: if the API fails, fall back to the WhatsApp order. |

### Planned

| Item | When |
| --- | --- |
| Payment idempotency and webhooks | Stage 2, with the payment provider. Store the provider's transaction ID with a unique constraint, so a repeated webhook can't credit an order twice. |
| Product pages search engines can read | Generate a static page and structured data (Product, Offer, AggregateRating) per product at publish time, plus a product sitemap. Needed once live sellers list products. |
| Error monitoring | Sentry's free plan for website errors; Supabase's built-in logs and query statistics for the database. |
| Automated tests on every push | A GitHub Actions workflow with a PostgreSQL service running the JavaScript, SQL and concurrency tests. |
| Load test | Before launch, a short k6 or Locust run against a copy of the project, never the live one. The free plan's limits will show first. |
| Backups | The free plan has none. Until upgrading, take a manual `npx supabase db dump` regularly and keep it off GitHub (the repository is public). |
| Project pausing | Free projects pause after a week without traffic. Upgrade before taking real orders. |

### Not needed at this size

| Item | Why not now | Revisit when |
| --- | --- | --- |
| Microservices | One managed database with small server functions is simpler, cheaper and has fewer ways to fail. Services can be split out later. | Separate teams own separate parts, or one part needs to scale on its own |
| NoSQL catalogue | PostgreSQL with JSONB already handles flexible product details, and one database keeps orders and stock consistent. | Catalogue reads outgrow PostgreSQL with caching |
| Redis cache, read replicas, auto-scaling | The static site is already on a CDN; Supabase handles the database. These cost money and add parts. | Database CPU stays high or queries slow down under real traffic (paid plans add replicas) |
| Elasticsearch or Algolia | PostgreSQL trigram search covers typos at this size, for free. | Tens of thousands of products, or search needs synonyms and ranking beyond tags |
