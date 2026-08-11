begin;

create extension if not exists pgtap with schema extensions;

select plan(15);

select has_table('public', 'beta_onboarding', 'beta onboarding table exists');
select has_table('public', 'beta_operational_events', 'beta operational events table exists');

select ok(
  (select relrowsecurity from pg_class where oid = 'public.beta_onboarding'::regclass),
  'beta onboarding has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.beta_operational_events'::regclass),
  'beta operational events has RLS enabled'
);
select has_index(
  'public',
  'beta_onboarding',
  'beta_onboarding_user_updated_at',
  'beta onboarding has the user recency index'
);
select has_index(
  'public',
  'beta_operational_events',
  'beta_operational_events_event_name_occurred_at',
  'beta operational events has the event recency index'
);
select has_column(
  'public',
  'beta_operational_events',
  'signup_verified_at',
  'signup events track verification state'
);

insert into auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values
  (
    '40000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'beta-owner@example.com',
    extensions.crypt('not-used', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{}',
    now(),
    now()
  ),
  (
    '40000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'beta-outsider@example.com',
    extensions.crypt('not-used', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{}',
    now(),
    now()
  );

insert into public.households (id, name, created_by)
values (
  '50000000-0000-0000-0000-000000000001',
  'Beta household',
  '40000000-0000-0000-0000-000000000001'
);

insert into public.household_members (household_id, user_id, role)
values (
  '50000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000001',
  'owner'
);

insert into public.beta_onboarding (user_id, household_id, step)
values (
  '40000000-0000-0000-0000-000000000001',
  '50000000-0000-0000-0000-000000000001',
  'income'
);

insert into public.beta_operational_events (user_id, household_id, event_name)
values (
  '40000000-0000-0000-0000-000000000001',
  '50000000-0000-0000-0000-000000000001',
  'onboarding_started'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"40000000-0000-0000-0000-000000000001","email":"beta-owner@example.com","role":"authenticated"}',
  true
);

select throws_ok(
  $$select count(*) from public.beta_onboarding$$,
  '42501',
  null,
  'customers cannot read beta onboarding rows directly'
);
select throws_ok(
  $$select count(*) from public.beta_operational_events$$,
  '42501',
  null,
  'customers cannot read beta operational event rows directly'
);
select throws_ok(
  $$insert into public.beta_operational_events (user_id, event_name)
    values (auth.uid(), 'income_added')$$,
  '42501',
  null,
  'customers cannot insert beta events directly'
);
select throws_ok(
  $$insert into public.beta_onboarding (user_id, step)
    values (auth.uid(), 'payday')$$,
  '42501',
  null,
  'customers cannot insert beta onboarding directly'
);

set local role postgres;
select is(
  (select signup_verified_at is not null
   from public.beta_operational_events
   where user_id = '40000000-0000-0000-0000-000000000001'
     and event_name = 'signup_completed'),
  true,
  'confirmed signup event is marked verified'
);

reset role;

delete from public.households
where id = '50000000-0000-0000-0000-000000000001';

delete from auth.users
where id = '40000000-0000-0000-0000-000000000001';

select is(
  (select count(*) from public.beta_operational_events
   where user_id = '40000000-0000-0000-0000-000000000001'),
  0::bigint,
  'deleted owner beta operational events cascade away'
);
select is(
  (select count(*) from public.beta_operational_events
   where user_id = '40000000-0000-0000-0000-000000000002'),
  1::bigint,
  'outsider signup event remains isolated from owner deletion'
);
select is(
  (select household_id is null from public.beta_onboarding where user_id = '40000000-0000-0000-0000-000000000001'),
  null::boolean,
  'beta onboarding is removed when the account is deleted'
);

select * from finish();
rollback;
