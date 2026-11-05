# Server functions

Small programs that run on Supabase (Edge Functions, Deno) for the jobs the website must never do itself.

| Function | Called by | What it does | Switched on by |
| --- | --- | --- | --- |
| `place-order` | The website at checkout | Sends the cart to `app.place_order()`. The database prices it, takes the stock and returns the order. The buyer comes from the sign-in token, never from the browser. | Deploying it, and setting `settings.api` in `js/catalogue.js` (Stage 3) |
| `start-payment` | The website, "Pay now" | Asks the payment provider to send a mobile money prompt to the buyer's phone for what's owed. On a new lay-by, this is the deposit. | `PAYMENT_API_URL`, `PAYMENT_API_KEY`, `PAYMENT_CALLBACK_URL` |
| `payment-webhook` | The payment provider | Checks the provider's signature, then records the payment once with `app.record_payment()`. A fully paid order is confirmed, and each seller's share is held. | `PAYMENT_PROVIDER`, `PAYMENT_WEBHOOK_SECRET` |
| `send-notifications` | A schedule, every few minutes | Sends queued order and alert messages as approved WhatsApp templates. Until WhatsApp is set up, messages wait in the queue. | `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `CRON_SECRET` |
| `daily-jobs` | A schedule, once a day | Releases seller payouts whose hold has passed with no open complaint, and cancels lay-bys not paid by their date. | `CRON_SECRET` |
| `courier-quote` | The website, at checkout | Prices delivery for the cart from the rate card (`app.delivery_quote()`), or from a connected courier's API when the buyer chose that courier. A live price is saved for 30 minutes and sent with the order as `delivery_quote_id`. | Migration 025 and rates in `delivery_rates`; for live prices `COURIER_API_URL`, `COURIER_API_KEY`, `COURIER_API_COURIER`, `COURIER_CONTRACT_VALIDATED` |
| `courier-webhook` | A connected courier | Checks the courier's signature, then records each parcel event once with `app.record_courier_event()`. | `COURIER_WEBHOOK_SECRET`, `COURIER_WEBHOOK_COURIER`, `COURIER_CONTRACT_VALIDATED` |

The request handling is in `_shared/handlers.ts` and uses only web standards, so it's tested in Node: `tests/functions.test.mjs`, and against a real database in `db/tests/functions.mjs`. `_shared/deno.ts` connects it to the database and sign-in on Supabase.

Apply migration **016 before deploying the updated notification sender**. It adds
processing leases and `app.claim_notifications()`; an overlapping run cannot claim
the same batch while it is being sent. Claims expire after ten minutes, retries
stop after five attempts, and claim tokens reject writes from an expired worker.
`db/tests/notifications.mjs` checks overlap and recovery against PostgreSQL.
Delivery is still at least once: a provider accepting a message just before a
network failure can lead to a retry. Provider reconciliation/idempotency is needed
before promising exactly-once messaging. No messages were sent by these tests.

Incoming JSON and signed webhook bodies are limited to 32 KiB while streaming.
Webhook payloads must be objects with finite positive amounts; API responses are
marked `no-store`. Provider requests time out after 15 seconds. These controls
complement, but do not replace, deployment-level rate limits and provider-specific
payment validation and reconciliation.

## Deploy

For the new connected checkout/payment flow, apply migrations **017–019** after 016
before deploying. The frontend remains disabled until `settings.api.enabled:true`
and confirmed project configuration are supplied. Both payment entry points also
require `PAYMENT_CONTRACT_VALIDATED=true`; leave it unset until the actual provider
contract has passed sandbox acceptance. Generic JSON mapping is only a test contract.
See [integration readiness](../../INTEGRATION-READINESS.md) for the remaining work.

`start-payment` now requires a verified sign-in and `attempt_key: "PAY-…"`. A repeat
uses the stored server reference and does not send another prompt. A request with
an uncertain provider outcome blocks new attempts until reconciliation. Webhooks
require `currency:"ZMW"`, cents-precision amounts and the approved signature. Refunds
are reconciled with a service-only ledger function; it does not itself send money.

From the project folder, in your own terminal:

```
npx.cmd supabase functions deploy place-order start-payment payment-webhook send-notifications daily-jobs courier-quote courier-webhook
```

`supabase/config.toml` turns off Supabase's sign-in check for these functions. Each one checks its own callers instead: guests and signed-in buyers, the provider's signature, or the schedule's secret.

## Secrets

Set them in the dashboard under **Edge Functions → Secrets**, or in your own terminal with `npx.cmd supabase secrets set NAME=value`. Never put them in the website or the repository, and don't paste them in chat. Supabase provides `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_DB_URL` itself.

| Secret | What it is |
| --- | --- |
| `ALLOWED_ORIGINS` | The website addresses allowed to call the functions, comma-separated. Default: `https://nindejr.github.io` |
| `CRON_SECRET` | A long random string that the schedules send as `Authorization: Bearer …` |
| `PAYMENT_PROVIDER` | Which field mapping `payment-webhook` uses. `generic` expects `transaction_id`, `order_ref`, `amount`, `status` and `method`. Add the chosen provider's mapping to `PROVIDERS` in `_shared/handlers.ts` once you have its documentation. |
| `PAYMENT_WEBHOOK_SECRET` | The signing secret the provider gives you for webhooks |
| `PAYMENT_API_URL`, `PAYMENT_API_KEY`, `PAYMENT_CALLBACK_URL` | The provider's collection endpoint and key, and the `payment-webhook` address |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `WHATSAPP_LANGUAGE` | From the WhatsApp Business Platform (Meta). The language defaults to `en`. |
| `EMAIL_API_KEY`, `EMAIL_FROM`, `EMAIL_API_URL` | Email receipts. The key and a verified sender, e.g. `Zed Supply <orders@your-domain>`. The URL defaults to Resend's (`https://api.resend.com/emails`); another provider must accept the same JSON. |
| `SITE_URL` | The storefront address used in email links. Default `https://nindejr.github.io/zedsupply/` |
| `COURIER_API_URL`, `COURIER_API_KEY`, `COURIER_API_COURIER` | A courier's rate API, its key, and its id in `js/couriers.js`. It's sent `{ origin, destination, weight_kg, speed, currency }` and must answer `{ amount, currency: "ZMW", min_days, max_days }`. |
| `COURIER_WEBHOOK_SECRET`, `COURIER_WEBHOOK_COURIER` | The signing secret a courier uses for tracking events, and that courier's id |
| `COURIER_CONTRACT_VALIDATED` | `true` only after the courier's sandbox has passed; until then both courier functions stay off |

