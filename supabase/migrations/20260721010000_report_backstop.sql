-- Server-side report-email backstop.
--
-- Problem: the report email was fire-and-forget from the client only (deleted
-- draft, single un-retried invoke). On a flaky uplink it was silently lost while
-- the service record still committed. And report_sent_at was stamped even when
-- Resend failed, permanently blocking a resend.
--
-- This migration adds the durable retry state + an ATOMIC CLAIM the sender uses
-- to guarantee at most one successful send per record under any concurrency
-- (the client fast path racing the cron sweep). The email-sending changes live
-- in the complete-service / unable-service / send-pending-reports edge functions.

alter table service_records add column if not exists report_attempts int not null default 0;
alter table service_records add column if not exists report_last_attempt_at timestamptz;
alter table service_records add column if not exists report_last_error text;
-- false = a permanent failure (bad recipient / malformed request). Kept separate
-- from the attempt counter on purpose: "how many times tried" and "should we ever
-- try again" are different questions — don't encode the second by poisoning the first.
alter table service_records add column if not exists report_retryable boolean not null default true;

-- The unsent, still-retryable set is tiny; a partial index keeps the
-- every-few-minutes sweep cheap.
create index if not exists idx_service_records_unsent_reports
  on service_records (serviced_at)
  where report_sent_at is null
    and report_retryable
    and status in ('completed', 'unable_to_service');

-- Atomic claim / lease. Both the client fast path and the cron backstop invoke
-- the sender (complete-service / unable-service), which calls this FIRST. The
-- single row-locked UPDATE serialises concurrent invocations: the loser
-- re-evaluates the WHERE against the just-committed lease and matches 0 rows.
--   Returns the new attempt number when claimed; NULL when not claimable
--   (already sent, marked non-retryable, at the attempt cap, or the lease is
--   still held by a very recent attempt).
-- The cap (20) and lease (2 min) live here as the single source of truth for the
-- claim. The sweep's WHERE clause mirrors them but is only a pre-filter — this
-- claim is authoritative, so any drift there is harmless.
create or replace function claim_service_report(p_id uuid)
returns int
language sql
set search_path = public
as $$
  update service_records
     set report_attempts = report_attempts + 1,
         report_last_attempt_at = now()
   where id = p_id
     and report_sent_at is null
     and report_retryable
     and report_attempts < 20
     and (report_last_attempt_at is null
          or report_last_attempt_at < now() - interval '2 minutes')
  returning report_attempts;
$$;

-- Only the edge functions (service-role key) ever claim; the client never does.
revoke all on function claim_service_report(uuid) from public;
revoke all on function claim_service_report(uuid) from anon;
revoke all on function claim_service_report(uuid) from authenticated;
grant execute on function claim_service_report(uuid) to service_role;
