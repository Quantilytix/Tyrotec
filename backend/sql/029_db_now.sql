-- Lets the API ask the database what time it is.
--
-- Everything with a deadline in this system is written by Postgres:
-- stock_reservations.expires_at is now() + interval, and
-- release_expired_reservations() decides what has lapsed by comparing
-- against now() again. Both are the database's clock.
--
-- The API was measuring "how long is left" against the clock of whatever
-- machine Node happens to be running on. When those two clocks disagree the
-- countdown is simply wrong -- on a developer machine running an hour fast,
-- every reservation is born already expired, and the customer sees
-- "Reservation expired" the instant they check out. Asking the database
-- removes the second clock from the question entirely.
--
-- Safe to run more than once.

create or replace function public.db_now()
returns timestamptz language sql stable as $$ select now() $$;

comment on function public.db_now() is
  'Current database time, so the API never has to trust its own host clock.';

-- Readable by any signed-in caller: it discloses nothing beyond the time,
-- and the API's service role uses it on every order fetch.
revoke execute on function public.db_now() from public, anon;
grant execute on function public.db_now() to authenticated, service_role;

-- Verification: expects a timestamp close to real UTC time.
-- select public.db_now();
