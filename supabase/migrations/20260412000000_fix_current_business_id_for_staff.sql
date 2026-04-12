-- Fix current_business_id() to work for staff/tech users, not just owners.
-- Previously only checked businesses.owner_id, which returned NULL for tech users,
-- causing all RLS policies using this function to block tech access to clients,
-- pools, jobs, service_records, etc.

CREATE OR REPLACE FUNCTION public.current_business_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT COALESCE(
    (SELECT id FROM businesses WHERE owner_id = auth.uid() LIMIT 1),
    (SELECT business_id FROM staff_members WHERE user_id = auth.uid() AND is_active = true LIMIT 1)
  );
$$;
