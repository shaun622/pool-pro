-- Home country for a business — drives address autocomplete + geocoding
-- so suggestions default to the operator's country instead of worldwide.
-- ISO 3166-1 alpha-2 (e.g. 'AU', 'NZ', 'GB'). Defaults to AU to match
-- the existing default timezone; operators change it in Settings.
alter table public.businesses add column if not exists country_code text default 'AU';
