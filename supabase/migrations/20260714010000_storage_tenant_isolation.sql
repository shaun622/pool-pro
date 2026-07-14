-- Storage tenant isolation (Phase 2c).
--
-- Every storage.objects policy was scoped only by bucket_id, so ANY authenticated
-- user (any tenant, even a customer-portal login) could upload / overwrite /
-- delete another business's files, and everything was world-readable. Scope the
-- writes to the caller's own business folder (the path prefix IS the business id
-- for service-photos / staff-photos / documents) and privatise the sensitive
-- `documents` bucket.
--
--   service-photos : ${business_id}/${service_record_id}/${ts}.jpg
--   staff-photos   : ${business_id}/${ts}.${ext}
--   documents      : ${business_id}/${ts}-${filename}
--
-- so (storage.foldername(name))[1] is the owning business id.
--
-- `logos` uses flat, non-business-prefixed names (${ts}.ext) and is uploaded
-- during onboarding BEFORE the business row exists, so it CANNOT be scoped by
-- current_business_id() without breaking signup. Logos are public + non-sensitive
-- (embedded in customer emails), so its policies are intentionally left as-is.
--
-- service-photos + staff-photos keep public READ (embedded in the completion
-- email and the customer portal); only their WRITES are locked here. Making
-- service-photos fully private is a deliberate, verify-first follow-up — it needs
-- long-TTL signed URLs in the completion email and a customer storage read policy,
-- and must be tested against a real completion email before shipping.

-- ── service-photos: uploads must target the caller's business folder ──────────
drop policy if exists "Authenticated users can upload photos" on storage.objects;
create policy "Business can upload service photos" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'service-photos'
    and (storage.foldername(name))[1] = public.current_business_id()::text
  );

-- ── staff-photos: upload + update must target the caller's business folder ────
drop policy if exists "Authenticated users can upload staff photos" on storage.objects;
drop policy if exists "Authenticated users can update staff photos" on storage.objects;
create policy "Business can upload staff photos" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'staff-photos'
    and (storage.foldername(name))[1] = public.current_business_id()::text
  );
create policy "Business can update staff photos" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'staff-photos'
    and (storage.foldername(name))[1] = public.current_business_id()::text
  );

-- ── documents: make PRIVATE and scope every operation to the business folder ──
update storage.buckets set public = false where id = 'documents';
drop policy if exists "Anyone can view documents" on storage.objects;
drop policy if exists "Authenticated can upload documents" on storage.objects;
drop policy if exists "Authenticated can delete documents" on storage.objects;
create policy "Business can read documents" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = public.current_business_id()::text
  );
create policy "Business can upload documents" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = public.current_business_id()::text
  );
create policy "Business can delete documents" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = public.current_business_id()::text
  );
