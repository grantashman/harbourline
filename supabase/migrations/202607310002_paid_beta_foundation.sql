create table if not exists public.beta_onboarding (
  user_id uuid primary key references auth.users(id) on delete cascade,
  household_id uuid references public.households(id) on delete set null,
  step text not null check (step in ('household', 'income', 'bills', 'payday', 'complete')),
  completed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists beta_onboarding_user_updated_at
  on public.beta_onboarding(user_id, updated_at desc);

alter table public.beta_onboarding enable row level security;

drop trigger if exists beta_onboarding_set_updated_at on public.beta_onboarding;
create trigger beta_onboarding_set_updated_at
before update on public.beta_onboarding
for each row execute function public.set_updated_at();

create table if not exists public.beta_operational_events (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  household_id uuid references public.households(id) on delete set null,
  event_name text not null check (event_name in (
    'checkout_started',
    'subscription_activated',
    'onboarding_started',
    'household_created',
    'income_added',
    'five_bills_added',
    'payday_viewed',
    'onboarding_completed',
    'support_requested',
    'subscription_past_due',
    'subscription_cancelled'
  )),
  occurred_at timestamptz not null default timezone('utc', now())
);

create index if not exists beta_operational_events_event_name_occurred_at
  on public.beta_operational_events(event_name, occurred_at desc);

alter table public.beta_operational_events enable row level security;

revoke all on public.beta_onboarding from public;
revoke all on public.beta_onboarding from anon;
revoke all on public.beta_onboarding from authenticated;
revoke all on public.beta_operational_events from public;
revoke all on public.beta_operational_events from anon;
revoke all on public.beta_operational_events from authenticated;

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
    'onboarding', (
      select to_jsonb(onboarding_row)
      from public.beta_onboarding onboarding_row
      where onboarding_row.user_id = auth.uid()
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

revoke all on function public.export_my_account() from public;
grant execute on function public.export_my_account() to authenticated;
