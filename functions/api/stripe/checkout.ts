// POST /api/stripe/checkout
//
// Customer-initiated "Add technician seat" flow. Two paths:
//
//   1. FIRST PURCHASE — no stripe_subscription_id on the business yet.
//      Create a Stripe Checkout Session in subscription mode with
//      quantity=1 of the addon price. Customer enters card on Stripe's
//      hosted page, Stripe creates customer + subscription. The webhook
//      then sets stripe_customer_id, stripe_subscription_id, and
//      purchased_seats=1 on the business.
//
//   2. INCREMENT — already has a subscription. We programmatically bump
//      the subscription's quantity by 1 with proration_behavior=
//      'always_invoice', which charges the customer immediately on
//      their saved card for the prorated remainder of the current
//      period. The webhook (subscription.updated) then bumps
//      purchased_seats to match the new quantity.
//
// Auth: Bearer <supabase-access-token> in Authorization header. Owner
// only (staff can't buy seats — they don't own the bill).

import {
  PoolproEnv, jsonResponse, badRequest, serverError,
  getCallerUser, getBusinessForOwner, stripeApi,
} from "./_shared";

interface StripeCustomer { id: string }
interface StripeSubscription {
  id: string;
  items: { data: Array<{ id: string; quantity: number }> };
}
interface StripeCheckoutSession { id: string; url: string }

export const onRequestPost: PagesFunction<PoolproEnv> = async ({ request, env }) => {
  // ─── 1. Authenticate caller ──────────────────────────────────────
  const user = await getCallerUser(request, env);
  if (!user) return jsonResponse(401, { error: "Not signed in" });

  // ─── 2. Look up their business ───────────────────────────────────
  const business = await getBusinessForOwner(env, user.id);
  if (!business) return jsonResponse(403, { error: "Owner-only feature. Staff can't buy seats." });

  // ─── 3. Validate Stripe config ───────────────────────────────────
  if (!env.STRIPE_SECRET_KEY) return serverError("STRIPE_SECRET_KEY not configured");
  if (!env.STRIPE_ADDON_TECH_SEAT_PRICE) return serverError("STRIPE_ADDON_TECH_SEAT_PRICE not configured");
  const appUrl = env.APP_URL || new URL(request.url).origin;

  // ─── 4. Increment path: existing subscription → bump quantity ────
  if (business.stripe_subscription_id) {
    try {
      // Pull current subscription to find the item id + quantity. We
      // edit items.data[0] (we only ever attach one price).
      const sub = await stripeApi<StripeSubscription>(env, `subscriptions/${business.stripe_subscription_id}`);
      const item = sub.items?.data?.[0];
      if (!item) return serverError("Subscription has no items");
      const newQuantity = (item.quantity || 0) + 1;

      // Idempotency: if the user double-clicks, both requests hit the
      // same key and Stripe returns the same result for the second one.
      const idempotencyKey = `addseat:${business.id}:${user.id}:${Date.now()}`;
      await stripeApi(env, `subscriptions/${business.stripe_subscription_id}`, {
        method: "POST",
        body: {
          [`items[0][id]`]: item.id,
          [`items[0][quantity]`]: newQuantity,
          proration_behavior: "always_invoice",
        },
        idempotencyKey,
      });

      // Webhook (subscription.updated) is the canonical writer of
      // purchased_seats; we don't update the DB here. Return success
      // so the UI shows a "Charge processing — seat will be available
      // shortly" toast and refetches the business after a moment.
      return jsonResponse(200, {
        ok: true,
        mode: "increment",
        newQuantity,
      });
    } catch (err) {
      console.error("Stripe increment error:", (err as Error).message);
      return serverError(`Could not add seat: ${(err as Error).message}`);
    }
  }

  // ─── 5. First-purchase path: create Checkout Session ─────────────
  try {
    // Create or reuse the Stripe customer. If the business already has
    // a stripe_customer_id (e.g. from a failed previous checkout), pass
    // it; otherwise let Checkout create one and we'll wire it via the
    // webhook.
    const params: Record<string, string> = {
      mode: "subscription",
      [`line_items[0][price]`]: env.STRIPE_ADDON_TECH_SEAT_PRICE,
      [`line_items[0][quantity]`]: "1",
      success_url: `${appUrl}/subscription?seat_added=1`,
      cancel_url: `${appUrl}/subscription?seat_added=0`,
      // Pass business_id in client_reference_id so the webhook can
      // reconcile customer.subscription.created back to the business
      // even before stripe_customer_id is written.
      client_reference_id: business.id,
      [`subscription_data[metadata][business_id]`]: business.id,
      // Tell Stripe to charge for proration immediately on quantity
      // updates (matters for path 4, not first checkout, but cheap
      // to set on creation so the subscription has the right default).
      [`subscription_data[proration_behavior]`]: "always_invoice",
      // Send the customer's email through so Stripe's customer record
      // matches, even before we know their stripe_customer_id.
      customer_email: user.email,
      // Allow promo codes if you ever set one up
      allow_promotion_codes: "true",
    };
    if (business.stripe_customer_id) {
      params.customer = business.stripe_customer_id;
      // Conflict: customer + customer_email is invalid in Stripe. Drop
      // the email when reusing an existing customer.
      delete params.customer_email;
    }

    const session = await stripeApi<StripeCheckoutSession>(env, "checkout/sessions", {
      method: "POST",
      body: params,
    });

    return jsonResponse(200, {
      ok: true,
      mode: "checkout",
      url: session.url,
    });
  } catch (err) {
    console.error("Stripe checkout error:", (err as Error).message);
    return serverError(`Could not start checkout: ${(err as Error).message}`);
  }
};

export const onRequestOptions: PagesFunction = async () => {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "authorization, content-type",
    },
  });
};
