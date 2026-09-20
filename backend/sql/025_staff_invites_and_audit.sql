-- Invite-only staff accounts, and the audit log split into customer and staff
-- activity. Run AFTER 024_roles_and_statuses.sql has completed.

-- Staff accounts are created by invitation only: there is no public staff
-- signup any more. An admin invites an email address with a role; the invite
-- carries a single-use token, and the account itself is only created when the
-- invitee sets their password.
--
-- Only the token's hash is stored. A leaked database backup then can't be used
-- to accept outstanding invites, the same reason passwords are never stored
-- as-is. The plain token exists only in the link handed to the invitee.
create table if not exists public.staff_invites (
  id uuid primary key default gen_random_uuid(),
  email varchar(255) not null,
  full_name varchar(255),
  role public.user_role not null,
  token_hash text not null unique,
  invited_by uuid references public.users(id) on delete set null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists staff_invites_email_idx on public.staff_invites (lower(email));
create index if not exists staff_invites_open_idx on public.staff_invites (expires_at)
  where accepted_at is null and revoked_at is null;

alter table public.staff_invites enable row level security;

-- The audit log records who acted, and the log is read as two separate views:
-- what customers did, and what staff did. Storing the actor's role at the time
-- of the action (rather than joining to users) keeps history honest: a sales
-- rep later promoted to admin must not have their past actions re-labelled.
-- 'system' covers automated actors such as the PayFast webhook and the
-- reservation jobs.
alter table public.activity_log
  add column if not exists actor_role text;

create index if not exists activity_log_actor_role_idx on public.activity_log (actor_role);

-- Existing rows predate the split. Their actor_label already says who acted,
-- so infer the role from the account where it still exists, and fall back to
-- 'system' for automated entries that never had an actor_id.
update public.activity_log al
set actor_role = coalesce(u.role::text, 'system')
from public.users u
where al.actor_role is null and al.actor_id = u.id;

update public.activity_log
set actor_role = 'system'
where actor_role is null;

-- Verification:
-- select actor_role, count(*) from public.activity_log group by actor_role;
-- select role, status, count(*) from public.users group by role, status;
--
-- Promote the first super admin if 024 didn't already:
--   update public.users set role = 'super_admin' where email = 'your-admin-email@example.com';
