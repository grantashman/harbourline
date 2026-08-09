begin;

create or replace function private.is_verified_auth_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.users user_row
    where user_row.id = auth.uid()
      and user_row.is_anonymous = false
  );
$$;

revoke all on function private.is_verified_auth_user() from public;
grant execute on function private.is_verified_auth_user() to authenticated;

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
  select private.is_verified_auth_user() and exists (
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
  select private.is_verified_auth_user() and exists (
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
  select private.is_verified_auth_user() and exists (
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
grant execute on function private.is_household_member(uuid, uuid) to authenticated;
grant execute on function private.is_household_owner(uuid, uuid) to authenticated;
grant execute on function private.shares_household(uuid, uuid) to authenticated;

create or replace function private.has_household_cloud_access(target_household uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_verified_auth_user() and exists (
    select 1
    from public.household_members members
    join public.billing_subscriptions subscriptions
      on subscriptions.user_id = members.user_id
    where members.household_id = target_household
      and subscriptions.status in ('active', 'trialing')
  );
$$;

revoke all on function private.has_household_cloud_access(uuid) from public;
grant execute on function private.has_household_cloud_access(uuid) to authenticated;

create or replace function public.has_active_subscription()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_verified_auth_user() and (
    exists (
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
    )
  );
$$;

revoke all on function public.has_active_subscription() from public;
grant execute on function public.has_active_subscription() to authenticated;

drop policy if exists "profiles are visible to the user and household peers" on public.profiles;
create policy "profiles are visible to the user and household peers"
on public.profiles for select
to authenticated
using (
  private.is_verified_auth_user()
  and (
    id = (select auth.uid())
    or private.shares_household(id)
  )
);

drop policy if exists "users update their own profile" on public.profiles;
create policy "users update their own profile"
on public.profiles for update
to authenticated
using (private.is_verified_auth_user() and id = (select auth.uid()))
with check (private.is_verified_auth_user() and id = (select auth.uid()));

drop policy if exists "owners remove members and members may leave" on public.household_members;
create policy "owners remove members and members may leave"
on public.household_members for delete
to authenticated
using (
  private.is_verified_auth_user()
  and (
    (private.is_household_owner(household_id) and role = 'member')
    or (user_id = (select auth.uid()) and role = 'member')
  )
);

drop policy if exists billing_subscriptions_select_own on public.billing_subscriptions;
create policy billing_subscriptions_select_own
  on public.billing_subscriptions for select
  using (private.is_verified_auth_user() and user_id = auth.uid());

commit;
