-- Invoicing schema for PoolPro

-- Add invoice settings to businesses
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS next_invoice_number integer DEFAULT 1;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS invoice_prefix text DEFAULT 'INV';
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS default_payment_terms_days integer DEFAULT 14;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS bank_details text;

-- Invoices
create table if not exists invoices (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses not null,
  client_id uuid references clients not null,
  service_record_id uuid references service_records,
  invoice_number text not null,
  status text default 'draft' check (status in ('draft', 'sent', 'paid', 'overdue', 'void')),
  line_items jsonb default '[]',
  subtotal numeric default 0,
  gst numeric default 0,
  total numeric default 0,
  issued_date date,
  due_date date,
  paid_date date,
  paid_amount numeric,
  payment_method text,
  notes text,
  public_token uuid default gen_random_uuid(),
  sent_at timestamptz,
  created_at timestamptz default now()
);

alter table invoices enable row level security;

create policy "Business can manage invoices"
  on invoices for all
  using (business_id = current_business_id());

create policy "Public invoice access"
  on invoices for select
  using (true);

-- Indexes
create index if not exists idx_invoices_business_id on invoices(business_id);
create index if not exists idx_invoices_client_id on invoices(client_id);
create index if not exists idx_invoices_public_token on invoices(public_token);
