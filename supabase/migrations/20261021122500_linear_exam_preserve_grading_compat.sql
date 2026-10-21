begin;

-- Preserve existing Premium AI essay grading and automatic XP for the linear engine.
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
  set status = case when v_manual then 'GRADING' else 'FINALIZED' end,
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

create or replace function private.prepare_linear_exam_runtime(p_attempt_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.attempts%rowtype;
  v_comp public.competitions%rowtype;
  v_question public.questions%rowtype;
  v_position integer := 0;
  v_question_count integer;
  v_duration_minutes integer;
  v_duration_seconds integer;
  v_base_seconds integer;
  v_remainder_seconds integer;
  v_question_base integer;
  v_decision_seconds integer := 30;
  v_grace_seconds integer := 30;
  v_started_at timestamptz;
  v_global_deadline timestamptz;
  v_random_questions boolean := false;
  v_random_options boolean := false;
  v_options jsonb;
  v_correct_ids jsonb;
  v_accepted_answers jsonb;
  v_question_type text;
  v_question_snapshot jsonb;
  v_answer_key jsonb;
begin
  select * into v_attempt from public.attempts where id = p_attempt_id for update;
  if not found then raise exception 'ATTEMPT_NOT_FOUND'; end if;
  if exists (select 1 from public.exam_attempt_runtime where attempt_id = p_attempt_id) then return; end if;

  select * into v_comp from public.competitions where id = v_attempt.competition_id;
  if not found then raise exception 'COMPETITION_NOT_FOUND'; end if;

  v_duration_minutes := greatest(1, least(1440,
    case when coalesce(v_comp.config->>'duration_minutes','') ~ '^[0-9]+
  v_random_questions := lower(coalesce(v_comp.config->>'linear_exam_randomize_questions','false')) = 'true';
  v_random_options := lower(coalesce(v_comp.config->>'linear_exam_randomize_options','false')) = 'true';

  select count(*) into v_question_count
  from public.questions
  where competition_id = v_attempt.competition_id and status = 'PUBLISHED';

  if v_question_count = 0 then raise exception 'EXAM_HAS_NO_PUBLISHED_QUESTIONS'; end if;
  if v_duration_seconds < v_question_count then raise exception 'EXAM_DURATION_TOO_SHORT'; end if;

  v_base_seconds := v_duration_seconds / v_question_count;
  v_remainder_seconds := v_duration_seconds - (v_base_seconds * v_question_count);
  v_started_at := coalesce(v_attempt.started_at, clock_timestamp());
  v_global_deadline := v_started_at + make_interval(secs => v_duration_seconds + (v_question_count * (v_decision_seconds + v_grace_seconds)));

  update public.attempts
  set started_at = v_started_at, expires_at = v_global_deadline, updated_at = clock_timestamp()
  where id = p_attempt_id;

  insert into public.exam_attempt_runtime (
    attempt_id, current_position, question_count, duration_seconds,
    decision_window_seconds, grace_seconds, time_bank_seconds,
    phase, grace_kind, global_deadline
  )
  values (
    p_attempt_id, 1, v_question_count, v_duration_seconds,
    v_decision_seconds, v_grace_seconds, 0, 'ACTIVE', null, v_global_deadline
  );

  for v_question in
    select q.*
    from public.questions q
    where q.competition_id = v_attempt.competition_id and q.status = 'PUBLISHED'
    order by
      case when v_random_questions then random() else q.display_order::double precision end,
      q.display_order, q.id
  loop
    v_position := v_position + 1;
    v_question_base := v_base_seconds + case when v_position <= v_remainder_seconds then 1 else 0 end;

    select coalesce(
      jsonb_agg(
        jsonb_build_object('id', qo.id::text, 'label', qo.label)
        order by
          case when v_random_options then random() else qo.display_order::double precision end,
          qo.display_order, qo.id
      ),
      '[]'::jsonb
    )
    into v_options
    from public.question_options qo
    where qo.question_id = v_question.id;

    select coalesce(jsonb_agg(qo.id::text order by qo.id), '[]'::jsonb)
    into v_correct_ids
    from public.question_options qo
    where qo.question_id = v_question.id and qo.is_correct = true;

    v_accepted_answers := coalesce(v_question.config->'accepted_answers', '[]'::jsonb);
    if jsonb_typeof(v_accepted_answers) <> 'array' then v_accepted_answers := '[]'::jsonb; end if;
    v_question_type := lower(replace(coalesce(v_question.type,''),'-','_'));

    -- Existing short-answer questions may keep accepted values in correct question_options.
    if v_question_type in ('short_answer','short_text','numeric') then
      select coalesce(jsonb_agg(to_jsonb(trimmed_answer) order by lower(trimmed_answer)), '[]'::jsonb)
      into v_accepted_answers
      from (
        select btrim(value) as trimmed_answer
        from jsonb_array_elements_text(v_accepted_answers) accepted(value)
        union
        select btrim(qo.value) as trimmed_answer
        from public.question_options qo
        where qo.question_id = v_question.id
          and qo.is_correct = true
          and nullif(btrim(qo.value),'') is not null
      ) accepted_values
      where nullif(trimmed_answer,'') is not null;
    end if;

    v_question_snapshot := jsonb_build_object(
      'id', v_question.id::text,
      'type', v_question.type,
      'prompt', v_question.prompt,
      'points', v_question.points,
      'required', v_question.required,
      'display_order', v_position,
      'options', v_options
    );

    v_answer_key := jsonb_build_object(
      'correct_option_ids', v_correct_ids,
      'accepted_answers', v_accepted_answers,
      'answer_key', coalesce(v_question.config->>'answer_key',''),
      'ai_assessment_enabled', lower(coalesce(v_question.config->'ai_assessment'->>'enabled','false')) = 'true'
    );

    insert into public.exam_attempt_questions (
      attempt_id, position, question_id, question_snapshot, answer_key_snapshot,
      points_snapshot, base_seconds, allocated_seconds, state,
      opened_at, question_deadline
    )
    values (
      p_attempt_id, v_position, v_question.id, v_question_snapshot, v_answer_key,
      greatest(0, v_question.points), v_question_base, v_question_base,
      case when v_position = 1 then 'ACTIVE' else 'LOCKED' end,
      case when v_position = 1 then v_started_at else null end,
      case when v_position = 1 then least(v_started_at + make_interval(secs => v_question_base), v_global_deadline) else null end
    );
  end loop;

  perform private.log_linear_exam_event(
    p_attempt_id, 1,
    (select question_id from public.exam_attempt_questions where attempt_id = p_attempt_id and position = 1),
    'ATTEMPT_STARTED', 'SYSTEM',
    jsonb_build_object('question_count', v_question_count, 'duration_seconds', v_duration_seconds),
    v_started_at
  );

  perform private.log_linear_exam_event(
    p_attempt_id, 1,
    (select question_id from public.exam_attempt_questions where attempt_id = p_attempt_id and position = 1),
    'QUESTION_OPENED', 'SYSTEM',
    jsonb_build_object('allocated_seconds', (select allocated_seconds from public.exam_attempt_questions where attempt_id = p_attempt_id and position = 1)),
    v_started_at
  );
end;
$$;
      then (v_comp.config->>'duration_minutes')::integer else 60 end
  ));
  v_duration_seconds := v_duration_minutes * 60;
  v_decision_seconds := greatest(1, least(60,
    case when coalesce(v_comp.config->>'linear_exam_decision_seconds','') ~ '^[0-9]+
  v_random_questions := lower(coalesce(v_comp.config->>'linear_exam_randomize_questions','false')) = 'true';
  v_random_options := lower(coalesce(v_comp.config->>'linear_exam_randomize_options','false')) = 'true';

  select count(*) into v_question_count
  from public.questions
  where competition_id = v_attempt.competition_id and status = 'PUBLISHED';

  if v_question_count = 0 then raise exception 'EXAM_HAS_NO_PUBLISHED_QUESTIONS'; end if;
  if v_duration_seconds < v_question_count then raise exception 'EXAM_DURATION_TOO_SHORT'; end if;

  v_base_seconds := v_duration_seconds / v_question_count;
  v_remainder_seconds := v_duration_seconds - (v_base_seconds * v_question_count);
  v_started_at := coalesce(v_attempt.started_at, clock_timestamp());
  v_global_deadline := v_started_at + make_interval(secs => v_duration_seconds + (v_question_count * (v_decision_seconds + v_grace_seconds)));

  update public.attempts
  set started_at = v_started_at, expires_at = v_global_deadline, updated_at = clock_timestamp()
  where id = p_attempt_id;

  insert into public.exam_attempt_runtime (
    attempt_id, current_position, question_count, duration_seconds,
    decision_window_seconds, grace_seconds, time_bank_seconds,
    phase, grace_kind, global_deadline
  )
  values (
    p_attempt_id, 1, v_question_count, v_duration_seconds,
    v_decision_seconds, v_grace_seconds, 0, 'ACTIVE', null, v_global_deadline
  );

  for v_question in
    select q.*
    from public.questions q
    where q.competition_id = v_attempt.competition_id and q.status = 'PUBLISHED'
    order by
      case when v_random_questions then random() else q.display_order::double precision end,
      q.display_order, q.id
  loop
    v_position := v_position + 1;
    v_question_base := v_base_seconds + case when v_position <= v_remainder_seconds then 1 else 0 end;

    select coalesce(
      jsonb_agg(
        jsonb_build_object('id', qo.id::text, 'label', qo.label)
        order by
          case when v_random_options then random() else qo.display_order::double precision end,
          qo.display_order, qo.id
      ),
      '[]'::jsonb
    )
    into v_options
    from public.question_options qo
    where qo.question_id = v_question.id;

    select coalesce(jsonb_agg(qo.id::text order by qo.id), '[]'::jsonb)
    into v_correct_ids
    from public.question_options qo
    where qo.question_id = v_question.id and qo.is_correct = true;

    v_accepted_answers := coalesce(v_question.config->'accepted_answers', '[]'::jsonb);
    if jsonb_typeof(v_accepted_answers) <> 'array' then v_accepted_answers := '[]'::jsonb; end if;

    v_question_snapshot := jsonb_build_object(
      'id', v_question.id::text,
      'type', v_question.type,
      'prompt', v_question.prompt,
      'points', v_question.points,
      'required', v_question.required,
      'display_order', v_position,
      'options', v_options
    );

    v_answer_key := jsonb_build_object(
      'correct_option_ids', v_correct_ids,
      'accepted_answers', v_accepted_answers
    );

    insert into public.exam_attempt_questions (
      attempt_id, position, question_id, question_snapshot, answer_key_snapshot,
      points_snapshot, base_seconds, allocated_seconds, state,
      opened_at, question_deadline
    )
    values (
      p_attempt_id, v_position, v_question.id, v_question_snapshot, v_answer_key,
      greatest(0, v_question.points), v_question_base, v_question_base,
      case when v_position = 1 then 'ACTIVE' else 'LOCKED' end,
      case when v_position = 1 then v_started_at else null end,
      case when v_position = 1 then least(v_started_at + make_interval(secs => v_question_base), v_global_deadline) else null end
    );
  end loop;

  perform private.log_linear_exam_event(
    p_attempt_id, 1,
    (select question_id from public.exam_attempt_questions where attempt_id = p_attempt_id and position = 1),
    'ATTEMPT_STARTED', 'SYSTEM',
    jsonb_build_object('question_count', v_question_count, 'duration_seconds', v_duration_seconds),
    v_started_at
  );

  perform private.log_linear_exam_event(
    p_attempt_id, 1,
    (select question_id from public.exam_attempt_questions where attempt_id = p_attempt_id and position = 1),
    'QUESTION_OPENED', 'SYSTEM',
    jsonb_build_object('allocated_seconds', (select allocated_seconds from public.exam_attempt_questions where attempt_id = p_attempt_id and position = 1)),
    v_started_at
  );
end;
$$;
      then (v_comp.config->>'linear_exam_decision_seconds')::integer else 30 end
  ));
  v_grace_seconds := greatest(1, least(60,
    case when coalesce(v_comp.config->>'linear_exam_grace_seconds','') ~ '^[0-9]+
  v_random_questions := lower(coalesce(v_comp.config->>'linear_exam_randomize_questions','false')) = 'true';
  v_random_options := lower(coalesce(v_comp.config->>'linear_exam_randomize_options','false')) = 'true';

  select count(*) into v_question_count
  from public.questions
  where competition_id = v_attempt.competition_id and status = 'PUBLISHED';

  if v_question_count = 0 then raise exception 'EXAM_HAS_NO_PUBLISHED_QUESTIONS'; end if;
  if v_duration_seconds < v_question_count then raise exception 'EXAM_DURATION_TOO_SHORT'; end if;

  v_base_seconds := v_duration_seconds / v_question_count;
  v_remainder_seconds := v_duration_seconds - (v_base_seconds * v_question_count);
  v_started_at := coalesce(v_attempt.started_at, clock_timestamp());
  v_global_deadline := v_started_at + make_interval(secs => v_duration_seconds + (v_question_count * (v_decision_seconds + v_grace_seconds)));

  update public.attempts
  set started_at = v_started_at, expires_at = v_global_deadline, updated_at = clock_timestamp()
  where id = p_attempt_id;

  insert into public.exam_attempt_runtime (
    attempt_id, current_position, question_count, duration_seconds,
    decision_window_seconds, grace_seconds, time_bank_seconds,
    phase, grace_kind, global_deadline
  )
  values (
    p_attempt_id, 1, v_question_count, v_duration_seconds,
    v_decision_seconds, v_grace_seconds, 0, 'ACTIVE', null, v_global_deadline
  );

  for v_question in
    select q.*
    from public.questions q
    where q.competition_id = v_attempt.competition_id and q.status = 'PUBLISHED'
    order by
      case when v_random_questions then random() else q.display_order::double precision end,
      q.display_order, q.id
  loop
    v_position := v_position + 1;
    v_question_base := v_base_seconds + case when v_position <= v_remainder_seconds then 1 else 0 end;

    select coalesce(
      jsonb_agg(
        jsonb_build_object('id', qo.id::text, 'label', qo.label)
        order by
          case when v_random_options then random() else qo.display_order::double precision end,
          qo.display_order, qo.id
      ),
      '[]'::jsonb
    )
    into v_options
    from public.question_options qo
    where qo.question_id = v_question.id;

    select coalesce(jsonb_agg(qo.id::text order by qo.id), '[]'::jsonb)
    into v_correct_ids
    from public.question_options qo
    where qo.question_id = v_question.id and qo.is_correct = true;

    v_accepted_answers := coalesce(v_question.config->'accepted_answers', '[]'::jsonb);
    if jsonb_typeof(v_accepted_answers) <> 'array' then v_accepted_answers := '[]'::jsonb; end if;

    v_question_snapshot := jsonb_build_object(
      'id', v_question.id::text,
      'type', v_question.type,
      'prompt', v_question.prompt,
      'points', v_question.points,
      'required', v_question.required,
      'display_order', v_position,
      'options', v_options
    );

    v_answer_key := jsonb_build_object(
      'correct_option_ids', v_correct_ids,
      'accepted_answers', v_accepted_answers
    );

    insert into public.exam_attempt_questions (
      attempt_id, position, question_id, question_snapshot, answer_key_snapshot,
      points_snapshot, base_seconds, allocated_seconds, state,
      opened_at, question_deadline
    )
    values (
      p_attempt_id, v_position, v_question.id, v_question_snapshot, v_answer_key,
      greatest(0, v_question.points), v_question_base, v_question_base,
      case when v_position = 1 then 'ACTIVE' else 'LOCKED' end,
      case when v_position = 1 then v_started_at else null end,
      case when v_position = 1 then least(v_started_at + make_interval(secs => v_question_base), v_global_deadline) else null end
    );
  end loop;

  perform private.log_linear_exam_event(
    p_attempt_id, 1,
    (select question_id from public.exam_attempt_questions where attempt_id = p_attempt_id and position = 1),
    'ATTEMPT_STARTED', 'SYSTEM',
    jsonb_build_object('question_count', v_question_count, 'duration_seconds', v_duration_seconds),
    v_started_at
  );

  perform private.log_linear_exam_event(
    p_attempt_id, 1,
    (select question_id from public.exam_attempt_questions where attempt_id = p_attempt_id and position = 1),
    'QUESTION_OPENED', 'SYSTEM',
    jsonb_build_object('allocated_seconds', (select allocated_seconds from public.exam_attempt_questions where attempt_id = p_attempt_id and position = 1)),
    v_started_at
  );
end;
$$;
      then (v_comp.config->>'linear_exam_grace_seconds')::integer else 30 end
  ));
  v_random_questions := lower(coalesce(v_comp.config->>'linear_exam_randomize_questions','false')) = 'true';
  v_random_options := lower(coalesce(v_comp.config->>'linear_exam_randomize_options','false')) = 'true';

  select count(*) into v_question_count
  from public.questions
  where competition_id = v_attempt.competition_id and status = 'PUBLISHED';

  if v_question_count = 0 then raise exception 'EXAM_HAS_NO_PUBLISHED_QUESTIONS'; end if;
  if v_duration_seconds < v_question_count then raise exception 'EXAM_DURATION_TOO_SHORT'; end if;

  v_base_seconds := v_duration_seconds / v_question_count;
  v_remainder_seconds := v_duration_seconds - (v_base_seconds * v_question_count);
  v_started_at := coalesce(v_attempt.started_at, clock_timestamp());
  v_global_deadline := v_started_at + make_interval(secs => v_duration_seconds + (v_question_count * (v_decision_seconds + v_grace_seconds)));

  update public.attempts
  set started_at = v_started_at, expires_at = v_global_deadline, updated_at = clock_timestamp()
  where id = p_attempt_id;

  insert into public.exam_attempt_runtime (
    attempt_id, current_position, question_count, duration_seconds,
    decision_window_seconds, grace_seconds, time_bank_seconds,
    phase, grace_kind, global_deadline
  )
  values (
    p_attempt_id, 1, v_question_count, v_duration_seconds,
    v_decision_seconds, v_grace_seconds, 0, 'ACTIVE', null, v_global_deadline
  );

  for v_question in
    select q.*
    from public.questions q
    where q.competition_id = v_attempt.competition_id and q.status = 'PUBLISHED'
    order by
      case when v_random_questions then random() else q.display_order::double precision end,
      q.display_order, q.id
  loop
    v_position := v_position + 1;
    v_question_base := v_base_seconds + case when v_position <= v_remainder_seconds then 1 else 0 end;

    select coalesce(
      jsonb_agg(
        jsonb_build_object('id', qo.id::text, 'label', qo.label)
        order by
          case when v_random_options then random() else qo.display_order::double precision end,
          qo.display_order, qo.id
      ),
      '[]'::jsonb
    )
    into v_options
    from public.question_options qo
    where qo.question_id = v_question.id;

    select coalesce(jsonb_agg(qo.id::text order by qo.id), '[]'::jsonb)
    into v_correct_ids
    from public.question_options qo
    where qo.question_id = v_question.id and qo.is_correct = true;

    v_accepted_answers := coalesce(v_question.config->'accepted_answers', '[]'::jsonb);
    if jsonb_typeof(v_accepted_answers) <> 'array' then v_accepted_answers := '[]'::jsonb; end if;

    v_question_snapshot := jsonb_build_object(
      'id', v_question.id::text,
      'type', v_question.type,
      'prompt', v_question.prompt,
      'points', v_question.points,
      'required', v_question.required,
      'display_order', v_position,
      'options', v_options
    );

    v_answer_key := jsonb_build_object(
      'correct_option_ids', v_correct_ids,
      'accepted_answers', v_accepted_answers
    );

    insert into public.exam_attempt_questions (
      attempt_id, position, question_id, question_snapshot, answer_key_snapshot,
      points_snapshot, base_seconds, allocated_seconds, state,
      opened_at, question_deadline
    )
    values (
      p_attempt_id, v_position, v_question.id, v_question_snapshot, v_answer_key,
      greatest(0, v_question.points), v_question_base, v_question_base,
      case when v_position = 1 then 'ACTIVE' else 'LOCKED' end,
      case when v_position = 1 then v_started_at else null end,
      case when v_position = 1 then least(v_started_at + make_interval(secs => v_question_base), v_global_deadline) else null end
    );
  end loop;

  perform private.log_linear_exam_event(
    p_attempt_id, 1,
    (select question_id from public.exam_attempt_questions where attempt_id = p_attempt_id and position = 1),
    'ATTEMPT_STARTED', 'SYSTEM',
    jsonb_build_object('question_count', v_question_count, 'duration_seconds', v_duration_seconds),
    v_started_at
  );

  perform private.log_linear_exam_event(
    p_attempt_id, 1,
    (select question_id from public.exam_attempt_questions where attempt_id = p_attempt_id and position = 1),
    'QUESTION_OPENED', 'SYSTEM',
    jsonb_build_object('allocated_seconds', (select allocated_seconds from public.exam_attempt_questions where attempt_id = p_attempt_id and position = 1)),
    v_started_at
  );
end;
$$;

commit;
