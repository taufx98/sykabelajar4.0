begin;

-- Server-side evaluator for organizer simulations. Raw option IDs are never used
-- as display labels, and correctness is calculated from the immutable attempt snapshot.
create or replace function private.evaluate_linear_preview_answer(
  p_state text,
  p_transition_reason text,
  p_question jsonb,
  p_answer_key jsonb,
  p_answer jsonb
)
returns jsonb
language plpgsql
immutable
security invoker
set search_path = ''
as $function$
declare
  v_type text := lower(replace(coalesce(p_question->>'type',''), '-', '_'));
  v_value text := nullif(btrim(coalesce(p_answer->>'value', p_answer->>'text', p_answer->>'url', '')), '');
  v_has_answer boolean := false;
  v_is_correct boolean := null;
  v_answer_text text := 'Tidak dijawab';
  v_result_status text := 'UNANSWERED';
  v_values text[] := array[]::text[];
  v_correct_values text[] := array[]::text[];
  v_label text;
begin
  if p_state = 'TIMEOUT' or p_transition_reason = 'TIMEOUT' then
    return jsonb_build_object('has_answer', false, 'is_correct', null, 'result_status', 'TIMEOUT', 'answer_text', 'Tidak dijawab');
  end if;
  if p_state = 'SKIPPED' or p_transition_reason = 'PARTICIPANT_SKIP' then
    return jsonb_build_object('has_answer', false, 'is_correct', null, 'result_status', 'SKIPPED', 'answer_text', 'Tidak dijawab');
  end if;

  v_has_answer :=
    v_value is not null
    or (jsonb_typeof(coalesce(p_answer->'values', '[]'::jsonb)) = 'array'
        and jsonb_array_length(coalesce(p_answer->'values', '[]'::jsonb)) > 0);

  if p_state <> 'ANSWERED' or not v_has_answer then
    return jsonb_build_object('has_answer', false, 'is_correct', null, 'result_status', 'UNANSWERED', 'answer_text', 'Tidak dijawab');
  end if;

  if v_type in ('multiple_choice', 'single_choice', 'true_false') then
    select opt->>'label'
      into v_label
    from jsonb_array_elements(coalesce(p_question->'options', '[]'::jsonb)) opt
    where opt->>'id' = v_value
    limit 1;
    if v_label is not null then
      v_answer_text := v_label;
    elsif v_value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      v_answer_text := 'Pilihan tidak ditemukan';
    else
      v_answer_text := coalesce(v_value, 'Tidak dijawab');
    end if;

    select exists (
      select 1
      from jsonb_array_elements_text(coalesce(p_answer_key->'correct_option_ids', '[]'::jsonb)) correct(value)
      where correct.value = v_value
    ) into v_is_correct;
  elsif v_type in ('multiple_checkbox', 'multiple_select') then
    select coalesce(array_agg(item.value order by item.value), array[]::text[])
      into v_values
    from jsonb_array_elements_text(coalesce(p_answer->'values', '[]'::jsonb)) item(value);
    select coalesce(array_agg(item.value order by item.value), array[]::text[])
      into v_correct_values
    from jsonb_array_elements_text(coalesce(p_answer_key->'correct_option_ids', '[]'::jsonb)) item(value);
    select string_agg(
      coalesce((
        select opt->>'label'
        from jsonb_array_elements(coalesce(p_question->'options', '[]'::jsonb)) opt
        where opt->>'id' = selected.value
        limit 1
      ), 'Pilihan tidak ditemukan'),
      ' · ' order by selected.ordinality
    )
    into v_answer_text
    from jsonb_array_elements_text(coalesce(p_answer->'values', '[]'::jsonb)) with ordinality selected(value, ordinality);
    v_answer_text := coalesce(v_answer_text, 'Tidak dijawab');
    v_is_correct := v_values = v_correct_values;
  elsif v_type in ('short_answer', 'numeric', 'short_text') then
    v_answer_text := coalesce(v_value, 'Tidak dijawab');
    select exists (
      select 1
      from jsonb_array_elements_text(coalesce(p_answer_key->'accepted_answers', '[]'::jsonb)) accepted(value)
      where lower(btrim(accepted.value)) = lower(btrim(v_value))
    ) into v_is_correct;
  elsif v_type = 'file_upload' then
    v_answer_text := coalesce(nullif(btrim(p_answer->>'file_name'), ''), 'Berkas terlampir');
    v_result_status := 'MANUAL_REVIEW';
  elsif v_type in ('essay', 'long_answer') then
    v_answer_text := coalesce(v_value, 'Tidak dijawab');
    v_result_status := 'MANUAL_REVIEW';
  else
    v_answer_text := coalesce(v_value, 'Tidak dijawab');
    v_result_status := 'MANUAL_REVIEW';
  end if;

  if v_result_status <> 'MANUAL_REVIEW' then
    v_result_status := case when coalesce(v_is_correct, false) then 'CORRECT' else 'INCORRECT' end;
  end if;

  return jsonb_build_object(
    'has_answer', true,
    'is_correct', v_is_correct,
    'result_status', v_result_status,
    'answer_text', v_answer_text
  );
