begin;

-- Timer semantics:
-- * use the configured total duration when present;
-- * otherwise allocate two minutes per question;
-- * reserve up to 60 seconds per transition for earned speed bonuses.
do $duration_migration$
declare
  v_definition text;
  v_old_duration text := $old_duration$  v_duration_minutes := greatest(1, least(1440,
    case when coalesce(v_comp.config->>'duration_minutes','') ~ '^[0-9]+$'
      then (v_comp.config->>'duration_minutes')::integer else 60 end
  ));
  v_duration_seconds := v_duration_minutes * 60;$old_duration$;
  v_new_duration text := $new_duration$  v_duration_minutes := case
    when coalesce(v_comp.config->>'duration_minutes','') ~ '^[0-9]+$'
      then case when (v_comp.config->>'duration_minutes')::integer > 0
        then greatest(1, least(1440, (v_comp.config->>'duration_minutes')::integer))
        else 0 end
    else 0
  end;$new_duration$;
  v_old_count_check text := $old_count_check$  if v_question_count = 0 then raise exception 'EXAM_HAS_NO_PUBLISHED_QUESTIONS'; end if;
  if v_duration_seconds < v_question_count then raise exception 'EXAM_DURATION_TOO_SHORT'; end if;$old_count_check$;
  v_new_count_check text := $new_count_check$  if v_question_count = 0 then raise exception 'EXAM_HAS_NO_PUBLISHED_QUESTIONS'; end if;
  if v_duration_minutes = 0 then
    v_duration_minutes := greatest(1, least(1440, v_question_count * 2));
  end if;
  v_duration_seconds := v_duration_minutes * 60;
  if v_duration_seconds < v_question_count then raise exception 'EXAM_DURATION_TOO_SHORT'; end if;$new_count_check$;
  v_old_deadline text := $old_deadline$  v_global_deadline := v_started_at + make_interval(secs => v_duration_seconds + (v_question_count * (v_decision_seconds + v_grace_seconds)));$old_deadline$;
  v_new_deadline text := $new_deadline$  v_global_deadline := v_started_at + make_interval(secs => v_duration_seconds + (greatest(0, v_question_count - 1) * 60));$new_deadline$;
begin
  select pg_get_functiondef('private.prepare_linear_exam_runtime(uuid)'::regprocedure)
    into v_definition;

  if position(v_old_duration in v_definition) = 0 then
    raise exception 'LINEAR_EXAM_DURATION_ANCHOR_NOT_FOUND';
  end if;
  v_definition := replace(v_definition, v_old_duration, v_new_duration);

  if position(v_old_count_check in v_definition) = 0 then
    raise exception 'LINEAR_EXAM_COUNT_CHECK_ANCHOR_NOT_FOUND';
  end if;
  v_definition := replace(v_definition, v_old_count_check, v_new_count_check);

  if position(v_old_deadline in v_definition) = 0 then
    raise exception 'LINEAR_EXAM_GLOBAL_DEADLINE_ANCHOR_NOT_FOUND';
  end if;
  v_definition := replace(v_definition, v_old_deadline, v_new_deadline);

  execute v_definition;
end;
$duration_migration$;