## Schedules

In the dashboard, use **Integrations → Cron** (pg_cron, available on the free plan) to call:

- `send-notifications` every 5 minutes
- `daily-jobs` once a day, for example 02:00

Each call needs the header `Authorization: Bearer <CRON_SECRET>`.

## WhatsApp templates

WhatsApp only allows business-started messages from templates that Meta has approved. Create these in WhatsApp Manager with the same names, and with body parameters in this order:

| Template | Parameters |
| --- | --- |
| `order_placed` | name, order reference |
| `order_confirmed`, `order_dispatched`, `order_delivered`, `order_cancelled` | order reference |
| `payment_received` | order reference, amount |
| `back_in_stock` | product title |
| `price_drop` | product title, new price |
| `seller_application_update` | business name, outcome ("needs more information", "is approved" or "was not approved"); ask them to check My Account |
| `order_receipt` | name, order reference, total (e.g. "K883.00", or "K500.00 before delivery"); ask them to open the receipt from their order |
| `parcel_update` | order reference, what happened ("is out for delivery", "has been delivered by the courier" or "could not be delivered; the courier will try again") |

## Costs

Supabase Edge Functions and pg_cron are within the free plan at this size. WhatsApp charges per conversation, and payment providers charge per transaction, so both need accounts and a budget before they're switched on.
