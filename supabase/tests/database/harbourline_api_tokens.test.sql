begin;

create extension if not exists pgtap with schema extensions;

select plan(8);

select has_table('public', 'api_tokens', 'API token table exists');
select has_column('public', 'api_tokens', 'household_id', 'API token is bound to a household');
select has_column('public', 'api_tokens', 'token_hash', 'API token stores a hash');
select has_column('public', 'api_tokens', 'expires_at', 'API token has an expiry');
select has_index('public', 'api_tokens', 'api_tokens_hash_active', 'active API token hash index exists');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.api_tokens'::regclass),
  'API tokens have RLS enabled'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000001","email":"owner@example.com","role":"authenticated"}',
  true
);

select is(
  (select count(*) from public.api_tokens),
  0::bigint,
  'no API token rows are visible before provisioning'
);
select throws_ok(
  $$insert into public.api_tokens (household_id, created_by, name, token_prefix, token_hash, expires_at)
    values (
      '20000000-0000-0000-0000-000000000001',
      auth.uid(),
      'unsafe direct token',
      'hl_live_abcdefghijkl',
      repeat('a', 64),
      now() + interval '1 day'
    )$$,
  '42501',
  null,
  'API tokens cannot be created by direct browser table writes'
);

select * from finish();
rollback;
