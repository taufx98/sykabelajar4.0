begin;

create schema if not exists private;

create table if not exists private.secure_exam_states (
  attempt_id uuid primary key references public.attempts(id) on delete cascade,
  session_key uuid not null,
  current_position integer not null default 1 check (current_position >= 1),
  total_questions integer not null check (total_questions >= 1),
  base_seconds integer not null check (base_seconds >= 1),
  time_bank_seconds integer not null default 0 check (time_bank_seconds >= 0),
  borrow_seconds_due integer not null default 0 check (borrow_seconds_due >= 0),
  grace_remaining_seconds integer not null default 30 check (grace_remaining_seconds >= 0),
  phase text not null default 'ACTIVE'
    check (phase in ('ACTIVE','TIMEOUT_DECISION','OVERTIME','FINISHED')),
  current_deadline timestamptz,
  decision_deadline timestamptz,
  overtime_deadline timestamptz,
  exam_deadline timestamptz not null,
  finished_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create table if not exists private.secure_exam_items (
  attempt_id uuid not null references public.attempts(id) on delete cascade,
  position integer not null check (position >= 1),
  question_id uuid not null,
  question_type text not null,
  prompt text not null,
  points numeric not null default 0,
  required boolean not null default true,
  options_public jsonb not null default '[]'::jsonb,
  config_public jsonb not null default '{}'::jsonb,
  answer_key jsonb not null default '{}'::jsonb,
  answer_json jsonb,
  item_status text not null default 'PENDING'
    check (item_status in ('PENDING','ACTIVE','TIMEOUT','TIMEOUT_DECISION','OVERTIME','ANSWERED','OVERTIME_ANSWERED','SKIPPED')),
  allocated_seconds integer not null default 0,
  opened_at timestamptz,
  deadline_at timestamptz,
  closed_at timestamptz,
  spent_seconds integer not null default 0,
  borrowed_seconds integer not null default 0,
  primary key (attempt_id, position),
  unique (attempt_id, question_id)
);

create table if not exists private.secure_exam_events (
  id bigint generated always as identity primary key,
  attempt_id uuid not null references public.attempts(id) on delete cascade,
  position integer,
  event_type text not null,
  details jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default clock_timestamp()
);

create index if not exists secure_exam_events_attempt_time_idx
  on private.secure_exam_events(attempt_id, occurred_at desc);
create index if not exists secure_exam_items_status_idx
  on private.secure_exam_items(attempt_id, item_status, position);

alter table private.secure_exam_states enable row level security;
alter table private.secure_exam_items enable row level security;
alter table private.secure_exam_events enable row level security;
revoke all on table private.secure_exam_states, private.secure_exam_items, private.secure_exam_events from public, anon, authenticated;

create or replace function private.secure_exam_record_event(
  p_attempt_id uuid,
  p_position integer,
  p_event_type text,
  p_details jsonb default '{}'::jsonb
) returns void
language sql
security definer
set search_path = public, private, pg_catalog
as $function$
  insert into private.secure_exam_events(attempt_id, position, event_type, details)
  values (p_attempt_id, p_position, p_event_type, coalesce(p_details, '{}'::jsonb));
$function$;

create or replace function private.secure_exam_access_ok(
  p_attempt_id uuid,
  p_session_key uuid,
  p_access_token text default null
) returns boolean
language sql
stable
security definer
set search_path = public, private, pg_catalog
as $function$
  select exists (
    select 1
    from public.attempts a
    join private.secure_exam_states s on s.attempt_id = a.id
    where a.id = p_attempt_id
      and s.session_key = p_session_key
      and (
        (nullif(trim(p_access_token), '') is null
          and auth.uid() is not null
          and a.participant_id = auth.uid()
          and a.collective_participant_id is null)
        or
        (nullif(trim(p_access_token), '') is not null
          and a.collective_participant_id is not null
          and a.collective_participant_id = private.collective_session_participant(p_access_token))
      )
  );
$function$;

create or replace function private.secure_exam_finalize(p_attempt_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $function$
declare
  v_attempt public.attempts%rowtype;
  v_state private.secure_exam_states%rowtype;
  v_item private.secure_exam_items%rowtype;
  v_answer jsonb;
  v_selected text;
  v_selected_values text[];
  v_correct_values text[];
  v_accepted jsonb;
  v_correct boolean;
  v_score numeric := 0;
  v_manual_count integer := 0;
  v_now timestamptz := clock_timestamp();
begin
  select * into v_attempt from public.attempts where id = p_attempt_id for update;
  if not found then raise exception 'ATTEMPT_NOT_FOUND'; end if;

  select * into v_state from private.secure_exam_states where attempt_id = p_attempt_id for update;
  if not found or v_state.phase = 'FINISHED' then return; end if;

  for v_item in
    select * from private.secure_exam_items
    where attempt_id = p_attempt_id
      and item_status not in ('ANSWERED','OVERTIME_ANSWERED','SKIPPED')
    order by position
  loop
    update private.secure_exam_items
      set item_status = 'SKIPPED',
          answer_json = coalesce(answer_json, '{"skipped":true}'::jsonb),
          closed_at = coalesce(closed_at, v_now),
          spent_seconds = case when opened_at is null then 0 else greatest(0, floor(extract(epoch from (v_now - opened_at)))::int) end
      where attempt_id = p_attempt_id and position = v_item.position;
    perform private.secure_exam_record_event(p_attempt_id, v_item.position, 'QUESTION_SKIPPED', jsonb_build_object('reason','EXAM_DEADLINE'));
  end loop;

  insert into public.answers(attempt_id, question_id, answer_json, saved_at, updated_at)
  select i.attempt_id, i.question_id, coalesce(i.answer_json, '{"skipped":true}'::jsonb), v_now, v_now
  from private.secure_exam_items i
  where i.attempt_id = p_attempt_id
  on conflict (attempt_id, question_id) do nothing;

  for v_item in
    select * from private.secure_exam_items
    where attempt_id = p_attempt_id and item_status in ('ANSWERED','OVERTIME_ANSWERED')
    order by position
  loop
    v_answer := coalesce(v_item.answer_json, '{}'::jsonb);
    v_selected := coalesce(v_answer->>'value', v_answer->>'option_id', '');
    v_correct := false;
    v_accepted := case
      when jsonb_typeof(v_item.answer_key->'accepted_answers') = 'array' then v_item.answer_key->'accepted_answers'
      else '[]'::jsonb
    end;

    if v_item.question_type in ('multiple_choice','true_false') then
      v_correct := exists (
        select 1 from jsonb_array_elements_text(coalesce(v_item.answer_key->'correct_option_ids','[]'::jsonb)) x(value)
        where x.value = v_selected
      );
    elsif v_item.question_type = 'multiple_checkbox' then
      select coalesce(array_agg(x.value order by x.value), array[]::text[])
        into v_selected_values
      from jsonb_array_elements_text(coalesce(v_answer->'values','[]'::jsonb)) x(value);
      select coalesce(array_agg(x.value order by x.value), array[]::text[])
        into v_correct_values
      from jsonb_array_elements_text(coalesce(v_item.answer_key->'correct_option_ids','[]'::jsonb)) x(value);
      v_correct := coalesce(v_selected_values, array[]::text[]) = coalesce(v_correct_values, array[]::text[]);
    elsif v_item.question_type in ('short_answer','numeric')
      and jsonb_array_length(v_accepted) > 0 then
      v_correct := exists (
        select 1 from jsonb_array_elements_text(v_accepted) x(value)
        where lower(trim(x.value)) = lower(trim(coalesce(v_answer->>'value','')))
      );
    elsif v_item.question_type in ('essay','file_upload','file-upload')
      or v_item.question_type = 'short_answer'
      or v_item.question_type = 'numeric' then
      insert into public.grading_items(attempt_id, question_id, score, feedback)
      values (p_attempt_id, v_item.question_id, 0, null)
      on conflict (attempt_id, question_id) do nothing;
      v_manual_count := v_manual_count + 1;
      continue;
    else
      insert into public.grading_items(attempt_id, question_id, score, feedback)
      values (p_attempt_id, v_item.question_id, 0, null)
      on conflict (attempt_id, question_id) do nothing;
      v_manual_count := v_manual_count + 1;
      continue;
    end if;

    if v_correct then v_score := v_score + coalesce(v_item.points, 0); end if;
  end loop;

  update public.attempts
  set status = case when v_manual_count > 0 then 'GRADING'::public.attempt_status else 'FINALIZED'::public.attempt_status end,
      score = v_score,
      submitted_at = coalesce(submitted_at, v_now),
      finalized_at = case when v_manual_count > 0 then null else coalesce(finalized_at, v_now) end,
      updated_at = v_now
  where id = p_attempt_id;

  update private.secure_exam_states
  set phase = 'FINISHED',
      current_deadline = null,
      decision_deadline = null,
      overtime_deadline = null,
      finished_at = coalesce(finished_at, v_now),
      updated_at = v_now
  where attempt_id = p_attempt_id;

  perform private.secure_exam_record_event(p_attempt_id, null, 'ATTEMPT_FINALIZED',
    jsonb_build_object('manual_grading_items',v_manual_count));
end;
$function$;

create or replace function private.secure_exam_open_next(p_attempt_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $function$
declare
  v_state private.secure_exam_states%rowtype;
  v_next private.secure_exam_items%rowtype;
  v_position integer;
  v_allocated integer;
  v_now timestamptz := clock_timestamp();
  v_deadline timestamptz;
begin
  select * into v_state from private.secure_exam_states where attempt_id = p_attempt_id for update;
  if not found or v_state.phase = 'FINISHED' then return; end if;
  if v_now >= v_state.exam_deadline then
    perform private.secure_exam_finalize(p_attempt_id);
    return;
  end if;

  v_position := v_state.current_position + 1;
  select * into v_next from private.secure_exam_items
    where attempt_id = p_attempt_id and position = v_position;
  if not found then
    perform private.secure_exam_finalize(p_attempt_id);
    return;
  end if;

  v_allocated := greatest(1, v_state.base_seconds + v_state.time_bank_seconds - v_state.borrow_seconds_due);
  v_deadline := least(v_now + make_interval(secs => v_allocated), v_state.exam_deadline);

  update private.secure_exam_items
  set item_status = 'ACTIVE', allocated_seconds = v_allocated,
      opened_at = v_now, deadline_at = v_deadline
  where attempt_id = p_attempt_id and position = v_position;

  update private.secure_exam_states
  set current_position = v_position, time_bank_seconds = 0, borrow_seconds_due = 0,
      phase = 'ACTIVE', current_deadline = v_deadline, decision_deadline = null,
      overtime_deadline = null, updated_at = v_now
  where attempt_id = p_attempt_id;

  perform private.secure_exam_record_event(p_attempt_id, v_position, 'QUESTION_OPENED',
    jsonb_build_object('allocated_seconds',v_allocated,'deadline_at',v_deadline));
end;
$function$;

create or replace function private.secure_exam_skip_current(p_attempt_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $function$
declare
  v_state private.secure_exam_states%rowtype;
  v_item private.secure_exam_items%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  select * into v_state from private.secure_exam_states where attempt_id = p_attempt_id for update;
  if not found or v_state.phase = 'FINISHED' then return; end if;
  select * into v_item from private.secure_exam_items
    where attempt_id = p_attempt_id and position = v_state.current_position for update;
  if not found then
    perform private.secure_exam_finalize(p_attempt_id);
    return;
  end if;

  update private.secure_exam_items
  set item_status = 'SKIPPED', answer_json = '{"skipped":true}'::jsonb,
      closed_at = v_now,
      spent_seconds = case when opened_at is null then 0 else greatest(0, floor(extract(epoch from (v_now - opened_at)))::int) end
  where attempt_id = p_attempt_id and position = v_state.current_position;

  insert into public.answers(attempt_id, question_id, answer_json, saved_at, updated_at)
  values (p_attempt_id, v_item.question_id, '{"skipped":true}'::jsonb, v_now, v_now)
  on conflict (attempt_id, question_id) do update
    set answer_json = excluded.answer_json, saved_at = excluded.saved_at, updated_at = excluded.updated_at;

  perform private.secure_exam_record_event(p_attempt_id, v_state.current_position, 'QUESTION_SKIPPED',
    jsonb_build_object('reason',coalesce(p_reason,'PARTICIPANT_SKIP')));
  perform private.secure_exam_open_next(p_attempt_id);
end;
$function$;

create or replace function public.start_secure_exam_attempt(
  p_competition_id uuid,
  p_session_key uuid,
  p_access_token text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $function$
declare
  v_attempt public.attempts%rowtype;
  v_existing private.secure_exam_states%rowtype;
  v_question_count integer;
  v_duration_seconds integer;
  v_base_seconds integer;
  v_now timestamptz := clock_timestamp();
begin
  if p_session_key is null then raise exception 'EXAM_SESSION_KEY_REQUIRED'; end if;
  if nullif(trim(p_access_token),'') is null then
    if auth.uid() is null then raise exception 'AUTHORIZATION_REQUIRED'; end if;
    select * into v_attempt from public.start_competition_attempt(p_competition_id);
  else
    if private.collective_session_participant(p_access_token) is null then raise exception 'COLLECTIVE_SESSION_INVALID'; end if;
    select * into v_attempt from public.start_collective_competition_attempt(p_access_token,p_competition_id);
  end if;

  select * into v_attempt from public.attempts where id = v_attempt.id for update;
  select * into v_existing from private.secure_exam_states where attempt_id = v_attempt.id for update;

  if found then
    if v_existing.session_key <> p_session_key then raise exception 'EXAM_SESSION_CONFLICT'; end if;
    return public.get_secure_exam_state(v_attempt.id,p_session_key,p_access_token);
  end if;

  select count(*)::integer into v_question_count
  from public.questions q
  where q.competition_id = p_competition_id and q.status = 'PUBLISHED';

  if v_question_count < 1 then raise exception 'EXAM_NO_PUBLISHED_QUESTIONS'; end if;
  v_duration_seconds := greatest(1, floor(extract(epoch from (coalesce(v_attempt.expires_at,v_now) - coalesce(v_attempt.started_at,v_now))))::integer);
  v_base_seconds := greatest(1, floor(v_duration_seconds::numeric / v_question_count)::integer);

  insert into private.secure_exam_items(
    attempt_id, position, question_id, question_type, prompt, points, required,
    options_public, config_public, answer_key, item_status
  )
  select
    v_attempt.id,
    row_number() over (order by q.display_order, q.id)::integer,
    q.id,
    replace(q.type,'-','_'),
    q.prompt,
    coalesce(q.points,0),
    coalesce(q.required,true),
    coalesce((
      select jsonb_agg(jsonb_build_object('id',qo.id::text,'label',qo.label) order by qo.display_order,qo.id)
      from public.question_options qo where qo.question_id = q.id
    ),'[]'::jsonb),
    jsonb_strip_nulls(jsonb_build_object(
      'image_url', q.config->>'image_url',
      'media_url', q.config->>'media_url',
      'asset_url', q.config->>'asset_url',
      'instructions', q.config->>'instructions'
    )),
    jsonb_build_object(
      'correct_option_ids', coalesce((
        select jsonb_agg(qo.id::text order by qo.id)
        from public.question_options qo where qo.question_id=q.id and qo.is_correct
      ),'[]'::jsonb),
      'accepted_answers', case
        when jsonb_typeof(q.config->'accepted_answers')='array' then q.config->'accepted_answers'
        else '[]'::jsonb
      end
    ),
    'PENDING'
  from public.questions q
  where q.competition_id = p_competition_id and q.status = 'PUBLISHED'
  order by q.display_order,q.id;

  insert into private.secure_exam_states(
    attempt_id, session_key, current_position, total_questions, base_seconds,
    phase, current_deadline, exam_deadline, grace_remaining_seconds
  ) values (
    v_attempt.id, p_session_key, 1, v_question_count, v_base_seconds,
    'ACTIVE',
    least(v_now + make_interval(secs => v_base_seconds), coalesce(v_attempt.expires_at,v_now+make_interval(secs=>v_duration_seconds))),
    coalesce(v_attempt.expires_at,v_now+make_interval(secs=>v_duration_seconds)),
    30
  );

  update private.secure_exam_items
  set item_status='ACTIVE', allocated_seconds=v_base_seconds, opened_at=v_now,
      deadline_at=least(v_now + make_interval(secs => v_base_seconds), coalesce(v_attempt.expires_at,v_now+make_interval(secs=>v_duration_seconds)))
  where attempt_id=v_attempt.id and position=1;

  perform private.secure_exam_record_event(v_attempt.id,1,'ATTEMPT_STARTED',
    jsonb_build_object('total_questions',v_question_count,'base_seconds',v_base_seconds,'exam_deadline',coalesce(v_attempt.expires_at,v_now+make_interval(secs=>v_duration_seconds))));
  perform private.secure_exam_record_event(v_attempt.id,1,'QUESTION_OPENED',
    jsonb_build_object('allocated_seconds',v_base_seconds));

  return public.get_secure_exam_state(v_attempt.id,p_session_key,p_access_token);
end;
$function$;

create or replace function public.get_secure_exam_state(
  p_attempt_id uuid,
  p_session_key uuid,
  p_access_token text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $function$
declare
  v_state private.secure_exam_states%rowtype;
  v_attempt public.attempts%rowtype;
  v_item private.secure_exam_items%rowtype;
  v_now timestamptz := clock_timestamp();
  v_grace integer;
begin
  if not private.secure_exam_access_ok(p_attempt_id,p_session_key,p_access_token) then
    raise exception 'EXAM_ACCESS_DENIED';
  end if;

  select * into v_attempt from public.attempts where id=p_attempt_id for update;
  select * into v_state from private.secure_exam_states where attempt_id=p_attempt_id for update;
  if not found then raise exception 'EXAM_STATE_NOT_FOUND'; end if;

  if v_state.phase <> 'FINISHED' and v_now >= v_state.exam_deadline then
    perform private.secure_exam_finalize(p_attempt_id);
  elsif v_state.phase = 'ACTIVE' and v_state.current_deadline is not null and v_now >= v_state.current_deadline then
    update private.secure_exam_states
    set phase='TIMEOUT_DECISION',
        decision_deadline=least(v_now + interval '30 seconds', exam_deadline),
        updated_at=v_now
    where attempt_id=p_attempt_id;
    update private.secure_exam_items set item_status='TIMEOUT'
      where attempt_id=p_attempt_id and position=v_state.current_position and item_status='ACTIVE';
    perform private.secure_exam_record_event(p_attempt_id,v_state.current_position,'QUESTION_TIMEOUT',
      jsonb_build_object('deadline_at',v_state.current_deadline));
  elsif v_state.phase = 'TIMEOUT_DECISION' and v_state.decision_deadline is not null and v_now >= v_state.decision_deadline then
    v_grace := least(30,v_state.grace_remaining_seconds,greatest(0,floor(extract(epoch from (v_state.exam_deadline-v_now)))::integer));
    if v_grace > 0 then
      update private.secure_exam_states
      set phase='OVERTIME', overtime_deadline=v_now + make_interval(secs=>v_grace),
          grace_remaining_seconds=grace_remaining_seconds-v_grace,
          updated_at=v_now
      where attempt_id=p_attempt_id;
      update private.secure_exam_items set item_status='OVERTIME'
        where attempt_id=p_attempt_id and position=v_state.current_position;
      perform private.secure_exam_record_event(p_attempt_id,v_state.current_position,'GRACE_USED',
        jsonb_build_object('seconds',v_grace,'source','EXAM_GRACE_POOL'));
    else
      perform private.secure_exam_skip_current(p_attempt_id,'TIMEOUT_DECISION_EXPIRED');
    end if;
  elsif v_state.phase = 'OVERTIME' and v_state.overtime_deadline is not null and v_now >= v_state.overtime_deadline then
    perform private.secure_exam_skip_current(p_attempt_id,'OVERTIME_EXPIRED');
  end if;

  select * into v_state from private.secure_exam_states where attempt_id=p_attempt_id;
  select * into v_attempt from public.attempts where id=p_attempt_id;
  select * into v_item from private.secure_exam_items
    where attempt_id=p_attempt_id and position=v_state.current_position;

  return jsonb_build_object(
    'attempt_id',v_attempt.id,
    'competition_id',v_attempt.competition_id,
    'attempt_status',v_attempt.status::text,
    'phase',v_state.phase,
    'position',case when v_state.phase='FINISHED' then v_state.total_questions else v_state.current_position end,
    'total_questions',v_state.total_questions,
    'base_seconds',v_state.base_seconds,
    'time_bank_seconds',v_state.time_bank_seconds,
    'grace_remaining_seconds',v_state.grace_remaining_seconds,
    'current_deadline',v_state.current_deadline,
    'decision_deadline',v_state.decision_deadline,
    'overtime_deadline',v_state.overtime_deadline,
    'exam_deadline',v_state.exam_deadline,
    'server_now',clock_timestamp(),
    'answered_count',(select count(*)::integer from private.secure_exam_items where attempt_id=p_attempt_id and item_status in ('ANSWERED','OVERTIME_ANSWERED')),
    'skipped_count',(select count(*)::integer from private.secure_exam_items where attempt_id=p_attempt_id and item_status='SKIPPED'),
    'timeout_count',(select count(*)::integer from private.secure_exam_items where attempt_id=p_attempt_id and item_status in ('TIMEOUT','TIMEOUT_DECISION','OVERTIME','OVERTIME_ANSWERED')),
    'current_question_status',case when v_state.phase='FINISHED' then 'FINISHED' else v_item.item_status end,
    'question',case when v_state.phase='FINISHED' or v_item.question_id is null then null else jsonb_build_object(
      'id',v_item.question_id,
      'type',v_item.question_type,
      'prompt',v_item.prompt,
      'points',v_item.points,
      'required',v_item.required,
      'display_order',v_item.position,
      'options',v_item.options_public,
      'config',v_item.config_public,
      'answer',v_item.answer_json
    ) end
  );
end;
$function$;


create or replace function public.secure_exam_save_current_answer(
  p_attempt_id uuid,
  p_session_key uuid,
  p_question_id uuid,
  p_answer_json jsonb,
  p_access_token text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $function$
declare
  v_state private.secure_exam_states%rowtype;
  v_item private.secure_exam_items%rowtype;
  v_answer jsonb := coalesce(p_answer_json,'{}'::jsonb);
  v_selected text;
  v_now timestamptz := clock_timestamp();
begin
  if not private.secure_exam_access_ok(p_attempt_id,p_session_key,p_access_token) then
    raise exception 'EXAM_ACCESS_DENIED';
  end if;

  perform 1 from public.attempts where id=p_attempt_id and status='IN_PROGRESS' for update;
  if not found then raise exception 'EXAM_ATTEMPT_NOT_ACTIVE'; end if;
  select * into v_state from private.secure_exam_states where attempt_id=p_attempt_id for update;
  if not found or v_state.phase='FINISHED' then raise exception 'EXAM_ALREADY_FINISHED'; end if;

  if v_now >= v_state.exam_deadline
     or (v_state.phase='ACTIVE' and v_state.current_deadline is not null and v_now >= v_state.current_deadline)
     or (v_state.phase='OVERTIME' and v_state.overtime_deadline is not null and v_now >= v_state.overtime_deadline) then
    return public.get_secure_exam_state(p_attempt_id,p_session_key,p_access_token);
  end if;

  if v_state.phase not in ('ACTIVE','OVERTIME') then
    raise exception 'EXAM_TIMEOUT_DECISION_REQUIRED';
  end if;

  select * into v_item from private.secure_exam_items
  where attempt_id=p_attempt_id and position=v_state.current_position for update;
  if not found then raise exception 'EXAM_CURRENT_QUESTION_NOT_FOUND'; end if;
  if v_item.question_id <> p_question_id then raise exception 'EXAM_QUESTION_CHANGED'; end if;

  if v_item.question_type in ('multiple_choice','true_false') then
    v_selected := coalesce(v_answer->>'value',v_answer->>'option_id','');
    if v_selected <> '' and not exists (
      select 1 from jsonb_array_elements(v_item.options_public) o where o->>'id'=v_selected
    ) then raise exception 'EXAM_INVALID_OPTION'; end if;
  elsif v_item.question_type='multiple_checkbox' then
    if exists (
      select 1 from jsonb_array_elements_text(coalesce(v_answer->'values','[]'::jsonb)) chosen(value)
      where not exists (select 1 from jsonb_array_elements(v_item.options_public) o where o->>'id'=chosen.value)
    ) then raise exception 'EXAM_INVALID_OPTION'; end if;
  elsif length(coalesce(v_answer->>'value','')) > 50000 then
    raise exception 'EXAM_ANSWER_TOO_LONG';
  end if;

  update private.secure_exam_items
    set answer_json=v_answer
    where attempt_id=p_attempt_id and position=v_state.current_position;

  insert into public.answers(attempt_id,question_id,answer_json,saved_at,updated_at)
  values (p_attempt_id,v_item.question_id,v_answer,v_now,v_now)
  on conflict (attempt_id,question_id) do update
    set answer_json=excluded.answer_json,saved_at=excluded.saved_at,updated_at=excluded.updated_at;

  return public.get_secure_exam_state(p_attempt_id,p_session_key,p_access_token);
end;
$function$;

create or replace function public.secure_exam_answer_and_advance(
  p_attempt_id uuid,
  p_session_key uuid,
  p_question_id uuid,
  p_answer_json jsonb,
  p_access_token text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $function$
declare
  v_state private.secure_exam_states%rowtype;
  v_attempt public.attempts%rowtype;
  v_item private.secure_exam_items%rowtype;
  v_answer jsonb := coalesce(p_answer_json,'{}'::jsonb);
  v_selected text;
  v_now timestamptz := clock_timestamp();
  v_unused integer := 0;
  v_spent integer := 0;
begin
  if not private.secure_exam_access_ok(p_attempt_id,p_session_key,p_access_token) then raise exception 'EXAM_ACCESS_DENIED'; end if;
  select * into v_attempt from public.attempts where id=p_attempt_id for update;
  select * into v_state from private.secure_exam_states where attempt_id=p_attempt_id for update;
  if v_state.phase='FINISHED' then raise exception 'EXAM_ALREADY_FINISHED'; end if;
  if v_now >= v_state.exam_deadline then
    perform private.secure_exam_finalize(p_attempt_id);
    return public.get_secure_exam_state(p_attempt_id,p_session_key,p_access_token);
  end if;
  if v_state.phase not in ('ACTIVE','OVERTIME') then raise exception 'EXAM_TIMEOUT_DECISION_REQUIRED'; end if;
  if v_state.phase='ACTIVE' and v_state.current_deadline is not null and v_now >= v_state.current_deadline then
    return public.get_secure_exam_state(p_attempt_id,p_session_key,p_access_token);
  end if;
  if v_state.phase='OVERTIME' and v_state.overtime_deadline is not null and v_now >= v_state.overtime_deadline then
    return public.get_secure_exam_state(p_attempt_id,p_session_key,p_access_token);
  end if;

  select * into v_item from private.secure_exam_items
  where attempt_id=p_attempt_id and position=v_state.current_position for update;
  if not found then raise exception 'EXAM_CURRENT_QUESTION_NOT_FOUND'; end if;
  if v_item.question_id <> p_question_id then raise exception 'EXAM_QUESTION_CHANGED'; end if;

  if v_item.question_type in ('multiple_choice','true_false') then
    v_selected := coalesce(v_answer->>'value',v_answer->>'option_id','');
    if not exists (select 1 from jsonb_array_elements(v_item.options_public) o where o->>'id'=v_selected) then
      raise exception 'EXAM_INVALID_OPTION';
    end if;
  elsif v_item.question_type='multiple_checkbox' then
    if exists (
      select 1 from jsonb_array_elements_text(coalesce(v_answer->'values','[]'::jsonb)) chosen(value)
      where not exists (select 1 from jsonb_array_elements(v_item.options_public) o where o->>'id'=chosen.value)
    ) then raise exception 'EXAM_INVALID_OPTION'; end if;
  elsif length(coalesce(v_answer->>'value','')) > 50000 then
    raise exception 'EXAM_ANSWER_TOO_LONG';
  end if;

  v_unused := case when v_state.phase='ACTIVE' then greatest(0,floor(extract(epoch from (v_state.current_deadline-v_now)))::integer) else 0 end;
  v_spent := case when v_item.opened_at is null then 0 else greatest(0,floor(extract(epoch from (v_now-v_item.opened_at)))::integer) end;
  update private.secure_exam_items
  set answer_json=v_answer,
      item_status=case when v_state.phase='OVERTIME' then 'OVERTIME_ANSWERED' else 'ANSWERED' end,
      closed_at=v_now,
      spent_seconds=v_spent,
      borrowed_seconds=case when v_state.borrow_seconds_due>0 then 30 else 0 end
  where attempt_id=p_attempt_id and position=v_state.current_position;

  insert into public.answers(attempt_id,question_id,answer_json,saved_at,updated_at)
  values (p_attempt_id,v_item.question_id,v_answer,v_now,v_now)
  on conflict (attempt_id,question_id) do update
    set answer_json=excluded.answer_json,saved_at=excluded.saved_at,updated_at=excluded.updated_at;

  update private.secure_exam_states
  set time_bank_seconds = case when v_state.phase='ACTIVE' then time_bank_seconds+v_unused else time_bank_seconds end,
      updated_at=v_now
  where attempt_id=p_attempt_id;

  perform private.secure_exam_record_event(p_attempt_id,v_state.current_position,
    case when v_state.phase='OVERTIME' then 'OVERTIME_ANSWERED' else 'QUESTION_ANSWERED' end,
    jsonb_build_object('spent_seconds',v_spent,'unused_seconds',v_unused));
  perform private.secure_exam_open_next(p_attempt_id);
  return public.get_secure_exam_state(p_attempt_id,p_session_key,p_access_token);
end;
$function$;

create or replace function public.secure_exam_skip_current(
  p_attempt_id uuid,
  p_session_key uuid,
  p_question_id uuid,
  p_access_token text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $function$
declare v_state private.secure_exam_states%rowtype; v_item private.secure_exam_items%rowtype;
begin
  if not private.secure_exam_access_ok(p_attempt_id,p_session_key,p_access_token) then raise exception 'EXAM_ACCESS_DENIED'; end if;
  select * into v_state from private.secure_exam_states where attempt_id=p_attempt_id for update;
  if v_state.phase='FINISHED' then return public.get_secure_exam_state(p_attempt_id,p_session_key,p_access_token); end if;
  select * into v_item from private.secure_exam_items where attempt_id=p_attempt_id and position=v_state.current_position for update;
  if not found or v_item.question_id <> p_question_id then raise exception 'EXAM_QUESTION_CHANGED'; end if;
  if clock_timestamp() >= v_state.exam_deadline then
    perform private.secure_exam_finalize(p_attempt_id);
  else
    perform private.secure_exam_skip_current(p_attempt_id,'PARTICIPANT_SKIP');
  end if;
  return public.get_secure_exam_state(p_attempt_id,p_session_key,p_access_token);
end;
$function$;

create or replace function public.secure_exam_resolve_timeout(
  p_attempt_id uuid,
  p_session_key uuid,
  p_question_id uuid,
  p_action text,
  p_access_token text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $function$
declare
  v_state private.secure_exam_states%rowtype;
  v_next_exists boolean;
  v_item private.secure_exam_items%rowtype;
  v_remaining integer;
  v_grant integer;
  v_now timestamptz := clock_timestamp();
begin
  if not private.secure_exam_access_ok(p_attempt_id,p_session_key,p_access_token) then raise exception 'EXAM_ACCESS_DENIED'; end if;
  select * into v_state from private.secure_exam_states where attempt_id=p_attempt_id for update;
  if v_state.phase='FINISHED' then return public.get_secure_exam_state(p_attempt_id,p_session_key,p_access_token); end if;
  select * into v_item from private.secure_exam_items where attempt_id=p_attempt_id and position=v_state.current_position for update;
  if not found or v_item.question_id <> p_question_id then raise exception 'EXAM_QUESTION_CHANGED'; end if;
  if v_now >= v_state.exam_deadline then
    perform private.secure_exam_finalize(p_attempt_id);
    return public.get_secure_exam_state(p_attempt_id,p_session_key,p_access_token);
  end if;
  if v_state.phase <> 'TIMEOUT_DECISION' then raise exception 'EXAM_TIMEOUT_DECISION_NOT_OPEN'; end if;
  if v_state.decision_deadline is null or v_now >= v_state.decision_deadline then
    return public.get_secure_exam_state(p_attempt_id,p_session_key,p_access_token);
  end if;

  if p_action='borrow' then
    select exists(select 1 from private.secure_exam_items where attempt_id=p_attempt_id and position=v_state.current_position+1) into v_next_exists;
    if not v_next_exists or v_state.base_seconds+v_state.time_bank_seconds < 60 then
      raise exception 'EXAM_BORROW_UNAVAILABLE';
    end if;
    v_grant := least(30,greatest(0,floor(extract(epoch from (v_state.exam_deadline-v_now)))::integer));
    if v_grant < 1 then
      perform private.secure_exam_finalize(p_attempt_id);
    else
      update private.secure_exam_states set phase='OVERTIME',
        borrow_seconds_due=30, overtime_deadline=v_now+make_interval(secs=>v_grant),
        updated_at=v_now where attempt_id=p_attempt_id;
      update private.secure_exam_items set item_status='OVERTIME'
        where attempt_id=p_attempt_id and position=v_state.current_position;
      perform private.secure_exam_record_event(p_attempt_id,v_state.current_position,'BORROW_ACCEPTED',
        jsonb_build_object('seconds',v_grant,'deduct_next_question_seconds',30));
    end if;
  elsif p_action='grace' then
    v_grant := least(30,v_state.grace_remaining_seconds,greatest(0,floor(extract(epoch from (v_state.exam_deadline-v_now)))::integer));
    if v_grant < 1 then raise exception 'EXAM_GRACE_EXHAUSTED'; end if;
    update private.secure_exam_states set phase='OVERTIME',
      grace_remaining_seconds=grace_remaining_seconds-v_grant,
      overtime_deadline=v_now+make_interval(secs=>v_grant), updated_at=v_now
      where attempt_id=p_attempt_id;
    update private.secure_exam_items set item_status='OVERTIME'
      where attempt_id=p_attempt_id and position=v_state.current_position;
    perform private.secure_exam_record_event(p_attempt_id,v_state.current_position,'GRACE_USED',
      jsonb_build_object('seconds',v_grant,'source','PARTICIPANT_CHOICE'));
  elsif p_action='skip' then
    perform private.secure_exam_skip_current(p_attempt_id,'TIMEOUT_DECISION_SKIP');
  else
    raise exception 'EXAM_INVALID_TIMEOUT_ACTION';
  end if;

  return public.get_secure_exam_state(p_attempt_id,p_session_key,p_access_token);
end;
$function$;

create or replace function public.get_secure_exam_monitor(p_competition_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $function$
declare
  v_user uuid := auth.uid();
  v_organizer uuid;
  v_allowed boolean := false;
  v_result jsonb;
begin
  if v_user is null then raise exception 'AUTHORIZATION_REQUIRED'; end if;
  select organizer_id into v_organizer from public.competitions where id=p_competition_id;
  if not found then raise exception 'COMPETITION_NOT_FOUND'; end if;

  select (
    exists(select 1 from public.user_roles ur where ur.user_id=v_user and ur.role::text='admin' and ur.is_active)
    or exists(select 1 from public.organizers o where o.id=v_organizer and o.owner_user_id=v_user)
    or exists(select 1 from public.organizer_members om where om.organizer_id=v_organizer and om.user_id=v_user and om.is_active and coalesce(om.status,'ACTIVE') not in ('INACTIVE','SUSPENDED','REMOVED'))
  ) into v_allowed;
  if not v_allowed then raise exception 'ORGANIZER_ACCESS_DENIED'; end if;

  select coalesce(jsonb_agg(recent.payload order by recent.created_at desc),'[]'::jsonb)
    into v_result
  from (
    select a.created_at,
      jsonb_build_object(
        'attempt_id',a.id,
        'participant_name',coalesce(p.full_name,p.username,cp.full_name,'Peserta'),
        'participant_type',case when a.collective_participant_id is not null then 'COLLECTIVE' else 'INDIVIDUAL' end,
        'attempt_status',a.status::text,
        'phase',s.phase,
        'current_position',s.current_position,
        'total_questions',s.total_questions,
        'answered_count',(select count(*)::integer from private.secure_exam_items i where i.attempt_id=a.id and i.item_status in ('ANSWERED','OVERTIME_ANSWERED')),
        'skipped_count',(select count(*)::integer from private.secure_exam_items i where i.attempt_id=a.id and (i.item_status='SKIPPED' or (i.item_status='ACTIVE' and i.deadline_at<=clock_timestamp()))),
        'timeout_count',(select count(*)::integer from private.secure_exam_items i where i.attempt_id=a.id and (i.item_status in ('TIMEOUT','TIMEOUT_DECISION','OVERTIME','OVERTIME_ANSWERED') or (i.item_status='ACTIVE' and i.deadline_at<=clock_timestamp()))),
        'questions',(select coalesce(jsonb_agg(jsonb_build_object(
          'position',i.position,
          'status',case when i.item_status='ACTIVE' and i.deadline_at<=clock_timestamp() then 'TIMEOUT_PENDING' else i.item_status end,
          'opened_at',i.opened_at,
          'closed_at',i.closed_at,
          'allocated_seconds',i.allocated_seconds,
          'spent_seconds',case when i.closed_at is null and i.opened_at is not null then greatest(0,floor(extract(epoch from (clock_timestamp()-i.opened_at)))::integer) else i.spent_seconds end,
          'borrowed_seconds',i.borrowed_seconds
        ) order by i.position), '[]'::jsonb) from private.secure_exam_items i where i.attempt_id=a.id)
      ) as payload
    from public.attempts a
    join private.secure_exam_states s on s.attempt_id=a.id
    left join public.profiles p on p.id=a.participant_id
    left join public.collective_participants cp on cp.id=a.collective_participant_id
    where a.competition_id=p_competition_id
    order by a.created_at desc
    limit 200
  ) recent;

  return jsonb_build_object('competition_id',p_competition_id,'server_now',clock_timestamp(),'attempts',v_result);
end;
$function$;

revoke all on function private.secure_exam_record_event(uuid,integer,text,jsonb) from public, anon, authenticated;
revoke all on function private.secure_exam_access_ok(uuid,uuid,text) from public, anon, authenticated;
revoke all on function private.secure_exam_finalize(uuid) from public, anon, authenticated;
revoke all on function private.secure_exam_open_next(uuid) from public, anon, authenticated;
revoke all on function private.secure_exam_skip_current(uuid,text) from public, anon, authenticated;

revoke all on function public.start_secure_exam_attempt(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.start_secure_exam_attempt(uuid,uuid,text) to anon, authenticated;
revoke all on function public.get_secure_exam_state(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.get_secure_exam_state(uuid,uuid,text) to anon, authenticated;
revoke all on function public.secure_exam_save_current_answer(uuid,uuid,uuid,jsonb,text) from public, anon, authenticated;
grant execute on function public.secure_exam_save_current_answer(uuid,uuid,uuid,jsonb,text) to anon, authenticated;
revoke all on function public.secure_exam_answer_and_advance(uuid,uuid,uuid,jsonb,text) from public, anon, authenticated;
grant execute on function public.secure_exam_answer_and_advance(uuid,uuid,uuid,jsonb,text) to anon, authenticated;
revoke all on function public.secure_exam_skip_current(uuid,uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.secure_exam_skip_current(uuid,uuid,uuid,text) to anon, authenticated;
revoke all on function public.secure_exam_resolve_timeout(uuid,uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.secure_exam_resolve_timeout(uuid,uuid,uuid,text,text) to anon, authenticated;
revoke all on function public.get_secure_exam_monitor(uuid) from public, anon, authenticated;
grant execute on function public.get_secure_exam_monitor(uuid) to authenticated;

-- The old bulk-question and arbitrary-question-answer RPCs bypass sequential exam state.
-- The new secure engine owns this flow for individual and collective participants.
revoke all on function public.get_participant_questions(uuid) from public, anon, authenticated;
revoke all on function public.start_competition_attempt(uuid) from public, anon, authenticated;
revoke all on function public.save_attempt_answer(uuid,uuid,jsonb) from public, anon, authenticated;
revoke all on function public.submit_competition_attempt(uuid,uuid) from public, anon, authenticated;
revoke all on function public.get_collective_participant_questions(text,uuid) from public, anon, authenticated;
revoke all on function public.start_collective_competition_attempt(text,uuid) from public, anon, authenticated;
revoke all on function public.get_collective_attempt_answers(text,uuid) from public, anon, authenticated;
revoke all on function public.save_collective_attempt_answer(text,uuid,uuid,jsonb) from public, anon, authenticated;
revoke all on function public.submit_collective_competition_attempt(text,uuid,uuid) from public, anon, authenticated;

commit;