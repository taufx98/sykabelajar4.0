create or replace function public.admin_force_delete_competition(p_competition_id uuid, p_reason text default 'Admin panel - forced delete')
returns public.competitions
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_before public.competitions;
  v_after public.competitions;
begin
  if not private.current_user_is_admin() then
    raise exception 'ACCESS_DENIED';
  end if;

  select * into v_before
  from public.competitions
  where id = p_competition_id
  for update;

  if not found then
    raise exception 'COMPETITION_NOT_FOUND';
  end if;

  update public.competitions
  set status = 'ARCHIVED', updated_at = now()
  where id = p_competition_id;

  delete from public.attempts where competition_id = p_competition_id;
  delete from public.collective_certificates where competition_id = p_competition_id;
  delete from public.certificates where competition_id = p_competition_id;
  delete from public.collective_registrations where competition_id = p_competition_id;
  delete from public.registrations where competition_id = p_competition_id;
  delete from public.chat_groups where competition_id = p_competition_id;

  delete from public.competitions where id = p_competition_id
  returning * into v_after;

  if not found then
    raise exception 'COMPETITION_DELETE_FAILED';
  end if;

  perform private.write_audit(
    'admin.competition_force_delete',
    'competition',
    p_competition_id::text,
    p_reason,
    to_jsonb(v_before),
    to_jsonb(v_after),
    jsonb_build_object('forced', true, 'status_before', v_before.status, 'status_before_archive', 'ARCHIVED')
  );

  return v_before;
end;
$$;

revoke all on function public.admin_force_delete_competition(uuid,text) from public, anon;
grant execute on function public.admin_force_delete_competition(uuid,text) to authenticated;
