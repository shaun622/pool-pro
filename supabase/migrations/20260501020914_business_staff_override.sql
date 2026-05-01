-- Operator override for staff seat limit. NULL = use the business's
-- plan default (PLAN_STAFF_LIMITS in PoolPro's useStaff.js, eventually
-- the plans table after Phase 2). Set by HQ admin via the
-- set-staff-override Pages Function (service-role-only writes).
--
-- A non-negative check stops a stray "-1" from leaking through. 0 is
-- legal — it means "no staff allowed" and is useful for parking
-- delinquent tenants without changing their plan.

alter table businesses
  add column if not exists staff_seat_override int;

alter table businesses
  add constraint businesses_staff_seat_override_nonneg
    check (staff_seat_override is null or staff_seat_override >= 0);

comment on column businesses.staff_seat_override is
  'HQ admin override of the plan-default staff seat limit. NULL = use plan default.';
