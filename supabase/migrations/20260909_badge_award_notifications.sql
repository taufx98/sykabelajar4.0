-- Notify the recipient immediately whenever a badge is granted.
-- This covers manual, automatic, event and system awards through the canonical user_badges table.

create or replace function public.notify_badge_awarded()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_badge record;
  v_profile record;
  v_link text;
  v_source_label text;
begin
  select name, description, icon_url, icon_emoji, rarity
    into v_badge
  from public.badges
  where id = new.badge_id;

  select username, full_name
    into v_profile
  from public.profiles
  where id = new.user_id;

  v_link := case
    when coalesce(v_profile.username, '') <> ''
      then '/profile/@' || v_profile.username
    else '/profile'
  end;

  v_source_label := case new.award_source
    when 'AUTOMATIC' then 'Otomatis'
    when 'EVENT' then 'Event'
    when 'SYSTEM' then 'Sistem'
    else 'Admin'
  end;

  insert into public.notifications(user_id, type, title, body, data)
  values (
    new.user_id,
    'badge-awarded',
    'Badge Baru Diperoleh!',
    'Selamat! Anda mendapatkan badge "' || coalesce(v_badge.name, 'Badge') || '".',
    jsonb_build_object(
      'badge_id', new.badge_id,
      'badge_name', coalesce(v_badge.name, 'Badge'),
      'badge_description', coalesce(v_badge.description, ''),
      'badge_icon_url', v_badge.icon_url,
      'badge_icon_emoji', v_badge.icon_emoji,
      'badge_rarity', coalesce(v_badge.rarity, 'Common'),
      'award_source', new.award_source,
      'award_source_label', v_source_label,
      'reason', new.reason,
      'link', v_link
    )
  );

  return new;
end;
$$;

drop trigger if exists trg_user_badges_notify on public.user_badges;
create trigger trg_user_badges_notify
after insert on public.user_badges
for each row
execute function public.notify_badge_awarded();

grant execute on function public.notify_badge_awarded() to authenticated;
