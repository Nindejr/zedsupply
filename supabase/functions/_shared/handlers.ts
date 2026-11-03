// Request handlers for the Zed Supply server functions. Plain web standards only (Request,
// Response, Web Crypto), so they run in Supabase Edge Functions (Deno) and in the Node tests
// (tests/functions.test.mjs). Everything outside the function arrives in `deps`, so the tests
// can stand in for the database, sign-in and WhatsApp.

export type Json = Record<string, unknown>;

export interface Deps {
  env: (name: string) => string | undefined;
  // The signed-in user's users.id for a bearer token, or null when it isn't valid
  userIdForToken: (token: string) => Promise<number | null>;
  // Runs one SQL statement with parameters and returns the rows
  sql: (text: string, params: unknown[]) => Promise<Json[]>;
  fetch: typeof fetch;
}

const ORDER_FIELDS = ['ref', 'contact_name', 'recipient_phone', 'fulfilment', 'buyer_town', 'buyer_province_id',
  'collection_point', 'pickup_point_id', 'deliver_to', 'address_id', 'delivery_scope', 'courier_id', 'preferred_date',
  'preferred_slot', 'is_gift', 'gift_message', 'hide_prices', 'payment_method', 'payment_plan', 'voucher_code', 'notes', 'expected_total_zmw'];
const ITEM_FIELDS = ['product_id', 'variant_id', 'quantity', 'addons', 'commitment_id'];
const MAX_BODY = 32 * 1024;

export function cors(req: Request, env: Deps['env']): Record<string, string> {
  const allowed = (env('ALLOWED_ORIGINS') || 'https://nindejr.github.io').split(',').map(s => s.trim());
  const origin = req.headers.get('origin') || '';
  return {
    'access-control-allow-origin': allowed.includes(origin) ? origin : allowed[0],
    'access-control-allow-headers': 'authorization, content-type, apikey, x-client-info',
    'access-control-allow-methods': 'POST, OPTIONS',
    vary: 'origin'
  };
}

function reply(status: number, body: Json, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers } });
}

// Database errors raised on purpose (RAISE EXCEPTION, P0001) are meant for the buyer; anything
// else is logged and replaced by a general message, so internals never reach the browser.
function dbMessage(e: unknown): { status: number; message: string } {
  const err = e as { code?: string; message?: string };
  if (err && err.code === 'P0001' && err.message) return { status: 409, message: err.message };
  console.error(e);
  return { status: 500, message: 'Something went wrong. Please try again, or order on WhatsApp.' };
}

// Count bytes while streaming, before allocating or parsing an untrusted body.
async function readText(req: Request): Promise<string | null> {
  if (Number(req.headers.get('content-length')) > MAX_BODY) return null;
  if (!req.body) return '';
  const reader = req.body.getReader(), decoder = new TextDecoder();
  let size = 0, text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return text + decoder.decode();
      size += value.byteLength;
      if (size > MAX_BODY) { void reader.cancel().catch(() => {}); return null; }
      text += decoder.decode(value, { stream: true });
    }
  } catch { return null; }
  finally { reader.releaseLock(); }
}

async function readJson(req: Request): Promise<Json | null> {
  const text = await readText(req);
  if (text === null) return null;
  try { const v = JSON.parse(text); return v && typeof v === 'object' && !Array.isArray(v) ? v : null; } catch { return null; }
}

