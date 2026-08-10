-- Stripe webhook acknowledgement must not depend on best-effort lifecycle email delivery.
-- A failed email is logged by the Edge Function and can be addressed independently;
-- the verified billing event itself must still be marked processed so Stripe receives 2xx.
create or replace function public.complete_billing_event_claim(
  target_event_id text,
  claim_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.billing_events
  set processed_at = timezone('utc', now()),
      processing_started_at = null,
      processing_token = null,
      last_error = null
  where event_id = target_event_id
    and processing_token = claim_token
    and processed_at is null;

  return found;
end;
$$;

revoke all on function public.complete_billing_event_claim(text, uuid) from public, anon, authenticated;
grant execute on function public.complete_billing_event_claim(text, uuid) to service_role;
