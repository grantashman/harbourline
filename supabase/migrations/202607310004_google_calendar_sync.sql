create table if not exists public.google_calendar_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  google_subject text not null,
  google_email text,
  calendar_id text not null default 'primary',
  encrypted_refresh_token text not null,
  refresh_token_nonce text not null,
  scope text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  last_synced_at timestamptz,
  sync_error text
);

create table if not exists public.google_calendar_oauth_states (
  state_hash text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  code_verifier text not null,
  return_path text not null default '/',
  expires_at timestamptz not null,
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.google_calendar_connections enable row level security;
alter table public.google_calendar_oauth_states enable row level security;

revoke all on public.google_calendar_connections from anon, authenticated;
revoke all on public.google_calendar_oauth_states from anon, authenticated;
revoke all on public.google_calendar_connections from public;
revoke all on public.google_calendar_oauth_states from public;
grant all on public.google_calendar_connections to service_role;
grant all on public.google_calendar_oauth_states to service_role;

create index if not exists google_calendar_oauth_states_expiry
  on public.google_calendar_oauth_states(expires_at);