// POST /place-order: the website sends the cart; the database prices it, takes the stock and
// returns the order. The buyer is taken from the sign-in token, never from the body.
export async function placeOrder(req: Request, deps: Deps): Promise<Response> {
  const h = cors(req, deps.env);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
  if (req.method !== 'POST') return reply(405, { error: 'Use POST' }, h);
  const body = await readJson(req);
  if (!body || !Array.isArray(body.items)) return reply(400, { error: 'Send the order as JSON with an items list' }, h);
  if (body.items.length > 50) return reply(400, { error: 'Keep each order to 50 items or fewer' }, h);
  const order: Json = {};
  for (const k of ORDER_FIELDS) if (body[k] !== undefined && body[k] !== null && body[k] !== '') order[k] = body[k];
  order.items = (body.items as Json[]).map(it => {
    const line: Json = {};
    for (const k of ITEM_FIELDS) if (it && it[k] !== undefined && it[k] !== null) line[k] = it[k];
    return line;
  });
  const auth = req.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  // The publishable key also arrives as a bearer token; only a real sign-in gives a user
  const userId = token && token !== deps.env('SUPABASE_ANON_KEY') ? await deps.userIdForToken(token) : null;
  if (token && token !== deps.env('SUPABASE_ANON_KEY') && userId === null) return reply(401, { error: 'Your sign-in has expired. Sign in again.' }, h);
  if (userId !== null) order.user_id = userId;
  else if (!order.contact_name || !order.recipient_phone) return reply(400, { error: 'Add your name and phone number' }, h);
  try {
    const rows = await deps.sql('SELECT app.place_order($1::jsonb) AS r', [JSON.stringify(order)]);
    return reply(200, rows[0].r as Json, h);
  } catch (e) {
    const m = dbMessage(e);
    return reply(m.status, { error: m.message }, h);
  }
}

// Signature check for payment webhooks: hex HMAC-SHA256 of the raw body with the shared secret,
// compared in constant time
export async function validSignature(secret: string, body: string, signature: string): Promise<boolean> {
  if (!secret || !signature) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)));
  const expected = Array.from(mac, b => b.toString(16).padStart(2, '0')).join('');
  const given = signature.trim().toLowerCase().replace(/^sha256=/, '');
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

// POST /payment-webhook: the payment provider reports a payment. Each provider names its
// fields differently; PAYMENT_PROVIDER picks the mapping below. The database records each
// provider reference once, so repeated deliveries are harmless.
export const PROVIDERS: Record<string, (b: Json) => { ref: string; order: string; amount: number; status: string; method?: string }> = {
  // A neutral format for testing and for aggregators configured to send it
  generic: b => ({ ref: String(b.transaction_id || ''), order: String(b.order_ref || ''), amount: Number(b.amount),
    status: String(b.status || ''), method: b.method ? String(b.method) : undefined })
};
const STATUS: Record<string, string> = { success: 'paid', successful: 'paid', completed: 'paid', paid: 'paid',
  pending: 'pending', processing: 'pending', failed: 'failed', cancelled: 'failed', rejected: 'failed', refunded: 'refunded' };

