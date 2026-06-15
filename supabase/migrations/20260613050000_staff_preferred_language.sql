-- Per-technician UI language preference for the tech app (en/id).
-- Customer-facing reports are generated server-side in English regardless
-- of this — it only affects the technician's on-screen UI language.
alter table public.staff_members add column if not exists preferred_language text default 'en';
