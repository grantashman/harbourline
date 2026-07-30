begin;

create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;
revoke all on schema private from public;
revoke all on schema private from anon;
revoke all on schema private from authenticated;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.households (
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 80),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

create unique index household_single_owner
  on public.household_members(household_id)
  where role = 'owner';

create index household_members_user_id
  on public.household_members(user_id, household_id);

create table public.household_invites (
  id uuid primary key default extensions.gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  email text not null check (char_length(trim(email)) between 3 and 320),
  role text not null default 'member' check (role = 'member'),
  token_hash text not null unique,
  invited_by uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

create index household_invites_household
  on public.household_invites(household_id, created_at desc);

create index household_invites_email
  on public.household_invites(lower(email), expires_at desc);

create table public.budget_documents (
  household_id uuid primary key references public.households(id) on delete cascade,
  revision bigint not null default 0 check (revision >= 0),
  schema_version integer not null default 3 check (schema_version > 0),
  state jsonb not null default '{}'::jsonb check (jsonb_typeof(state) = 'object'),
  updated_by uuid not null references auth.users(id) on delete restrict,
  updated_at timestamptz not null default now()
);

create table public.sync_mutations (
  id uuid primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  base_revision bigint not null check (base_revision >= 0),
  applied_revision bigint not null check (applied_revision > 0),
  state_hash text not null,
  created_at timestamptz not null default now()
);

create index sync_mutations_household
  on public.sync_mutations(household_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.household_invites enable row level security;
alter table public.budget_documents enable row level security;
alter table public.sync_mutations enable row level security;

create or replace function private.is_household_member(
  target_household uuid,
  target_user uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.household_members
    where household_id = target_household
      and user_id = target_user
  );
$$;

create or replace function private.is_household_owner(
  target_household uuid,
  target_user uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.household_members
    where household_id = target_household
      and user_id = target_user
      and role = 'owner'
  );
$$;

create or replace function private.shares_household(
  target_user uuid,
  requesting_user uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.household_members mine
    join public.household_members theirs
      on theirs.household_id = mine.household_id
    where mine.user_id = requesting_user
      and theirs.user_id = target_user
  );
$$;

revoke all on function private.is_household_member(uuid, uuid) from public;
revoke all on function private.is_household_owner(uuid, uuid) from public;
revoke all on function private.shares_household(uuid, uuid) from public;
grant usage on schema private to authenticated;
grant execute on function private.is_household_member(uuid, uuid) to authenticated;
grant execute on function private.is_household_owner(uuid, uuid) to authenticated;
grant execute on function private.shares_household(uuid, uuid) to authenticated;

create policy "profiles are visible to the user and household peers"
on public.profiles for select
to authenticated
using (
  id = (select auth.uid())
  or private.shares_household(id)
);

create policy "users update their own profile"
on public.profiles for update
to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

create policy "members view their households"
on public.households for select
to authenticated
using (private.is_household_member(id));

create policy "owners update their households"
on public.households for update
to authenticated
using (private.is_household_owner(id))
with check (private.is_household_owner(id));

create policy "members view household membership"
on public.household_members for select
to authenticated
using (private.is_household_member(household_id));

create policy "owners remove members and members may leave"
on public.household_members for delete
to authenticated
using (
  (private.is_household_owner(household_id) and role = 'member')
  or (user_id = (select auth.uid()) and role = 'member')
);

create policy "owners view household invitations"
on public.household_invites for select
to authenticated
using (private.is_household_owner(household_id));

create policy "owners revoke household invitations"
on public.household_invites for delete
to authenticated
using (private.is_household_owner(household_id));

create policy "members read the household budget"
on public.budget_documents for select
to authenticated
using (private.is_household_member(household_id));

create policy "users read their own mutation receipts"
on public.sync_mutations for select
to authenticated
using (
  user_id = (select auth.uid())
  and private.is_household_member(household_id)
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger households_set_updated_at
before update on public.households
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.create_household(household_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  new_household_id uuid;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if char_length(trim(coalesce(household_name, ''))) not between 1 and 80 then
    raise exception 'Household name must be between 1 and 80 characters' using errcode = '22023';
  end if;

  insert into public.households (name, created_by)
  values (trim(household_name), current_user_id)
  returning id into new_household_id;

  insert into public.household_members (household_id, user_id, role)
  values (new_household_id, current_user_id, 'owner');

  insert into public.budget_documents (
    household_id,
    revision,
    schema_version,
    state,
    updated_by
  )
  values (
    new_household_id,
    0,
    3,
    '{}'::jsonb,
    current_user_id
  );

  return new_household_id;
end;
$$;

create or replace function public.create_household_invite(
  target_household uuid,
  invite_email text,
  expires_in_hours integer default 168
)
returns table (
  invite_id uuid,
  invite_token text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  normalised_email text := lower(trim(coalesce(invite_email, '')));
  generated_token text;
  expiry timestamptz;
  created_invite_id uuid;
begin
  if not private.is_household_owner(target_household, current_user_id) then
    raise exception 'Only the household owner can invite members' using errcode = '42501';
  end if;
  if normalised_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'A valid email address is required' using errcode = '22023';
  end if;

  generated_token := translate(
    rtrim(encode(extensions.gen_random_bytes(24), 'base64'), '='),
    '+/',
    '-_'
  );
  expiry := now() + make_interval(hours => greatest(least(expires_in_hours, 720), 1));

  insert into public.household_invites (
    household_id,
    email,
    role,
    token_hash,
    invited_by,
    expires_at
  )
  values (
    target_household,
    normalised_email,
    'member',
    encode(extensions.digest(generated_token, 'sha256'), 'hex'),
    current_user_id,
    expiry
  )
  returning id into created_invite_id;

  return query select created_invite_id, generated_token, expiry;
end;
$$;

create or replace function public.accept_household_invite(invite_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  current_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  matched_invite public.household_invites%rowtype;
begin
  if current_user_id is null or current_email = '' then
    raise exception 'A verified email account is required' using errcode = '42501';
  end if;

  select *
  into matched_invite
  from public.household_invites
  where token_hash = encode(
    extensions.digest(coalesce(invite_token, ''), 'sha256'),
    'hex'
  )
    and accepted_at is null
    and expires_at > now()
  for update;

  if not found or lower(matched_invite.email) <> current_email then
    raise exception 'Invite is invalid, expired, or belongs to another email' using errcode = '42501';
  end if;

  insert into public.household_members (household_id, user_id, role)
  values (matched_invite.household_id, current_user_id, 'member')
  on conflict (household_id, user_id) do nothing;

  update public.household_invites
  set accepted_at = now()
  where id = matched_invite.id;

  return matched_invite.household_id;
end;
$$;

create or replace function public.sync_budget(
  target_household uuid,
  mutation_id uuid,
  base_revision bigint,
  document_schema_version integer,
  document_state jsonb,
  document_state_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  current_document public.budget_documents%rowtype;
  prior_revision bigint;
begin
  if not private.is_household_member(target_household, current_user_id) then
    raise exception 'Household membership required' using errcode = '42501';
  end if;
  if base_revision < 0 or document_schema_version < 1 then
    raise exception 'Invalid sync metadata' using errcode = '22023';
  end if;
  if jsonb_typeof(document_state) <> 'object' then
    raise exception 'Budget state must be a JSON object' using errcode = '22023';
  end if;
  if char_length(coalesce(document_state_hash, '')) not between 8 and 128 then
    raise exception 'A valid state hash is required' using errcode = '22023';
  end if;

  select applied_revision
  into prior_revision
  from public.sync_mutations
  where id = mutation_id
    and household_id = target_household
    and user_id = current_user_id;

  if found then
    select *
    into current_document
    from public.budget_documents
    where household_id = target_household;

    return jsonb_build_object(
      'conflict', false,
      'idempotent', true,
      'document', jsonb_build_object(
        'householdId', current_document.household_id,
        'revision', current_document.revision,
        'schemaVersion', current_document.schema_version,
        'state', current_document.state,
        'updatedAt', current_document.updated_at
      )
    );
  end if;

  select *
  into current_document
  from public.budget_documents
  where household_id = target_household
  for update;

  if not found then
    raise exception 'Household budget document not found' using errcode = 'P0002';
  end if;

  if current_document.revision <> base_revision then
    return jsonb_build_object(
      'conflict', true,
      'idempotent', false,
      'document', jsonb_build_object(
        'householdId', current_document.household_id,
        'revision', current_document.revision,
        'schemaVersion', current_document.schema_version,
        'state', current_document.state,
        'updatedAt', current_document.updated_at
      )
    );
  end if;

  update public.budget_documents
  set revision = current_document.revision + 1,
      schema_version = document_schema_version,
      state = document_state,
      updated_by = current_user_id,
      updated_at = now()
  where household_id = target_household
  returning * into current_document;

  insert into public.sync_mutations (
    id,
    household_id,
    user_id,
    base_revision,
    applied_revision,
    state_hash
  )
  values (
    mutation_id,
    target_household,
    current_user_id,
    base_revision,
    current_document.revision,
    document_state_hash
  );

  return jsonb_build_object(
    'conflict', false,
    'idempotent', false,
    'document', jsonb_build_object(
      'householdId', current_document.household_id,
      'revision', current_document.revision,
      'schemaVersion', current_document.schema_version,
      'state', current_document.state,
      'updatedAt', current_document.updated_at
    )
  );
end;
$$;

create or replace function public.transfer_household_ownership(
  target_household uuid,
  new_owner uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if not private.is_household_owner(target_household, current_user_id) then
    raise exception 'Only the household owner can transfer ownership' using errcode = '42501';
  end if;
  if not private.is_household_member(target_household, new_owner) then
    raise exception 'The new owner must already be a household member' using errcode = '22023';
  end if;
  if new_owner = current_user_id then
    return;
  end if;

  update public.household_members
  set role = 'member'
  where household_id = target_household
    and user_id = current_user_id;

  update public.household_members
  set role = 'owner'
  where household_id = target_household
    and user_id = new_owner;

  update public.households
  set created_by = new_owner
  where id = target_household;
end;
$$;

create or replace function public.delete_household(target_household uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_household_owner(target_household, auth.uid()) then
    raise exception 'Only the household owner can delete it' using errcode = '42501';
  end if;
  delete from public.households where id = target_household;
end;
$$;

create or replace function public.export_my_account()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'exportedAt', now(),
    'profile', (
      select to_jsonb(profile_row)
      from public.profiles profile_row
      where profile_row.id = auth.uid()
    ),
    'households', coalesce((
      select jsonb_agg(jsonb_build_object(
        'household', to_jsonb(household_row),
        'membership', to_jsonb(member_row),
        'budget', to_jsonb(budget_row)
      ))
      from public.household_members member_row
      join public.households household_row
        on household_row.id = member_row.household_id
      left join public.budget_documents budget_row
        on budget_row.household_id = household_row.id
      where member_row.user_id = auth.uid()
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.create_household(text) from public;
revoke all on function public.create_household_invite(uuid, text, integer) from public;
revoke all on function public.accept_household_invite(text) from public;
revoke all on function public.sync_budget(uuid, uuid, bigint, integer, jsonb, text) from public;
revoke all on function public.transfer_household_ownership(uuid, uuid) from public;
revoke all on function public.delete_household(uuid) from public;
revoke all on function public.export_my_account() from public;

grant execute on function public.create_household(text) to authenticated;
grant execute on function public.create_household_invite(uuid, text, integer) to authenticated;
grant execute on function public.accept_household_invite(text) to authenticated;
grant execute on function public.sync_budget(uuid, uuid, bigint, integer, jsonb, text) to authenticated;
grant execute on function public.transfer_household_ownership(uuid, uuid) to authenticated;
grant execute on function public.delete_household(uuid) to authenticated;
grant execute on function public.export_my_account() to authenticated;

revoke all on public.profiles from anon;
revoke all on public.households from anon;
revoke all on public.household_members from anon;
revoke all on public.household_invites from anon;
revoke all on public.budget_documents from anon;
revoke all on public.sync_mutations from anon;

grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;
grant select on public.households to authenticated;
grant update (name) on public.households to authenticated;
grant select, delete on public.household_members to authenticated;
grant select, delete on public.household_invites to authenticated;
grant select on public.budget_documents to authenticated;
grant select on public.sync_mutations to authenticated;

do $$
begin
  if exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'budget_documents'
  ) then
    alter publication supabase_realtime add table public.budget_documents;
  end if;
end;
$$;

commit;
