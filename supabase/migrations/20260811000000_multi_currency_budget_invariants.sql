begin;

-- Currency metadata is explicit and configuration-driven. AUD is the only
-- enabled currency until a reviewed staging rollout turns another row on.
create table if not exists public.currency_catalog (
  code text primary key check (code ~ '^[A-Z]{3}$'),
  minor_unit smallint not null check (minor_unit between 0 and 6),
  default_locale text not null check (char_length(trim(default_locale)) between 2 and 40),
  enabled boolean not null default false,
  verified_at timestamptz,
  verified_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

insert into public.currency_catalog (code, minor_unit, default_locale, enabled)
values
  ('AUD', 2, 'en-AU', true),
  ('CAD', 2, 'en-CA', false),
  ('EUR', 2, 'en-IE', false),
  ('GBP', 2, 'en-GB', false),
  ('JPY', 0, 'ja-JP', false),
  ('NZD', 2, 'en-NZ', false),
  ('SGD', 2, 'en-SG', false),
  ('USD', 2, 'en-US', false)
on conflict (code) do nothing;

alter table public.households
  add column if not exists currency text not null default 'AUD';

alter table public.households
  drop constraint if exists households_currency_format;
alter table public.households
  add constraint households_currency_format check (currency ~ '^[A-Z]{3}$');

alter table public.currency_catalog enable row level security;
revoke all on public.currency_catalog from anon, authenticated;

create or replace function private.currency_is_enabled(target_currency text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.currency_catalog
    where code = upper(trim(target_currency))
      and enabled = true
  );
$$;

create or replace function private.validate_budget_state(
  target_household uuid,
  target_state jsonb,
  target_schema_version integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  household_currency text;
  document_currency text;
  representation text;
begin
  select currency into household_currency
  from public.households
  where id = target_household;

  if household_currency is null then
    raise exception 'Household currency is not configured' using errcode = 'P0002';
  end if;
  if not private.currency_is_enabled(household_currency) then
    raise exception 'Household currency is not enabled' using errcode = '22023';
  end if;
  if jsonb_typeof(target_state) <> 'object' then
    raise exception 'Budget state must be a JSON object' using errcode = '22023';
  end if;

  -- Empty documents are created before the first local state is uploaded.
  if target_state = '{}'::jsonb then return; end if;

  document_currency := nullif(upper(trim(target_state ->> 'currency')), '');
  if document_currency is null then
    -- Existing release-2 documents are AUD legacy records. They remain
    -- readable, but a new schema-version-4 client must upload the exact form.
    if household_currency <> 'AUD' or target_schema_version >= 4 then
      raise exception 'Budget state must declare its currency' using errcode = '22023';
    end if;
    return;
  end if;
  if document_currency <> household_currency then
    raise exception 'Budget currency cannot differ from its household currency' using errcode = '22023';
  end if;
  if not private.currency_is_enabled(document_currency) then
    raise exception 'Budget currency is not enabled' using errcode = '22023';
  end if;

  representation := target_state ->> 'moneyRepresentation';
  if target_schema_version >= 4 and representation <> 'minor-unit-string' then
    raise exception 'Budget money must use minor-unit strings' using errcode = '22023';
  end if;
end;
$$;

create or replace function private.enforce_budget_currency()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.validate_budget_state(new.household_id, new.state, new.schema_version);
  return new;
end;
$$;

drop trigger if exists budget_documents_currency_invariant on public.budget_documents;
create trigger budget_documents_currency_invariant
before insert or update of schema_version, state on public.budget_documents
for each row execute function private.enforce_budget_currency();

-- Keep the household and its document aligned if an operator changes the
-- catalogue or performs a controlled migration. Normal clients cannot update
-- this column through RLS; existing rows remain AUD.
create or replace function private.enforce_household_currency()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_document jsonb;
begin
  if not private.currency_is_enabled(new.currency) then
    raise exception 'Household currency is not enabled' using errcode = '22023';
  end if;
  select state into current_document
  from public.budget_documents
  where household_id = new.id;
  if current_document is not null and current_document <> '{}'::jsonb
     and coalesce(current_document ->> 'currency', 'AUD') <> new.currency then
    raise exception 'Existing budget records must be migrated before changing currency' using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists households_currency_invariant on public.households;
create trigger households_currency_invariant
before insert or update of currency on public.households
for each row execute function private.enforce_household_currency();

-- Re-assert the invariant at the RPC boundary so callers receive a stable
-- domain error even if trigger behavior is changed in a future migration.
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
  perform private.validate_budget_state(target_household, document_state, document_schema_version);
  if char_length(coalesce(document_state_hash, '')) not between 8 and 128 then
    raise exception 'A valid state hash is required' using errcode = '22023';
  end if;

  select applied_revision into prior_revision
  from public.sync_mutations
  where id = mutation_id and household_id = target_household and user_id = current_user_id;
  if found then
    select * into current_document from public.budget_documents where household_id = target_household;
    return jsonb_build_object(
      'conflict', false, 'idempotent', true,
      'document', jsonb_build_object(
        'householdId', current_document.household_id,
        'revision', current_document.revision,
        'schemaVersion', current_document.schema_version,
        'state', current_document.state,
        'updatedAt', current_document.updated_at
      )
    );
  end if;

  select * into current_document
  from public.budget_documents
  where household_id = target_household
  for update;
  if not found then
    raise exception 'Household budget document not found' using errcode = 'P0002';
  end if;
  if current_document.revision <> base_revision then
    return jsonb_build_object(
      'conflict', true, 'idempotent', false,
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

  insert into public.sync_mutations (id, household_id, user_id, base_revision, applied_revision, state_hash)
  values (mutation_id, target_household, current_user_id, base_revision, current_document.revision, document_state_hash);

  return jsonb_build_object(
    'conflict', false, 'idempotent', false,
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

revoke all on function private.currency_is_enabled(text) from public;
revoke all on function private.validate_budget_state(uuid, jsonb, integer) from public;
revoke all on function private.enforce_budget_currency() from public;
revoke all on function private.enforce_household_currency() from public;

commit;
