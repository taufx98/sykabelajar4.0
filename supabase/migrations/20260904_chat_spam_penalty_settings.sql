insert into public.platform_settings (key, value)
values (
  'chat_spam_policy',
  '{"window_seconds":10,"message_threshold":4,"levels":[{"level":1,"duration_minutes":1},{"level":2,"duration_minutes":10},{"level":3,"duration_minutes":60},{"level":4,"duration_minutes":1440}]}'::jsonb
)
on conflict (key) do nothing;

create or replace function public.chat_spam_gate()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_spam public.chat_spam_controls;
  v_policy jsonb;
  v_now timestamptz := now();
  v_count integer := 0;
  v_next integer;
  v_minutes integer;
  v_until timestamptz;
  v_window_seconds integer := 10;
  v_message_threshold integer := 4;
  v_default_minutes integer;
begin
  if v_uid is null then raise exception 'UNAUTHORIZED'; end if;
  if public.is_active_admin(v_uid) then
    return jsonb_build_object('blocked',false,'strike_count',0,'blocked_until',null);
  end if;

  select value into v_policy from public.platform_settings where key='chat_spam_policy' limit 1;
  if v_policy is not null then
    v_window_seconds := greatest(1, least(300, coalesce((v_policy->>'window_seconds')::integer, 10)));
    v_message_threshold := greatest(2, least(20, coalesce((v_policy->>'message_threshold')::integer, 4)));
  end if;

  if exists(select 1 from public.chat_user_moderation where user_id=v_uid and (is_permanent or coalesce(blocked_until, now() - interval '1 second') > now())) then
    return jsonb_build_object('blocked',true,'strike_count',(select strike_level from public.chat_user_moderation where user_id=v_uid),'blocked_until',(select blocked_until from public.chat_user_moderation where user_id=v_uid),'reset_at',now()+interval '7 days');
  end if;

  select * into v_spam from public.chat_spam_controls where user_id=v_uid for update;
  if found and v_spam.window_started_at <= v_now-interval '7 days' then
    update public.chat_spam_controls set window_started_at=v_now,strike_count=0,blocked_until=null,updated_at=v_now where user_id=v_uid returning * into v_spam;
  elsif not found then
    insert into public.chat_spam_controls(user_id,window_started_at,strike_count,blocked_until,updated_at) values(v_uid,v_now,0,null,v_now) returning * into v_spam;
  end if;

  if v_spam.blocked_until is not null and v_spam.blocked_until > v_now then
    return jsonb_build_object('blocked',true,'strike_count',v_spam.strike_count,'blocked_until',v_spam.blocked_until,'reset_at',v_spam.window_started_at+interval '7 days');
  end if;

  execute format('select count(*) from public.chat_messages where sender_id=$1 and created_at >= now() - make_interval(secs => $2)') into v_count using v_uid, v_window_seconds;

  if v_count >= v_message_threshold then
    v_next := least(4,v_spam.strike_count+1);
    v_default_minutes := case v_next when 1 then 1 when 2 then 10 when 3 then 60 else 1440 end;
    v_minutes := case
      when v_policy is not null and jsonb_array_length(coalesce(v_policy->'levels','[]'::jsonb)) >= v_next
        then greatest(1, least(10080, coalesce((v_policy->'levels'->(v_next-1)->>'duration_minutes')::integer, v_default_minutes)))
      else v_default_minutes
    end;
    v_until := v_now+make_interval(mins=>v_minutes);
    update public.chat_spam_controls set strike_count=v_next,blocked_until=v_until,updated_at=v_now where user_id=v_uid;
    insert into public.chat_user_moderation(user_id,blocked_by,reason,strike_level,blocked_until,is_permanent,updated_at)
    values(v_uid,null,'Pelanggaran spam otomatis',v_next,v_until,false,v_now)
    on conflict(user_id) do update set
      blocked_at=now(), reason='Pelanggaran spam otomatis', strike_level=excluded.strike_level,
      blocked_until=excluded.blocked_until, is_permanent=false, updated_at=now();
    return jsonb_build_object('blocked',true,'strike_count',v_next,'blocked_until',v_until,'reset_at',v_spam.window_started_at+interval '7 days');
  end if;

  return jsonb_build_object('blocked',false,'strike_count',v_spam.strike_count,'blocked_until',null,'reset_at',v_spam.window_started_at+interval '7 days');
end;
$function$;