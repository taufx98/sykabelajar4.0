create or replace function public.get_public_feed_v3(p_limit integer default 16, p_before timestamptz default null)
returns table(
  id uuid, author_user_id uuid, author_name text, author_username text, avatar_url text,
  title text, body text, cover_url text, created_at timestamptz, competition_id uuid, competition_slug text,
  likes bigint, liked boolean, comments bigint, organizer_name text, organizer_photo_url text
)
language sql security definer stable
set search_path = public, private
as $$
  select p.id,p.author_user_id,
         case when c.id is null then coalesce(pr.full_name,pr.username,'Pengguna') else coalesce(nullif(o.name,''),'Penyelenggara') end,
         coalesce(pr.username,''),
         case when c.id is null then pr.avatar_url else coalesce(nullif(o.logo_asset_url,''),nullif(op.avatar_url,'')) end,
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

create or replace function public.get_public_feed_v2(p_limit integer default 16, p_before timestamptz default null)
returns table(
  id uuid, author_user_id uuid, author_name text, author_username text, avatar_url text,
  title text, body text, cover_url text, created_at timestamptz, competition_id uuid, competition_slug text,
  likes bigint, liked boolean, comments bigint
)
language sql security definer stable
set search_path = public, private
as $$
  select p.id,p.author_user_id,
         case when c.id is null then coalesce(pr.full_name,pr.username,'Pengguna') else coalesce(nullif(o.name,''),'Penyelenggara') end,
         coalesce(pr.username,''),
         case when c.id is null then pr.avatar_url else coalesce(nullif(o.logo_asset_url,''),nullif(op.avatar_url,'')) end,
         p.title,p.body,p.cover_url,p.created_at,p.competition_id,c.slug,
         (select count(*) from public.post_likes pl where pl.post_id=p.id)::bigint,
         (auth.uid() is not null and exists(select 1 from public.post_likes mpl where mpl.post_id=p.id and mpl.user_id=auth.uid())),
         (select count(*) from public.comments cm where cm.post_id=p.id and cm.moderation_state in ('PUBLISHED','VISIBLE'))::bigint
  from public.posts p
  left join public.profiles pr on pr.id=p.author_user_id
  left join public.competitions c on c.id=p.competition_id
  left join public.organizers o on o.id=c.organizer_id
  left join public.profiles op on op.id=o.owner_user_id
  where p.status='PUBLISHED' and (p_before is null or p.created_at<p_before)
  order by p.created_at desc,p.id desc
  limit least(greatest(coalesce(p_limit,16),1),31);
$$;
