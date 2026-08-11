begin;

create extension if not exists pgtap with schema extensions;

select plan(12);

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

select * from finish();
rollback;
