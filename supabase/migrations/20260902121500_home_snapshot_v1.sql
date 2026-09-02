create or replace function public.get_home_snapshot_v1(p_feed_limit integer default 15)
returns jsonb
language sql
stable
security definer
set search_path = public, private
as $$
  select jsonb_build_object(
    'competitions', coalesce((select jsonb_agg(to_jsonb(x)) from public.get_public_competitions_v2(5) x), '[]'::jsonb),
    'leaderboard', coalesce((select jsonb_agg(to_jsonb(x)) from public.get_public_leaderboard_v2(5) x), '[]'::jsonb),
    'coin_leaderboard', coalesce((select jsonb_agg(to_jsonb(x)) from public.get_public_coin_leaderboard_v2(5) x), '[]'::jsonb),
    'stats', coalesce((select to_jsonb(x) from public.get_platform_stats() x limit 1), '{}'::jsonb),
    'feed', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc, x.id desc) from public.get_public_feed_v2(least(greatest(coalesce(p_feed_limit,15),1),16), null) x), '[]'::jsonb)
  );
$$;

grant execute on function public.get_home_snapshot_v1(integer) to anon, authenticated;
