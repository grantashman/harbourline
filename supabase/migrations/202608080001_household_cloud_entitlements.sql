begin;

-- The single paid plan belongs to a household. An active subscription held by
-- any household member grants cloud-write access to that household. Reads,
-- exports, deletion and ownership transfer intentionally remain available after
-- cancellation so customer data is not stranded.
create or replace function private.has_household_cloud_access(target_household uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.household_members members
    join public.billing_subscriptions subscriptions
      on subscriptions.user_id = members.user_id
    where members.household_id = target_household
      and subscriptions.status in ('active', 'trialing')
  );
$$;

revoke all on function private.has_household_cloud_access(uuid) from public;

-- The client-facing summary must use the same household entitlement rule as
-- database write guards so invited household members are not incorrectly
-- blocked by the owner-only subscription record.
create or replace function public.has_active_subscription()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.billing_subscriptions subscriptions
    where subscriptions.user_id = auth.uid()
      and subscriptions.status in ('active', 'trialing')
  )
  or exists (
    select 1
    from public.household_members memberships
    where memberships.user_id = auth.uid()
      and private.has_household_cloud_access(memberships.household_id)
  );
$$;

revoke all on function public.has_active_subscription() from public;
grant execute on function public.has_active_subscription() to authenticated;

create or replace function private.enforce_household_write_entitlement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Service-role migrations and trusted maintenance jobs do not carry a user
  -- JWT and must remain able to create/repair records.
  if auth.uid() is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if not public.has_active_subscription() then
      raise exception 'An active Harbourline subscription is required to create a household'
        using errcode = '42501';
    end if;
  elsif not private.has_household_cloud_access(new.id) then
    raise exception 'An active household Harbourline subscription is required for cloud changes'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create or replace function private.enforce_member_entitlement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  -- The initial owner row is inserted immediately after household creation,
  -- before the household has any members to inspect.
  if new.role = 'owner' and new.user_id = auth.uid() then
    if not public.has_active_subscription() then
      raise exception 'An active Harbourline subscription is required to create a household'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if not private.has_household_cloud_access(new.household_id) then
    raise exception 'An active household Harbourline subscription is required for cloud changes'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create or replace function private.enforce_cloud_write_entitlement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or private.has_household_cloud_access(new.household_id) then
    return new;
  end if;

  raise exception 'An active household Harbourline subscription is required for cloud changes'
    using errcode = '42501';
end;
$$;

revoke all on function private.enforce_household_write_entitlement() from public;
revoke all on function private.enforce_member_entitlement() from public;
revoke all on function private.enforce_cloud_write_entitlement() from public;

drop trigger if exists households_require_subscription on public.households;
create trigger households_require_subscription
before insert or update on public.households
for each row execute function private.enforce_household_write_entitlement();

drop trigger if exists household_members_require_entitlement on public.household_members;
create trigger household_members_require_entitlement
before insert on public.household_members
for each row execute function private.enforce_member_entitlement();

drop trigger if exists household_invites_require_entitlement on public.household_invites;
create trigger household_invites_require_entitlement
before insert on public.household_invites
for each row execute function private.enforce_cloud_write_entitlement();

drop trigger if exists budget_documents_require_entitlement on public.budget_documents;
create trigger budget_documents_require_entitlement
before insert or update on public.budget_documents
for each row execute function private.enforce_cloud_write_entitlement();

drop trigger if exists sync_mutations_require_entitlement on public.sync_mutations;
create trigger sync_mutations_require_entitlement
before insert on public.sync_mutations
for each row execute function private.enforce_cloud_write_entitlement();

commit;