end;
$function$;

revoke all on function private.evaluate_linear_preview_answer(text,text,jsonb,jsonb,jsonb) from public, anon, authenticated;

-- Collective enrollment is now checked against the set of enabled registration modes,
-- while retaining compatibility with competitions saved before multi-mode support.
create or replace function private.competition_allows_collective(p_participant_mode text, p_config jsonb)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $function$
  select
    coalesce(p_participant_mode, '') in ('COLLECTIVE_TEACHER', 'COLLECTIVE_ORGANIZATION')
    or exists (
      select 1
      from jsonb_array_elements_text(coalesce(p_config->'participant_modes', '[]'::jsonb)) mode(value)
      where mode.value in ('COLLECTIVE_TEACHER', 'COLLECTIVE_ORGANIZATION')
    );
$function$;

revoke all on function private.competition_allows_collective(text,jsonb) from public, anon, authenticated;

-- Every click of "Simulasi" creates a fresh temporary attempt. An unfinished run
-- is not reused, so its drafts/answers can never bleed into the next trial.
create or replace function public.start_organizer_exam_preview(p_competition_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
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
$function$;

revoke all on function public.start_organizer_exam_preview(uuid) from public, anon;
grant execute on function public.start_organizer_exam_preview(uuid) to authenticated;

-- Update the report RPC from the installed version by replacing only stable,
-- verified SQL fragments; this keeps its existing authorization/manual-review rules.
do $report_migration$
declare
  v_definition text;
  v_old_counts text := $old_counts$
  select
    count(*) filter (where q.state = 'ANSWERED'),
    count(*) filter (where q.state = 'SKIPPED'),
    count(*) filter (where q.state = 'TIMEOUT'),
    coalesce(sum(q.points_snapshot), 0)
  into v_answered, v_skipped, v_timeout, v_max_score
  from public.exam_attempt_questions q
  where q.attempt_id = p_attempt_id;$old_counts$;
  v_new_counts text := $new_counts$
  select
    count(*) filter (
      where q.state = 'ANSWERED'
        and coalesce((private.evaluate_linear_preview_answer(q.state, q.transition_reason, q.question_snapshot, q.answer_key_snapshot, a.answer_json)->>'has_answer')::boolean, false)
    ),
    count(*) filter (
      where (q.state = 'SKIPPED' and coalesce(q.transition_reason, '') <> 'TIMEOUT')
         or (q.state = 'ANSWERED'
             and not coalesce((private.evaluate_linear_preview_answer(q.state, q.transition_reason, q.question_snapshot, q.answer_key_snapshot, a.answer_json)->>'has_answer')::boolean, false))
    ),
    count(*) filter (where q.state = 'TIMEOUT' or q.transition_reason = 'TIMEOUT'),
    coalesce(sum(q.points_snapshot), 0)
  into v_answered, v_skipped, v_timeout, v_max_score
  from public.exam_attempt_questions q
  left join public.answers a
    on a.attempt_id = q.attempt_id and a.question_id = q.question_id
  where q.attempt_id = p_attempt_id;$new_counts$;
  v_old_manual_from text := $old_manual_from$
  from public.exam_attempt_questions q
  where q.attempt_id = p_attempt_id
    and q.state = 'ANSWERED'
    and ($old_manual_from$;
  v_new_manual_from text := $new_manual_from$
  from public.exam_attempt_questions q
  left join public.answers a
    on a.attempt_id = q.attempt_id and a.question_id = q.question_id
  where q.attempt_id = p_attempt_id
    and q.state = 'ANSWERED'
    and coalesce((private.evaluate_linear_preview_answer(q.state, q.transition_reason, q.question_snapshot, q.answer_key_snapshot, a.answer_json)->>'has_answer')::boolean, false)
    and ($new_manual_from$;
  v_old_answer_line text := $old_answer_line$    'answer', coalesce(a.answer_json, '{}'::jsonb),$old_answer_line$;
  v_new_answer_line text := $new_answer_line$    'answer', coalesce(a.answer_json, '{}'::jsonb),
    'evaluation', private.evaluate_linear_preview_answer(q.state, q.transition_reason, q.question_snapshot, q.answer_key_snapshot, a.answer_json),$new_answer_line$;
begin
  select pg_get_functiondef('public.get_organizer_exam_preview_report(uuid)'::regprocedure)
    into v_definition;

  if position(v_old_counts in v_definition) = 0 then raise exception 'PREVIEW_REPORT_COUNT_ANCHOR_NOT_FOUND'; end if;
  v_definition := replace(v_definition, v_old_counts, v_new_counts);

  if position(v_old_manual_from in v_definition) = 0 then raise exception 'PREVIEW_REPORT_MANUAL_ANCHOR_NOT_FOUND'; end if;
  v_definition := replace(v_definition, v_old_manual_from, v_new_manual_from);

  if position(v_old_answer_line in v_definition) = 0 then raise exception 'PREVIEW_REPORT_ANSWER_ANCHOR_NOT_FOUND'; end if;
  v_definition := replace(v_definition, v_old_answer_line, v_new_answer_line);

  execute v_definition;
end;
$report_migration$;

-- Make legacy collective setup paths honor the multi-select mode array.
do $mode_migration$
declare
  v_definition text;
  v_old_select text := $old_select$  select c.id, c.participant_mode into v_competition from public.competitions c where c.id = p_competition_id;$old_select$;
  v_new_select text := $new_select$  select c.id, c.participant_mode, c.config into v_competition from public.competitions c where c.id = p_competition_id;$new_select$;
  v_old_guard text := $old_guard$if v_competition.participant_mode not in ('COLLECTIVE_TEACHER','COLLECTIVE_ORGANIZATION') then raise exception 'COMPETITION_NOT_COLLECTIVE'; end if;$old_guard$;
  v_new_guard text := $new_guard$if not private.competition_allows_collective(v_competition.participant_mode, v_competition.config) then raise exception 'COMPETITION_NOT_COLLECTIVE'; end if;$new_guard$;
  v_old_row_guard text := $old_row_guard$if v_comp.participant_mode not in ('COLLECTIVE_TEACHER','COLLECTIVE_ORGANIZATION') then raise exception 'COMPETITION_NOT_COLLECTIVE'; end if;$old_row_guard$;
  v_new_row_guard text := $new_row_guard$if not private.competition_allows_collective(v_comp.participant_mode, v_comp.config) then raise exception 'COMPETITION_NOT_COLLECTIVE'; end if;$new_row_guard$;
begin
  select pg_get_functiondef('public.create_collective_participants(uuid,uuid[])'::regprocedure) into v_definition;
  if position(v_old_select in v_definition) = 0 then raise exception 'COLLECTIVE_PARTICIPANT_SELECT_ANCHOR_NOT_FOUND'; end if;
  v_definition := replace(v_definition, v_old_select, v_new_select);
  if position(v_old_guard in v_definition) = 0 then raise exception 'COLLECTIVE_PARTICIPANT_GUARD_ANCHOR_NOT_FOUND'; end if;
  v_definition := replace(v_definition, v_old_guard, v_new_guard);
  execute v_definition;

  select pg_get_functiondef('public.get_collective_registration_options(uuid)'::regprocedure) into v_definition;
  if position(v_old_row_guard in v_definition) = 0 then raise exception 'COLLECTIVE_OPTIONS_GUARD_ANCHOR_NOT_FOUND'; end if;
  v_definition := replace(v_definition, v_old_row_guard, v_new_row_guard);
  execute v_definition;

  select pg_get_functiondef('public.quote_collective_registration(uuid,uuid[],text)'::regprocedure) into v_definition;
  if position(v_old_row_guard in v_definition) = 0 then raise exception 'COLLECTIVE_QUOTE_GUARD_ANCHOR_NOT_FOUND'; end if;
  v_definition := replace(v_definition, v_old_row_guard, v_new_row_guard);
  execute v_definition;
end;
$mode_migration$;

commit;
