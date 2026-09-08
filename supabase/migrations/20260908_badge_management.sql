-- Badge Management Center: badge catalog, user awards, audit trail and admin evaluator.

create table if not exists public.badges (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  slug text not null unique,
  description text not null default '',
  icon_url text,
  icon_emoji text,
  category text not null default 'Khusus',
  rarity text not null default 'Common' check (rarity in ('Common','Uncommon','Rare','Epic','Legendary','Special')),
  status text not null default 'DRAFT' check (status in ('DRAFT','ACTIVE','ARCHIVED')),
  award_type text not null default 'MANUAL' check (award_type in ('MANUAL','AUTOMATIC','EVENT')),
  rule_config jsonb not null default '{"conditions":[]}'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists badges_status_idx on public.badges(status);
create index if not exists badges_category_idx on public.badges(category);
create index if not exists badges_award_type_idx on public.badges(award_type);

create table if not exists public.user_badges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  badge_id uuid not null references public.badges(id) on delete restrict,
  awarded_at timestamptz not null default now(),
  awarded_by uuid references auth.users(id),
  award_source text not null default 'MANUAL' check (award_source in ('MANUAL','AUTOMATIC','EVENT','SYSTEM')),
  reason text not null default '',
  source_reference text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(user_id, badge_id)
);

create index if not exists user_badges_user_idx on public.user_badges(user_id, awarded_at desc);
create index if not exists user_badges_badge_idx on public.user_badges(badge_id, awarded_at desc);

