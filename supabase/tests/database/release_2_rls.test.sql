begin;

create extension if not exists pgtap with schema extensions;

select plan(32);

select has_table('public', 'households', 'households table exists');
select has_table('public', 'household_members', 'household membership table exists');
select has_table('public', 'household_invites', 'household invitations table exists');
select has_table('public', 'budget_documents', 'budget documents table exists');
select has_table('public', 'google_calendar_connections', 'Google Calendar connections table exists');
select has_table('public', 'google_calendar_oauth_states', 'Google Calendar OAuth states table exists');

select ok(
  (select relrowsecurity from pg_class where oid = 'public.profiles'::regclass),
  'profiles has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.households'::regclass),
  'households has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.household_members'::regclass),
  'household_members has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.household_invites'::regclass),
  'household_invites has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.budget_documents'::regclass),
  'budget_documents has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.sync_mutations'::regclass),
  'sync_mutations has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.google_calendar_connections'::regclass),
  'google_calendar_connections has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.google_calendar_oauth_states'::regclass),
  'google_calendar_oauth_states has RLS enabled'
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
    '10000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'owner@example.com',
    extensions.crypt('not-used', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{}',
    now(),
    now()
  ),
  (
    '10000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'member@example.com',
    extensions.crypt('not-used', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{}',
    now(),
    now()
  ),
  (
    '10000000-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'outsider@example.com',
    extensions.crypt('not-used', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{}',
    now(),
    now()
  );

insert into auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  is_anonymous,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values (
  '10000000-0000-0000-0000-000000000004',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  null,
  extensions.crypt('not-used', extensions.gen_salt('bf')),
  true,
  '{}',
  '{}',
  now(),
  now()
);

insert into public.billing_subscriptions (user_id, status)
values (
  '10000000-0000-0000-0000-000000000001',
  'active'
);

insert into public.households (id, name, created_by)
values (
  '20000000-0000-0000-0000-000000000001',
  'Test household',
  '10000000-0000-0000-0000-000000000001'
);

insert into public.household_members (household_id, user_id, role)
values
  (
    '20000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'owner'
  ),
  (
    '20000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000002',
    'member'
  );

insert into public.budget_documents (
  household_id,
  revision,
  schema_version,
  state,
  updated_by
)
values (
  '20000000-0000-0000-0000-000000000001',
  0,
  3,
  '{"expenses":[]}',
  '10000000-0000-0000-0000-000000000001'
);

insert into public.beta_onboarding (user_id, household_id, step)
values (
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  'income'
);

insert into public.beta_operational_events (user_id, household_id, event_name)
values (
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  'onboarding_started'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000001","email":"owner@example.com","role":"authenticated"}',
  true
);

select is(
  (select count(*) from public.households),
  1::bigint,
  'owner sees their household'
);
select is(
  (select count(*) from public.household_members),
  2::bigint,
  'owner sees household members'
);
select lives_ok(
  $$select public.create_household_invite(
    '20000000-0000-0000-0000-000000000001',
    'new-member@example.com',
    24
  )$$,
  'owner can create an invitation'
);

set local "request.jwt.claims" =
  '{"sub":"10000000-0000-0000-0000-000000000002","email":"member@example.com","role":"authenticated"}';

select ok(
  public.has_active_subscription(),
  'household members inherit the active owner entitlement'
);

select is(
  (select count(*) from public.budget_documents),
  1::bigint,
  'member can read the household budget'
);
select throws_ok(
  $$update public.budget_documents
    set state = '{"tampered":true}'
    where household_id = '20000000-0000-0000-0000-000000000001'$$,
  '42501',
  null,
  'member cannot bypass revisioned sync with a direct update'
);
select lives_ok(
  $$select public.sync_budget(
    '20000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001',
    0,
    3,
    '{"expenses":[{"name":"Rent"}]}',
    'sha256-edf69da2ce9c8b9a5e38fc06065624ef7412ef4791facb7a54eae5fd9c345e9d'
  )$$,
  'member can use the guarded sync function'
);

set local role postgres;
update public.billing_subscriptions
set status = 'canceled'
where user_id = '10000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000002","email":"member@example.com","role":"authenticated"}',
  true
);

select throws_ok(
  $$select public.sync_budget(
    '20000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000003',
    1,
    3,
    '{"expenses":[]}',
    'sha256-2d03d267bfb76336ffd2533f385ad1d7dfb04a927de3cadac8af5ef03dbffdc0'
  )$$,
  '42501',
  'An active household Harbourline subscription is required for cloud changes',
  'canceled household cannot write through sync'
);
select throws_ok(
  $$select public.create_household('Unpaid household')$$,
  '42501',
  'An active Harbourline subscription is required to create a household',
  'unpaid account cannot create a household'
);

set local role postgres;
update public.billing_subscriptions
set status = 'active'
where user_id = '10000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000001","email":"owner@example.com","role":"authenticated"}',
  true
);

select is(
  (select public.export_my_account() -> 'onboarding' ->> 'step'),
  'income',
  'account export includes onboarding progress when available'
);
select ok(
  not (select public.export_my_account() ? 'operationalEvents'),
  'account export excludes private operational events'
);

set local "request.jwt.claims" =
  '{"sub":"10000000-0000-0000-0000-000000000004","role":"authenticated"}';
select throws_ok(
  $$select public.export_my_account()$$,
  '42501',
  'A verified Harbourline account is required to export data',
  'anonymous auth sessions cannot export account data'
);
select is(
  public.has_active_subscription(),
  false,
  'anonymous auth sessions cannot receive cloud entitlement'
);
select throws_ok(
  $$select public.create_household('Anonymous household')$$,
  '42501',
  'An active Harbourline subscription is required to create a household',
  'anonymous auth sessions cannot create households'
);
select throws_ok(
  $$select public.sync_budget(
    '20000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000004',
    0,
    3,
    '{"expenses":[]}',
    'fnv1a-anonymous'
  )$$,
  '42501',
  'Household membership required',
  'anonymous auth sessions cannot sync household budgets'
);

set local "request.jwt.claims" =
  '{"sub":"10000000-0000-0000-0000-000000000003","email":"outsider@example.com","role":"authenticated"}';

select is(
  (select count(*) from public.households),
  0::bigint,
  'outsider cannot see the household'
);
select is(
  (select count(*) from public.budget_documents),
  0::bigint,
  'outsider cannot see the budget document'
);
select throws_ok(
  $$select public.sync_budget(
    '20000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000002',
    1,
    3,
    '{"expenses":[]}',
    'fnv1a-outsider'
  )$$,
  '42501',
  'Household membership required',
  'outsider cannot invoke household sync'
);

select * from finish();
rollback;
