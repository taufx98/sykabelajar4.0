-- Harden event group creation and membership.
-- Event groups may only be created by teachers/admins or organizer members,
-- and shared invites may only be joined by an enrolled participant or admin.

create or replace function public.create_chat_group(
  p_name text,
  p_description text default null,
  p_group_type text default 'general',
  p_competition_id uuid default null,
  p_join_mode text default 'invite_only'
)
returns jsonb
language plpgsql
security definer
set search_path=public,private,extensions
as $$
declare
  v_uid uuid:=auth.uid();
  v_group public.chat_groups;
  v_token text;
  v_can_manage_event boolean:=false;
begin
  if v_uid is null then raise exception 'UNAUTHORIZED'; end if;
  if nullif(trim(p_name),'') is null then raise exception 'GROUP_NAME_REQUIRED'; end if;
  if p_group_type not in ('general','event','class') then raise exception 'GROUP_TYPE_INVALID'; end if;
  if p_join_mode not in ('invite_only','link') then raise exception 'JOIN_MODE_INVALID'; end if;
  if p_group_type='event' then
    if p_competition_id is null then raise exception 'EVENT_COMPETITION_REQUIRED'; end if;
    v_can_manage_event:=exists(
      select 1 from public.user_roles ur
      where ur.user_id=v_uid and ur.role in ('teacher','admin') and ur.is_active=true
    ) or exists(
      select 1 from public.competitions c
      where c.id=p_competition_id
        and exists(
          select 1 from public.organizer_members om
          where om.organizer_id=c.organizer_id
            and om.user_id=v_uid
            and om.is_active=true
            and om.status='ACTIVE'
        )
    );
    if not v_can_manage_event then raise exception 'EVENT_GROUP_CREATE_FORBIDDEN'; end if;
  end if;
  v_token:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
  insert into public.chat_groups(name,description,group_type,competition_id,owner_user_id,join_mode,invite_token_hash)
  values(trim(p_name),nullif(trim(p_description),''),p_group_type,p_competition_id,v_uid,p_join_mode,encode(digest(v_token,'sha256'),'hex'))
  returning * into v_group;
  insert into public.chat_group_members(group_id,user_id,role) values(v_group.id,v_uid,'OWNER');
  return jsonb_build_object('id',v_group.id,'name',v_group.name,'description',v_group.description,'group_type',v_group.group_type,'competition_id',v_group.competition_id,'join_mode',v_group.join_mode,'invite_token',v_token,'created_at',v_group.created_at);
end;
$$;

create or replace function public.add_chat_group_member(
  p_group_id uuid,
  p_user_id uuid default null,
  p_collective_participant_id uuid default null
)
returns public.chat_group_members
language plpgsql
security definer
set search_path=public,private
as $$
declare
  v_uid uuid:=auth.uid();
  v_group public.chat_groups;
  v_member public.chat_group_members;
  v_comp uuid;
begin
  if v_uid is null or not private.chat_group_user_is_admin(p_group_id,v_uid) then raise exception 'ACCESS_DENIED'; end if;
  if (p_user_id is null)=(p_collective_participant_id is null) then raise exception 'MEMBER_IDENTITY_REQUIRED'; end if;
  select * into v_group from public.chat_groups where id=p_group_id;
  if not found then raise exception 'GROUP_NOT_FOUND'; end if;
  if p_user_id is not null then
    if not exists(select 1 from public.profiles where id=p_user_id) then raise exception 'USER_NOT_FOUND'; end if;
    if v_group.group_type='event' and not exists(select 1 from public.participants pt where pt.competition_id=v_group.competition_id and pt.user_id=p_user_id) then raise exception 'EVENT_MEMBER_NOT_ELIGIBLE'; end if;
  end if;
  if p_collective_participant_id is not null then
    select competition_id into v_comp from public.collective_participants where id=p_collective_participant_id and status='ACTIVE';
    if v_comp is null then raise exception 'PARTICIPANT_NOT_FOUND'; end if;
    if v_group.group_type='event' and v_group.competition_id<>v_comp then raise exception 'EVENT_SCOPE_MISMATCH'; end if;
  end if;
  insert into public.chat_group_members(group_id,user_id,collective_participant_id,role,status)
  values(p_group_id,p_user_id,p_collective_participant_id,'MEMBER','ACTIVE')
  on conflict do update set status='ACTIVE',role='MEMBER'
  returning * into v_member;
  return v_member;
end;
$$;

create or replace function public.join_chat_group(p_invite_token text)
returns jsonb
language plpgsql
security definer
set search_path=public,private,extensions
as $$
declare
  v_uid uuid:=auth.uid();
  v_hash text:=encode(digest(trim(coalesce(p_invite_token,'')),'sha256'),'hex');
  v_group public.chat_groups;
begin
  if v_uid is null then raise exception 'UNAUTHORIZED'; end if;
  select * into v_group from public.chat_groups where invite_token_hash=v_hash and join_mode='link' limit 1;
  if not found then raise exception 'GROUP_INVITE_INVALID'; end if;
  if v_group.group_type='event' and not exists(select 1 from public.participants pt where pt.competition_id=v_group.competition_id and pt.user_id=v_uid) and not exists(select 1 from public.collective_participants cp where cp.competition_id=v_group.competition_id and cp.user_id=v_uid and cp.status='ACTIVE') and not exists(select 1 from public.user_roles ur where ur.user_id=v_uid and ur.role='admin' and ur.is_active=true) then
    raise exception 'GROUP_EVENT_NOT_ELIGIBLE';
  end if;
  insert into public.chat_group_members(group_id,user_id,role,status)
  values(v_group.id,v_uid,'MEMBER','ACTIVE')
  on conflict(group_id,user_id) do update set status='ACTIVE';
  return jsonb_build_object('ok',true,'group_id',v_group.id,'name',v_group.name);
end;
$$;

revoke execute on function public.create_chat_group(text,text,text,uuid,text) from public,anon;
grant execute on function public.create_chat_group(text,text,text,uuid,text) to authenticated;
revoke execute on function public.add_chat_group_member(uuid,uuid,uuid) from public,anon;
grant execute on function public.add_chat_group_member(uuid,uuid,uuid) to authenticated;
revoke execute on function public.join_chat_group(text) from public,anon;
grant execute on function public.join_chat_group(text) to authenticated;