create table if not exists public.badge_audit_logs (
  id bigint generated always as identity primary key,
  badge_id uuid references public.badges(id) on delete set null,
  target_user_id uuid references public.profiles(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists badge_audit_logs_badge_idx on public.badge_audit_logs(badge_id, created_at desc);
create index if not exists badge_audit_logs_user_idx on public.badge_audit_logs(target_user_id, created_at desc);

create or replace function private.badge_admin_guard()
returns void
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if not private.current_user_is_admin() then
    raise exception 'ACCESS_DENIED';
  end if;
end;
$$;

create or replace function public.admin_evaluate_badges()
returns integer
language plpgsql
security definer
set search_path = public, private
as $$
declare
  b record;
  p record;
  c jsonb;
  passed boolean;
  field_name text;
  operator_name text;
  expected text;
  actual_num numeric;
  actual_text text;
  awarded_count integer := 0;
begin
  perform private.badge_admin_guard();

  for b in
    select * from public.badges
    where status = 'ACTIVE' and award_type = 'AUTOMATIC'
  loop
    for p in select id, grade, total_xp, edu_coin from public.profiles loop
      passed := true;
      for c in select value from jsonb_array_elements(coalesce(b.rule_config->'conditions','[]'::jsonb)) loop
        field_name := coalesce(c->>'field','');
        operator_name := coalesce(c->>'operator','=');
        expected := coalesce(c->>'value','');
        actual_num := null;
        actual_text := null;

        case field_name
          when 'total_xp' then actual_num := coalesce(p.total_xp,0);
          when 'edu_coin' then actual_num := coalesce(p.edu_coin,0);
          when 'competition_wins' then
            select count(*) into actual_num from public.awards a where a.user_id=p.id and upper(coalesce(a.rank_code,'')) in ('FIRST','SECOND','THIRD');
          when 'competitions_joined' then
            select count(*) into actual_num from public.registrations r where r.user_id=p.id and r.status in ('APPROVED','ACTIVE');
          when 'awards_count' then
            select count(*) into actual_num from public.awards a where a.user_id=p.id;
          when 'followers' then
            select count(*) into actual_num from public.follows f where f.following_id=p.id;
          when 'following' then
            select count(*) into actual_num from public.follows f where f.follower_id=p.id;
          when 'daily_checkin_streak' then
            select coalesce(max(d.streak_day),0) into actual_num from public.daily_checkins d where d.user_id=p.id;
          when 'grade' then actual_text := coalesce(p.grade,'');
          else passed := false;
        end case;

        if actual_num is not null then
          case operator_name
            when '>=' then passed := passed and actual_num >= nullif(expected,'')::numeric;
            when '>' then passed := passed and actual_num > nullif(expected,'')::numeric;
            when '=' then passed := passed and actual_num = nullif(expected,'')::numeric;
            when '<=' then passed := passed and actual_num <= nullif(expected,'')::numeric;
            when '<' then passed := passed and actual_num < nullif(expected,'')::numeric;
            else passed := false;
          end case;
        elsif actual_text is not null then
          case operator_name
            when '=' then passed := passed and actual_text = expected;
            when '!=' then passed := passed and actual_text <> expected;
            else passed := false;
          end case;
        end if;

        exit when not passed;
      end loop;

      if passed then
        insert into public.user_badges(user_id, badge_id, award_source, reason, metadata)
        values (p.id, b.id, 'AUTOMATIC', 'Memenuhi aturan badge otomatis.', jsonb_build_object('rule_config', b.rule_config))
        on conflict (user_id, badge_id) do nothing;
        if found then
          awarded_count := awarded_count + 1;
          insert into public.badge_audit_logs(badge_id, target_user_id, actor_user_id, action, reason, metadata)
          values (b.id, p.id, auth.uid(), 'AWARDED_AUTOMATIC', 'Badge diberikan oleh evaluator otomatis.', jsonb_build_object('rule_config', b.rule_config));
        end if;
      end if;
    end loop;
  end loop;

  return awarded_count;
end;
$$;

alter table public.badges enable row level security;
alter table public.user_badges enable row level security;
alter table public.badge_audit_logs enable row level security;

drop policy if exists badges_public_read on public.badges;
create policy badges_public_read on public.badges
  for select to anon, authenticated
  using (status = 'ACTIVE');

drop policy if exists badges_admin_all on public.badges;
create policy badges_admin_all on public.badges
  for all to authenticated
  using (private.current_user_is_admin())
  with check (private.current_user_is_admin());

drop policy if exists user_badges_self_read on public.user_badges;
create policy user_badges_self_read on public.user_badges
  for select to authenticated
  using (user_id = auth.uid() or private.current_user_is_admin());

drop policy if exists user_badges_admin_write on public.user_badges;
create policy user_badges_admin_write on public.user_badges
  for all to authenticated
  using (private.current_user_is_admin())
  with check (private.current_user_is_admin());

drop policy if exists badge_audit_admin_read on public.badge_audit_logs;
create policy badge_audit_admin_read on public.badge_audit_logs
  for select to authenticated
  using (private.current_user_is_admin());

drop policy if exists badge_audit_admin_insert on public.badge_audit_logs;
create policy badge_audit_admin_insert on public.badge_audit_logs
  for insert to authenticated
  with check (private.current_user_is_admin());

grant select on public.badges to anon, authenticated;
grant select on public.user_badges to authenticated;
grant select on public.badge_audit_logs to authenticated;
grant execute on function public.admin_evaluate_badges() to authenticated;

insert into public.badges (code, name, slug, description, icon_emoji, category, rarity, status, award_type, rule_config)
values
  ('COMPETITION_MASTER','Competition Master','competition-master','Menang minimal 5 kompetisi.','🏆','Kompetisi','Epic','ACTIVE','AUTOMATIC','{"conditions":[{"field":"competition_wins","operator":">=","value":5}]}'::jsonb),
  ('SEVEN_DAY_STREAK','7 Day Streak','7-day-streak','Check-in harian selama minimal 7 hari berturut-turut.','🔥','Aktivitas','Uncommon','ACTIVE','AUTOMATIC','{"conditions":[{"field":"daily_checkin_streak","operator":">=","value":7}]}'::jsonb),
  ('PREMIUM_MEMBER','Premium Member','premium-member','Badge khusus untuk anggota Premium.','💎','Membership','Rare','ACTIVE','MANUAL','{"conditions":[]}'::jsonb),
  ('CERTIFIED_STUDENT','Certified Student','certified-student','Menyelesaikan pembelajaran atau program yang ditentukan.','🎓','Pembelajaran','Rare','DRAFT','MANUAL','{"conditions":[]}'::jsonb),
  ('COMMUNITY_CONTRIBUTOR','Community Contributor','community-contributor','Kontribusi aktif yang diakui komunitas.','👥','Komunitas','Uncommon','DRAFT','MANUAL','{"conditions":[]}'::jsonb),
  ('EVENT_SPECIAL','Event Special','event-special','Badge khusus untuk event tertentu.','⭐','Khusus','Legendary','DRAFT','EVENT','{"conditions":[]}'::jsonb)
on conflict (code) do nothing;
