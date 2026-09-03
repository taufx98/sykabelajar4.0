-- Allow public profiles to be read by guests and authenticated users.
-- A non-public profile remains visible to its owner only.

drop policy if exists profiles_public_read on public.profiles;

create policy profiles_public_read
on public.profiles
for select
to anon, authenticated
using (
  is_public = true
  or (select auth.uid()) = id
);
