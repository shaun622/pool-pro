-- Storage read-scoping: stop cross-tenant enumeration/download of photos (audit #2).
--
-- service-photos and staff-photos had an UNSCOPED select policy
--   create policy "Anyone can view service photos" ... using (bucket_id = 'service-photos')
-- with no `to` clause → it applied to the PUBLIC role (incl. anon). RLS can't filter
-- columns and the requester controls the query, so anyone with the public anon key
-- could `storage.from('service-photos').list('')` and enumerate every business's
-- folders + filenames, then download each object — cross-tenant harvest of staff-face
-- and customer-property photos.
--
-- Fix (folder-scoped, no signed-URL rewrite): DROP the blanket select policies and
-- replace them with scoped ones so list()/RLS reads only ever return the caller's own
-- rows. Anon matches NO select policy → list() returns nothing → enumeration closed;
-- and a cross-tenant object can't be downloaded because its UUID path can't be
-- discovered. Buckets stay public=true, so the existing getPublicUrl links in the
-- report emails and the in-app/portal photo display keep working unchanged (the
-- public object endpoint bypasses RLS; only the enumerable RLS read path is scoped).
--
-- Path scheme (foldername(name) is 1-indexed, folders only):
--   service-photos : ${business_id}/${service_record_id}/${clientPhotoId}.jpg  → [1]=biz, [2]=record
--   staff-photos   : ${business_id}/${ts}.${ext}                               → [1]=biz

-- ── service-photos ────────────────────────────────────────────────────────────
drop policy if exists "Anyone can view service photos" on storage.objects;
drop policy if exists "Business reads own service photos" on storage.objects;
drop policy if exists "Customer reads own service photos" on storage.objects;

-- Business reads its own folder (list / management / future signed URLs).
create policy "Business reads own service photos" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'service-photos'
    and (storage.foldername(storage.objects.name))[1] = public.current_business_id()::text
  );

-- Customer portal reads photos of THEIR OWN pools' service records (the service
-- record id is the 2nd path segment → pool → client → this auth user).
create policy "Customer reads own service photos" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'service-photos'
    and exists (
      select 1
      from service_records sr
      join pools   p on p.id = sr.pool_id
      join clients c on c.id = p.client_id
      where sr.id::text = (storage.foldername(storage.objects.name))[2]
        and c.auth_user_id = auth.uid()
    )
  );

-- ── staff-photos ──────────────────────────────────────────────────────────────
drop policy if exists "Anyone can view staff photos" on storage.objects;
drop policy if exists "Business reads own staff photos" on storage.objects;

create policy "Business reads own staff photos" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'staff-photos'
    and (storage.foldername(storage.objects.name))[1] = public.current_business_id()::text
  );