export async function paymentWebhook(req: Request, deps: Deps): Promise<Response> {
  if (req.method !== 'POST') return reply(405, { error: 'Use POST' });
  const provider = deps.env('PAYMENT_PROVIDER') || '';
  const secret = deps.env('PAYMENT_WEBHOOK_SECRET') || '';
  if (!PROVIDERS[provider] || !secret || deps.env('PAYMENT_CONTRACT_VALIDATED') !== 'true') return reply(503, { error: 'Payments are not set up yet' });
  const raw = await readText(req);
  if (raw === null) return reply(413, { error: 'Too large or unreadable' });
  const sig = req.headers.get('x-signature') || req.headers.get('x-webhook-signature') || '';
  if (!(await validSignature(secret, raw, sig))) return reply(401, { error: 'Bad signature' });
  let body: Json;
  try { body = JSON.parse(raw); } catch { return reply(400, { error: 'Not JSON' }); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return reply(400, { error: 'Send a JSON object' });
  if (body.currency !== 'ZMW') return reply(400, { error: 'Only ZMW settlement events are accepted' });
  const p = PROVIDERS[provider](body);
  const status = STATUS[p.status.toLowerCase()];
  if (!p.ref || p.ref.length > 120 || !/^ZS-[A-Z0-9]{4,12}$/.test(p.order) || !Number.isFinite(p.amount) || !(p.amount > 0) || Math.round(p.amount * 100) / 100 !== p.amount || !status) return reply(400, { error: 'Missing or unknown fields' });
  try {
    const rows = await deps.sql('SELECT app.record_payment($1, $2, $3, $4, $5, $6, $7::jsonb) AS r',
      [provider, p.ref, p.order, p.amount, status, p.method || null, raw]);
    return reply(200, rows[0].r as Json);
  } catch (e) {
    const m = dbMessage(e);
    return reply(m.status === 409 ? 422 : 500, { error: m.message });
  }
}

// WhatsApp message templates. Each must be created and approved in WhatsApp Manager with the
// same name and these body parameters, in this order.
export const TEMPLATES: Record<string, (p: Json) => string[]> = {
  order_placed: p => [String(p.name || 'there'), String(p.ref)],
  order_confirmed: p => [String(p.ref)],
  order_dispatched: p => [String(p.ref)],
  order_delivered: p => [String(p.ref)],
  order_cancelled: p => [String(p.ref)],
  payment_received: p => [String(p.ref), 'K' + Number(p.amount).toFixed(2)],
  back_in_stock: p => [String(p.title)],
  price_drop: p => [String(p.title), 'K' + Number(p.price).toFixed(2)],
  seller_application_update: p => [String(p.business), ({ info_needed: 'needs more information', approved: 'is approved', rejected: 'was not approved' } as Record<string, string>)[String(p.status)] || 'has been updated']
};

// POST /send-notifications (scheduled every few minutes): sends queued messages on WhatsApp.
// Until WHATSAPP_TOKEN and WHATSAPP_PHONE_ID are set, messages stay queued and nothing is sent.
export async function sendNotifications(req: Request, deps: Deps): Promise<Response> {
  if (req.headers.get('authorization') !== 'Bearer ' + deps.env('CRON_SECRET') || !deps.env('CRON_SECRET')) return reply(401, { error: 'Not allowed' });
  if (req.method !== 'POST') return reply(405, { error: 'Use POST' });
  const token = deps.env('WHATSAPP_TOKEN'), phoneId = deps.env('WHATSAPP_PHONE_ID');
  if (!token || !phoneId) return reply(200, { configured: false, sent: 0 });
  const lang = deps.env('WHATSAPP_LANGUAGE') || 'en';
  // A persistent lease keeps another run from claiming this batch after the SQL lock ends.
  const batch = await deps.sql('SELECT * FROM app.claim_notifications()', []);
  let sent = 0;
  for (const n of batch) {
    const params = TEMPLATES[String(n.template)];
    if (!params) { await deps.sql(`UPDATE notifications SET status = 'skipped', last_error = 'No template', claimed_at = NULL, claim_token = NULL WHERE id = $1 AND claim_token = $2 AND status = 'processing'`, [n.id, n.claim_token]); continue; }
    let res: Response;
    try {
      res = await deps.fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
        method: 'POST',
        signal: AbortSignal.timeout(15000),
        headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp', to: String(n.to_address).replace(/^\+/, ''), type: 'template',
          template: { name: n.template, language: { code: lang },
            components: [{ type: 'body', parameters: params(n.payload as Json).map(text => ({ type: 'text', text })) }] }
        })
      });
    } catch {
      await deps.sql(`UPDATE notifications SET status = CASE WHEN attempts >= 5 THEN 'failed' ELSE 'queued' END, last_error = 'Delivery interrupted; retry pending', claimed_at = NULL, claim_token = NULL WHERE id = $1 AND claim_token = $2 AND status = 'processing'`, [n.id, n.claim_token]);
      continue;
    }
    if (res.ok) { sent++; await deps.sql(`UPDATE notifications SET status = 'sent', sent_at = now(), last_error = NULL, claimed_at = NULL, claim_token = NULL WHERE id = $1 AND claim_token = $2 AND status = 'processing'`, [n.id, n.claim_token]); }
    else {
      await deps.sql(`UPDATE notifications SET status = CASE WHEN attempts >= 5 THEN 'failed' ELSE 'queued' END, last_error = $3, claimed_at = NULL, claim_token = NULL WHERE id = $1 AND claim_token = $2 AND status = 'processing'`, [n.id, n.claim_token, 'Provider HTTP ' + res.status]);
    }
  }
  return reply(200, { configured: true, sent, tried: batch.length });
}

