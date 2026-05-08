-- Per-chemical "stock remaining at the client" log on each service.
--
-- Manual rather than auto-tracked from a running balance: pool
-- chemicals at a client site don't behave like inventory. Customers
-- top up themselves, bottles get spilled / replaced / swapped, and
-- the running balance diverges from the actual bottle the moment any
-- of that happens. The tech is already looking at the container
-- while they dose, so capturing what's left is one quick text entry
-- per chemical and is always accurate. Same freeform-text approach
-- as dose_text — "3kg", "half a bag", "1L", whatever fits.
--
-- Display layers should render this alongside the dose: e.g.
-- "100g  ·  3kg left". Empty values mean the tech didn't note it.

alter table public.chemicals_added
  add column if not exists stock_remaining text;
