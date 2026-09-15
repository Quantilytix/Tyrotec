-- Security hardening. Run once in the Supabase SQL Editor of any project
-- created from 000_fresh_database_schema.sql before this fix was folded into
-- it (or built from the numbered migrations). Safe to run more than once.
--
-- 1. The signup trigger trusted the `role` in raw_user_meta_data. Anyone can
--    set that field by calling Supabase Auth's public signup endpoint
--    directly with the (public) anon key -- e.g. signUp({ options: { data:
--    { role: 'admin' } } }) -- which created an approved admin profile. The
--    trigger now only ever creates a customer, or a *pending* sales_rep that
--    an admin must approve -- the same outcomes the backend's own /register
--    allows. The backend still upserts role/status explicitly for the
--    accounts it creates, so nothing legitimate changes.
--
-- 2. Supabase grants EXECUTE on new public-schema functions to the anon and
--    authenticated roles, and these functions are SECURITY DEFINER -- so
--    anyone holding the anon key could call /rest/v1/rpc/approve_order (or
--    cancel_order, or checkout for another customer) directly, skipping the
--    API's role checks. Only the backend's service role calls them.
--
-- 3. whatsapp_processed_messages was the one table without row level
--    security. Enabling it (with no policies) blocks the anon/authenticated
--    roles; the backend's service role bypasses RLS as before.

create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.users (id, email, company_name, full_name, role, status)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'company_name',
    new.raw_user_meta_data->>'full_name',
    case when new.raw_user_meta_data->>'role' = 'sales_rep'
      then 'sales_rep'::public.user_role else 'customer'::public.user_role end,
    case when new.raw_user_meta_data->>'role' = 'sales_rep'
      then 'pending'::public.account_status else 'approved'::public.account_status end
  ) on conflict (id) do nothing;
  return new;
end;
$$;

revoke execute on function public.approve_order(uuid) from public, anon, authenticated;
revoke execute on function public.cancel_order(uuid) from public, anon, authenticated;
revoke execute on function public.checkout_quote_with_reservation(uuid, uuid, integer) from public, anon, authenticated;
revoke execute on function public.release_expired_reservations() from public, anon, authenticated;
revoke execute on function public.warn_expiring_reservations(integer) from public, anon, authenticated;

grant execute on function public.approve_order(uuid) to service_role;
grant execute on function public.cancel_order(uuid) to service_role;
grant execute on function public.checkout_quote_with_reservation(uuid, uuid, integer) to service_role;
grant execute on function public.release_expired_reservations() to service_role;
grant execute on function public.warn_expiring_reservations(integer) to service_role;

alter table public.whatsapp_processed_messages enable row level security;

-- Verification: every row should show anon_can_execute = false and
-- service_role_can_execute = true.
-- select p.proname,
--        has_function_privilege('anon', p.oid, 'execute') as anon_can_execute,
--        has_function_privilege('authenticated', p.oid, 'execute') as authenticated_can_execute,
--        has_function_privilege('service_role', p.oid, 'execute') as service_role_can_execute
-- from pg_proc p
-- where p.pronamespace = 'public'::regnamespace
--   and p.proname in ('approve_order', 'cancel_order', 'checkout_quote_with_reservation',
--                     'release_expired_reservations', 'warn_expiring_reservations');
--
-- And every application table should show rls_enabled = true:
-- select relname as table_name, relrowsecurity as rls_enabled
-- from pg_class
-- where relnamespace = 'public'::regnamespace and relkind = 'r'
-- order by relname;
