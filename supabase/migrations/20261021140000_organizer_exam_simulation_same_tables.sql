begin;

-- Use the existing attempt/answer/runtime tables. No preview-only tables are created.
alter table public.attempts
  add column if not exists is_preview boolean not null default false,
  add column if not exists preview_owner_id uuid null references auth.users(id) on delete cascade;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'attempts_preview_owner_consistency'
      and conrelid = 'public.attempts'::regclass
  ) then
    alter table public.attempts
      add constraint attempts_preview_owner_consistency
      check (
        (is_preview = false and preview_owner_id is null)
        or
        (is_preview = true and preview_owner_id is not null
          and participant_id is null
          and collective_participant_id is null
          and canonical_participant_id is null
          and registration_id is null)
      );
  end if;
end;
$$;

create index if not exists attempts_preview_owner_competition_idx
  on public.attempts (preview_owner_id, competition_id, created_at desc)
  where is_preview = true;

-- Prevent organizer table-update privileges from turning official attempts into
-- previews or changing the owner / participant identity of an existing preview.
create or replace function private.guard_attempt_preview_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null
     and not private.current_user_is_admin()
     and (
       new.is_preview is distinct from old.is_preview
       or new.preview_owner_id is distinct from old.preview_owner_id
       or new.competition_id is distinct from old.competition_id
       or new.participant_id is distinct from old.participant_id
       or new.registration_id is distinct from old.registration_id
       or new.collective_participant_id is distinct from old.collective_participant_id
       or new.canonical_participant_id is distinct from old.canonical_participant_id
     ) then
    raise exception 'ATTEMPT_PREVIEW_IDENTITY_SERVER_MANAGED';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_attempt_preview_identity() from public, anon, authenticated;

drop trigger if exists guard_attempt_preview_identity on public.attempts;
create trigger guard_attempt_preview_identity
before update on public.attempts
for each row execute function private.guard_attempt_preview_identity();

-- Direct table reads must not reveal another organizer's preview attempt/answers.
drop policy if exists attempts_admin_or_owner_read on public.attempts;
create policy attempts_admin_or_owner_read on public.attempts
for select to authenticated
using (
  (is_preview = true and preview_owner_id = (select auth.uid()))
  or (is_preview = false and participant_id = (select auth.uid())
      and status in ('NOT_STARTED','IN_PROGRESS'))
  or private.current_user_is_admin()
  or (
    is_preview = false
    and exists (
      select 1 from public.competitions c
      where c.id = attempts.competition_id
        and c.organizer_id is not null
        and private.current_user_is_organizer_for(c.organizer_id)
    )
  )
);

drop policy if exists attempts_admin_or_owner_update on public.attempts;
create policy attempts_admin_or_owner_update on public.attempts
for update to authenticated
using (
  private.current_user_is_admin()
  or (
    is_preview = false
    and exists (
      select 1 from public.competitions c
      where c.id = attempts.competition_id
        and c.organizer_id is not null
        and private.current_user_is_organizer_for(c.organizer_id)
    )
  )
)
with check (
  private.current_user_is_admin()
  or (
    is_preview = false
    and exists (
      select 1 from public.competitions c
      where c.id = attempts.competition_id
        and c.organizer_id is not null
        and private.current_user_is_organizer_for(c.organizer_id)
    )
  )
);

drop policy if exists answers_organizer_read on public.answers;
create policy answers_organizer_read on public.answers
for select to authenticated
using (
  exists (
    select 1
    from public.attempts a
    join public.competitions c on c.id = a.competition_id
    where a.id = answers.attempt_id
      and a.is_preview = false
      and a.status in ('SUBMITTED','GRADING','FINALIZED')
      and (
        private.current_user_is_admin()
        or (c.organizer_id is not null and private.current_user_is_organizer_for(c.organizer_id))
      )
  )
);

