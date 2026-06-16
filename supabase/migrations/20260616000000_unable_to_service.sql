-- "Unable to Service" support.
--
-- A tech who can't access a pool (locked gate, locked pool room, dog in
-- yard, no access, etc.) records a service_record with
-- status = 'unable_to_service'. service_records.status is plain text with
-- no CHECK constraint, so the new status value needs no migration. We
-- reuse `notes` for the free-text note and service_photos (tag =
-- 'unable_access') for the up-to-5 watermarked photos.
--
-- Two small changes only:
--   1. unable_reason — the canonical (English) reason category, kept
--      separate from the free note so the dashboard can show a clean chip
--      and we can filter by it.
--   2. activity_feed.type — add 'service_unable' so the owner gets an
--      in-app bell alert. Unlike service_records.status, this column IS
--      constrained by a CHECK, so the enum has to be widened.

-- 1. Reason category on the service record (no grants needed — existing table).
alter table service_records add column if not exists unable_reason text;

-- 2. Allow the new activity-feed event type.
alter table activity_feed drop constraint if exists activity_feed_type_check;
alter table activity_feed add constraint activity_feed_type_check check (type in (
  'quote_sent','quote_accepted','quote_declined','quote_viewed','job_created',
  'job_completed','service_completed','client_created','payment_received',
  'recurring_generated','service_unable'
));
