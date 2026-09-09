-- Ensure hidden badge collections are not sent to the browser at all.

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
  left join public.profile_ui_settings s on s.user_id = p.id
  where ub.user_id = p_profile_id
    and b.status = 'ACTIVE'
    and (auth.uid() = p_profile_id or private.current_user_is_admin() or (coalesce(p.is_public, false) = true and coalesce(s.show_badge_collection, true) = true));
$$;

revoke all on function public.get_public_profile_badges(uuid) from public, anon, authenticated;
grant execute on function public.get_public_profile_badges(uuid) to anon, authenticated;
