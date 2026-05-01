-- Stripe billing groundwork for the "Add technician seat" feature
-- (PoolMate add-on: $3/mo per extra seat, billed immediately, prorated).
--
-- Three new columns on businesses, all nullable so existing rows stay
-- valid:
--   stripe_customer_id      cus_xxx   — created lazily on first checkout
--   stripe_subscription_id  sub_xxx   — the add-on subscription, holds
--                                       quantity-based pricing
--   purchased_seats         int       — seats the customer paid for on
--                                       top of their plan default; goes
--                                       up via Stripe webhook when a new
--                                       subscription quantity arrives,
--                                       down on cancel/decrement
--
-- Effective seat limit (computed in useBusiness):
--   staff_seat_override                          (operator override, wins)
--     ?? plans[plan].max_staff + purchased_seats (plan default + paid extras)
--     ?? 1                                       (fallback)
--
-- The Stripe IDs are populated by the checkout / webhook Pages Functions
-- (functions/api/stripe/*). Webhook is the only writer of
-- purchased_seats — UI never sets it directly. This keeps the seat
-- count strictly tied to actual paid invoices.

alter table businesses
  add column if not exists stripe_customer_id text;

alter table businesses
  add column if not exists stripe_subscription_id text;

alter table businesses
  add column if not exists purchased_seats int not null default 0;

alter table businesses
  drop constraint if exists businesses_purchased_seats_nonneg;

alter table businesses
  add constraint businesses_purchased_seats_nonneg
    check (purchased_seats >= 0);

comment on column businesses.stripe_customer_id is
  'Stripe customer (cus_xxx). Created lazily on first add-seat checkout.';
comment on column businesses.stripe_subscription_id is
  'Stripe subscription (sub_xxx) holding the technician seat add-on.';
comment on column businesses.purchased_seats is
  'Extra staff seats purchased on top of the plan default. Updated by Stripe webhook.';

-- Unique index on stripe_customer_id so the webhook can lookup the
-- business in O(1). Allow multiple NULLs (default Postgres behaviour).
create unique index if not exists businesses_stripe_customer_id_unique
  on businesses (stripe_customer_id)
  where stripe_customer_id is not null;
