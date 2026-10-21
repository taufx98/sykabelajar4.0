begin;

-- Delegate status changes to the canonical state-transition RPC.
create or replace function public.release_organizer_competition(p_competition_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_comp public.competitions%rowtype;
  v_question_count integer;
  v_duration integer;
begin
  if v_uid is null then raise exception 'AUTHORIZATION_REQUIRED'; end if;

  select * into v_comp from public.competitions where id=p_competition_id for update;
  if not found then raise exception 'COMPETITION_NOT_FOUND'; end if;
  if not (
    private.current_user_is_admin()
    or (v_comp.organizer_id is not null and private.current_user_is_organizer_for(v_comp.organizer_id))
  ) then
    raise exception 'NOT_AUTHORIZED';
  end if;
  if v_comp.status <> 'DRAFT' then raise exception 'COMPETITION_NOT_DRAFT'; end if;
  if nullif(trim(v_comp.title),'') is null or nullif(trim(v_comp.slug),'') is null then
    raise exception 'COMPETITION_IDENTITY_INCOMPLETE';
  end if;
  if v_comp.registration_starts_at is null or v_comp.registration_ends_at is null
     or v_comp.starts_at is null or v_comp.ends_at is null or v_comp.announcement_at is null then
    raise exception 'COMPETITION_TIMELINE_INCOMPLETE';
  end if;
  if v_comp.registration_starts_at > v_comp.registration_ends_at
     or v_comp.starts_at > v_comp.ends_at then
    raise exception 'COMPETITION_TIMELINE_INVALID';
  end if;

  select count(*) into v_question_count
  from public.questions
  where competition_id=p_competition_id and status='PUBLISHED';
  if v_question_count < 1 then raise exception 'EXAM_HAS_NO_PUBLISHED_QUESTIONS'; end if;

  v_duration := case
    when coalesce(v_comp.config->>'duration_minutes','') ~ '^[0-9]+$'
      then (v_comp.config->>'duration_minutes')::integer
    else 60
  end;
  if v_duration < 1 or v_duration > 1440 or v_duration * 60 < v_question_count then
    raise exception 'EXAM_DURATION_INVALID';
  end if;

  perform public.transition_competition(
    p_competition_id,
    'PUBLISHED'::public.competition_status,
    'Organizer release after readiness validation'
  );

  return jsonb_build_object(
    'competition_id',p_competition_id,
    'status','PUBLISHED',
    'published_at',clock_timestamp(),
    'published_question_count',v_question_count
  );
end;
$$;

commit;
