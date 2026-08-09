create or replace function public.export_my_account()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from auth.users user_row
    where user_row.id = auth.uid()
      and user_row.is_anonymous = false
  ) then
    raise exception 'A verified Harbourline account is required to export data'
      using errcode = '42501';
  end if;

  return jsonb_build_object(
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
end;
$$;

revoke all on function public.export_my_account() from public;
grant execute on function public.export_my_account() to authenticated;
