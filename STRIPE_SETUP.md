# Stripe wiring — Add Technician Seat add-on

PoolMate's "Add technician seat — $3/mo" feature charges customers immediately via Stripe and bumps `businesses.purchased_seats` through a webhook. The code is already in place in `functions/api/stripe/`. This doc covers the operator setup needed to make it actually run.

## Prerequisites

- A Stripe account (Test mode is fine to start; switch to Live when ready)
- A Cloudflare Pages deploy of PoolPro with custom env vars

## 1. Create the add-on product in Stripe Dashboard

1. Stripe Dashboard → Products → **Create product**
2. Name: `PoolMate technician seat`
3. Pricing: **Recurring**, $3.00 / month, in your currency
4. Save and copy the **Price ID** (looks like `price_1Pxxxxx...`). This is the value for `STRIPE_ADDON_TECH_SEAT_PRICE`.

## 2. Configure the webhook endpoint

1. Stripe Dashboard → Developers → Webhooks → **Add endpoint**
2. Endpoint URL: `https://pool-pro-2jk.pages.dev/api/stripe/webhook` (or your custom domain)
3. Events to send (select these four):
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
4. After creation, click **Reveal signing secret**. Copy the `whsec_...` value. This is `STRIPE_WEBHOOK_SECRET`.

## 3. Set Cloudflare Pages env vars

Cloudflare Dashboard → Pages → poolpro → Settings → Environment variables. Add to **Production**:

| Var | Value |
|---|---|
| `SUPABASE_URL` | `https://tdeytachcvjehlunlsue.supabase.co` (or your project URL) |
| `SUPABASE_SERVICE_KEY` | service_role key from Supabase Dashboard → Settings → API |
| `STRIPE_SECRET_KEY` | `sk_test_...` or `sk_live_...` from Stripe Dashboard → Developers → API keys |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` from step 2 |
| `STRIPE_ADDON_TECH_SEAT_PRICE` | `price_...` from step 1 |
| `APP_URL` | `https://pool-pro-2jk.pages.dev` (no trailing slash) |

The same vars are needed in **Preview** if you want preview deploys to work too.

## 4. Apply the schema migration

The migration `20260501150326_stripe_addon_seats.sql` adds three columns to `businesses` (`stripe_customer_id`, `stripe_subscription_id`, `purchased_seats`) plus a unique index. Run it via your usual Supabase migration flow. After it's applied:

```sql
select column_name from information_schema.columns
  where table_name = 'businesses'
    and column_name in ('stripe_customer_id', 'stripe_subscription_id', 'purchased_seats');
-- expect 3 rows
```

## 5. Test in Stripe Test mode

1. Sign in to PoolMate as a paid plan owner.
2. Visit `/subscription`. The "Need an extra technician?" Card should appear (only visible on paid plans, not trial; hidden when an operator override is set on the business).
3. Click **Add technician seat — $3/mo**. You'll be redirected to Stripe Checkout.
4. Pay with test card `4242 4242 4242 4242`, any future expiry, any CVC.
5. Stripe redirects back to `/subscription?seat_added=1`. The success toast fires; `useBusiness` refetches; within ~5 seconds the seat count goes up.
6. Click **Add technician seat** again. This time it bumps subscription quantity (no Checkout redirect) and shows a "Stripe is processing…" toast. Within ~5 seconds the seat count goes up again.
7. Verify in Stripe Dashboard → Customers → your test customer → the subscription quantity reflects the count, and an invoice was paid for the prorated charge.

## 6. Going live

- Repeat steps 1-3 with **live** keys (`sk_live_...`, separate live webhook with its own `whsec_...`, live `price_...`).
- Make sure to use the live webhook signing secret in `STRIPE_WEBHOOK_SECRET`.
- Stripe **does not** share resources between test and live mode — you'll create a separate product in Live mode.

## Architecture quick reference

```
USER clicks "Add seat"
  → POST /api/stripe/checkout (Bearer <supabase JWT>)
    → checkout.ts authenticates via Supabase, looks up the business
      → if no subscription yet:
          create Stripe Checkout Session, return URL
          USER → Stripe Checkout → enters card → redirects back
          Stripe → webhook (checkout.session.completed)
            → webhook.ts sets stripe_customer_id, stripe_subscription_id
          Stripe → webhook (customer.subscription.created)
            → webhook.ts sets purchased_seats=quantity
      → else:
          PATCH subscription, items[0].quantity += 1, prorate=always_invoice
          return { mode: "increment" }
          Stripe immediately charges the prorated amount
          Stripe → webhook (customer.subscription.updated)
            → webhook.ts updates purchased_seats=quantity
```

`useBusiness().staffLimit` already factors `purchased_seats` into the effective limit:

```js
staffLimit = staff_seat_override ?? (plan.max_staff + purchased_seats) ?? 1
```

## Notes

- **Cancelling**: not yet exposed in the UI. Customer can cancel the add-on subscription via Stripe's customer portal (set one up in Dashboard → Settings → Customer portal) and the `customer.subscription.deleted` webhook will reset `purchased_seats` to 0.
- **Removing a single seat (decrement)**: not exposed yet. If a customer wants to drop from 3 extras to 2, they'd need to cancel and rebuy or contact support. Add this later if customers request it.
- **HQ admin override interaction**: when `businesses.staff_seat_override` is set, `purchased_seats` is *ignored* (override wins). The "Add seat" Card hides itself in that state so the customer doesn't waste money on extras the operator override won't honor.
