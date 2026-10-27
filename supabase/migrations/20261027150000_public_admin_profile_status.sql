-- Expose only the public admin-status bit needed by public profile rendering.
-- Role membership stays private in user_roles; callers never receive role rows or account data.
create or replace function public.is_public_profile_admin(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.user_roles as ur
    join public.profiles as p on p.id = ur.user_id
    where ur.user_id = p_profile_id
      and ur.role::text = 'admin'
      and ur.is_active is true
      and (coalesce(p.is_public, true) is true or p.id = (select auth.uid()))
  );
$function$;

revoke all on function public.is_public_profile_admin(uuid) from public;
grant execute on function public.is_public_profile_admin(uuid) to anon, authenticated;
