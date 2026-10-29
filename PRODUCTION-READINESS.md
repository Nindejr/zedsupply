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

They can't work for real until a server stores them. The database for that server is designed and tested (migrations 001–009 pass on PostgreSQL 18, including concurrency tests), but nothing connects the website to it yet.

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

## Recommended backend

The database is PostgreSQL, so a managed PostgreSQL platform with built-in phone sign-in, file storage and server functions fits best. Supabase is one example, and it's named in the Phase 2 plan. Migrations 001–009 can be applied as they are.

Map the sign-in identity to the `users` table (the migrations use numeric IDs, while Supabase Auth uses its own identity). Keep the website static, and have it call the API.
