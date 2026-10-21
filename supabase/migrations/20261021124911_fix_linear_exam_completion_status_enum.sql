begin;

-- Keep attempt status CASE branches typed as the public enum; PostgreSQL otherwise infers text and rejects completion.
create or replace function private.complete_linear_exam_attempt(
  p_attempt_id uuid,
  p_completed_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.attempts%rowtype;
  v_item public.exam_attempt_questions%rowtype;
  v_answer jsonb;
  v_key jsonb;
  v_type text;
  v_value text;
  v_points numeric;
  v_item_score numeric;
  v_score numeric := 0;
  v_matched boolean;
  v_manual boolean := false;
  v_similarity numeric;
  v_org uuid;
  v_plan text;
  v_season uuid;
begin
  select * into v_attempt from public.attempts where id = p_attempt_id for update;
  if not found then raise exception 'ATTEMPT_NOT_FOUND'; end if;
  if exists (select 1 from public.exam_attempt_runtime where attempt_id = p_attempt_id and phase = 'COMPLETED')
     and v_attempt.status in ('SUBMITTED','GRADING','FINALIZED','EXPIRED') then
    return;
  end if;

  select c.organizer_id into v_org
  from public.competitions c
  where c.id = v_attempt.competition_id;

  select op.plan_code into v_plan
  from public.organizer_plans op
  where op.organizer_id = v_org
    and op.is_active = true
    and op.starts_at <= clock_timestamp()
    and (op.ends_at is null or op.ends_at > clock_timestamp())
  order by op.starts_at desc, op.created_at desc
  limit 1;

  delete from public.grading_items where attempt_id = p_attempt_id;

  for v_item in
    select * from public.exam_attempt_questions
    where attempt_id = p_attempt_id
    order by position
  loop
    -- Drafts are not submitted responses. Score only answers explicitly locked by the participant.
    if v_item.state <> 'ANSWERED' then
      continue;
    end if;

    v_key := coalesce(v_item.answer_key_snapshot, '{}'::jsonb);
    v_type := lower(replace(coalesce(v_item.question_snapshot->>'type',''), '-', '_'));
    v_points := v_item.points_snapshot;

    select a.answer_json into v_answer
    from public.answers a
    where a.attempt_id = p_attempt_id and a.question_id = v_item.question_id;

    if v_answer is null or v_answer = '{}'::jsonb then
      continue;
    end if;

    v_value := nullif(btrim(coalesce(v_answer->>'value',v_answer->>'text',v_answer->>'url','')), '');
    v_matched := false;

    if v_type in ('multiple_choice','single_choice','true_false') then
      if v_value is not null then
        select exists (
          select 1
          from jsonb_array_elements_text(coalesce(v_key->'correct_option_ids','[]'::jsonb)) k(value)
          where k.value = v_value
        ) into v_matched;
      end if;
      if v_matched then v_score := v_score + v_points; end if;
    elsif v_type in ('multiple_checkbox','multiple_select') then
      select
        coalesce(array(select jsonb_array_elements_text(coalesce(v_answer->'values','[]'::jsonb)) order by 1), array[]::text[])
        =
        coalesce(array(select jsonb_array_elements_text(coalesce(v_key->'correct_option_ids','[]'::jsonb)) order by 1), array[]::text[])
      into v_matched;
      if v_matched then v_score := v_score + v_points; end if;
    elsif v_type in ('short_answer','numeric','short_text') then
      if v_value is not null then
        select exists (
          select 1
          from jsonb_array_elements_text(coalesce(v_key->'accepted_answers','[]'::jsonb)) accepted(value)
          where lower(btrim(accepted.value)) = lower(btrim(v_value))
        ) into v_matched;
      end if;
      if v_matched then v_score := v_score + v_points; end if;
    elsif v_type in ('essay','long_answer') then
      if v_value is not null then
        if coalesce(v_key->>'ai_assessment_enabled','false') = 'true'
           and coalesce(v_key->>'answer_key','') <> ''
           and exists (
             select 1
             from public.plan_entitlements pe
             where pe.plan_code = v_plan
               and pe.capability = 'essay_ai_assessment'
               and coalesce(pe.limit_value,0) > 0
           ) then
          v_similarity := public.calculate_essay_similarity(v_key->>'answer_key',v_value);
          v_item_score := round(coalesce(v_points,0) * greatest(0,least(100,coalesce(v_similarity,0))) / 100, 2);
          insert into public.grading_items (attempt_id, question_id, score, feedback)
          values (
            p_attempt_id, v_item.question_id, v_item_score,
            'AI Similarity Grade: ' || to_char(v_similarity,'FM990D00') || '%'
          );
          v_score := v_score + v_item_score;
        else
          insert into public.grading_items (attempt_id, question_id, score, feedback)
          values (p_attempt_id, v_item.question_id, 0, null);
          v_manual := true;
        end if;
      end if;
    elsif v_type = 'file_upload' then
      if v_value is not null then
        insert into public.grading_items (attempt_id, question_id, score, feedback)
        values (p_attempt_id, v_item.question_id, 0, null);
        v_manual := true;
      end if;
    else
      -- Unknown/custom response types remain pending for human review, never client-graded.
      if v_value is not null then
        insert into public.grading_items (attempt_id, question_id, score, feedback)
        values (p_attempt_id, v_item.question_id, 0, null);
        v_manual := true;
      end if;
    end if;
  end loop;

  update public.attempts
  set status = case when v_manual then 'GRADING'::public.attempt_status else 'FINALIZED'::public.attempt_status end,
      submitted_at = p_completed_at,
      finalized_at = case when v_manual then null else p_completed_at end,
      score = v_score,
      updated_at = clock_timestamp()
  where id = p_attempt_id;

  update public.exam_attempt_runtime
  set phase = 'COMPLETED', grace_kind = null, updated_at = clock_timestamp()
  where attempt_id = p_attempt_id;

  -- Keep automatic competition XP rewards consistent with the previous grading flow.
  if not v_manual and v_attempt.participant_id is not null and v_score > 0 then
    select s.id into v_season
    from public.academic_seasons s
    where s.is_active = true
    order by s.start_at desc
    limit 1;

    if v_season is not null then
      insert into public.xp_ledger(user_id, season_id, event_type, event_id, amount, reason)
      select v_attempt.participant_id, v_season, 'COMPETITION_SCORE', v_attempt.id::text, v_score, 'Nilai kompetisi'
      where not exists (
        select 1 from public.xp_ledger x
        where x.user_id = v_attempt.participant_id
          and x.event_type = 'COMPETITION_SCORE'
          and x.event_id = v_attempt.id::text
      );
    end if;
  end if;

  perform private.log_linear_exam_event(
    p_attempt_id, null, null, 'ATTEMPT_COMPLETED', 'SYSTEM',
    jsonb_build_object('status', case when v_manual then 'GRADING' else 'FINALIZED' end),
    p_completed_at
  );
end;
$$;

commit;
