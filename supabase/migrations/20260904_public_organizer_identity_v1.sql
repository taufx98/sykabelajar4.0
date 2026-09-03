create or replace function public.get_public_competitions_v3(p_limit integer default 6)
returns table(
  id uuid, organizer_id uuid, slug text, title text, short_description text, description text, category text,
  status public.competition_status, registration_starts_at timestamptz, registration_ends_at timestamptz,
  starts_at timestamptz, ends_at timestamptz, announcement_at timestamptz, poster_url text, juknis_url text,
  visibility text, participant_count bigint, organizer_name text, organizer_photo_url text
)
language sql security definer stable
set search_path = public, private
as $$
  select c.id,c.organizer_id,c.slug,c.title,c.short_description,c.description,c.category,c.status,
         c.registration_starts_at,c.registration_ends_at,c.starts_at,c.ends_at,c.announcement_at,
         c.poster_url,c.juknis_url,c.visibility,
         (select count(*) from public.registrations r where r.competition_id=c.id and r.status<>'CANCELLED')::bigint,
         coalesce(nullif(o.name,''),'Penyelenggara'),
         coalesce(nullif(o.logo_asset_url,''),nullif(op.avatar_url,''))
  from public.competitions c
  left join public.organizers o on o.id=c.organizer_id
  left join public.profiles op on op.id=o.owner_user_id
  where c.visibility='PUBLIC'
    and c.status in ('PUBLISHED','REGISTRATION_OPEN','REGISTRATION_CLOSED','LIVE','SUBMISSION_CLOSED','RESULT_PUBLISHED','ARCHIVED')
  order by c.created_at desc
  limit least(greatest(coalesce(p_limit,6),1),20);
$$;
revoke execute on function public.get_public_competitions_v3(integer) from public;
grant execute on function public.get_public_competitions_v3(integer) to anon,authenticated;

create or replace function public.get_public_feed_v3(p_limit integer default 16, p_before timestamptz default null)
returns table(
  id uuid, author_user_id uuid, author_name text, author_username text, avatar_url text,
  title text, body text, cover_url text, created_at timestamptz, competition_id uuid, competition_slug text,
  likes bigint, liked boolean, comments bigint, organizer_name text, organizer_photo_url text
)
language sql security definer stable
set search_path = public, private
as $$
  select p.id,p.author_user_id,coalesce(pr.full_name,pr.username,'Pengguna'),coalesce(pr.username,''),pr.avatar_url,
         p.title,p.body,p.cover_url,p.created_at,p.competition_id,c.slug,
         (select count(*) from public.post_likes pl where pl.post_id=p.id)::bigint,
         (auth.uid() is not null and exists(select 1 from public.post_likes mpl where mpl.post_id=p.id and mpl.user_id=auth.uid())),
         (select count(*) from public.comments cm where cm.post_id=p.id and cm.moderation_state in ('PUBLISHED','VISIBLE'))::bigint,
         case when c.id is null then null else coalesce(nullif(o.name,''),'Penyelenggara') end,
         case when c.id is null then null else coalesce(nullif(o.logo_asset_url,''),nullif(op.avatar_url,'')) end
  from public.posts p
  left join public.profiles pr on pr.id=p.author_user_id
  left join public.competitions c on c.id=p.competition_id
  left join public.organizers o on o.id=c.organizer_id
  left join public.profiles op on op.id=o.owner_user_id
  where p.status='PUBLISHED' and (p_before is null or p.created_at<p_before)
  order by p.created_at desc,p.id desc
  limit least(greatest(coalesce(p_limit,16),1),31);
$$;
revoke execute on function public.get_public_feed_v3(integer,timestamptz) from public;
grant execute on function public.get_public_feed_v3(integer,timestamptz) to anon,authenticated;

create or replace function public.get_home_snapshot_v1(p_feed_limit integer default 15)
returns jsonb language sql stable security definer
set search_path = public, private
as $$
  select jsonb_build_object(
    'competitions',coalesce((select jsonb_agg(to_jsonb(x)) from public.get_public_competitions_v3(5) x),'[]'::jsonb),
    'leaderboard',coalesce((select jsonb_agg(to_jsonb(x)) from public.get_public_leaderboard_v2(5) x),'[]'::jsonb),
    'coin_leaderboard',coalesce((select jsonb_agg(to_jsonb(x)) from public.get_public_coin_leaderboard_v2(5) x),'[]'::jsonb),
    'stats',coalesce((select to_jsonb(x) from public.get_platform_stats() x limit 1),'{}'::jsonb),
    'feed',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id desc) from public.get_public_feed_v3(least(greatest(coalesce(p_feed_limit,15),1),16),null) x),'[]'::jsonb)
  );
$$;
revoke execute on function public.get_home_snapshot_v1(integer) from public;
grant execute on function public.get_home_snapshot_v1(integer) to anon,authenticated;
