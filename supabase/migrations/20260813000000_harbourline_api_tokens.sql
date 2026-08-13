begin;

create table public.api_tokens (
  id uuid primary key default extensions.gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 80),
  token_prefix text not null check (token_prefix ~ '^hl_live_[A-Za-z0-9_-]{12}$'),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  scopes text[] not null default array['household:read', 'bills:read']::text[]
    check (scopes <> '{}'::text[] and scopes <@ array['household:read', 'bills:read']::text[]),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);

create index api_tokens_household_created
  on public.api_tokens(household_id, created_at desc);

create index api_tokens_hash_active
  on public.api_tokens(token_hash)
  where revoked_at is null;

alter table public.api_tokens enable row level security;

revoke all on public.api_tokens from anon, authenticated;
grant select, update on public.api_tokens to authenticated;

drop policy if exists "household owners view API tokens" on public.api_tokens;
create policy "household owners view API tokens"
  on public.api_tokens for select
  to authenticated
  using (private.is_household_owner(household_id));

drop policy if exists "household owners revoke API tokens" on public.api_tokens;
create policy "household owners revoke API tokens"
  on public.api_tokens for update
  to authenticated
  using (private.is_household_owner(household_id))
  with check (private.is_household_owner(household_id));

commit;
