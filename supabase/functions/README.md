# Server functions

Small programs that run on Supabase (Edge Functions, Deno) for the jobs the website must never do itself.

| Function | Called by | What it does | Switched on by |
| --- | --- | --- | --- |
| `place-order` | The website at checkout | Sends the cart to `app.place_order()`. The database prices it, takes the stock and returns the order. The buyer comes from the sign-in token, never from the browser. | Deploying it, and setting `settings.api` in `js/catalogue.js` (Stage 3) |
| `start-payment` | The website, "Pay now" | Asks the payment provider to send a mobile money prompt to the buyer's phone for what's owed. On a new lay-by, this is the deposit. | `PAYMENT_API_URL`, `PAYMENT_API_KEY`, `PAYMENT_CALLBACK_URL` |
| `payment-webhook` | The payment provider | Checks the provider's signature, then records the payment once with `app.record_payment()`. A fully paid order is confirmed, and each seller's share is held. | `PAYMENT_PROVIDER`, `PAYMENT_WEBHOOK_SECRET` |
| `send-notifications` | A schedule, every few minutes | Sends queued order and alert messages as approved WhatsApp templates. Until WhatsApp is set up, messages wait in the queue. | `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `CRON_SECRET` |
| `daily-jobs` | A schedule, once a day | Releases seller payouts whose hold has passed with no open complaint, and cancels lay-bys not paid by their date. | `CRON_SECRET` |

The request handling is in `_shared/handlers.ts` and uses only web standards, so it's tested in Node: `tests/functions.test.mjs`, and against a real database in `db/tests/functions.mjs`. `_shared/deno.ts` connects it to the database and sign-in on Supabase.

## Deploy

From the project folder, in your own terminal:

```
npx.cmd supabase functions deploy place-order start-payment payment-webhook send-notifications daily-jobs
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

## Costs

Supabase Edge Functions and pg_cron are within the free plan at this size. WhatsApp charges per conversation, and payment providers charge per transaction, so both need accounts and a budget before they're switched on.
