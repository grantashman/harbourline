alter table public.beta_operational_events
  add column if not exists operator_notification_sent_at timestamptz;

alter table public.beta_operational_events
  drop constraint if exists beta_operational_events_event_name_check;

alter table public.beta_operational_events
  add constraint beta_operational_events_event_name_check
  check (event_name in (
    'checkout_started',
    'subscription_activated',
    'onboarding_started',
    'household_created',
    'income_added',
    'five_bills_added',
    'payday_viewed',
    'onboarding_completed',
    'support_requested',
    'signup_completed',
    'subscription_past_due',
    'subscription_cancelled'
  ));

delete from public.beta_operational_events as duplicate
using public.beta_operational_events as keeper
where duplicate.event_name = 'signup_completed'
  and keeper.event_name = 'signup_completed'
  and duplicate.user_id = keeper.user_id
  and (
    keeper.occurred_at < duplicate.occurred_at
    or (keeper.occurred_at = duplicate.occurred_at and keeper.id < duplicate.id)
  );

create unique index if not exists beta_operational_events_signup_completed_user_key
  on public.beta_operational_events(user_id)
  where event_name = 'signup_completed';

create or replace function private.record_new_user_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.beta_operational_events (user_id, event_name)
  values (new.id, 'signup_completed')
  on conflict do nothing;
  return new;
end;
$$;

revoke all on function private.record_new_user_signup() from public;

drop trigger if exists beta_user_created_signup on auth.users;
create trigger beta_user_created_signup
after insert on auth.users
for each row
when (new.is_anonymous is not true)
execute function private.record_new_user_signup();

alter table public.billing_events
  drop constraint if exists billing_events_lifecycle_email_kind_check;

alter table public.billing_events
  add constraint billing_events_lifecycle_email_kind_check
  check (lifecycle_email_kind in ('welcome', 'past_due', 'cancelled'));

create or replace function public.claim_billing_event(
  target_event_id text,
  target_event_type text,
  claim_token uuid,
  stale_after_seconds integer default 300
)
returns table (claimed boolean, processed boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  stale_after interval := make_interval(secs => greatest(60, least(stale_after_seconds, 900)));
begin
  if target_event_id is null or target_event_id = '' or target_event_type is null or target_event_type = '' or claim_token is null then
    raise exception 'billing event claim input is invalid';
  end if;

  insert into public.billing_events (event_id, event_type, processing_started_at, processing_token)
  values (target_event_id, target_event_type, timezone('utc', now()), claim_token)
  on conflict (event_id) do nothing;

  if found then
    return query select true, false;
    return;
  end if;

  update public.billing_events
  set processed_at = null,
      processing_started_at = timezone('utc', now()),
      processing_token = claim_token,
      last_error = null
  where event_id = target_event_id
    and processed_at is not null
    and lifecycle_email_kind is not null
    and lifecycle_email_sent_at is null;

  if found then
    return query select true, false;
    return;
  end if;

  update public.billing_events
  set processing_started_at = timezone('utc', now()),
      processing_token = claim_token,
      last_error = null
  where event_id = target_event_id
    and processed_at is null
    and (
      processing_started_at is null
      or processing_started_at < timezone('utc', now()) - stale_after
    );

  if found then
    return query select true, false;
    return;
  end if;

  return query
  select false, exists(
    select 1
    from public.billing_events
    where event_id = target_event_id
      and processed_at is not null
  );
end;
$$;

create or replace function public.complete_billing_event_claim(
  target_event_id text,
  claim_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.billing_events
  set processed_at = timezone('utc', now()),
      processing_started_at = null,
      processing_token = null,
      last_error = null
  where event_id = target_event_id
    and processing_token = claim_token
    and processed_at is null
    and (
      lifecycle_email_kind is null
      or lifecycle_email_sent_at is not null
    );

  return found;
end;
$$;
