begin;

drop function if exists public.get_public_leaderboard(integer);
drop function if exists public.get_public_coin_leaderboard(integer);
drop function if exists public.register_for_competition(uuid,text,uuid,text,boolean);
drop function if exists public.create_organizer_plan_order(uuid,text,text,text,text,integer,integer,text,text);
drop function if exists public.get_or_create_support_thread();
drop function if exists public.get_public_profile_by_username(text);
drop function if exists public.get_name_change_cooldown(uuid);
drop function if exists public.get_display_name_cooldown(uuid);

commit;
