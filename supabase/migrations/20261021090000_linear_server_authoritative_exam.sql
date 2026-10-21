begin;

-- Linear Exam Engine v1: private per-attempt question snapshots and server-owned clocks.
create table if not exists public.exam_attempt_runtime (
  attempt_id uuid primary key references public.attempts(id) on delete cascade,
  current_position integer not null check (current_position >= 1),
  question_count integer not null check (question_count >= 1),
  duration_seconds integer not null check (duration_seconds >= 1),
  decision_window_seconds integer not null default 30 check (decision_window_seconds between 1 and 60),
  grace_seconds integer not null default 30 check (grace_seconds between 1 and 60),
  time_bank_seconds integer not null default 0 check (time_bank_seconds >= 0),
  phase text not null default 'ACTIVE' check (phase in ('ACTIVE','DECISION','GRACE','COMPLETED')),
  grace_kind text check (grace_kind is null or grace_kind in ('BORROWED','FREE')),
  global_deadline timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create table if not exists public.exam_attempt_questions (
  attempt_id uuid not null references public.attempts(id) on delete cascade,
  position integer not null check (position >= 1),
  question_id uuid not null,
  question_snapshot jsonb not null,
  answer_key_snapshot jsonb not null default '{}'::jsonb,
  points_snapshot numeric not null default 0 check (points_snapshot >= 0),
  base_seconds integer not null check (base_seconds >= 1),
  allocated_seconds integer not null default 0 check (allocated_seconds >= 0),
  borrowed_from_previous_seconds integer not null default 0 check (borrowed_from_previous_seconds >= 0),
  time_credit_seconds integer not null default 0 check (time_credit_seconds >= 0),
  state text not null default 'LOCKED' check (state in ('LOCKED','ACTIVE','TIMEOUT','ANSWERED','SKIPPED')),
  opened_at timestamptz,
  question_deadline timestamptz,
  decision_deadline timestamptz,
  grace_deadline timestamptz,
  closed_at timestamptz,
  elapsed_seconds integer,
  transition_reason text,
  primary key (attempt_id, position),
  unique (attempt_id, question_id)
);

create table if not exists public.exam_attempt_events (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.attempts(id) on delete cascade,
  question_position integer,
  question_id uuid,
  event_type text not null,
  actor_kind text not null default 'SYSTEM' check (actor_kind in ('PARTICIPANT','SYSTEM','ORGANIZER','ADMIN')),
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default clock_timestamp(),
  recorded_at timestamptz not null default clock_timestamp()
);

create index if not exists exam_attempt_events_attempt_occurred_idx
  on public.exam_attempt_events (attempt_id, occurred_at desc);
create index if not exists exam_attempt_questions_attempt_state_idx
  on public.exam_attempt_questions (attempt_id, state, position);

alter table public.exam_attempt_runtime enable row level security;
alter table public.exam_attempt_questions enable row level security;
alter table public.exam_attempt_events enable row level security;
revoke all on table public.exam_attempt_runtime, public.exam_attempt_questions, public.exam_attempt_events from anon, authenticated;

-- Do not allow a participant to bypass the server state machine using PostgREST.
drop policy if exists answer_self_insert on public.answers;
drop policy if exists answer_self_update on public.answers;
drop policy if exists answers_organizer_read on public.answers;
create policy answers_organizer_read on public.answers
for select to authenticated
using (
  exists (
    select 1
    from public.attempts a
    join public.competitions c on c.id = a.competition_id
    where a.id = answers.attempt_id
      and (
        private.current_user_is_admin()
        or (c.organizer_id is not null and private.current_user_is_organizer_for(c.organizer_id))
      )
  )
);

-- A participant may only inspect their own in-progress attempt row. The score is
-- never exposed through direct table reads after submission; organizer/admin reads stay intact.
drop policy if exists attempts_admin_or_owner_read on public.attempts;
create policy attempts_admin_or_owner_read on public.attempts
for select to authenticated
using (
  (participant_id = (select auth.uid()) and status in ('NOT_STARTED','IN_PROGRESS'))
  or private.current_user_is_admin()
  or exists (
    select 1 from public.competitions c
    where c.id = attempts.competition_id
      and c.organizer_id is not null
      and private.current_user_is_organizer_for(c.organizer_id)
  )
);

-- Participants must use the one-question RPC, never a raw SELECT of the full question bank.
drop policy if exists questions_select on public.questions;
create policy questions_select on public.questions
for select to authenticated
using (
  private.current_user_is_admin()
  or exists (
    select 1 from public.question_banks qb
    where qb.id = questions.question_bank_id
      and qb.organizer_id is not null
      and private.current_user_is_organizer_for(qb.organizer_id)
  )
  or exists (
    select 1 from public.competitions c
    where c.id = questions.competition_id
      and c.organizer_id is not null
      and private.current_user_is_organizer_for(c.organizer_id)
  )
);

create or replace function private.prevent_question_mutation_during_exam()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_question_id uuid;
begin
  if tg_op = 'DELETE' then
    v_question_id := old.id;
  else
    v_question_id := new.id;
  end if;

  if exists (
    select 1
    from public.exam_attempt_questions eq
    join public.attempts a on a.id = eq.attempt_id
    where eq.question_id = v_question_id
      and a.status in ('IN_PROGRESS','SUBMITTED','GRADING')
  ) then
    raise exception 'QUESTION_LOCKED_BY_ACTIVE_EXAM';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function private.prevent_option_mutation_during_exam()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_question_id uuid;
begin
  if tg_op = 'DELETE' then
    v_question_id := old.question_id;
  else
    v_question_id := new.question_id;
  end if;

  if exists (
    select 1
    from public.exam_attempt_questions eq
    join public.attempts a on a.id = eq.attempt_id
    where eq.question_id = v_question_id
      and a.status in ('IN_PROGRESS','SUBMITTED','GRADING')
  ) then
    raise exception 'QUESTION_LOCKED_BY_ACTIVE_EXAM';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists protect_question_during_linear_exam on public.questions;
create trigger protect_question_during_linear_exam
before update or delete on public.questions
for each row execute function private.prevent_question_mutation_during_exam();

drop trigger if exists protect_question_options_during_linear_exam on public.question_options;
create trigger protect_question_options_during_linear_exam
before insert or update or delete on public.question_options
for each row execute function private.prevent_option_mutation_during_exam();

revoke all on function private.prevent_question_mutation_during_exam() from public, anon, authenticated;
revoke all on function private.prevent_option_mutation_during_exam() from public, anon, authenticated;

create or replace function private.log_linear_exam_event(
  p_attempt_id uuid,
  p_position integer,
  p_question_id uuid,
  p_event_type text,
  p_actor_kind text default 'SYSTEM',
  p_metadata jsonb default '{}'::jsonb,
  p_occurred_at timestamptz default clock_timestamp()
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.exam_attempt_events (
    attempt_id, question_position, question_id, event_type, actor_kind, metadata, occurred_at
  )
  values (
    p_attempt_id, p_position, p_question_id, p_event_type,
    coalesce(p_actor_kind, 'SYSTEM'), coalesce(p_metadata, '{}'::jsonb), coalesce(p_occurred_at, clock_timestamp())
  );
$$;

create or replace function private.build_linear_exam_state(p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.attempts%rowtype;
  v_runtime public.exam_attempt_runtime%rowtype;
  v_question public.exam_attempt_questions%rowtype;
  v_answer jsonb := '{}'::jsonb;
  v_answered integer := 0;
  v_skipped integer := 0;
  v_timed_out integer := 0;
  v_now timestamptz := clock_timestamp();
begin
  select * into v_attempt from public.attempts where id = p_attempt_id;
  if not found then raise exception 'ATTEMPT_NOT_FOUND'; end if;

  select * into v_runtime from public.exam_attempt_runtime where attempt_id = p_attempt_id;
  if not found then raise exception 'EXAM_RUNTIME_NOT_FOUND'; end if;

  select count(*) filter (where state = 'ANSWERED'),
         count(*) filter (where state = 'SKIPPED')
    into v_answered, v_skipped
    from public.exam_attempt_questions
   where attempt_id = p_attempt_id;

  select count(*) into v_timed_out
  from public.exam_attempt_events
  where attempt_id = p_attempt_id and event_type = 'QUESTION_TIMEOUT';

  if v_runtime.phase = 'COMPLETED' then
    return jsonb_build_object(
      'attempt_id', v_attempt.id,
      'attempt_status', v_attempt.status,
      'phase', 'COMPLETED',
      'position', v_runtime.question_count,
      'total_questions', v_runtime.question_count,
      'answered_count', v_answered,
      'skipped_count', v_skipped,
      'timeout_count', v_timed_out,
      'server_now', v_now,
      'message', 'Jawaban telah diterima dan menunggu pengumuman resmi.'
    );
  end if;

  select * into v_question
  from public.exam_attempt_questions
  where attempt_id = p_attempt_id and position = v_runtime.current_position;

  if not found then raise exception 'EXAM_CURRENT_QUESTION_NOT_FOUND'; end if;

  select a.answer_json into v_answer
  from public.answers a
  where a.attempt_id = p_attempt_id and a.question_id = v_question.question_id;

  return jsonb_build_object(
    'attempt_id', v_attempt.id,
    'attempt_status', v_attempt.status,
    'phase', v_runtime.phase,
    'position', v_runtime.current_position,
    'total_questions', v_runtime.question_count,
    'question', v_question.question_snapshot,
    'question_state', v_question.state,
    'question_deadline', v_question.question_deadline,
    'decision_deadline', v_question.decision_deadline,
    'grace_deadline', v_question.grace_deadline,
    'grace_kind', v_runtime.grace_kind,
    'can_borrow', case when v_runtime.current_position < v_runtime.question_count then exists (
      select 1 from public.exam_attempt_questions next_q
      where next_q.attempt_id = p_attempt_id and next_q.position = v_runtime.current_position + 1
        and next_q.base_seconds + next_q.time_credit_seconds - next_q.borrowed_from_previous_seconds >= 60
    ) else false end,
    'time_bank_seconds', v_runtime.time_bank_seconds,
    'global_deadline', v_runtime.global_deadline,
    'answer', coalesce(v_answer, '{}'::jsonb),
    'answered_count', v_answered,
    'skipped_count', v_skipped,
    'timeout_count', v_timed_out,
    'server_now', v_now
  );
end;
$$;

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
as $$
declare
  v_runtime public.exam_attempt_runtime%rowtype;
  v_current public.exam_attempt_questions%rowtype;
  v_next public.exam_attempt_questions%rowtype;
  v_next_position integer;
  v_allocation integer;
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
          time_bank_seconds = greatest(0, coalesce(p_time_bank_seconds, 0)),
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

  update public.exam_attempt_questions
  set time_credit_seconds = time_credit_seconds + greatest(0, coalesce(p_time_bank_seconds, 0))
  where attempt_id = p_attempt_id and position = v_next_position
  returning * into v_next;
  v_allocation := greatest(1, v_next.base_seconds + v_next.time_credit_seconds - v_next.borrowed_from_previous_seconds);
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
    jsonb_build_object('allocated_seconds', v_allocation, 'borrowed_from_previous_seconds', v_next.borrowed_from_previous_seconds),
    p_transition_at
  );
end;
$$;

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
  v_score numeric := 0;
  v_matched boolean;
  v_manual boolean := false;
  v_season uuid;
begin
  select * into v_attempt from public.attempts where id = p_attempt_id for update;
  if not found then raise exception 'ATTEMPT_NOT_FOUND'; end if;
  if exists (select 1 from public.exam_attempt_runtime where attempt_id = p_attempt_id and phase = 'COMPLETED')
     and v_attempt.status in ('SUBMITTED','GRADING','FINALIZED','EXPIRED') then
    return;
  end if;

  delete from public.grading_items where attempt_id = p_attempt_id;

  for v_item in
    select * from public.exam_attempt_questions
    where attempt_id = p_attempt_id
    order by position
  loop
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
    elsif v_type in ('essay','long_answer','file_upload') then
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

  -- Preserve the legacy XP side-effect for auto-graded individual attempts.
  if not v_manual and v_attempt.participant_id is not null and v_score > 0 then
    select id into v_season
    from public.academic_seasons
    where is_active = true
    order by start_at desc
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
  v_question_snapshot jsonb;
  v_answer_key jsonb;
begin
  select * into v_attempt from public.attempts where id = p_attempt_id for update;
  if not found then raise exception 'ATTEMPT_NOT_FOUND'; end if;
  if exists (select 1 from public.exam_attempt_runtime where attempt_id = p_attempt_id) then return; end if;

  select * into v_comp from public.competitions where id = v_attempt.competition_id;
  if not found then raise exception 'COMPETITION_NOT_FOUND'; end if;

  v_duration_minutes := greatest(1, least(1440, coalesce((v_comp.config->>'duration_minutes')::integer, 60)));
  v_duration_seconds := v_duration_minutes * 60;
  v_decision_seconds := greatest(1, least(60, coalesce((v_comp.config->>'linear_exam_decision_seconds')::integer, 30)));
  v_grace_seconds := greatest(1, least(60, coalesce((v_comp.config->>'linear_exam_grace_seconds')::integer, 30)));
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

create or replace function private.resolve_linear_exam_timeouts(p_attempt_id uuid, p_server_now timestamptz default clock_timestamp())
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_runtime public.exam_attempt_runtime%rowtype;
  v_question public.exam_attempt_questions%rowtype;
  v_iteration integer;
  v_transition_at timestamptz;
begin
  for v_iteration in 1..200 loop
    select * into v_runtime from public.exam_attempt_runtime where attempt_id = p_attempt_id for update;
    if not found or v_runtime.phase = 'COMPLETED' then return; end if;

    select * into v_question
    from public.exam_attempt_questions
    where attempt_id = p_attempt_id and position = v_runtime.current_position
    for update;
    if not found then raise exception 'EXAM_CURRENT_QUESTION_NOT_FOUND'; end if;

    if v_runtime.phase = 'ACTIVE' then
      if v_question.question_deadline is null or p_server_now < v_question.question_deadline then return; end if;
      v_transition_at := v_question.question_deadline;
      update public.exam_attempt_questions
      set state = 'TIMEOUT',
          decision_deadline = least(v_transition_at + make_interval(secs => v_runtime.decision_window_seconds), v_runtime.global_deadline),
          transition_reason = 'QUESTION_TIMEOUT'
      where attempt_id = p_attempt_id and position = v_question.position;
      update public.exam_attempt_runtime
      set phase = 'DECISION', grace_kind = null, updated_at = clock_timestamp()
      where attempt_id = p_attempt_id;
      perform private.log_linear_exam_event(p_attempt_id, v_question.position, v_question.question_id, 'QUESTION_TIMEOUT', 'SYSTEM', '{}'::jsonb, v_transition_at);
      perform private.log_linear_exam_event(p_attempt_id, v_question.position, v_question.question_id, 'TIMEOUT_DECISION_OPENED', 'SYSTEM', jsonb_build_object('decision_seconds', v_runtime.decision_window_seconds), v_transition_at);
      continue;
    elsif v_runtime.phase = 'DECISION' then
      if v_question.decision_deadline is null or p_server_now < v_question.decision_deadline then return; end if;
      v_transition_at := v_question.decision_deadline;
      update public.exam_attempt_questions
      set grace_deadline = least(v_transition_at + make_interval(secs => v_runtime.grace_seconds), v_runtime.global_deadline)
      where attempt_id = p_attempt_id and position = v_question.position;
      update public.exam_attempt_runtime
      set phase = 'GRACE', grace_kind = 'FREE', updated_at = clock_timestamp()
      where attempt_id = p_attempt_id;
      perform private.log_linear_exam_event(p_attempt_id, v_question.position, v_question.question_id, 'DECISION_TIMEOUT', 'SYSTEM', '{}'::jsonb, v_transition_at);
      perform private.log_linear_exam_event(p_attempt_id, v_question.position, v_question.question_id, 'QUESTION_GRACE_STARTED', 'SYSTEM', jsonb_build_object('grace_seconds', v_runtime.grace_seconds, 'kind', 'FREE'), v_transition_at);
      continue;
    elsif v_runtime.phase = 'GRACE' then
      if v_question.grace_deadline is null or p_server_now < v_question.grace_deadline then return; end if;
      v_transition_at := v_question.grace_deadline;
      perform private.log_linear_exam_event(p_attempt_id, v_question.position, v_question.question_id, 'QUESTION_SKIPPED', 'SYSTEM', jsonb_build_object('reason', 'GRACE_EXPIRED'), v_transition_at);
      perform private.advance_linear_exam_question(p_attempt_id, v_transition_at, 'SKIPPED', 0, 'GRACE_EXPIRED', 'SYSTEM');
      continue;
    else
      return;
    end if;
  end loop;
end;
$$;

create or replace function private.assert_individual_linear_exam_access(p_attempt_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'AUTHORIZATION_REQUIRED'; end if;
  if not exists (
    select 1 from public.attempts a
    where a.id = p_attempt_id and a.participant_id = auth.uid()
  ) then
    raise exception 'ATTEMPT_NOT_FOUND';
  end if;
end;
$$;

create or replace function private.assert_collective_linear_exam_access(p_attempt_id uuid, p_access_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cp uuid;
begin
  v_cp := private.collective_session_participant(p_access_token);
  if v_cp is null then raise exception 'COLLECTIVE_SESSION_INVALID'; end if;
  if not exists (
    select 1 from public.attempts a
    where a.id = p_attempt_id and a.collective_participant_id = v_cp
  ) then
    raise exception 'ATTEMPT_NOT_FOUND';
  end if;
end;
$$;

create or replace function public.start_linear_exam_attempt(p_competition_id uuid)
returns jsonb
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
  from public.attempts a
  where a.competition_id = p_competition_id and a.participant_id = v_uid and a.status = 'IN_PROGRESS'
  order by a.created_at desc
  limit 1
  for update;

  if found then
    if not exists (select 1 from public.exam_attempt_runtime r where r.attempt_id = v_attempt.id) then
      if exists (select 1 from public.answers x where x.attempt_id = v_attempt.id) then
        raise exception 'LEGACY_ATTEMPT_REQUIRES_REVIEW';
      end if;
      update public.attempts set started_at = clock_timestamp(), updated_at = clock_timestamp()
      where id = v_attempt.id returning * into v_attempt;
      perform private.prepare_linear_exam_runtime(v_attempt.id);
    end if;
    perform private.resolve_linear_exam_timeouts(v_attempt.id, clock_timestamp());
    return private.build_linear_exam_state(v_attempt.id);
  end if;

  select a.* into v_attempt
  from public.attempts a
  join public.exam_attempt_runtime r on r.attempt_id = a.id and r.phase = 'COMPLETED'
  where a.competition_id = p_competition_id and a.participant_id = v_uid
  order by a.created_at desc
  limit 1;

  if found then return private.build_linear_exam_state(v_attempt.id); end if;

  select * into v_attempt from public.start_competition_attempt(p_competition_id);
  perform private.prepare_linear_exam_runtime(v_attempt.id);
  return private.build_linear_exam_state(v_attempt.id);
end;
$$;

create or replace function public.get_linear_exam_state(p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_individual_linear_exam_access(p_attempt_id);
  perform private.resolve_linear_exam_timeouts(p_attempt_id, clock_timestamp());
  return private.build_linear_exam_state(p_attempt_id);
end;
$$;

create or replace function public.save_linear_exam_draft(p_attempt_id uuid, p_question_id uuid, p_answer_json jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_runtime public.exam_attempt_runtime%rowtype;
  v_attempt public.attempts%rowtype;
  v_question public.exam_attempt_questions%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  perform private.assert_individual_linear_exam_access(p_attempt_id);
  perform private.resolve_linear_exam_timeouts(p_attempt_id, v_now);

  select * into v_attempt from public.attempts where id = p_attempt_id for update;
  select * into v_runtime from public.exam_attempt_runtime where attempt_id = p_attempt_id for update;
  if v_runtime.phase = 'COMPLETED' or v_attempt.status <> 'IN_PROGRESS' then raise exception 'EXAM_NOT_ACTIVE'; end if;
  if v_runtime.phase not in ('ACTIVE','GRACE') then raise exception 'QUESTION_NOT_ANSWERABLE'; end if;

  select * into v_question
  from public.exam_attempt_questions
  where attempt_id = p_attempt_id and position = v_runtime.current_position
  for update;
  if v_question.question_id <> p_question_id then raise exception 'EXAM_QUESTION_CHANGED'; end if;
  if v_runtime.phase = 'ACTIVE' and (v_question.question_deadline is null or v_now >= v_question.question_deadline) then raise exception 'QUESTION_TIMEOUT'; end if;
  if v_runtime.phase = 'GRACE' and (v_question.grace_deadline is null or v_now >= v_question.grace_deadline) then raise exception 'QUESTION_TIMEOUT'; end if;
  if jsonb_typeof(coalesce(p_answer_json, '{}'::jsonb)) <> 'object' or pg_column_size(coalesce(p_answer_json, '{}'::jsonb)) > 50000 then raise exception 'INVALID_ANSWER_PAYLOAD'; end if;
  if not (
    nullif(btrim(coalesce(p_answer_json->>'value','')), '') is not null
    or (jsonb_typeof(p_answer_json->'values') = 'array' and jsonb_array_length(p_answer_json->'values') > 0)
    or nullif(btrim(coalesce(p_answer_json->>'url','')), '') is not null
    or nullif(btrim(coalesce(p_answer_json->>'text','')), '') is not null
  ) then
    delete from public.answers where attempt_id = p_attempt_id and question_id = v_question.question_id;
  else
    insert into public.answers(attempt_id, question_id, answer_json, saved_at, updated_at)
    values (p_attempt_id, v_question.question_id, p_answer_json, v_now, v_now)
    on conflict (attempt_id, question_id)
    do update set answer_json = excluded.answer_json, saved_at = excluded.saved_at, updated_at = excluded.updated_at;
  end if;

  perform private.log_linear_exam_event(p_attempt_id, v_question.position, v_question.question_id, 'ANSWER_DRAFT_SAVED', 'PARTICIPANT', '{}'::jsonb, v_now);
  return private.build_linear_exam_state(p_attempt_id);
end;
$$;

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
as $$
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
  if v_runtime.phase = 'COMPLETED' or v_attempt.status <> 'IN_PROGRESS' then return private.build_linear_exam_state(p_attempt_id); end if;
  if v_runtime.phase not in ('ACTIVE','GRACE') then return private.build_linear_exam_state(p_attempt_id); end if;

  select * into v_question
  from public.exam_attempt_questions
  where attempt_id = p_attempt_id and position = v_runtime.current_position
  for update;

  if v_question.question_id <> p_question_id then raise exception 'EXAM_QUESTION_CHANGED'; end if;
  if v_runtime.phase = 'ACTIVE' and (v_question.question_deadline is null or v_now >= v_question.question_deadline) then
    perform private.resolve_linear_exam_timeouts(p_attempt_id, v_now);
    return private.build_linear_exam_state(p_attempt_id);
  end if;
  if v_runtime.phase = 'GRACE' and (v_question.grace_deadline is null or v_now >= v_question.grace_deadline) then
    perform private.resolve_linear_exam_timeouts(p_attempt_id, v_now);
    return private.build_linear_exam_state(p_attempt_id);
  end if;

  if jsonb_typeof(coalesce(p_answer_json, '{}'::jsonb)) <> 'object' or pg_column_size(coalesce(p_answer_json, '{}'::jsonb)) > 50000 then raise exception 'INVALID_ANSWER_PAYLOAD'; end if;

  v_payload_present :=
    nullif(btrim(coalesce(p_answer_json->>'value','')), '') is not null
    or (jsonb_typeof(p_answer_json->'values') = 'array' and jsonb_array_length(p_answer_json->'values') > 0)
    or nullif(btrim(coalesce(p_answer_json->>'url','')), '') is not null
    or nullif(btrim(coalesce(p_answer_json->>'text','')), '') is not null;

  if p_skip or not v_payload_present then
    delete from public.answers where attempt_id = p_attempt_id and question_id = v_question.question_id;
    v_final_state := 'SKIPPED';
    perform private.log_linear_exam_event(p_attempt_id, v_question.position, v_question.question_id, 'QUESTION_SKIPPED', 'PARTICIPANT', jsonb_build_object('reason', case when p_skip then 'PARTICIPANT_SKIP' else 'EMPTY_ANSWER' end), v_now);
    v_time_bank := 0;
  else
    insert into public.answers(attempt_id, question_id, answer_json, saved_at, updated_at)
    values (p_attempt_id, v_question.question_id, p_answer_json, v_now, v_now)
    on conflict (attempt_id, question_id)
    do update set answer_json = excluded.answer_json, saved_at = excluded.saved_at, updated_at = excluded.updated_at;

    v_final_state := 'ANSWERED';
    if v_runtime.phase = 'ACTIVE' then
      v_time_bank := greatest(0, floor(extract(epoch from (v_question.question_deadline - v_now)))::integer);
    elsif v_runtime.phase = 'GRACE' and v_runtime.grace_kind = 'BORROWED' then
      v_time_bank := greatest(0, floor(extract(epoch from (v_question.grace_deadline - v_now)))::integer);
    else
      v_time_bank := 0;
    end if;
    perform private.log_linear_exam_event(p_attempt_id, v_question.position, v_question.question_id, 'QUESTION_ANSWERED', 'PARTICIPANT', jsonb_build_object('phase', v_runtime.phase), v_now);
  end if;

  perform private.advance_linear_exam_question(p_attempt_id, v_now, v_final_state, v_time_bank, case when v_final_state = 'SKIPPED' then 'PARTICIPANT_SKIP' else 'ANSWERED' end, 'PARTICIPANT');
  perform private.resolve_linear_exam_timeouts(p_attempt_id, clock_timestamp());
  return private.build_linear_exam_state(p_attempt_id);
end;
$$;

create or replace function public.choose_linear_exam_timeout(
  p_attempt_id uuid,
  p_decision text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_runtime public.exam_attempt_runtime%rowtype;
  v_attempt public.attempts%rowtype;
  v_question public.exam_attempt_questions%rowtype;
  v_next public.exam_attempt_questions%rowtype;
  v_now timestamptz := clock_timestamp();
  v_next_available integer;
  v_new_grace_deadline timestamptz;
begin
  perform private.assert_individual_linear_exam_access(p_attempt_id);
  perform private.resolve_linear_exam_timeouts(p_attempt_id, v_now);

  select * into v_attempt from public.attempts where id = p_attempt_id for update;
  select * into v_runtime from public.exam_attempt_runtime where attempt_id = p_attempt_id for update;
  if v_runtime.phase <> 'DECISION' then return private.build_linear_exam_state(p_attempt_id); end if;

  select * into v_question
  from public.exam_attempt_questions
  where attempt_id = p_attempt_id and position = v_runtime.current_position
  for update;

  if v_question.decision_deadline is null or v_now >= v_question.decision_deadline then
    perform private.resolve_linear_exam_timeouts(p_attempt_id, v_now);
    return private.build_linear_exam_state(p_attempt_id);
  end if;

  if upper(coalesce(p_decision,'')) = 'BORROW' then
    select * into v_next
    from public.exam_attempt_questions
    where attempt_id = p_attempt_id and position = v_runtime.current_position + 1
    for update;
    if not found then raise exception 'NO_NEXT_QUESTION_TO_BORROW_FROM'; end if;

    v_next_available := v_next.base_seconds + v_next.time_credit_seconds - v_next.borrowed_from_previous_seconds;
    if v_next_available < 60 then raise exception 'NEXT_QUESTION_MINIMUM_TIME'; end if;

    update public.exam_attempt_questions
    set borrowed_from_previous_seconds = borrowed_from_previous_seconds + 30
    where attempt_id = p_attempt_id and position = v_next.position;

    v_new_grace_deadline := least(v_now + make_interval(secs => v_runtime.grace_seconds), v_runtime.global_deadline);
    update public.exam_attempt_questions
    set grace_deadline = v_new_grace_deadline,
        transition_reason = 'BORROWED_30_SECONDS'
    where attempt_id = p_attempt_id and position = v_question.position;
    update public.exam_attempt_runtime
    set phase = 'GRACE', grace_kind = 'BORROWED', updated_at = clock_timestamp()
    where attempt_id = p_attempt_id;

    perform private.log_linear_exam_event(p_attempt_id, v_question.position, v_question.question_id, 'BORROW_ACCEPTED', 'PARTICIPANT', jsonb_build_object('seconds', 30, 'deducted_from_position', v_next.position), v_now);
    perform private.log_linear_exam_event(p_attempt_id, v_question.position, v_question.question_id, 'QUESTION_GRACE_STARTED', 'SYSTEM', jsonb_build_object('grace_seconds', v_runtime.grace_seconds, 'kind', 'BORROWED'), v_now);
  elsif upper(coalesce(p_decision,'')) = 'CONTINUE' then
    v_new_grace_deadline := least(v_now + make_interval(secs => v_runtime.grace_seconds), v_runtime.global_deadline);
    update public.exam_attempt_questions
    set grace_deadline = v_new_grace_deadline,
        transition_reason = 'FREE_GRACE'
    where attempt_id = p_attempt_id and position = v_question.position;
    update public.exam_attempt_runtime
    set phase = 'GRACE', grace_kind = 'FREE', updated_at = clock_timestamp()
    where attempt_id = p_attempt_id;

    perform private.log_linear_exam_event(p_attempt_id, v_question.position, v_question.question_id, 'BORROW_DECLINED', 'PARTICIPANT', '{}'::jsonb, v_now);
    perform private.log_linear_exam_event(p_attempt_id, v_question.position, v_question.question_id, 'QUESTION_GRACE_STARTED', 'SYSTEM', jsonb_build_object('grace_seconds', v_runtime.grace_seconds, 'kind', 'FREE'), v_now);
  else
    raise exception 'INVALID_TIMEOUT_DECISION';
  end if;

  return private.build_linear_exam_state(p_attempt_id);
end;
$$;

create or replace function public.skip_linear_exam_question(p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_runtime public.exam_attempt_runtime%rowtype;
  v_question public.exam_attempt_questions%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  perform private.assert_individual_linear_exam_access(p_attempt_id);
  perform private.resolve_linear_exam_timeouts(p_attempt_id, v_now);

  select * into v_runtime from public.exam_attempt_runtime where attempt_id = p_attempt_id for update;
  if v_runtime.phase not in ('ACTIVE','GRACE') then return private.build_linear_exam_state(p_attempt_id); end if;
  select * into v_question from public.exam_attempt_questions where attempt_id=p_attempt_id and position=v_runtime.current_position for update;

  if (v_runtime.phase = 'ACTIVE' and (v_question.question_deadline is null or v_now >= v_question.question_deadline))
    or (v_runtime.phase = 'GRACE' and (v_question.grace_deadline is null or v_now >= v_question.grace_deadline)) then
    perform private.resolve_linear_exam_timeouts(p_attempt_id, v_now);
    return private.build_linear_exam_state(p_attempt_id);
  end if;

  delete from public.answers where attempt_id = p_attempt_id and question_id = v_question.question_id;
  perform private.log_linear_exam_event(p_attempt_id, v_question.position, v_question.question_id, 'QUESTION_SKIPPED', 'PARTICIPANT', jsonb_build_object('reason', 'PARTICIPANT_SKIP'), v_now);
  perform private.advance_linear_exam_question(p_attempt_id, v_now, 'SKIPPED', 0, 'PARTICIPANT_SKIP', 'PARTICIPANT');
  perform private.resolve_linear_exam_timeouts(p_attempt_id, clock_timestamp());
  return private.build_linear_exam_state(p_attempt_id);
end;
$$;

create or replace function public.start_collective_linear_exam_attempt(
  p_competition_id uuid,
  p_access_token text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cp uuid := private.collective_session_participant(p_access_token);
  v_attempt public.attempts%rowtype;
begin
  if v_cp is null then raise exception 'COLLECTIVE_SESSION_INVALID'; end if;
  if not exists (
    select 1 from public.collective_participants cp
    where cp.id = v_cp and cp.competition_id = p_competition_id and cp.status = 'ACTIVE'
  ) then raise exception 'PARTICIPANT_NOT_REGISTERED'; end if;

  select * into v_attempt
  from public.attempts a
  where a.competition_id=p_competition_id and a.collective_participant_id=v_cp and a.status='IN_PROGRESS'
  order by a.created_at desc limit 1 for update;

  if found then
    if not exists (select 1 from public.exam_attempt_runtime r where r.attempt_id=v_attempt.id) then
      if exists (select 1 from public.answers x where x.attempt_id=v_attempt.id) then
        raise exception 'LEGACY_ATTEMPT_REQUIRES_REVIEW';
      end if;
      update public.attempts set started_at=clock_timestamp(), updated_at=clock_timestamp()
      where id=v_attempt.id returning * into v_attempt;
      perform private.prepare_linear_exam_runtime(v_attempt.id);
    end if;
    perform private.resolve_linear_exam_timeouts(v_attempt.id, clock_timestamp());
    return private.build_linear_exam_state(v_attempt.id);
  end if;

  select a.* into v_attempt
  from public.attempts a
  join public.exam_attempt_runtime r on r.attempt_id=a.id and r.phase='COMPLETED'
  where a.competition_id=p_competition_id and a.collective_participant_id=v_cp
  order by a.created_at desc limit 1;
  if found then return private.build_linear_exam_state(v_attempt.id); end if;

  select * into v_attempt from public.start_collective_competition_attempt(p_access_token, p_competition_id);
  perform private.prepare_linear_exam_runtime(v_attempt.id);
  return private.build_linear_exam_state(v_attempt.id);
end;
$$;

create or replace function public.get_collective_linear_exam_state(p_attempt_id uuid, p_access_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_collective_linear_exam_access(p_attempt_id, p_access_token);
  perform private.resolve_linear_exam_timeouts(p_attempt_id, clock_timestamp());
  return private.build_linear_exam_state(p_attempt_id);
end;
$$;

create or replace function public.save_collective_linear_exam_draft(
  p_attempt_id uuid,
  p_access_token text,
  p_question_id uuid,
  p_answer_json jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_runtime public.exam_attempt_runtime%rowtype;
  v_attempt public.attempts%rowtype;
  v_question public.exam_attempt_questions%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  perform private.assert_collective_linear_exam_access(p_attempt_id, p_access_token);
  perform private.resolve_linear_exam_timeouts(p_attempt_id, v_now);
  select * into v_attempt from public.attempts where id=p_attempt_id for update;
  select * into v_runtime from public.exam_attempt_runtime where attempt_id=p_attempt_id for update;
  if v_runtime.phase='COMPLETED' or v_attempt.status<>'IN_PROGRESS' then raise exception 'EXAM_NOT_ACTIVE'; end if;
  if v_runtime.phase not in ('ACTIVE','GRACE') then raise exception 'QUESTION_NOT_ANSWERABLE'; end if;
  select * into v_question from public.exam_attempt_questions where attempt_id=p_attempt_id and position=v_runtime.current_position for update;
  if v_question.question_id <> p_question_id then raise exception 'EXAM_QUESTION_CHANGED'; end if;
  if (v_runtime.phase='ACTIVE' and (v_question.question_deadline is null or v_now>=v_question.question_deadline))
     or (v_runtime.phase='GRACE' and (v_question.grace_deadline is null or v_now>=v_question.grace_deadline)) then
    raise exception 'QUESTION_TIMEOUT';
  end if;
  if jsonb_typeof(coalesce(p_answer_json,'{}'::jsonb))<>'object' or pg_column_size(coalesce(p_answer_json,'{}'::jsonb))>50000 then raise exception 'INVALID_ANSWER_PAYLOAD'; end if;
  if not (
    nullif(btrim(coalesce(p_answer_json->>'value','')), '') is not null
    or (jsonb_typeof(p_answer_json->'values')='array' and jsonb_array_length(p_answer_json->'values')>0)
    or nullif(btrim(coalesce(p_answer_json->>'url','')), '') is not null
    or nullif(btrim(coalesce(p_answer_json->>'text','')), '') is not null
  ) then
    delete from public.answers where attempt_id=p_attempt_id and question_id=v_question.question_id;
  else
    insert into public.answers(attempt_id,question_id,answer_json,saved_at,updated_at)
    values(p_attempt_id,v_question.question_id,p_answer_json,v_now,v_now)
    on conflict(attempt_id,question_id) do update
    set answer_json=excluded.answer_json,saved_at=excluded.saved_at,updated_at=excluded.updated_at;
  end if;
  perform private.log_linear_exam_event(p_attempt_id,v_question.position,v_question.question_id,'ANSWER_DRAFT_SAVED','PARTICIPANT','{}'::jsonb,v_now);
  return private.build_linear_exam_state(p_attempt_id);
end;
$$;

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
as $$
declare
  v_runtime public.exam_attempt_runtime%rowtype;
  v_attempt public.attempts%rowtype;
  v_question public.exam_attempt_questions%rowtype;
  v_now timestamptz := clock_timestamp();
  v_payload_present boolean;
  v_time_bank integer := 0;
  v_final_state text;
begin
  perform private.assert_collective_linear_exam_access(p_attempt_id,p_access_token);
  perform private.resolve_linear_exam_timeouts(p_attempt_id,v_now);
  select * into v_attempt from public.attempts where id=p_attempt_id for update;
  select * into v_runtime from public.exam_attempt_runtime where attempt_id=p_attempt_id for update;
  if v_runtime.phase='COMPLETED' or v_attempt.status<>'IN_PROGRESS' then return private.build_linear_exam_state(p_attempt_id); end if;
  if v_runtime.phase not in ('ACTIVE','GRACE') then return private.build_linear_exam_state(p_attempt_id); end if;
  select * into v_question from public.exam_attempt_questions where attempt_id=p_attempt_id and position=v_runtime.current_position for update;
  if v_question.question_id <> p_question_id then raise exception 'EXAM_QUESTION_CHANGED'; end if;
  if (v_runtime.phase='ACTIVE' and (v_question.question_deadline is null or v_now>=v_question.question_deadline))
     or (v_runtime.phase='GRACE' and (v_question.grace_deadline is null or v_now>=v_question.grace_deadline)) then
    perform private.resolve_linear_exam_timeouts(p_attempt_id,v_now);
    return private.build_linear_exam_state(p_attempt_id);
  end if;
  if jsonb_typeof(coalesce(p_answer_json,'{}'::jsonb))<>'object' or pg_column_size(coalesce(p_answer_json,'{}'::jsonb))>50000 then raise exception 'INVALID_ANSWER_PAYLOAD'; end if;
  v_payload_present := nullif(btrim(coalesce(p_answer_json->>'value','')), '') is not null
    or (jsonb_typeof(p_answer_json->'values')='array' and jsonb_array_length(p_answer_json->'values')>0)
    or nullif(btrim(coalesce(p_answer_json->>'url','')), '') is not null
    or nullif(btrim(coalesce(p_answer_json->>'text','')), '') is not null;

  if p_skip or not v_payload_present then
    delete from public.answers where attempt_id=p_attempt_id and question_id=v_question.question_id;
    v_final_state := 'SKIPPED';
    perform private.log_linear_exam_event(p_attempt_id,v_question.position,v_question.question_id,'QUESTION_SKIPPED','PARTICIPANT',jsonb_build_object('reason',case when p_skip then 'PARTICIPANT_SKIP' else 'EMPTY_ANSWER' end),v_now);
  else
    insert into public.answers(attempt_id,question_id,answer_json,saved_at,updated_at)
    values(p_attempt_id,v_question.question_id,p_answer_json,v_now,v_now)
    on conflict(attempt_id,question_id) do update
    set answer_json=excluded.answer_json,saved_at=excluded.saved_at,updated_at=excluded.updated_at;
    v_final_state := 'ANSWERED';
    if v_runtime.phase='ACTIVE' then
      v_time_bank := greatest(0,floor(extract(epoch from (v_question.question_deadline-v_now)))::integer);
    elsif v_runtime.phase='GRACE' and v_runtime.grace_kind='BORROWED' then
      v_time_bank := greatest(0,floor(extract(epoch from (v_question.grace_deadline-v_now)))::integer);
    end if;
    perform private.log_linear_exam_event(p_attempt_id,v_question.position,v_question.question_id,'QUESTION_ANSWERED','PARTICIPANT',jsonb_build_object('phase',v_runtime.phase),v_now);
  end if;

  perform private.advance_linear_exam_question(p_attempt_id,v_now,v_final_state,v_time_bank,case when v_final_state='SKIPPED' then 'PARTICIPANT_SKIP' else 'ANSWERED' end,'PARTICIPANT');
  perform private.resolve_linear_exam_timeouts(p_attempt_id,clock_timestamp());
  update public.collective_access_sessions
  set last_seen_at=clock_timestamp()
  where token_hash=private.hash_collective_token(p_access_token) and revoked_at is null;
  return private.build_linear_exam_state(p_attempt_id);
end;
$$;

create or replace function public.choose_collective_linear_exam_timeout(
  p_attempt_id uuid,
  p_access_token text,
  p_decision text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_runtime public.exam_attempt_runtime%rowtype;
  v_question public.exam_attempt_questions%rowtype;
  v_next public.exam_attempt_questions%rowtype;
  v_now timestamptz := clock_timestamp();
  v_next_available integer;
  v_new_grace_deadline timestamptz;
begin
  perform private.assert_collective_linear_exam_access(p_attempt_id,p_access_token);
  perform private.resolve_linear_exam_timeouts(p_attempt_id,v_now);
  select * into v_runtime from public.exam_attempt_runtime where attempt_id=p_attempt_id for update;
  if v_runtime.phase<>'DECISION' then return private.build_linear_exam_state(p_attempt_id); end if;
  select * into v_question from public.exam_attempt_questions where attempt_id=p_attempt_id and position=v_runtime.current_position for update;
  if v_question.decision_deadline is null or v_now>=v_question.decision_deadline then
    perform private.resolve_linear_exam_timeouts(p_attempt_id,v_now);
    return private.build_linear_exam_state(p_attempt_id);
  end if;

  if upper(coalesce(p_decision,''))='BORROW' then
    select * into v_next from public.exam_attempt_questions
    where attempt_id=p_attempt_id and position=v_runtime.current_position+1 for update;
    if not found then raise exception 'NO_NEXT_QUESTION_TO_BORROW_FROM'; end if;
    v_next_available := v_next.base_seconds + v_next.time_credit_seconds - v_next.borrowed_from_previous_seconds;
    if v_next_available<60 then raise exception 'NEXT_QUESTION_MINIMUM_TIME'; end if;
    update public.exam_attempt_questions
    set borrowed_from_previous_seconds=borrowed_from_previous_seconds+30
    where attempt_id=p_attempt_id and position=v_next.position;
    v_new_grace_deadline := least(v_now+make_interval(secs=>v_runtime.grace_seconds),v_runtime.global_deadline);
    update public.exam_attempt_questions set grace_deadline=v_new_grace_deadline,transition_reason='BORROWED_30_SECONDS'
    where attempt_id=p_attempt_id and position=v_question.position;
    update public.exam_attempt_runtime set phase='GRACE',grace_kind='BORROWED',updated_at=clock_timestamp() where attempt_id=p_attempt_id;
    perform private.log_linear_exam_event(p_attempt_id,v_question.position,v_question.question_id,'BORROW_ACCEPTED','PARTICIPANT',jsonb_build_object('seconds',30,'deducted_from_position',v_next.position),v_now);
    perform private.log_linear_exam_event(p_attempt_id,v_question.position,v_question.question_id,'QUESTION_GRACE_STARTED','SYSTEM',jsonb_build_object('grace_seconds',v_runtime.grace_seconds,'kind','BORROWED'),v_now);
  elsif upper(coalesce(p_decision,''))='CONTINUE' then
    v_new_grace_deadline := least(v_now+make_interval(secs=>v_runtime.grace_seconds),v_runtime.global_deadline);
    update public.exam_attempt_questions set grace_deadline=v_new_grace_deadline,transition_reason='FREE_GRACE'
    where attempt_id=p_attempt_id and position=v_question.position;
    update public.exam_attempt_runtime set phase='GRACE',grace_kind='FREE',updated_at=clock_timestamp() where attempt_id=p_attempt_id;
    perform private.log_linear_exam_event(p_attempt_id,v_question.position,v_question.question_id,'BORROW_DECLINED','PARTICIPANT','{}'::jsonb,v_now);
    perform private.log_linear_exam_event(p_attempt_id,v_question.position,v_question.question_id,'QUESTION_GRACE_STARTED','SYSTEM',jsonb_build_object('grace_seconds',v_runtime.grace_seconds,'kind','FREE'),v_now);
  else
    raise exception 'INVALID_TIMEOUT_DECISION';
  end if;
  return private.build_linear_exam_state(p_attempt_id);
end;
$$;

create or replace function public.resolve_collective_linear_exam_timeout(p_attempt_id uuid, p_access_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_collective_linear_exam_access(p_attempt_id,p_access_token);
  perform private.resolve_linear_exam_timeouts(p_attempt_id,clock_timestamp());
  update public.collective_access_sessions
  set last_seen_at=clock_timestamp()
  where token_hash=private.hash_collective_token(p_access_token) and revoked_at is null;
  return private.build_linear_exam_state(p_attempt_id);
end;
$$;

create or replace function public.skip_collective_linear_exam_question(p_attempt_id uuid, p_access_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_runtime public.exam_attempt_runtime%rowtype;
  v_question public.exam_attempt_questions%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  perform private.assert_collective_linear_exam_access(p_attempt_id,p_access_token);
  perform private.resolve_linear_exam_timeouts(p_attempt_id,v_now);
  select * into v_runtime from public.exam_attempt_runtime where attempt_id=p_attempt_id for update;
  if v_runtime.phase not in ('ACTIVE','GRACE') then return private.build_linear_exam_state(p_attempt_id); end if;
  select * into v_question from public.exam_attempt_questions where attempt_id=p_attempt_id and position=v_runtime.current_position for update;
  if (v_runtime.phase='ACTIVE' and (v_question.question_deadline is null or v_now>=v_question.question_deadline))
     or (v_runtime.phase='GRACE' and (v_question.grace_deadline is null or v_now>=v_question.grace_deadline)) then
    perform private.resolve_linear_exam_timeouts(p_attempt_id,v_now);
    return private.build_linear_exam_state(p_attempt_id);
  end if;
  delete from public.answers where attempt_id=p_attempt_id and question_id=v_question.question_id;
  perform private.log_linear_exam_event(p_attempt_id,v_question.position,v_question.question_id,'QUESTION_SKIPPED','PARTICIPANT',jsonb_build_object('reason','PARTICIPANT_SKIP'),v_now);
  perform private.advance_linear_exam_question(p_attempt_id,v_now,'SKIPPED',0,'PARTICIPANT_SKIP','PARTICIPANT');
  perform private.resolve_linear_exam_timeouts(p_attempt_id,clock_timestamp());
  update public.collective_access_sessions
  set last_seen_at=clock_timestamp()
  where token_hash=private.hash_collective_token(p_access_token) and revoked_at is null;
  return private.build_linear_exam_state(p_attempt_id);
end;
$$;

create or replace function public.resolve_linear_exam_timeout(p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_individual_linear_exam_access(p_attempt_id);
  perform private.resolve_linear_exam_timeouts(p_attempt_id,clock_timestamp());
  return private.build_linear_exam_state(p_attempt_id);
end;
$$;

create or replace function public.get_linear_exam_activity(
  p_competition_id uuid,
  p_limit integer default 100,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_comp public.competitions%rowtype;
  v_result jsonb;
  v_limit integer := greatest(1, least(coalesce(p_limit, 100), 200));
  v_offset integer := greatest(0, coalesce(p_offset, 0));
  v_total integer := 0;
begin
  if auth.uid() is null then raise exception 'AUTHORIZATION_REQUIRED'; end if;
  select * into v_comp from public.competitions where id=p_competition_id;
  if not found then raise exception 'COMPETITION_NOT_FOUND'; end if;
  if not (private.current_user_is_admin() or (v_comp.organizer_id is not null and private.current_user_is_organizer_for(v_comp.organizer_id))) then
    raise exception 'FORBIDDEN';
  end if;

  select count(*)::integer into v_total
  from public.attempts a
  join public.exam_attempt_runtime r on r.attempt_id=a.id
  where a.competition_id=p_competition_id;

  -- Process overdue state transitions only for the bounded page currently requested.
  perform private.resolve_linear_exam_timeouts(a.id,clock_timestamp())
  from public.attempts a
  join public.exam_attempt_runtime r on r.attempt_id=a.id and r.phase<>'COMPLETED'
  where a.competition_id=p_competition_id
  order by a.created_at desc, a.id
  limit v_limit offset v_offset;

  select coalesce(jsonb_agg(row_data order by created_at desc), '[]'::jsonb)
  into v_result
  from (
    select
      a.created_at,
      jsonb_build_object(
        'attempt_id',a.id,
        'participant_name',coalesce(p.full_name,p.username,cp.full_name,'Peserta'),
        'participant_kind',case when a.collective_participant_id is null then 'INDIVIDUAL' else 'COLLECTIVE' end,
        'attempt_status',a.status,
        'phase',r.phase,
        'current_position',r.current_position,
        'total_questions',r.question_count,
        'answered_count',(select count(*) from public.exam_attempt_questions eq where eq.attempt_id=a.id and eq.state='ANSWERED'),
        'skipped_count',(select count(*) from public.exam_attempt_questions eq where eq.attempt_id=a.id and eq.state='SKIPPED'),
        'timeout_count',(select count(*) from public.exam_attempt_events ev where ev.attempt_id=a.id and ev.event_type='QUESTION_TIMEOUT'),
        'current_question_deadline',(select eq.question_deadline from public.exam_attempt_questions eq where eq.attempt_id=a.id and eq.position=r.current_position),
        'events',coalesce((
          select jsonb_agg(jsonb_build_object(
            'position',recent.question_position,
            'event_type',recent.event_type,
            'occurred_at',recent.occurred_at,
            'metadata',recent.metadata
          ) order by recent.occurred_at desc)
          from (
            select ev.question_position,ev.event_type,ev.occurred_at,ev.metadata
            from public.exam_attempt_events ev
            where ev.attempt_id=a.id
            order by ev.occurred_at desc
            limit 10
          ) recent
        ),'[]'::jsonb)
      ) as row_data
    from public.attempts a
    join public.exam_attempt_runtime r on r.attempt_id=a.id
    left join public.profiles p on p.id=a.participant_id
    left join public.collective_participants cp on cp.id=a.collective_participant_id
    where a.competition_id=p_competition_id
    order by a.created_at desc, a.id
    limit v_limit offset v_offset
  ) activity;

  return jsonb_build_object(
    'competition_id',p_competition_id,
    'generated_at',clock_timestamp(),
    'total_count',v_total,
    'page_size',v_limit,
    'offset',v_offset,
    'has_more',(v_offset + jsonb_array_length(coalesce(v_result,'[]'::jsonb))) < v_total,
    'participants',coalesce(v_result,'[]'::jsonb)
  );
end;
$$;

-- Keep public statistics about question count without exposing question content.
create or replace function public.get_public_competition_question_count(p_competition_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.questions q
  join public.competitions c on c.id=q.competition_id
  where q.competition_id=p_competition_id
    and q.status='PUBLISHED'
    and c.status in ('LIVE','RESULT_PUBLISHED','ARCHIVED');
$$;


-- Prevent direct result RPCs from revealing a finalized score before public announcement.
create or replace function public.get_canonical_competition_result(p_participant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.participants%rowtype;
  a public.attempts%rowtype;
  c public.competitions%rowtype;
  v_rank bigint;
begin
  select * into p from public.participants where id=p_participant_id;
  if not found then raise exception 'PARTICIPANT_NOT_FOUND'; end if;
  if not private.current_user_is_admin()
     and (p.user_id is null or p.user_id<>auth.uid())
     and not exists(
       select 1 from public.collective_participants cp
       where cp.id=p.collective_participant_id and cp.managed_by_user_id=auth.uid()
     ) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  select * into c from public.competitions where id=p.competition_id;
  if not found then raise exception 'COMPETITION_NOT_FOUND'; end if;

  if not private.current_user_is_admin() and c.status not in ('RESULT_PUBLISHED','ARCHIVED') then
    return jsonb_build_object(
      'participant_id',p.id,
      'competition_id',p.competition_id,
      'participant_type',p.participant_type,
      'name',p.full_name,
      'attempt',null,
      'rank',null,
      'published',false
    );
  end if;

  select * into a
  from public.attempts
  where canonical_participant_id=p.id and status='FINALIZED'
  order by finalized_at desc nulls last,created_at desc
  limit 1;

  if not found then
    return jsonb_build_object(
      'participant_id',p.id,
      'competition_id',p.competition_id,
      'participant_type',p.participant_type,
      'name',p.full_name,
      'attempt',null,
      'rank',null,
      'published',true
    );
  end if;

  select 1+count(*) into v_rank
  from public.attempts x
  where x.competition_id=p.competition_id
    and x.status='FINALIZED'
    and x.canonical_participant_id is not null
    and x.score>a.score;

  return jsonb_build_object(
    'participant_id',p.id,
    'competition_id',p.competition_id,
    'participant_type',p.participant_type,
    'name',p.full_name,
    'attempt',jsonb_build_object('id',a.id,'status',a.status,'score',a.score,'finalized_at',a.finalized_at),
    'rank',v_rank,
    'published',true
  );
end;
$$;

revoke all on function public.get_canonical_competition_result(uuid) from public, anon, authenticated;
grant execute on function public.get_canonical_competition_result(uuid) to authenticated;

-- Remove legacy RPC paths which disclosed every question at once or bypassed the
-- per-question server state machine. New clients use the linear RPCs below.
revoke execute on function public.start_competition_attempt(uuid) from public, anon, authenticated;
revoke execute on function public.get_participant_questions(uuid) from public, anon, authenticated;
revoke execute on function public.get_attempt_resume(uuid) from public, anon, authenticated;
revoke execute on function public.save_attempt_answer(uuid,uuid,jsonb) from public, anon, authenticated;
revoke execute on function public.submit_competition_attempt(uuid,uuid) from public, anon, authenticated;
revoke execute on function public.start_collective_competition_attempt(text,uuid) from public, anon, authenticated;
revoke execute on function public.get_collective_participant_questions(text,uuid) from public, anon, authenticated;
revoke execute on function public.get_collective_attempt_answers(text,uuid) from public, anon, authenticated;
revoke execute on function public.save_collective_attempt_answer(text,uuid,uuid,jsonb) from public, anon, authenticated;
revoke execute on function public.submit_collective_competition_attempt(text,uuid,uuid) from public, anon, authenticated;

revoke all on function private.log_linear_exam_event(uuid,integer,uuid,text,text,jsonb,timestamptz) from public, anon, authenticated;
revoke all on function private.build_linear_exam_state(uuid) from public, anon, authenticated;
revoke all on function private.advance_linear_exam_question(uuid,timestamptz,text,integer,text,text) from public, anon, authenticated;
revoke all on function private.complete_linear_exam_attempt(uuid,timestamptz) from public, anon, authenticated;
revoke all on function private.prepare_linear_exam_runtime(uuid) from public, anon, authenticated;
revoke all on function private.resolve_linear_exam_timeouts(uuid,timestamptz) from public, anon, authenticated;
revoke all on function private.assert_individual_linear_exam_access(uuid) from public, anon, authenticated;
revoke all on function private.assert_collective_linear_exam_access(uuid,text) from public, anon, authenticated;

revoke all on function public.start_linear_exam_attempt(uuid) from public, anon, authenticated;
revoke all on function public.get_linear_exam_state(uuid) from public, anon, authenticated;
revoke all on function public.save_linear_exam_draft(uuid,uuid,jsonb) from public, anon, authenticated;
revoke all on function public.answer_linear_exam_question(uuid,uuid,jsonb,boolean) from public, anon, authenticated;
revoke all on function public.choose_linear_exam_timeout(uuid,text) from public, anon, authenticated;
revoke all on function public.skip_linear_exam_question(uuid) from public, anon, authenticated;
revoke all on function public.resolve_linear_exam_timeout(uuid) from public, anon, authenticated;
revoke all on function public.start_collective_linear_exam_attempt(uuid,text) from public, anon, authenticated;
revoke all on function public.get_collective_linear_exam_state(uuid,text) from public, anon, authenticated;
revoke all on function public.save_collective_linear_exam_draft(uuid,text,uuid,jsonb) from public, anon, authenticated;
revoke all on function public.answer_collective_linear_exam_question(uuid,text,uuid,jsonb,boolean) from public, anon, authenticated;
revoke all on function public.choose_collective_linear_exam_timeout(uuid,text,text) from public, anon, authenticated;
revoke all on function public.resolve_collective_linear_exam_timeout(uuid,text) from public, anon, authenticated;
revoke all on function public.skip_collective_linear_exam_question(uuid,text) from public, anon, authenticated;
revoke all on function public.get_linear_exam_activity(uuid,integer,integer) from public, anon, authenticated;

grant execute on function public.start_linear_exam_attempt(uuid) to authenticated;
grant execute on function public.get_linear_exam_state(uuid) to authenticated;
grant execute on function public.save_linear_exam_draft(uuid,uuid,jsonb) to authenticated;
grant execute on function public.answer_linear_exam_question(uuid,uuid,jsonb,boolean) to authenticated;
grant execute on function public.choose_linear_exam_timeout(uuid,text) to authenticated;
grant execute on function public.skip_linear_exam_question(uuid) to authenticated;
grant execute on function public.resolve_linear_exam_timeout(uuid) to authenticated;

grant execute on function public.start_collective_linear_exam_attempt(uuid,text) to anon, authenticated;
grant execute on function public.get_collective_linear_exam_state(uuid,text) to anon, authenticated;
grant execute on function public.save_collective_linear_exam_draft(uuid,text,uuid,jsonb) to anon, authenticated;
grant execute on function public.answer_collective_linear_exam_question(uuid,text,uuid,jsonb,boolean) to anon, authenticated;
grant execute on function public.choose_collective_linear_exam_timeout(uuid,text,text) to anon, authenticated;
grant execute on function public.resolve_collective_linear_exam_timeout(uuid,text) to anon, authenticated;
grant execute on function public.skip_collective_linear_exam_question(uuid,text) to anon, authenticated;
grant execute on function public.get_linear_exam_activity(uuid,integer,integer) to authenticated;
grant execute on function public.get_public_competition_question_count(uuid) to anon, authenticated;

commit;