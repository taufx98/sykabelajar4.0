-- Organizer creation must go through the SECURITY DEFINER RPCs, which enforce
-- role eligibility, verified email/phone, and free-claim anti-abuse checks.
-- No frontend source file directly inserts organizer rows.
revoke insert on table public.organizers from public, anon, authenticated;

-- The RLS insert policy is redundant once direct client INSERT is revoked.
-- Keeping it would be misleading and could reopen the path if grants change.
drop policy if exists organizers_admin_or_owner_insert on public.organizers;
