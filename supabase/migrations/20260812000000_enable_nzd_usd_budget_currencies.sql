begin;

-- Owner-authorized budgeting pilot: keep AUD compatibility and enable only the
-- paired NZD/USD catalog rows. Subscription billing remains AUD and is managed
-- by the protected workflow's Stripe contract.
update public.currency_catalog
set enabled = true,
    verified_at = now(),
    updated_at = now()
where code in ('NZD', 'USD');

do $$
begin
  if (
    select count(*) = 3 and bool_and(enabled)
    from public.currency_catalog
    where code in ('AUD', 'NZD', 'USD')
  ) is not true then
    raise exception 'AUD, NZD and USD must all be enabled for the budgeting pilot' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.currency_catalog
    where enabled = true
      and code not in ('AUD', 'NZD', 'USD')
  ) then
    raise exception 'Only AUD, NZD and USD may be enabled by the budgeting pilot' using errcode = '22023';
  end if;
end;
$$;

commit;