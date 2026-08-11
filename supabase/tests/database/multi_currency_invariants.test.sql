begin;

create extension if not exists pgtap with schema extensions;

select plan(14);

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
values (
  '40000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'currency-test@example.com',
  extensions.crypt('not-used', extensions.gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}',
  '{}',
  now(),
  now()
)
on conflict (id) do nothing;

select ok(
  to_regclass('public.currency_catalog') is not null,
  'currency catalog table exists'
);
select ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'households'
      and column_name = 'currency'
      and is_nullable = 'NO'
  ),
  'households have a required currency'
);
select ok(
  (select enabled from public.currency_catalog where code = 'AUD') is true,
  'AUD is enabled by the migration'
);
select ok(
  (select enabled from public.currency_catalog where code = 'USD') is false,
  'USD remains gated until explicitly verified'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.currency_catalog'::regclass),
  'currency catalog has RLS enabled'
);
select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.households'::regclass
      and conname = 'households_currency_format'
  ),
  'household currency uses an ISO-style format constraint'
);
select ok(
  to_regprocedure('private.validate_budget_state(uuid,jsonb,integer)') is not null,
  'budget state validation function exists'
);
select ok(
  to_regprocedure('private.validate_exact_money_json(jsonb,text,text)') is not null,
  'recursive exact-money validation function exists'
);
select ok(
  to_regprocedure('public.create_household(text,text)') is not null,
  'household creation accepts a requested currency'
);
select ok(
  to_regprocedure('public.sync_budget(uuid,uuid,bigint,integer,text,text)') is not null,
  'sync RPC accepts canonical JSON text and a SHA-256 state hash'
);
select lives_ok(
  $$select private.validate_exact_money_json(
    '{"currency":"AUD","moneyRepresentation":"minor-unit-string","amount":"12345"}'::jsonb,
    'AUD',
    '$'
  )$$,
  'integer minor-unit strings pass recursive validation'
);
select throws_ok(
  $$select private.validate_exact_money_json(
    '{"currency":"AUD","moneyRepresentation":"minor-unit-string","amount":123.45}'::jsonb,
    'AUD',
    '$'
  )$$,
  '22023',
  'Budget money must be an integer minor-unit string at $.amount',
  'decimal major-unit money is rejected even with the marker'
);
select throws_ok(
  $$select private.validate_exact_money_json(
    '{"currency":"AUD","moneyRepresentation":"minor-unit-string","amount":"12.3"}'::jsonb,
    'AUD',
    '$'
  )$$,
  '22023',
  'Budget money must be an integer minor-unit string at $.amount',
  'malformed minor-unit strings are rejected'
);
update public.currency_catalog
set enabled = true
where code = 'USD';

insert into public.households (id, name, created_by, currency)
values (
  '40000000-0000-0000-0000-000000000002',
  'Currency test household',
  '40000000-0000-0000-0000-000000000001',
  'USD'
)
on conflict (id) do nothing;

select throws_ok(
  $$select private.validate_budget_state(
    '40000000-0000-0000-0000-000000000002',
    '{"currency":"USD","amount":100}'::jsonb,
    3
  )$$,
  '22023',
  'Non-AUD budget states must use schema version 4 or newer',
  'legacy schema versions cannot bypass exact-money validation for non-AUD households'
);

select * from finish();
rollback;
