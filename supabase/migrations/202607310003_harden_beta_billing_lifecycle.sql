alter table public.billing_events
  add column if not exists processing_started_at timestamptz,
  add column if not exists processing_token uuid,
  add column if not exists lifecycle_event_name text check (lifecycle_event_name in (
    'subscription_activated',
    'subscription_past_due',
    'subscription_cancelled'
  )),
  add column if not exists lifecycle_user_id uuid references auth.users(id) on delete set null,
  add column if not exists lifecycle_email_kind text check (lifecycle_email_kind in ('welcome', 'cancelled')),
  add column if not exists lifecycle_event_recorded_at timestamptz,
  add column if not exists lifecycle_email_sent_at timestamptz;

alter table public.beta_operational_events
  add column if not exists source_billing_event_id text references public.billing_events(event_id) on delete set null,
  add column if not exists source_checkout_key text;

create unique index if not exists beta_operational_events_source_billing_event_id_key
  on public.beta_operational_events(source_billing_event_id)
  where source_billing_event_id is not null;

create unique index if not exists beta_operational_events_source_checkout_key_key
  on public.beta_operational_events(source_checkout_key)
  where source_checkout_key is not null;

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

create or replace function public.release_billing_event_claim(
  target_event_id text,
  claim_token uuid,
  error_message text
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.billing_events
  set processing_started_at = null,
      processing_token = null,
      last_error = left(coalesce(error_message, 'Billing event could not be processed'), 1000)
  where event_id = target_event_id
    and processing_token = claim_token
    and processed_at is null;
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
    and processed_at is null;

  return found;
end;
$$;

revoke all on function public.claim_billing_event(text, text, uuid, integer) from public, anon, authenticated;
revoke all on function public.release_billing_event_claim(text, uuid, text) from public, anon, authenticated;
revoke all on function public.complete_billing_event_claim(text, uuid) from public, anon, authenticated;
grant execute on function public.claim_billing_event(text, text, uuid, integer) to service_role;
grant execute on function public.release_billing_event_claim(text, uuid, text) to service_role;
grant execute on function public.complete_billing_event_claim(text, uuid) to service_role;
