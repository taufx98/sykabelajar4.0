create or replace function public.create_organizer(p_name text, p_slug text)
returns table(id uuid, name text, slug text, access_code text)
language plpgsql
security definer
set search_path = public, private
as $function$
declare
  v_uid uuid := auth.uid();
  v_user auth.users;
  v_id uuid;
  v_code text := encode(gen_random_bytes(5), 'hex');
  v_slug text := lower(regexp_replace(trim(p_slug), '[^a-zA-Z0-9]+', '-', 'g'));
  v_phone text;
  v_identity_hash text;
begin
  if v_uid is null then
    raise exception 'UNAUTHORIZED';
  end if;

  -- A direct RPC call must not let a student account self-promote into the
  -- organizer workspace flow. The active organizer role must come from backend role assignment.
  if not exists (
    select 1
    from public.user_roles ur
    where ur.user_id = v_uid
      and ur.role = 'organizer_member'::public.app_role
      and ur.is_active = true
  ) then
    raise exception 'ORGANIZER_ROLE_REQUIRED';
  end if;

  if nullif(trim(p_name), '') is null then
    raise exception 'ORGANIZER_NAME_REQUIRED';
  end if;
  if nullif(trim(v_slug), '') is null then
    raise exception 'ORGANIZER_SLUG_REQUIRED';
  end if;
  if exists (select 1 from public.organizers where owner_user_id = v_uid) then
    raise exception 'ORGANIZER_LIMIT_REACHED';
  end if;

  select * into v_user from auth.users where id = v_uid;
  if not found then
    raise exception 'USER_NOT_FOUND';
  end if;
  if v_user.email_confirmed_at is null then
    raise exception 'EMAIL_VERIFICATION_REQUIRED';
  end if;
  if v_user.phone_confirmed_at is null then
    raise exception 'PHONE_VERIFICATION_REQUIRED';
  end if;

  v_phone := regexp_replace(coalesce(v_user.phone, ''), '[^0-9]+', '', 'g');
  if length(v_phone) < 8 then
    raise exception 'PHONE_VERIFICATION_REQUIRED';
  end if;
  v_identity_hash := encode(digest(v_phone, 'sha256'), 'hex');

  if exists (
    select 1 from private.organizer_free_identity_claims where identity_hash = v_identity_hash
  ) then
    raise exception 'FREE_ORGANIZER_ALREADY_CLAIMED';
  end if;

  insert into public.organizers(name, slug, owner_user_id, status)
  values (trim(p_name), trim(both '-' from v_slug), v_uid, 'ACTIVE')
  returning id into v_id;

  insert into public.organizer_members(organizer_id, user_id, member_role, is_active, role, status)
  values (v_id, v_uid, 'owner', true, 'owner', 'ACTIVE')
  on conflict (organizer_id, user_id) do update
    set member_role = 'owner',
        is_active = true,
        role = 'owner',
        status = 'ACTIVE',
        updated_at = now();

  insert into public.organizer_plans(organizer_id, plan_code, starts_at, ends_at, is_active)
  values (v_id, 'FREE', now(), now() + interval '6 months', true);

  insert into private.organizer_access_codes(organizer_id, code_hash, rotated_by)
  values (v_id, crypt(v_code, gen_salt('bf', 10)), v_uid);

  insert into private.organizer_free_identity_claims(identity_hash, owner_user_id, organizer_id)
  values (v_identity_hash, v_uid, v_id);

  return query
    select o.id, o.name, o.slug, v_code
    from public.organizers o
    where o.id = v_id;
exception
  when unique_violation then
    raise exception 'FREE_ORGANIZER_ALREADY_CLAIMED';
end;
$function$;