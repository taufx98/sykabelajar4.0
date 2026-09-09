-- Connect the new badge system to profile showcase and privacy settings.
-- Public badge reads go through a SECURITY DEFINER RPC because user_badges is intentionally self/admin-only.

alter table public.profile_ui_settings
  add column if not exists show_badges boolean not null default true;

alter table public.profile_ui_settings
  add column if not exists show_badge_collection boolean not null default true;

create or replace function public.get_public_profile_badges(p_profile_id uuid)
returns table(
  id uuid,
  name text,
  description text,
  icon_url text,
  icon_emoji text,
  category text,
  rarity text,
  awarded_at timestamptz,
  reason text,
  award_source text
)
language sql
stable
security definer
set search_path = public, private
as $$
  select
    ub.id,
    b.name,
    b.description,
    b.icon_url,
    b.icon_emoji,
    b.category,
    b.rarity,
    ub.awarded_at,
    ub.reason,
    ub.award_source
  from public.user_badges ub
  join public.badges b on b.id = ub.badge_id
  join public.profiles p on p.id = ub.user_id
  where ub.user_id = p_profile_id
    and b.status = 'ACTIVE'
    and (auth.uid() = p_profile_id or coalesce(p.is_public, false) = true or private.current_user_is_admin());
$$;

revoke all on function public.get_public_profile_badges(uuid) from public, anon, authenticated;
grant execute on function public.get_public_profile_badges(uuid) to anon, authenticated;

create or replace function public.get_public_profile_badge_visibility(p_profile_id uuid)
returns table(show_badges boolean, show_badge_collection boolean)
language sql
stable
security definer
set search_path = public, private
as $$
  select
    coalesce(s.show_badges, true),
    coalesce(s.show_badge_collection, true)
  from public.profiles p
  left join public.profile_ui_settings s on s.user_id = p.id
  where p.id = p_profile_id
    and (auth.uid() = p_profile_id or coalesce(p.is_public, false) = true or private.current_user_is_admin());
$$;

revoke all on function public.get_public_profile_badge_visibility(uuid) from public, anon, authenticated;
grant execute on function public.get_public_profile_badge_visibility(uuid) to anon, authenticated;