-- The existing linear exam access helper permits the verified owner of a preview
-- attempt while keeping ordinary attempts bound to their participant account.
create or replace function private.assert_individual_linear_exam_access(p_attempt_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_attempt public.attempts%rowtype;
begin
  if v_uid is null then raise exception 'AUTHORIZATION_REQUIRED'; end if;

  select * into v_attempt
  from public.attempts
  where id = p_attempt_id;

  if not found then raise exception 'ATTEMPT_NOT_FOUND'; end if;

  if v_attempt.is_preview then
    if v_attempt.preview_owner_id is distinct from v_uid then
      raise exception 'ATTEMPT_NOT_FOUND';
    end if;
  elsif v_attempt.participant_id is distinct from v_uid then
    raise exception 'ATTEMPT_NOT_FOUND';
  end if;
end;
$$;

revoke all on function private.assert_individual_linear_exam_access(uuid) from public, anon, authenticated;

-- Start/resume a draft-only simulation with the same server-authoritative exam engine.
create or replace function public.start_organizer_exam_preview(p_competition_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_comp public.competitions%rowtype;
  v_attempt public.attempts%rowtype;
begin
  if v_uid is null then raise exception 'AUTHORIZATION_REQUIRED'; end if;

  perform pg_advisory_xact_lock(hashtextextended(v_uid::text || ':' || p_competition_id::text, 0));

  select * into v_comp
  from public.competitions
  where id = p_competition_id;

  if not found then raise exception 'COMPETITION_NOT_FOUND'; end if;
  if not private.current_user_is_admin() and (
    v_comp.organizer_id is null
    or coalesce(private.current_user_organizer_role(v_comp.organizer_id), '') not in ('owner','editor')
  ) then
    raise exception 'NOT_AUTHORIZED';
  end if;
  if v_comp.status <> 'DRAFT' then
    raise exception 'PREVIEW_REQUIRES_DRAFT_COMPETITION';
  end if;

  select * into v_attempt
  from public.attempts a
  where a.competition_id = p_competition_id
    and a.preview_owner_id = v_uid
    and a.is_preview = true
    and a.status = 'IN_PROGRESS'
  order by a.created_at desc
  limit 1
  for update;

  if found then
    if not exists (select 1 from public.exam_attempt_runtime r where r.attempt_id = v_attempt.id) then
      update public.attempts
      set started_at = clock_timestamp(), updated_at = clock_timestamp()
      where id = v_attempt.id;
      perform private.prepare_linear_exam_runtime(v_attempt.id);
      return private.build_linear_exam_state(v_attempt.id);
    end if;

    if exists (
      select 1 from public.exam_attempt_runtime r
      where r.attempt_id = v_attempt.id and r.phase <> 'COMPLETED'
    ) then
      perform private.resolve_linear_exam_timeouts(v_attempt.id, clock_timestamp());
      return private.build_linear_exam_state(v_attempt.id);
    end if;
  end if;

  -- Keep only the latest completed preview for this owner/competition.
  -- Cascades clear its answers, runtime snapshots, events, and grading rows.
  delete from public.attempts
  where competition_id = p_competition_id
    and preview_owner_id = v_uid
    and is_preview = true;

  insert into public.attempts (
    competition_id, participant_id, registration_id, collective_participant_id,
    canonical_participant_id, attempt_number, status, started_at,
    is_preview, preview_owner_id
  )
  values (
    p_competition_id, null, null, null, null, 1, 'IN_PROGRESS',
    clock_timestamp(), true, v_uid
  )
  returning * into v_attempt;

  perform private.prepare_linear_exam_runtime(v_attempt.id);
  return private.build_linear_exam_state(v_attempt.id);
end;
$$;

revoke all on function public.start_organizer_exam_preview(uuid) from public, anon;
grant execute on function public.start_organizer_exam_preview(uuid) to authenticated;

-- Report data and answer keys are returned only to the owner of the completed preview.
create or replace function public.get_organizer_exam_preview_report(p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_attempt public.attempts%rowtype;
  v_runtime public.exam_attempt_runtime%rowtype;
  v_comp public.competitions%rowtype;
  v_answered integer := 0;
  v_skipped integer := 0;
  v_timeout integer := 0;
  v_max_score numeric := 0;
  v_manual integer := 0;
  v_questions jsonb := '[]'::jsonb;
begin
  if v_uid is null then raise exception 'AUTHORIZATION_REQUIRED'; end if;

  select * into v_attempt from public.attempts
  where id = p_attempt_id and is_preview = true and preview_owner_id = v_uid;
  if not found then raise exception 'PREVIEW_NOT_FOUND'; end if;

  select * into v_runtime from public.exam_attempt_runtime where attempt_id = p_attempt_id;
  if not found or v_runtime.phase <> 'COMPLETED' then
    raise exception 'PREVIEW_NOT_COMPLETED';
  end if;

  select * into v_comp from public.competitions where id = v_attempt.competition_id;

  select
    count(*) filter (where q.state = 'ANSWERED'),
    count(*) filter (where q.state = 'SKIPPED'),
    count(*) filter (where q.state = 'TIMEOUT'),
    coalesce(sum(q.points_snapshot), 0)
  into v_answered, v_skipped, v_timeout, v_max_score
  from public.exam_attempt_questions q
  where q.attempt_id = p_attempt_id;

  select count(*) into v_manual
  from public.exam_attempt_questions q
  where q.attempt_id = p_attempt_id
    and q.state = 'ANSWERED'
    and (
      lower(replace(coalesce(q.question_snapshot->>'type',''),'-','_')) in ('file_upload')
      or (
        lower(replace(coalesce(q.question_snapshot->>'type',''),'-','_')) in ('essay','long_answer')
        and not (
          coalesce(q.answer_key_snapshot->>'ai_assessment_enabled','false') = 'true'
          and coalesce(q.answer_key_snapshot->>'answer_key','') <> ''
          and exists (
            select 1
            from public.organizer_plans op
            join public.plan_entitlements pe on pe.plan_code = op.plan_code
            where op.organizer_id = v_comp.organizer_id
              and op.is_active = true
              and op.starts_at <= clock_timestamp()
              and (op.ends_at is null or op.ends_at > clock_timestamp())
              and pe.capability = 'essay_ai_assessment'
              and coalesce(pe.limit_value,0) > 0
          )
        )
      )
    );

  select coalesce(jsonb_agg(jsonb_build_object(
    'position', q.position,
    'state', q.state,
    'points', q.points_snapshot,
    'question', q.question_snapshot,
    'answer', coalesce(a.answer_json, '{}'::jsonb),
    'answer_key', q.answer_key_snapshot,
    'manual_review_required',
      (lower(replace(coalesce(q.question_snapshot->>'type',''),'-','_')) in ('file_upload'))
      or (
        lower(replace(coalesce(q.question_snapshot->>'type',''),'-','_')) in ('essay','long_answer')
        and not (
          coalesce(q.answer_key_snapshot->>'ai_assessment_enabled','false') = 'true'
          and coalesce(q.answer_key_snapshot->>'answer_key','') <> ''
          and exists (
            select 1
            from public.organizer_plans op
            join public.plan_entitlements pe on pe.plan_code = op.plan_code
            where op.organizer_id = v_comp.organizer_id
              and op.is_active = true
              and op.starts_at <= clock_timestamp()
              and (op.ends_at is null or op.ends_at > clock_timestamp())
              and pe.capability = 'essay_ai_assessment'
              and coalesce(pe.limit_value,0) > 0
          )
        )
      )
  ) order by q.position), '[]'::jsonb)
  into v_questions
  from public.exam_attempt_questions q
  left join public.answers a
    on a.attempt_id = q.attempt_id and a.question_id = q.question_id
  where q.attempt_id = p_attempt_id;

  return jsonb_build_object(
    'attempt_id', v_attempt.id,
    'competition_id', v_attempt.competition_id,
    'competition_title', v_comp.title,
    'attempt_status', v_attempt.status,
    'score', v_attempt.score,
    'maximum_score', v_max_score,
    'answered_count', v_answered,
    'skipped_count', v_skipped,
    'timeout_count', v_timeout,
    'manual_review_count', v_manual,
    'questions', v_questions,
    'completed_at', v_attempt.submitted_at
  );
end;
$$;

revoke all on function public.get_organizer_exam_preview_report(uuid) from public, anon;
grant execute on function public.get_organizer_exam_preview_report(uuid) to authenticated;

-- A preview with essay/file items must not generate rows in the official grading queue.
create or replace function private.skip_preview_grading_item_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.attempts a
    where a.id = new.attempt_id and a.is_preview = true
  ) then
    return null;
  end if;
  return new;
end;
$$;

revoke all on function private.skip_preview_grading_item_insert() from public, anon, authenticated;

drop trigger if exists skip_preview_grading_item_insert on public.grading_items;
create trigger skip_preview_grading_item_insert
before insert on public.grading_items
for each row execute function private.skip_preview_grading_item_insert();

-- If a preview contains manually graded question types, mark its attempt completed
-- without leaving it in GRADING (which locks source questions and leaks into queues).
create or replace function private.normalize_preview_attempt_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_preview = true and new.status = 'GRADING'::public.attempt_status then
    new.status := 'FINALIZED'::public.attempt_status;
    new.finalized_at := coalesce(new.finalized_at, new.submitted_at, clock_timestamp());
  end if;
  return new;
end;
$$;

revoke all on function private.normalize_preview_attempt_status() from public, anon, authenticated;

drop trigger if exists normalize_preview_attempt_status on public.attempts;
create trigger normalize_preview_attempt_status
before update of status on public.attempts
for each row execute function private.normalize_preview_attempt_status();

-- Explicitly disallow manual grading/finalization of preview attempts.
create or replace function public.save_manual_grading_item(p_grading_item_id uuid, p_score numeric, p_feedback text default null)
returns public.grading_items
language plpgsql
security definer
set search_path = 'public', 'private'
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.grading_items%rowtype;
  v_q public.questions%rowtype;
  v_attempt public.attempts%rowtype;
  v_comp public.competitions%rowtype;
  v_max numeric;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_row from public.grading_items where id=p_grading_item_id for update;
  if not found then raise exception 'GRADING_ITEM_NOT_FOUND'; end if;
  select * into v_q from public.questions where id=v_row.question_id;
  select * into v_attempt from public.attempts where id=v_row.attempt_id;
  if v_attempt.is_preview then raise exception 'PREVIEW_ATTEMPT_NOT_GRADABLE'; end if;
  select * into v_comp from public.competitions where id=v_attempt.competition_id;
  if not (private.current_user_is_admin() or private.current_user_is_organizer_for(v_comp.organizer_id)) then
    raise exception 'FORBIDDEN';
  end if;
  v_max := coalesce(v_q.points,0);
  if p_score < 0 or p_score > v_max then raise exception 'SCORE_OUT_OF_RANGE'; end if;
  update public.grading_items
  set grader_id=v_uid, score=p_score, feedback=p_feedback, updated_at=now()
  where id=p_grading_item_id returning * into v_row;
  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,reason,after_data)
  values(v_uid,'MANUAL_GRADING','grading_item',p_grading_item_id::text,p_feedback,to_jsonb(v_row));
  return v_row;
end;
$$;

create or replace function public.finalize_attempt_manual(p_attempt_id uuid, p_score numeric, p_reason text default null)
returns public.attempts
language plpgsql
security definer
set search_path = 'public', 'private'
as $$
declare
  actor uuid := auth.uid();
  a public.attempts%rowtype;
  c public.competitions%rowtype;
begin
  if actor is null then raise exception 'AUTHORIZATION_REQUIRED'; end if;
  select * into a from public.attempts where id=p_attempt_id for update;
  if not found then raise exception 'ATTEMPT_NOT_FOUND'; end if;
  if a.is_preview then raise exception 'PREVIEW_ATTEMPT_NOT_GRADABLE'; end if;
  select * into c from public.competitions where id=a.competition_id;
  if not (private.current_user_is_admin() or private.current_user_is_organizer_for(c.organizer_id)) then
    raise exception 'ACCESS_DENIED';
  end if;
  perform private.require_organizer_entitlement(c.organizer_id,'manual_grading');
  if a.status not in ('GRADING','SUBMITTED') then raise exception 'ATTEMPT_NOT_FINALIZABLE'; end if;
  if p_reason is null or trim(p_reason)='' then raise exception 'FINALIZE_REASON_REQUIRED'; end if;
  update public.attempts
  set score=greatest(coalesce(p_score,0),0), status='FINALIZED',
      finalized_at=now(), updated_at=now()
  where id=a.id returning * into a;
  perform private.write_audit('attempt.finalize','attempt',a.id::text,p_reason,null,
    jsonb_build_object('score',a.score,'status',a.status),null);
  return a;
end;
$$;

-- Release is a server-side state transition, not a client-side status update.
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

  update public.competitions
  set status='PUBLISHED', updated_at=clock_timestamp()
  where id=p_competition_id;

  return jsonb_build_object(
    'competition_id',p_competition_id,
    'status','PUBLISHED',
    'published_at',clock_timestamp(),
    'published_question_count',v_question_count
  );
end;
$$;

revoke all on function public.release_organizer_competition(uuid) from public, anon;
grant execute on function public.release_organizer_competition(uuid) to authenticated;

commit;
