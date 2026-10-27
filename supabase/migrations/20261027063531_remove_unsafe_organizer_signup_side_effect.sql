create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_type text := lower(coalesce(new.raw_user_meta_data->>'account_type', 'student'));
  v_role public.app_role;
begin
  -- Registration metadata may choose only a supported basic account type.
  -- Privileged roles and organizer workspace ownership are never granted from
  -- raw_user_meta_data; workspace creation must use the protected create_organizer RPC.
  if v_type not in ('student', 'teacher', 'organizer') then
    v_type := 'student';
  end if;

  insert into public.profiles (
    id, full_name, username, grade, birth_date, institution, school_id,
    guardian_name, account_type, whatsapp, subjects
  ) values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    nullif(lower(new.raw_user_meta_data->>'username'), ''),
    nullif(new.raw_user_meta_data->>'grade', ''),
    nullif(new.raw_user_meta_data->>'birth_date', '')::date,
    nullif(upper(new.raw_user_meta_data->>'institution'), ''),
    nullif(new.raw_user_meta_data->>'school_id', '')::uuid,
    nullif(new.raw_user_meta_data->>'guardian_name', ''),
    v_type,
    nullif(new.raw_user_meta_data->>'whatsapp', ''),
    nullif(new.raw_user_meta_data->>'subjects', '')
  )
  on conflict (id) do update set
    full_name = excluded.full_name,
    username = coalesce(excluded.username, public.profiles.username),
    grade = excluded.grade,
    birth_date = excluded.birth_date,
    institution = excluded.institution,
    school_id = excluded.school_id,
    guardian_name = excluded.guardian_name,
    account_type = excluded.account_type,
    whatsapp = excluded.whatsapp,
    subjects = excluded.subjects,
    updated_at = now();

  v_role := case
    when v_type = 'teacher' then 'teacher'::public.app_role
    when v_type = 'organizer' then 'organizer_member'::public.app_role
    else 'student'::public.app_role
  end;

  insert into public.user_roles (user_id, role, is_active)
  values (new.id, v_role, true)
  on conflict (user_id, role) do update set is_active = true;

  insert into public.user_settings (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$function$;