create or replace function private.advance_linear_exam_question(
  p_attempt_id uuid,
  p_transition_at timestamptz,
  p_final_state text,
  p_time_bank_seconds integer,
  p_reason text,
  p_actor_kind text default 'SYSTEM'
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_runtime public.exam_attempt_runtime%rowtype;
  v_current public.exam_attempt_questions%rowtype;
  v_next public.exam_attempt_questions%rowtype;
  v_next_position integer;
  v_allocation integer;
  v_bonus_seconds integer := least(60, greatest(0, coalesce(p_time_bank_seconds, 0)));
begin
  select * into v_runtime
  from public.exam_attempt_runtime
  where attempt_id = p_attempt_id
  for update;
  if not found or v_runtime.phase = 'COMPLETED' then return; end if;

  select * into v_current
  from public.exam_attempt_questions
  where attempt_id = p_attempt_id and position = v_runtime.current_position
  for update;
  if not found then raise exception 'EXAM_CURRENT_QUESTION_NOT_FOUND'; end if;

  update public.exam_attempt_questions
  set state = p_final_state,
      closed_at = p_transition_at,
      elapsed_seconds = greatest(0, floor(extract(epoch from (p_transition_at - opened_at)))::integer),
      transition_reason = p_reason
  where attempt_id = p_attempt_id and position = v_current.position;

  v_next_position := v_current.position + 1;

  if v_next_position > v_runtime.question_count then
    update public.exam_attempt_runtime
      set current_position = v_runtime.question_count,
          time_bank_seconds = 0,
          phase = 'COMPLETED',
          grace_kind = null,
          updated_at = clock_timestamp()
    where attempt_id = p_attempt_id;

    perform private.complete_linear_exam_attempt(p_attempt_id, p_transition_at);
    return;
  end if;

  select * into v_next
  from public.exam_attempt_questions
  where attempt_id = p_attempt_id and position = v_next_position
  for update;
  if not found then raise exception 'EXAM_NEXT_QUESTION_NOT_FOUND'; end if;

  -- Replace, never accumulate: a question can receive at most one 60-second bonus.
  update public.exam_attempt_questions
  set time_credit_seconds = v_bonus_seconds,
      borrowed_from_previous_seconds = 0
  where attempt_id = p_attempt_id and position = v_next_position
  returning * into v_next;

  v_allocation := greatest(1, v_next.base_seconds + least(60, v_next.time_credit_seconds));
  update public.exam_attempt_questions
  set state = 'ACTIVE',
      allocated_seconds = v_allocation,
      opened_at = p_transition_at,
      question_deadline = least(
        p_transition_at + make_interval(secs => v_allocation),
        v_runtime.global_deadline
      ),
      decision_deadline = null,
      grace_deadline = null,
      closed_at = null,
      elapsed_seconds = null,
      transition_reason = null
  where attempt_id = p_attempt_id and position = v_next_position;

  update public.exam_attempt_runtime
  set current_position = v_next_position,
      time_bank_seconds = 0,
      phase = 'ACTIVE',
      grace_kind = null,
      updated_at = clock_timestamp()
  where attempt_id = p_attempt_id;

  perform private.log_linear_exam_event(
    p_attempt_id, v_next_position, v_next.question_id, 'QUESTION_OPENED',
    p_actor_kind,
    jsonb_build_object(
      'allocated_seconds', v_allocation,
      'speed_bonus_seconds', least(60, v_next.time_credit_seconds),
      'borrowed_from_previous_seconds', 0
    ),
    p_transition_at
  );
end;
$function$;

-- Old DECISION/GRACE attempts are reconciled on their next RPC call. Timeout
-- now means SKIPPED immediately; no free grace, borrowed time, or user decision.
create or replace function private.resolve_linear_exam_timeouts(
  p_attempt_id uuid,
  p_server_now timestamptz default clock_timestamp()
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_runtime public.exam_attempt_runtime%rowtype;
  v_question public.exam_attempt_questions%rowtype;
  v_iteration integer;
  v_transition_at timestamptz;
  v_effective_now timestamptz;
begin
  for v_iteration in 1..200 loop
    select * into v_runtime
    from public.exam_attempt_runtime
    where attempt_id = p_attempt_id
    for update;

    if not found or v_runtime.phase = 'COMPLETED' then return; end if;

    select * into v_question
    from public.exam_attempt_questions
    where attempt_id = p_attempt_id
      and position = v_runtime.current_position
    for update;

    if not found then raise exception 'EXAM_CURRENT_QUESTION_NOT_FOUND'; end if;
    v_effective_now := greatest(coalesce(p_server_now, clock_timestamp()), clock_timestamp());

    if v_runtime.phase = 'ACTIVE'
       and v_question.question_deadline is not null
       and v_effective_now < v_question.question_deadline then
      return;
    end if;

    if v_runtime.phase not in ('ACTIVE', 'DECISION', 'GRACE') then
      return;
    end if;

    if v_runtime.phase = 'ACTIVE' then
      v_transition_at := coalesce(v_question.question_deadline, v_effective_now);
    else
      -- Legacy timed-out questions advance from their original deadline so any
      -- subsequent expired questions are also reconciled without adding time.
      v_transition_at := coalesce(
        v_question.question_deadline,
        v_question.decision_deadline,
        v_question.grace_deadline,
        v_effective_now
      );
    end if;

    delete from public.answers
    where attempt_id = p_attempt_id
      and question_id = v_question.question_id;

    perform private.log_linear_exam_event(
      p_attempt_id, v_question.position, v_question.question_id,
      'QUESTION_TIMEOUT', 'SYSTEM',
      jsonb_build_object('reason', 'TIME_LIMIT'),
      v_transition_at
    );
    perform private.log_linear_exam_event(
      p_attempt_id, v_question.position, v_question.question_id,
      'QUESTION_SKIPPED', 'SYSTEM',
      jsonb_build_object('reason', 'TIME_LIMIT'),
      v_transition_at
    );

    perform private.advance_linear_exam_question(
      p_attempt_id, v_transition_at, 'SKIPPED', 0, 'TIMEOUT', 'SYSTEM'
    );
  end loop;
end;
$function$;

create or replace function public.answer_linear_exam_question(
  p_attempt_id uuid,
  p_question_id uuid,
  p_answer_json jsonb,
  p_skip boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_runtime public.exam_attempt_runtime%rowtype;
  v_attempt public.attempts%rowtype;
  v_question public.exam_attempt_questions%rowtype;
  v_now timestamptz := clock_timestamp();
  v_payload_present boolean;
  v_time_bank integer := 0;
  v_final_state text;
begin
  perform private.assert_individual_linear_exam_access(p_attempt_id);
  perform private.resolve_linear_exam_timeouts(p_attempt_id, v_now);

  select * into v_attempt from public.attempts where id = p_attempt_id for update;
  select * into v_runtime from public.exam_attempt_runtime where attempt_id = p_attempt_id for update;
  if v_runtime.phase = 'COMPLETED' or v_attempt.status <> 'IN_PROGRESS' then
    return private.build_linear_exam_state(p_attempt_id);
  end if;
  if v_runtime.phase <> 'ACTIVE' then
    return private.build_linear_exam_state(p_attempt_id);
  end if;

  select * into v_question
  from public.exam_attempt_questions
  where attempt_id = p_attempt_id and position = v_runtime.current_position
  for update;

  v_now := clock_timestamp();
  if v_question.question_id is distinct from p_question_id then
    raise exception 'EXAM_QUESTION_CHANGED';
  end if;
  if v_question.question_deadline is null or v_now >= v_question.question_deadline then
    perform private.resolve_linear_exam_timeouts(p_attempt_id, v_now);
    return private.build_linear_exam_state(p_attempt_id);
  end if;

  if jsonb_typeof(coalesce(p_answer_json, '{}'::jsonb)) <> 'object'
     or pg_column_size(coalesce(p_answer_json, '{}'::jsonb)) > 50000 then
    raise exception 'INVALID_ANSWER_PAYLOAD';
  end if;

  v_payload_present :=
    nullif(btrim(coalesce(p_answer_json->>'value','')), '') is not null
    or (jsonb_typeof(p_answer_json->'values') = 'array' and jsonb_array_length(p_answer_json->'values') > 0)
    or nullif(btrim(coalesce(p_answer_json->>'url','')), '') is not null
    or nullif(btrim(coalesce(p_answer_json->>'text','')), '') is not null;

  if p_skip or not v_payload_present then
    delete from public.answers
    where attempt_id = p_attempt_id and question_id = v_question.question_id;
    v_final_state := 'SKIPPED';
    perform private.log_linear_exam_event(
      p_attempt_id, v_question.position, v_question.question_id,
      'QUESTION_SKIPPED', 'PARTICIPANT',
      jsonb_build_object('reason', case when p_skip then 'PARTICIPANT_SKIP' else 'EMPTY_ANSWER' end),
      v_now
    );
  else
    insert into public.answers(attempt_id, question_id, answer_json, saved_at, updated_at)
    values (p_attempt_id, v_question.question_id, p_answer_json, v_now, v_now)
    on conflict (attempt_id, question_id)
    do update set answer_json = excluded.answer_json,
                  saved_at = excluded.saved_at,
                  updated_at = excluded.updated_at;

    v_final_state := 'ANSWERED';
    -- Eligible for one 60-second bonus only when at least half of the
    -- actual allocated interval remains. Wrong answers still qualify.
    if v_runtime.current_position < v_runtime.question_count
       and extract(epoch from (v_question.question_deadline - v_now)) * 2
           >= extract(epoch from (v_question.question_deadline - v_question.opened_at)) then
      v_time_bank := 60;
    else
      v_time_bank := 0;
    end if;

    perform private.log_linear_exam_event(
      p_attempt_id, v_question.position, v_question.question_id,
      'QUESTION_ANSWERED', 'PARTICIPANT',
      jsonb_build_object(
        'phase', 'ACTIVE',
        'speed_bonus_awarded', v_time_bank > 0,
        'speed_bonus_seconds', v_time_bank
      ),
      v_now
    );
  end if;

  perform private.advance_linear_exam_question(
    p_attempt_id, v_now, v_final_state, v_time_bank,
    case when v_final_state = 'SKIPPED' then 'PARTICIPANT_SKIP' else 'ANSWERED' end,
    'PARTICIPANT'
  );
  perform private.resolve_linear_exam_timeouts(p_attempt_id, clock_timestamp());
  return private.build_linear_exam_state(p_attempt_id);
end;
$function$;

create or replace function public.answer_collective_linear_exam_question(
  p_attempt_id uuid,
  p_access_token text,
  p_question_id uuid,
  p_answer_json jsonb,
  p_skip boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_runtime public.exam_attempt_runtime%rowtype;
  v_attempt public.attempts%rowtype;
  v_question public.exam_attempt_questions%rowtype;
  v_now timestamptz := clock_timestamp();
  v_payload_present boolean;
  v_time_bank integer := 0;
  v_final_state text;
begin
  perform private.assert_collective_linear_exam_access(p_attempt_id, p_access_token);
  perform private.resolve_linear_exam_timeouts(p_attempt_id, v_now);

  select * into v_attempt from public.attempts where id = p_attempt_id for update;
  select * into v_runtime from public.exam_attempt_runtime where attempt_id = p_attempt_id for update;
  if v_runtime.phase = 'COMPLETED' or v_attempt.status <> 'IN_PROGRESS' then
    return private.build_linear_exam_state(p_attempt_id);
  end if;
  if v_runtime.phase <> 'ACTIVE' then
    return private.build_linear_exam_state(p_attempt_id);
  end if;

  select * into v_question
  from public.exam_attempt_questions
  where attempt_id = p_attempt_id and position = v_runtime.current_position
  for update;

  v_now := clock_timestamp();
  if v_question.question_id is distinct from p_question_id then
    raise exception 'EXAM_QUESTION_CHANGED';
  end if;
  if v_question.question_deadline is null or v_now >= v_question.question_deadline then
    perform private.resolve_linear_exam_timeouts(p_attempt_id, v_now);
    return private.build_linear_exam_state(p_attempt_id);
  end if;

  if jsonb_typeof(coalesce(p_answer_json, '{}'::jsonb)) <> 'object'
     or pg_column_size(coalesce(p_answer_json, '{}'::jsonb)) > 50000 then
    raise exception 'INVALID_ANSWER_PAYLOAD';
  end if;

  v_payload_present :=
    nullif(btrim(coalesce(p_answer_json->>'value','')), '') is not null
    or (jsonb_typeof(p_answer_json->'values') = 'array' and jsonb_array_length(p_answer_json->'values') > 0)
    or nullif(btrim(coalesce(p_answer_json->>'url','')), '') is not null
    or nullif(btrim(coalesce(p_answer_json->>'text','')), '') is not null;

  if p_skip or not v_payload_present then
    delete from public.answers
    where attempt_id = p_attempt_id and question_id = v_question.question_id;
    v_final_state := 'SKIPPED';
    perform private.log_linear_exam_event(
      p_attempt_id, v_question.position, v_question.question_id,
      'QUESTION_SKIPPED', 'PARTICIPANT',
      jsonb_build_object('reason', case when p_skip then 'PARTICIPANT_SKIP' else 'EMPTY_ANSWER' end),
      v_now
    );
  else
    insert into public.answers(attempt_id, question_id, answer_json, saved_at, updated_at)
    values (p_attempt_id, v_question.question_id, p_answer_json, v_now, v_now)
    on conflict (attempt_id, question_id)
    do update set answer_json = excluded.answer_json,
                  saved_at = excluded.saved_at,
                  updated_at = excluded.updated_at;

    v_final_state := 'ANSWERED';
    if v_runtime.current_position < v_runtime.question_count
       and extract(epoch from (v_question.question_deadline - v_now)) * 2
           >= extract(epoch from (v_question.question_deadline - v_question.opened_at)) then
      v_time_bank := 60;
    else
      v_time_bank := 0;
    end if;

    perform private.log_linear_exam_event(
      p_attempt_id, v_question.position, v_question.question_id,
      'QUESTION_ANSWERED', 'PARTICIPANT',
      jsonb_build_object(
        'phase', 'ACTIVE',
        'speed_bonus_awarded', v_time_bank > 0,
        'speed_bonus_seconds', v_time_bank
      ),
      v_now
    );
  end if;

  perform private.advance_linear_exam_question(
    p_attempt_id, v_now, v_final_state, v_time_bank,
    case when v_final_state = 'SKIPPED' then 'PARTICIPANT_SKIP' else 'ANSWERED' end,
    'PARTICIPANT'
  );
  perform private.resolve_linear_exam_timeouts(p_attempt_id, clock_timestamp());

  update public.collective_access_sessions
  set last_seen_at = clock_timestamp()
  where token_hash = private.hash_collective_token(p_access_token)
    and revoked_at is null;

  return private.build_linear_exam_state(p_attempt_id);
end;
$function$;

commit;