// POST /daily-jobs (scheduled once a day): releases payouts whose hold has passed and cancels
// lay-bys not paid by their date
export async function dailyJobs(req: Request, deps: Deps): Promise<Response> {
  if (req.headers.get('authorization') !== 'Bearer ' + deps.env('CRON_SECRET') || !deps.env('CRON_SECRET')) return reply(401, { error: 'Not allowed' });
  if (req.method !== 'POST') return reply(405, { error: 'Use POST' });
  const released = await deps.sql('SELECT app.release_due_payouts() AS n', []);
  const expired = await deps.sql('SELECT app.expire_laybys() AS n', []);
  return reply(200, { payouts_released: released[0].n, laybys_expired: expired[0].n });
}

// POST /start-payment { order_ref, phone }: asks the payment provider to send a mobile money
// prompt to the buyer's phone for what's still owed on the order. The provider later calls
// /payment-webhook. Signed-in buyers can start payment for their own orders; guests need the
// phone number the order was placed with. Off until PAYMENT_API_URL and PAYMENT_API_KEY are set.
export async function startPayment(req: Request, deps: Deps): Promise<Response> {
  const h = cors(req, deps.env);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
  if (req.method !== 'POST') return reply(405, { error: 'Use POST' }, h);
  const url = deps.env('PAYMENT_API_URL'), key = deps.env('PAYMENT_API_KEY');
  if (!url || !key || deps.env('PAYMENT_CONTRACT_VALIDATED') !== 'true' || !url.startsWith('https://')) return reply(503, { error: 'Mobile money prompts are not set up yet. Pay with the instructions we send on WhatsApp.' }, h);
  const body = await readJson(req);
  const ref = String((body && body.order_ref) || ''), phone = String((body && body.phone) || '').replace(/[^\d+]/g, '');
  if (!/^ZS-[A-Z0-9]{4,12}$/.test(ref) || !/^\+?260\d{9}$/.test(phone)) return reply(400, { error: 'Send the order reference and a Zambian mobile number' }, h);
  const auth = req.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const userId = token && token !== deps.env('SUPABASE_ANON_KEY') ? await deps.userIdForToken(token) : null;
  if (token && token !== deps.env('SUPABASE_ANON_KEY') && userId === null) return reply(401, { error: 'Your sign-in has expired. Sign in again.' }, h);
  if (userId === null) return reply(401, { error: 'Sign in with a verified account to request payment' }, h);
  const attemptKey = String(body && body.attempt_key || '');
  if (!/^PAY-[a-zA-Z0-9-]{8,64}$/.test(attemptKey)) return reply(400, { error: 'Send a stable payment attempt key' }, h);
  let attempt: Json;
  try {
    const rows = await deps.sql('SELECT app.begin_payment($1, $2, $3, $4) AS r', [ref, userId, phone.startsWith('+') ? phone : '+' + phone, attemptKey]);
    attempt = rows[0].r as Json;
  } catch (e) { const m = dbMessage(e); return reply(m.status, { error: m.message }, h); }
  const amount = Number(attempt.amount);
  if (!attempt.send) return reply(200, { started: true, amount, replayed: true, state: attempt.state }, h);
  const res = await deps.fetch(url, {
    method: 'POST',
    signal: AbortSignal.timeout(15000),
    headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json', 'idempotency-key': String(attempt.reference) },
    body: JSON.stringify({ reference: attempt.reference, order_ref: ref, amount, currency: 'ZMW',
      phone: phone.replace(/^\+/, ''), callback_url: deps.env('PAYMENT_CALLBACK_URL') })
  }).catch(() => null);
  await deps.sql(`UPDATE payment_attempts SET state = $2 WHERE id = $1 AND state = 'created'`, [attempt.id, res && res.ok ? 'submitted' : 'unknown']);
  if (!res || !res.ok) { console.error('payment provider unavailable', res ? res.status : 'network'); return reply(502, { error: 'Payment confirmation is uncertain. Do not repeat the payment; check its status with support.' }, h); }
  return reply(200, { started: true, amount }, h);
}
