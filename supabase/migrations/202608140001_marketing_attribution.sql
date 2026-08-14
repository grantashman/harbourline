alter table public.beta_operational_events
  add column if not exists attribution_source text,
  add column if not exists attribution_medium text,
  add column if not exists attribution_campaign text,
  add column if not exists attribution_content text,
  add column if not exists attribution_term text,
  add column if not exists attribution_landing_path text;

create or replace function private.safe_marketing_attribution_value(
  metadata jsonb,
  key_name text
)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  candidate text := metadata ->> key_name;
begin
  if candidate is null
     or length(candidate) = 0
     or length(candidate) > 120
     or candidate !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$' then
    return null;
  end if;
  return candidate;
end;
$$;

create or replace function private.safe_marketing_landing_path(metadata jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  candidate text := metadata ->> 'landingPath';
begin
  if candidate is null
     or length(candidate) = 0
     or length(candidate) > 120
     or candidate !~ '^/'
     or candidate ~ '[[:cntrl:]]' then
    return null;
  end if;
  return candidate;
end;
$$;

update public.beta_operational_events as event_row
set
  attribution_source = private.safe_marketing_attribution_value(
    auth_user.raw_user_meta_data -> 'marketing_attribution', 'source'
  ),
  attribution_medium = private.safe_marketing_attribution_value(
    auth_user.raw_user_meta_data -> 'marketing_attribution', 'medium'
  ),
  attribution_campaign = private.safe_marketing_attribution_value(
    auth_user.raw_user_meta_data -> 'marketing_attribution', 'campaign'
  ),
  attribution_content = private.safe_marketing_attribution_value(
    auth_user.raw_user_meta_data -> 'marketing_attribution', 'content'
  ),
  attribution_term = private.safe_marketing_attribution_value(
    auth_user.raw_user_meta_data -> 'marketing_attribution', 'term'
  ),
  attribution_landing_path = private.safe_marketing_landing_path(
    auth_user.raw_user_meta_data -> 'marketing_attribution'
  )
from auth.users as auth_user
where event_row.user_id = auth_user.id
  and event_row.event_name = 'signup_completed'
  and (
    event_row.attribution_source is null
    or event_row.attribution_medium is null
    or event_row.attribution_campaign is null
    or event_row.attribution_content is null
    or event_row.attribution_term is null
    or event_row.attribution_landing_path is null
  );

create or replace function private.record_new_user_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  attribution jsonb := case
    when jsonb_typeof(new.raw_user_meta_data -> 'marketing_attribution') = 'object'
      then new.raw_user_meta_data -> 'marketing_attribution'
    else '{}'::jsonb
  end;
  verified_at timestamptz := coalesce(new.email_confirmed_at, new.confirmed_at);
begin
  insert into public.beta_operational_events (
    user_id,
    event_name,
    signup_verified_at,
    attribution_source,
    attribution_medium,
    attribution_campaign,
    attribution_content,
    attribution_term,
    attribution_landing_path
  )
  values (
    new.id,
    'signup_completed',
    verified_at,
    private.safe_marketing_attribution_value(attribution, 'source'),
    private.safe_marketing_attribution_value(attribution, 'medium'),
    private.safe_marketing_attribution_value(attribution, 'campaign'),
    private.safe_marketing_attribution_value(attribution, 'content'),
    private.safe_marketing_attribution_value(attribution, 'term'),
    private.safe_marketing_landing_path(attribution)
  )
  on conflict do nothing;

  update public.beta_operational_events
  set signup_verified_at = coalesce(signup_verified_at, verified_at),
      attribution_source = coalesce(attribution_source, private.safe_marketing_attribution_value(attribution, 'source')),
      attribution_medium = coalesce(attribution_medium, private.safe_marketing_attribution_value(attribution, 'medium')),
      attribution_campaign = coalesce(attribution_campaign, private.safe_marketing_attribution_value(attribution, 'campaign')),
      attribution_content = coalesce(attribution_content, private.safe_marketing_attribution_value(attribution, 'content')),
      attribution_term = coalesce(attribution_term, private.safe_marketing_attribution_value(attribution, 'term')),
      attribution_landing_path = coalesce(attribution_landing_path, private.safe_marketing_landing_path(attribution))
  where user_id = new.id
    and event_name = 'signup_completed'
    and (signup_verified_at is null or attribution_source is null or attribution_medium is null
      or attribution_campaign is null or attribution_content is null or attribution_term is null
      or attribution_landing_path is null);
  return new;
end;
$$;

revoke all on function private.safe_marketing_attribution_value(jsonb, text) from public;
revoke all on function private.safe_marketing_landing_path(jsonb) from public;
revoke all on function private.record_new_user_signup() from public;
