// Shared helpers for /api/stripe/* Pages Functions.
//
// Env vars (set in Cloudflare Pages → Settings → Environment variables):
//   SUPABASE_URL                   PoolMate's Supabase project URL
//   SUPABASE_SERVICE_KEY           service_role key (NOT anon)
//   STRIPE_SECRET_KEY              sk_test_... or sk_live_...
//   STRIPE_WEBHOOK_SECRET          whsec_... (from Stripe Dashboard → Developers → Webhooks)
//   STRIPE_ADDON_TECH_SEAT_PRICE   price_... (recurring $3/mo product in Stripe Dashboard)
//   APP_URL                        https://pool-pro-2jk.pages.dev (no trailing slash)

export interface PoolproEnv {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_KEY?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_ADDON_TECH_SEAT_PRICE?: string;
  APP_URL?: string;
  [key: string]: string | undefined;
}

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export function badRequest(msg: string): Response {
  return jsonResponse(400, { error: msg });
}

export function serverError(msg: string): Response {
  return jsonResponse(500, { error: msg });
}

// ─── Auth: verify Supabase JWT from Authorization header ───────────
// The frontend posts the user's access_token as Bearer. We hit Supabase
// auth's GET /auth/v1/user with that token to confirm it's still valid
// and pull the user id. Service-role queries elsewhere bypass RLS, so
// this is the only checkpoint enforcing "the caller is who they say".
export async function getCallerUser(req: Request, env: PoolproEnv): Promise<{ id: string; email: string } | null> {
  const auth = req.headers.get("authorization") || "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const token = match[1].trim();
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) return null;

  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) return null;
  const body = await res.json() as { id?: string; email?: string };
  if (!body.id || !body.email) return null;
  return { id: body.id, email: body.email };
}

// ─── Supabase REST helper (service-role, bypasses RLS) ─────────────
export async function pgrest<T = unknown>(
  env: PoolproEnv,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    throw new Error("SUPABASE_URL or SUPABASE_SERVICE_KEY not configured");
  }
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      "content-type": "application/json",
      ...init.headers,
    },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Supabase ${res.status}: ${detail || res.statusText}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ─── Resolve a user → their owned business ─────────────────────────
// Add-tech-seat is owner-only for now. Staff / admins can view but not
// purchase seats. If we want to allow admins later, swap this for a
// businesses-via-staff-link query.
export async function getBusinessForOwner(env: PoolproEnv, ownerId: string): Promise<{
  id: string;
  plan: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  purchased_seats: number;
  staff_seat_override: number | null;
} | null> {
  const rows = await pgrest<Array<{
    id: string;
    plan: string | null;
    stripe_customer_id: string | null;
    stripe_subscription_id: string | null;
    purchased_seats: number;
    staff_seat_override: number | null;
  }>>(env, `businesses?select=id,plan,stripe_customer_id,stripe_subscription_id,purchased_seats,staff_seat_override&owner_id=eq.${ownerId}&limit=1`);
  return rows[0] || null;
}

// ─── Stripe REST helper ─────────────────────────────────────────────
// We talk Stripe's REST API directly via fetch — no SDK needed. The
// official `stripe` npm package targets Node and is heavy on the
// Workers runtime; fetch is plenty for the small surface we use
// (customers.create, checkout.sessions.create, subscriptions.update).
//
// Body must be url-encoded (Stripe doesn't accept JSON for most endpoints).
export async function stripeApi<T = unknown>(
  env: PoolproEnv,
  path: string,
  options: { method?: string; body?: Record<string, string | number | boolean> | string; idempotencyKey?: string } = {},
): Promise<T> {
  if (!env.STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY not configured");
  const headers: Record<string, string> = {
    authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
    "content-type": "application/x-www-form-urlencoded",
    "stripe-version": "2024-06-20",
  };
  if (options.idempotencyKey) headers["idempotency-key"] = options.idempotencyKey;

  let body: string | undefined;
  if (typeof options.body === "string") {
    body = options.body;
  } else if (options.body) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(options.body)) {
      params.append(k, String(v));
    }
    body = params.toString();
  }

  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: options.method || (body ? "POST" : "GET"),
    headers,
    body,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Stripe ${res.status}: ${detail || res.statusText}`);
  }
  return res.json() as Promise<T>;
}

// ─── Stripe webhook signature verification ─────────────────────────
// Cloudflare Workers has the Web Crypto API; we use it to compute the
// HMAC-SHA256 of `<timestamp>.<rawBody>` and constant-time compare to
// the v1 signature in the header. Stripe rotates webhook secrets when
// the dashboard secret is regenerated — pick whsec_... from the
// Dashboard webhook page.
export async function verifyStripeWebhook(
  rawBody: string,
  signatureHeader: string | null,
  webhookSecret: string,
  toleranceSeconds = 300,
): Promise<boolean> {
  if (!signatureHeader) return false;
  // Header looks like: "t=1614265456,v1=abcdef...,v0=oldsig"
  const parts = signatureHeader.split(",");
  const tsPart = parts.find(p => p.startsWith("t="));
  const v1Parts = parts.filter(p => p.startsWith("v1="));
  if (!tsPart || v1Parts.length === 0) return false;
  const timestamp = parseInt(tsPart.slice(2), 10);
  if (Number.isNaN(timestamp)) return false;
  // Reject events older than tolerance window (replay protection)
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > toleranceSeconds) return false;

  const signedPayload = `${timestamp}.${rawBody}`;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(webhookSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(signedPayload));
  const expected = Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");

  // Constant-time compare against any v1 signature
  for (const v1 of v1Parts) {
    const got = v1.slice(3);
    if (got.length !== expected.length) continue;
    let diff = 0;
    for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ expected.charCodeAt(i);
    if (diff === 0) return true;
  }
  return false;
}
