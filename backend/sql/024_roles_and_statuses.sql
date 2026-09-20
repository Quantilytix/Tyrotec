-- New role and account status values. RUN THIS FILE FIRST, ON ITS OWN, and let
-- it finish before running 025_staff_invites_and_audit.sql.
--
-- Postgres will not let a newly added enum value be *used* in the same
-- transaction that adds it, so the additions live in their own file. Running
-- them together would fail with "unsafe use of new value of enum type".
--
-- super_admin sits above admin: roles are ranked in the API
-- (backend/src/middleware/auth.js), so anything an admin may do, a super admin
-- may do too. Only a super admin can change roles, suspend or remove staff,
-- and create other admins.
alter type public.user_role add value if not exists 'super_admin';

-- suspended blocks sign-in while keeping the account and all of its history --
-- deleting a staff member would orphan the orders and payments they handled.
alter type public.account_status add value if not exists 'suspended';

-- After this file completes, promote the first super admin (also fine to run
-- later, from 025's notes):
--   update public.users set role = 'super_admin'
--   where email = 'your-admin-email@example.com';
