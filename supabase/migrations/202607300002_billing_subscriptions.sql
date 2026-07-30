create table if not exists public.billing_subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  status text not null default 'incomplete' check (status in ('incomplete', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused', 'incomplete_expired')),
  price_id text,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.billing_events (
  event_id text primary key,
  event_type text not null,
  received_at timestamptz not null default timezone('utc', now())
);

alter table public.billing_subscriptions enable row level security;
alter table public.billing_events enable row level security;

drop policy if exists billing_subscriptions_select_own on public.billing_subscriptions;
create policy billing_subscriptions_select_own
  on public.billing_subscriptions for select
  using (user_id = auth.uid());

revoke all on public.billing_events from anon, authenticated;
revoke insert, update, delete on public.billing_subscriptions from anon, authenticated;
grant select on public.billing_subscriptions to authenticated;

create or replace function public.has_active_subscription()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.billing_subscriptions
    where user_id = auth.uid()
      and status in ('active', 'trialing')
  );
$$;

revoke all on function public.has_active_subscription() from public;
grant execute on function public.has_active_subscription() to authenticated;
