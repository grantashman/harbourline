alter table public.billing_subscriptions
  add column if not exists stripe_event_created_at timestamptz,
  add column if not exists stripe_event_id text;

alter table public.beta_operational_events
  add column if not exists signup_verified_at timestamptz;

update public.beta_operational_events as event_row
set signup_verified_at = coalesce(auth_user.email_confirmed_at, auth_user.confirmed_at)
from auth.users as auth_user
where event_row.user_id = auth_user.id
  and event_row.event_name = 'signup_completed'
  and event_row.signup_verified_at is null
  and coalesce(auth_user.email_confirmed_at, auth_user.confirmed_at) is not null;

create or replace function private.record_new_user_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  verified_at timestamptz := coalesce(new.email_confirmed_at, new.confirmed_at);
begin
  insert into public.beta_operational_events (user_id, event_name, signup_verified_at)
  values (new.id, 'signup_completed', verified_at)
  on conflict do nothing;

  update public.beta_operational_events
  set signup_verified_at = coalesce(signup_verified_at, verified_at)
  where user_id = new.id
    and event_name = 'signup_completed'
    and signup_verified_at is null
    and verified_at is not null;
  return new;
end;
$$;

revoke all on function private.record_new_user_signup() from public;

drop trigger if exists beta_user_confirmed_signup on auth.users;
create trigger beta_user_confirmed_signup
after update of email_confirmed_at, confirmed_at on auth.users
for each row
when (
  new.is_anonymous is not true
  and coalesce(new.email_confirmed_at, new.confirmed_at) is not null
  and coalesce(old.email_confirmed_at, old.confirmed_at) is distinct from coalesce(new.email_confirmed_at, new.confirmed_at)
)
execute function private.record_new_user_signup();

-- Replace the legacy void-returning release function with a checked result.
drop function if exists public.release_billing_event_claim(text, uuid, text);
create function public.release_billing_event_claim(
  target_event_id text,
  claim_token uuid,
  error_message text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.billing_events
  set processing_started_at = null,
      processing_token = null,
      last_error = left(coalesce(error_message, 'Billing event could not be processed'), 1000)
  where event_id = target_event_id
    and processing_token = claim_token
    and processed_at is null;

  return found;
end;
$$;

revoke all on function public.release_billing_event_claim(text, uuid, text) from public, anon, authenticated;
grant execute on function public.release_billing_event_claim(text, uuid, text) to service_role;

create or replace function public.apply_billing_subscription_snapshot(
  target_user_id uuid,
  target_customer_id text,
  target_subscription_id text,
  target_status text,
  target_price_id text,
  target_current_period_end timestamptz,
  target_cancel_at_period_end boolean,
  target_event_created_at timestamptz,
  target_event_id text
)
returns table (applied boolean, previous_status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.billing_subscriptions%rowtype;
begin
  if target_user_id is null
    or target_subscription_id is null
    or target_status is null
    or target_event_created_at is null
    or target_event_id is null
  then
    raise exception 'billing subscription snapshot input is invalid';
  end if;

  select * into current_row
  from public.billing_subscriptions
  where user_id = target_user_id
  for update;

  if found and current_row.stripe_event_created_at is not null and (
    target_event_created_at < current_row.stripe_event_created_at
    or (
      target_event_created_at = current_row.stripe_event_created_at
      and (
        target_subscription_id is distinct from current_row.stripe_subscription_id
        or target_event_id <= coalesce(current_row.stripe_event_id, '')
      )
    )
  ) then
    return query select false, current_row.status;
    return;
  end if;

  insert into public.billing_subscriptions (
    user_id,
    stripe_customer_id,
    stripe_subscription_id,
    status,
    price_id,
    current_period_end,
    cancel_at_period_end,
    stripe_event_created_at,
    stripe_event_id,
    updated_at
  ) values (
    target_user_id,
    target_customer_id,
    target_subscription_id,
    target_status,
    target_price_id,
    target_current_period_end,
    target_cancel_at_period_end,
    target_event_created_at,
    target_event_id,
    timezone('utc', now())
  )
  on conflict (user_id) do update set
    stripe_customer_id = excluded.stripe_customer_id,
    stripe_subscription_id = excluded.stripe_subscription_id,
    status = excluded.status,
    price_id = excluded.price_id,
    current_period_end = excluded.current_period_end,
    cancel_at_period_end = excluded.cancel_at_period_end,
    stripe_event_created_at = excluded.stripe_event_created_at,
    stripe_event_id = excluded.stripe_event_id,
    updated_at = excluded.updated_at;

  return query select true, current_row.status;
end;
$$;

revoke all on function public.apply_billing_subscription_snapshot(uuid, text, text, text, text, timestamptz, boolean, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.apply_billing_subscription_snapshot(uuid, text, text, text, text, timestamptz, boolean, timestamptz, text)
  to service_role;
