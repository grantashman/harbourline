begin;

create extension if not exists pgtap with schema extensions;

select plan(7);

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

select * from finish();
rollback;
