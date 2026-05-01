// POST /api/stripe/webhook
//
// Stripe → us. The Stripe Dashboard's webhook endpoint should be set
// to https://<APP_URL>/api/stripe/webhook with these events selected:
//   - customer.subscription.created
//   - customer.subscription.updated
//   - customer.subscription.deleted
//   - checkout.session.completed   (catches the very first link)
//
// This is the ONLY writer of businesses.purchased_seats and the
// stripe_customer_id / stripe_subscription_id columns. The UI reads
// purchased_seats; useBusiness derives the effective seat limit. Don't
// add UI write paths — they create races with webhook deliveries.
//
// Cloudflare Pages Functions don't expose the raw body if we read it
// twice, so we read it once with .text() and verify the signature
// against the same string.

import {
  PoolproEnv, jsonResponse, badRequest,
  pgrest, verifyStripeWebhook,
} from "./_shared";

interface StripeSubscription {
  id: string;
  customer: string;
  status: string;
  metadata?: Record<string, string>;
  items: {
    data: Array<{ id: string; quantity: number; price: { id: string } }>;
  };
}

interface StripeCheckoutSession {
  id: string;
  customer: string | null;
  subscription: string | null;
  client_reference_id: string | null;
}

interface StripeEvent {
  id: string;
  type: string;
  data: { object: unknown };
}

export const onRequestPost: PagesFunction<PoolproEnv> = async ({ request, env }) => {
  if (!env.STRIPE_WEBHOOK_SECRET) {
    console.error("[stripe webhook] STRIPE_WEBHOOK_SECRET not configured");
    return jsonResponse(500, { error: "webhook not configured" });
  }

  const rawBody = await request.text();
  const signatureHeader = request.headers.get("stripe-signature");
  const ok = await verifyStripeWebhook(rawBody, signatureHeader, env.STRIPE_WEBHOOK_SECRET);
  if (!ok) {
    console.warn("[stripe webhook] signature mismatch");
    return jsonResponse(400, { error: "invalid signature" });
  }

  let event: StripeEvent;
  try {
    event = JSON.parse(rawBody) as StripeEvent;
  } catch {
    return badRequest("invalid JSON");
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutCompleted(env, event.data.object as StripeCheckoutSession);
        break;

      case "customer.subscription.created":
      case "customer.subscription.updated":
        await handleSubscriptionUpsert(env, event.data.object as StripeSubscription);
        break;

      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(env, event.data.object as StripeSubscription);
        break;

      default:
        // Unknown event types: log + 200. Stripe will stop retrying.
        console.log(`[stripe webhook] ignored event type: ${event.type}`);
    }
  } catch (err) {
    console.error(`[stripe webhook] handler error for ${event.type}:`, (err as Error).message);
    // Return 500 so Stripe retries — whatever broke might be transient.
    return jsonResponse(500, { error: "handler error" });
  }

  return jsonResponse(200, { received: true });
};

// ─── Handlers ──────────────────────────────────────────────────────

// First-time purchase: Stripe calls this immediately after checkout.
// We wire stripe_customer_id + stripe_subscription_id onto the business
// row using client_reference_id, which the checkout endpoint set to the
// business id. The subscription.created event arrives separately and
// sets purchased_seats — but client_reference_id is only on the
// checkout session, so we have to handle it here.
async function handleCheckoutCompleted(env: PoolproEnv, session: StripeCheckoutSession) {
  if (!session.client_reference_id) {
    console.warn("[stripe webhook] checkout.session.completed without client_reference_id");
    return;
  }
  if (!session.customer || !session.subscription) {
    // Subscription mode should always populate these. Defensive log.
    console.warn(`[stripe webhook] checkout session ${session.id} missing customer or subscription`);
    return;
  }
  await pgrest(env, `businesses?id=eq.${session.client_reference_id}`, {
    method: "PATCH",
    body: JSON.stringify({
      stripe_customer_id: session.customer,
      stripe_subscription_id: session.subscription,
    }),
    headers: { prefer: "return=minimal" },
  });
}

// subscription.created and .updated both land here. We trust the
// subscription's quantity as the authoritative seat count. The
// metadata.business_id was set by checkout.ts when creating the
// subscription, so if the customer/sub IDs aren't on the business yet
// (race with checkout.session.completed), we still resolve correctly.
async function handleSubscriptionUpsert(env: PoolproEnv, sub: StripeSubscription) {
  const item = sub.items?.data?.[0];
  if (!item) {
    console.warn(`[stripe webhook] subscription ${sub.id} has no items`);
    return;
  }
  // Map Stripe status → live seats. "active" + "trialing" = paid; all
  // other states (incomplete, past_due, canceled, unpaid) = 0 seats.
  const isLive = sub.status === "active" || sub.status === "trialing";
  const seatCount = isLive ? (item.quantity || 0) : 0;

  // Resolve which business this is. Prefer metadata.business_id (set
  // on creation), fall back to stripe_customer_id lookup.
  let businessId = sub.metadata?.business_id;
  if (!businessId) {
    const rows = await pgrest<Array<{ id: string }>>(
      env,
      `businesses?select=id&stripe_customer_id=eq.${sub.customer}&limit=1`,
    );
    if (rows.length === 0) {
      console.warn(`[stripe webhook] subscription ${sub.id} for unknown customer ${sub.customer}`);
      return;
    }
    businessId = rows[0].id;
  }

  await pgrest(env, `businesses?id=eq.${businessId}`, {
    method: "PATCH",
    body: JSON.stringify({
      stripe_customer_id: sub.customer,
      stripe_subscription_id: sub.id,
      purchased_seats: seatCount,
    }),
    headers: { prefer: "return=minimal" },
  });
}

// Subscription cancelled (by customer via portal, or by Stripe for
// non-payment, etc). Drop seats to 0 — the original plan's max_staff
// still applies. We keep stripe_subscription_id around for audit.
async function handleSubscriptionDeleted(env: PoolproEnv, sub: StripeSubscription) {
  let businessId = sub.metadata?.business_id;
  if (!businessId) {
    const rows = await pgrest<Array<{ id: string }>>(
      env,
      `businesses?select=id&stripe_customer_id=eq.${sub.customer}&limit=1`,
    );
    if (rows.length === 0) return;
    businessId = rows[0].id;
  }
  await pgrest(env, `businesses?id=eq.${businessId}`, {
    method: "PATCH",
    body: JSON.stringify({
      purchased_seats: 0,
    }),
    headers: { prefer: "return=minimal" },
  });
}
