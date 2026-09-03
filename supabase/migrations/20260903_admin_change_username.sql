-- Admin-only username change with normalization, uniqueness validation, and audit trail.
create or replace function public.admin_change_username(
  p_user_id uuid,
  p_username text,
  p_reason text default 'Admin panel'
)
returns public.profiles
language plpgsql
security definer
set search_path to 'public', 'private'
as $$
declare
  v_before public.profiles;
  v_after public.profiles;
  v_username text;
begin
  if not private.current_user_is_admin() then
    raise exception 'ACCESS_DENIED';
  end if;

  if p_user_id is null then
    raise exception 'USER_ID_REQUIRED';
  end if;

  v_username := lower(regexp_replace(btrim(coalesce(p_username, '')), '^@+', ''));

  if v_username = '' then
    raise exception 'USERNAME_REQUIRED';
  end if;

  if length(v_username) < 3 or length(v_username) > 30 then
    raise exception 'USERNAME_LENGTH_INVALID';
  end if;

  if v_username !~ '^[a-z0-9][a-z0-9._-]*$' then
    raise exception 'USERNAME_FORMAT_INVALID';
  end if;

  select * into v_before
  from public.profiles
  where id = p_user_id
  for update;

  if not found then
    raise exception 'USER_NOT_FOUND';
  end if;

  if v_before.username = v_username then
    return v_before;
  end if;

  if exists (
    select 1 from public.profiles
    where username = v_username and id <> p_user_id
  ) then
    raise exception 'USERNAME_TAKEN';
  end if;

  update public.profiles
  set username = v_username,
      updated_at = now()
  where id = p_user_id
  returning * into v_after;

  perform private.write_audit(
    'user.username_update',
    'user',
    p_user_id::text,
    p_reason,
    jsonb_build_object('username', v_before.username),
    jsonb_build_object('username', v_after.username),
    null
  );

  return v_after;
exception
  when unique_violation then
    raise exception 'USERNAME_TAKEN';
end;
$$;

grant execute on function public.admin_change_username(uuid, text, text) to authenticated;
