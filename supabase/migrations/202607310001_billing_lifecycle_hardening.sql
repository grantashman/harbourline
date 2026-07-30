alter table public.billing_events
  add column if not exists processed_at timestamptz,
  add column if not exists last_error text;
