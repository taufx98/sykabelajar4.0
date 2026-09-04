insert into public.platform_settings (key,value)
values ('chat_spam_policy', jsonb_build_object(
  'enabled', true,
  'levels', jsonb_build_array(
    jsonb_build_object('level',1,'name','Pelanggaran 1','message_threshold',4,'window_seconds',10,'duration_minutes',1,'message','Aktivitas chat kamu terdeteksi terlalu cepat. Akses chat dibatasi selama 1 menit.','enabled',true),
    jsonb_build_object('level',2,'name','Pelanggaran 2','message_threshold',4,'window_seconds',10,'duration_minutes',10,'message','Aktivitas spam kembali terdeteksi. Akses chat dibatasi selama 10 menit.','enabled',true),
    jsonb_build_object('level',3,'name','Pelanggaran 3','message_threshold',4,'window_seconds',10,'duration_minutes',60,'message','Pelanggaran spam berulang. Akses chat dibatasi selama 1 jam.','enabled',true),
    jsonb_build_object('level',4,'name','Pelanggaran 4','message_threshold',4,'window_seconds',10,'duration_minutes',1440,'message','Pelanggaran spam berulang. Akses chat dibatasi selama 24 jam.','enabled',true)
  )
)) on conflict (key) do nothing;

create or replace function public.chat_spam_gate()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_spam public.chat_spam_controls;
  v_policy jsonb;
  v_levels jsonb := '[]'::jsonb;
  v_now timestamptz := now();
  v_count integer := 0;
  v_next integer;
  v_minutes integer;
  v_until timestamptz;
  v_rule jsonb;
  v_window_seconds integer;
  v_message_threshold integer;
  v_message text;
begin
  if v_uid is null then raise exception 'UNAUTHORIZED'; end if;
  if public.is_active_admin(v_uid) then return jsonb_build_object('blocked',false,'strike_count',0,'blocked_until',null); end if;

  select value into v_policy from public.platform_settings where key='chat_spam_policy' limit 1;
  if coalesce((v_policy->>'enabled')::boolean,true) = false then return jsonb_build_object('blocked',false,'strike_count',0,'blocked_until',null); end if;
  v_levels := case when jsonb_typeof(v_policy->'levels')='array' then v_policy->'levels' else '[]'::jsonb end;
  if jsonb_array_length(v_levels)=0 then return jsonb_build_object('blocked',false,'strike_count',0,'blocked_until',null); end if;

  if exists(select 1 from public.chat_user_moderation where user_id=v_uid and (is_permanent or coalesce(blocked_until,now()-interval '1 second')>now())) then
    return jsonb_build_object('blocked',true,'strike_count',(select strike_level from public.chat_user_moderation where user_id=v_uid),'blocked_until',(select blocked_until from public.chat_user_moderation where user_id=v_uid),'reset_at',now()+interval '7 days');
  end if;

  select * into v_spam from public.chat_spam_controls where user_id=v_uid for update;
  if found and v_spam.window_started_at <= v_now-interval '7 days' then
    update public.chat_spam_controls set window_started_at=v_now,strike_count=0,blocked_until=null,updated_at=v_now where user_id=v_uid returning * into v_spam;
  elsif not found then
    insert into public.chat_spam_controls(user_id,window_started_at,strike_count,blocked_until,updated_at) values(v_uid,v_now,0,null,v_now) returning * into v_spam;
  end if;

  if v_spam.blocked_until is not null and v_spam.blocked_until > v_now then return jsonb_build_object('blocked',true,'strike_count',v_spam.strike_count,'blocked_until',v_spam.blocked_until,'reset_at',v_spam.window_started_at+interval '7 days'); end if;

  v_next := least(jsonb_array_length(v_levels),v_spam.strike_count+1);
  v_rule := v_levels->(v_next-1);
  if coalesce((v_rule->>'enabled')::boolean,true) = false then return jsonb_build_object('blocked',false,'strike_count',v_spam.strike_count,'blocked_until',null,'reset_at',v_spam.window_started_at+interval '7 days'); end if;
  v_window_seconds := greatest(1,least(300,coalesce((v_rule->>'window_seconds')::integer,10)));
  v_message_threshold := greatest(2,least(20,coalesce((v_rule->>'message_threshold')::integer,4)));
  v_minutes := greatest(1,least(10080,coalesce((v_rule->>'duration_minutes')::integer,1)));
  v_message := coalesce(nullif(trim(v_rule->>'message'),''),'Aktivitas chat terdeteksi sebagai spam. Akses chat dibatasi sementara.');

  execute format('select count(*) from public.chat_messages where sender_id=$1 and created_at >= now() - make_interval(secs => $2)') into v_count using v_uid,v_window_seconds;
  if v_count >= v_message_threshold then
    v_until := v_now+make_interval(mins=>v_minutes);
    update public.chat_spam_controls set strike_count=v_next,blocked_until=v_until,updated_at=v_now where user_id=v_uid;
    insert into public.chat_user_moderation(user_id,blocked_by,reason,strike_level,blocked_until,is_permanent,updated_at)
    values(v_uid,null,v_message,v_next,v_until,false,v_now)
    on conflict(user_id) do update set blocked_at=now(),reason=excluded.reason,strike_level=excluded.strike_level,blocked_until=excluded.blocked_until,is_permanent=false,updated_at=now();
    return jsonb_build_object('blocked',true,'strike_count',v_next,'blocked_until',v_until,'reset_at',v_spam.window_started_at+interval '7 days','message',v_message);
  end if;
  return jsonb_build_object('blocked',false,'strike_count',v_spam.strike_count,'blocked_until',null,'reset_at',v_spam.window_started_at+interval '7 days');
end;
$$;