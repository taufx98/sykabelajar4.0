-- Sequential, server-authoritative competition exam engine.
-- Additive migration: existing competition/attempt records remain intact.

create table if not exists public.competition_exam_configs (
  competition_id uuid primary key references public.competitions(id) on delete cascade,
  duration_seconds integer not null default 1800 check (duration_seconds between 60 and 21600),
  question_count integer null check (question_count is null or question_count between 1 and 1000),
  attempt_limit integer not null default 1 check (attempt_limit between 1 and 10),
  randomize_questions boolean not null default false,
  randomize_options boolean not null default false,
  decision_window_seconds integer not null default 30 check (decision_window_seconds between 0 and 120),
  borrow_seconds integer not null default 30 check (borrow_seconds between 1 and 120),
  overtime_grace_seconds integer not null default 30 check (overtime_grace_seconds between 0 and 120),
  min_next_question_seconds integer not null default 30 check (min_next_question_seconds between 5 and 300),
  frozen_at timestamptz null,
  created_by uuid null references auth.users(id) on delete set null,
  updated_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.exam_attempt_sessions (
  attempt_id uuid primary key references public.attempts(id) on delete cascade,
  competition_id uuid not null references public.competitions(id) on delete cascade,
  current_question_index integer not null default 1 check (current_question_index >= 1),
  question_count integer not null default 0 check (question_count >= 0),
  state text not null default 'ACTIVE' check (state in ('ACTIVE','TIMEOUT_DECISION','OVERTIME','COMPLETED')),
  current_question_id uuid null references public.questions(id) on delete set null,
  current_question_opened_at timestamptz null,
  current_question_deadline timestamptz null,
  decision_deadline timestamptz null,
  overtime_deadline timestamptz null,
  overtime_type text not null default 'NONE' check (overtime_type in ('NONE','BORROW','GRACE')),
  overtime_started_at timestamptz null,
  current_allocated_seconds integer not null default 0 check (current_allocated_seconds >= 0),
  current_borrowed_seconds integer not null default 0 check (current_borrowed_seconds >= 0),
  time_bank_seconds integer not null default 0 check (time_bank_seconds >= 0),
  pending_next_debt_seconds integer not null default 0 check (pending_next_debt_seconds >= 0),
  base_seconds integer not null default 60 check (base_seconds >= 1),
  config_snapshot jsonb not null default '{}'::jsonb,
  lock_version bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.exam_attempt_questions (
  attempt_id uuid not null references public.attempts(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete restrict,
  question_index integer not null check (question_index >= 1),
  question_type text not null,
  prompt_snapshot text not null,
  points_snapshot numeric not null default 0,
  required_snapshot boolean not null default true,
  config_snapshot jsonb not null default '{}'::jsonb,
  options_snapshot jsonb not null default '[]'::jsonb,
  state text not null default 'QUEUED' check (state in ('QUEUED','ACTIVE','ANSWERED','OVERTIME_ANSWERED','TIMEOUT','SKIPPED')),
  opened_at timestamptz null,
  deadline_at timestamptz null,
  closed_at timestamptz null,
  allocated_seconds integer not null default 0,
  elapsed_seconds integer not null default 0,
  borrowed_seconds integer not null default 0,
  grace_seconds_used integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (attempt_id, question_index),
  unique (attempt_id, question_id)
);

create table if not exists public.exam_attempt_events (
  id bigint generated always as identity primary key,
  attempt_id uuid not null references public.attempts(id) on delete cascade,
  question_id uuid null references public.questions(id) on delete set null,
  question_index integer null,
  event_type text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp()
);

create index if not exists exam_sessions_competition_state_idx
  on public.exam_attempt_sessions(competition_id, state, updated_at desc);
create index if not exists exam_attempt_questions_attempt_state_idx
  on public.exam_attempt_questions(attempt_id, state, question_index);
create index if not exists exam_attempt_events_attempt_time_idx
  on public.exam_attempt_events(attempt_id, created_at desc);

alter table public.competition_exam_configs enable row level security;
alter table public.exam_attempt_sessions enable row level security;
alter table public.exam_attempt_questions enable row level security;
alter table public.exam_attempt_events enable row level security;

revoke all on public.competition_exam_configs from anon, authenticated;
revoke all on public.exam_attempt_sessions from anon, authenticated;
revoke all on public.exam_attempt_questions from anon, authenticated;
revoke all on public.exam_attempt_events from anon, authenticated;
grant usage on schema public to authenticated;
grant usage on schema public to anon;

create or replace function private.exam_is_manager(p_competition_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, private, pg_catalog
as $$
  select coalesce(private.current_user_is_admin(), false)
    or exists (
      select 1 from public.competitions c
      join public.organizer_members om on om.organizer_id = c.organizer_id
      where c.id = p_competition_id
        and om.user_id = p_user_id
        and om.status = 'ACTIVE'
    );
$$;
revoke all on function private.exam_is_manager(uuid,uuid) from public, anon, authenticated;

create or replace function private.exam_has_answer(p_attempt_id uuid, p_question_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, private, pg_catalog
as $$
  select exists (
    select 1 from public.answers a
    where a.attempt_id = p_attempt_id
      and a.question_id = p_question_id
      and a.answer_json is not null
      and a.answer_json <> '{}'::jsonb
      and (
        nullif(btrim(coalesce(a.answer_json->>'value','')), '') is not null
        or (jsonb_typeof(a.answer_json->'values')='array' and jsonb_array_length(a.answer_json->'values') > 0)
        or (jsonb_typeof(a.answer_json->'option_ids')='array' and jsonb_array_length(a.answer_json->'option_ids') > 0)
      )
  );
$$;
revoke all on function private.exam_has_answer(uuid,uuid) from public, anon, authenticated;

create or replace function private.exam_log(
  p_attempt_id uuid, p_question_id uuid, p_question_index integer,
  p_event_type text, p_metadata jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = public, private, pg_catalog
as $$
  insert into public.exam_attempt_events(attempt_id, question_id, question_index, event_type, metadata)
  values (p_attempt_id, p_question_id, p_question_index, p_event_type, coalesce(p_metadata, '{}'::jsonb));
$$;
revoke all on function private.exam_log(uuid,uuid,integer,text,jsonb) from public, anon, authenticated;

create or replace function private.exam_finalize_attempt(p_attempt_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare
  v_attempt public.attempts%rowtype;
  v_q public.exam_attempt_questions%rowtype;
  v_answer jsonb;
  v_score numeric := 0;
  v_matched boolean;
  v_correct text[];
  v_selected text[];
  v_requires_manual boolean := false;
  v_now timestamptz := clock_timestamp();
begin
  select * into v_attempt from public.attempts where id = p_attempt_id for update;
  if not found then raise exception 'ATTEMPT_NOT_FOUND'; end if;
  if v_attempt.status in ('SUBMITTED','GRADING','FINALIZED','EXPIRED') then
    update public.exam_attempt_sessions set state='COMPLETED', updated_at=v_now where attempt_id=p_attempt_id;
    return;
  end if;

  perform set_config('app.sequential_exam_rpc', 'on', true);
  for v_q in
    select * from public.exam_attempt_questions
    where attempt_id = p_attempt_id
    order by question_index
  loop
    select a.answer_json into v_answer
    from public.answers a
    where a.attempt_id = p_attempt_id and a.question_id = v_q.question_id;

    if v_answer is null or v_answer = '{}'::jsonb then
      continue;
    end if;

    v_matched := false;
    if v_q.question_type in ('multiple_choice','multiple-choice','true_false','true-false') then
      select coalesce(bool_or(
        coalesce((opt->>'is_correct')::boolean, false)
        and coalesce(opt->>'value','') = coalesce(v_answer->>'value','')
      ), false)
      into v_matched
      from jsonb_array_elements(v_q.options_snapshot) as e(opt);
      if v_matched then v_score := v_score + coalesce(v_q.points_snapshot,0); end if;
    elsif v_q.question_type in ('multiple_checkbox','multiple-checkbox') then
      select coalesce(array_agg(opt->>'value' order by opt->>'value'), '{}')
        into v_correct
      from jsonb_array_elements(v_q.options_snapshot) as e(opt)
      where coalesce((opt->>'is_correct')::boolean, false);
      select coalesce(array_agg(selected.value order by selected.value), '{}')
        into v_selected
      from jsonb_array_elements_text(coalesce(v_answer->'values','[]'::jsonb)) as selected(value);
      if coalesce(v_correct,'{}') = coalesce(v_selected,'{}') then
        v_score := v_score + coalesce(v_q.points_snapshot,0);
      end if;
    elsif v_q.question_type in ('short_answer','short-answer','numeric') then
      select exists (
        select 1
        from jsonb_array_elements_text(coalesce(v_q.config_snapshot->'accepted_answers','[]'::jsonb)) as accepted(value)
        where lower(btrim(accepted.value)) = lower(btrim(coalesce(v_answer->>'value','')))
      ) into v_matched;
      if v_matched then v_score := v_score + coalesce(v_q.points_snapshot,0); end if;
    else
      v_requires_manual := true;
      insert into public.grading_items(attempt_id, question_id, score, feedback)
      values (p_attempt_id, v_q.question_id, 0, null)
      on conflict (attempt_id, question_id) do nothing;
    end if;
  end loop;

  update public.attempts
  set status = case when v_requires_manual then 'GRADING'::attempt_status else 'FINALIZED'::attempt_status end,
      score = v_score,
      submitted_at = coalesce(submitted_at, v_now),
      finalized_at = case when v_requires_manual then null else coalesce(finalized_at, v_now) end,
      updated_at = v_now
  where id = p_attempt_id;

  update public.exam_attempt_sessions
    set state='COMPLETED', current_question_id=null, current_question_deadline=null,
        decision_deadline=null, overtime_deadline=null, updated_at=v_now,
        lock_version=lock_version+1
  where attempt_id=p_attempt_id;

  perform private.exam_log(p_attempt_id, null, null, 'ATTEMPT_AUTO_SUBMITTED',
    jsonb_build_object('reason','ALL_QUESTIONS_PROCESSED','manual_grading',v_requires_manual));
end;
$$;
revoke all on function private.exam_finalize_attempt(uuid) from public, anon, authenticated;

create or replace function private.exam_open_next(
  p_attempt_id uuid, p_carry_seconds integer, p_next_debt_seconds integer
)
returns void
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare
  v_session public.exam_attempt_sessions%rowtype;
  v_attempt public.attempts%rowtype;
  v_next public.exam_attempt_questions%rowtype;
  v_alloc integer;
  v_now timestamptz := clock_timestamp();
begin
  select * into v_session from public.exam_attempt_sessions where attempt_id=p_attempt_id for update;
  select * into v_attempt from public.attempts where id=p_attempt_id for update;
  if not found then raise exception 'ATTEMPT_NOT_FOUND'; end if;

  select * into v_next
  from public.exam_attempt_questions
  where attempt_id=p_attempt_id and question_index=v_session.current_question_index+1;

  if not found then
    perform private.exam_finalize_attempt(p_attempt_id);
    return;
  end if;

  v_alloc := greatest(1, v_session.base_seconds + greatest(0,coalesce(p_carry_seconds,0)) - greatest(0,coalesce(p_next_debt_seconds,0)));
  update public.exam_attempt_questions
    set state='ACTIVE', opened_at=v_now, deadline_at=v_now + make_interval(secs=>v_alloc),
        allocated_seconds=v_alloc
    where attempt_id=p_attempt_id and question_index=v_next.question_index;

  update public.exam_attempt_sessions
    set current_question_index=v_next.question_index,
        question_count=v_session.question_count,
        state='ACTIVE',
        current_question_id=v_next.question_id,
        current_question_opened_at=v_now,
        current_question_deadline=v_now + make_interval(secs=>v_alloc),
        decision_deadline=null,
        overtime_deadline=null,
        overtime_type='NONE',
        overtime_started_at=null,
        current_allocated_seconds=v_alloc,
        current_borrowed_seconds=0,
        time_bank_seconds=greatest(0,coalesce(p_carry_seconds,0)-coalesce(p_next_debt_seconds,0)),
        pending_next_debt_seconds=0,
        updated_at=v_now,
        lock_version=lock_version+1
    where attempt_id=p_attempt_id;

  perform private.exam_log(p_attempt_id, v_next.question_id, v_next.question_index, 'QUESTION_OPENED',
    jsonb_build_object('allocated_seconds',v_alloc,'time_bank_seconds',greatest(0,coalesce(p_carry_seconds,0)-coalesce(p_next_debt_seconds,0))));
end;
$$;
revoke all on function private.exam_open_next(uuid,integer,integer) from public, anon, authenticated;

create or replace function private.exam_skip_current(p_attempt_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare v_s public.exam_attempt_sessions%rowtype; v_q public.exam_attempt_questions%rowtype; v_debt integer;
begin
  select * into v_s from public.exam_attempt_sessions where attempt_id=p_attempt_id for update;
  select * into v_q from public.exam_attempt_questions
    where attempt_id=p_attempt_id and question_index=v_s.current_question_index for update;
  if not found then return; end if;
  v_debt := case when v_s.overtime_type='BORROW' then v_s.pending_next_debt_seconds else 0 end;
  update public.exam_attempt_questions
    set state='SKIPPED', closed_at=clock_timestamp(),
        elapsed_seconds=greatest(0,extract(epoch from (coalesce(v_s.overtime_deadline,v_s.current_question_deadline)-coalesce(v_s.current_question_opened_at,clock_timestamp())))::integer)
    where attempt_id=p_attempt_id and question_index=v_q.question_index;
  perform private.exam_log(p_attempt_id,v_q.question_id,v_q.question_index,'QUESTION_SKIPPED',jsonb_build_object('reason',p_reason,'borrowed_seconds',v_s.current_borrowed_seconds));
  perform private.exam_open_next(p_attempt_id,0,v_debt);
end;
$$;
revoke all on function private.exam_skip_current(uuid,text) from public, anon, authenticated;

create or replace function private.exam_tick(p_attempt_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare
  v_a public.attempts%rowtype;
  v_s public.exam_attempt_sessions%rowtype;
  v_q public.exam_attempt_questions%rowtype;
  v_skip_q public.exam_attempt_questions%rowtype;
  v_has_answer boolean;
  v_now timestamptz;
  v_elapsed integer;
  v_carry integer;
  v_debt integer;
  v_step integer;
begin
  -- Catch up missed transitions using their server deadlines, not the browser clock.
  for v_step in 1..1000 loop
    v_now := clock_timestamp();
    select * into v_a from public.attempts where id=p_attempt_id for update;
    if not found then raise exception 'ATTEMPT_NOT_FOUND'; end if;
    select * into v_s from public.exam_attempt_sessions where attempt_id=p_attempt_id for update;
    if not found or v_s.state='COMPLETED' then return; end if;

    if v_a.status in ('SUBMITTED','GRADING','FINALIZED','EXPIRED') then
      update public.exam_attempt_sessions set state='COMPLETED',current_question_id=null,
        current_question_deadline=null,decision_deadline=null,overtime_deadline=null,
        updated_at=v_now,lock_version=lock_version+1 where attempt_id=p_attempt_id;
      return;
    end if;

    -- Hard server-side cap: a suspended tab cannot get fresh time by waking up late.
    if v_a.expires_at is not null and v_now >= v_a.expires_at then
      select * into v_q from public.exam_attempt_questions
        where attempt_id=p_attempt_id and question_index=v_s.current_question_index for update;
      if found then
        select private.exam_has_answer(p_attempt_id,v_q.question_id) into v_has_answer;
        if v_has_answer then
          update public.exam_attempt_questions
            set state=case when v_s.state='OVERTIME' then 'OVERTIME_ANSWERED' else 'ANSWERED' end,
                closed_at=v_a.expires_at
            where attempt_id=p_attempt_id and question_index=v_s.current_question_index;
          perform private.exam_log(p_attempt_id,v_q.question_id,v_q.question_index,'QUESTION_SAVED_AT_GLOBAL_DEADLINE',
            jsonb_build_object('previous_state',v_s.state));
        else
          update public.exam_attempt_questions set state='SKIPPED',closed_at=v_a.expires_at
            where attempt_id=p_attempt_id and question_index=v_s.current_question_index;
          perform private.exam_log(p_attempt_id,v_q.question_id,v_q.question_index,'QUESTION_SKIPPED',
            jsonb_build_object('reason','GLOBAL_ATTEMPT_DEADLINE'));
        end if;
      end if;
      for v_skip_q in
        select * from public.exam_attempt_questions
        where attempt_id=p_attempt_id and state='QUEUED'
        order by question_index for update
      loop
        update public.exam_attempt_questions set state='SKIPPED',closed_at=v_a.expires_at
          where attempt_id=p_attempt_id and question_index=v_skip_q.question_index;
        perform private.exam_log(p_attempt_id,v_skip_q.question_id,v_skip_q.question_index,'QUESTION_SKIPPED',
          jsonb_build_object('reason','GLOBAL_ATTEMPT_DEADLINE'));
      end loop;
      perform private.exam_log(p_attempt_id,null,null,'ATTEMPT_GLOBAL_DEADLINE_REACHED',
        jsonb_build_object('deadline',v_a.expires_at));
      perform private.exam_finalize_attempt(p_attempt_id);
      return;
    end if;

    select * into v_q from public.exam_attempt_questions
      where attempt_id=p_attempt_id and question_index=v_s.current_question_index for update;
    if not found then perform private.exam_finalize_attempt(p_attempt_id); return; end if;
    select private.exam_has_answer(p_attempt_id,v_q.question_id) into v_has_answer;

    if v_s.state='ACTIVE' and v_s.current_question_deadline is not null and v_now >= v_s.current_question_deadline then
      if v_has_answer then
        update public.exam_attempt_questions set state='ANSWERED',closed_at=v_s.current_question_deadline,
          elapsed_seconds=v_s.current_allocated_seconds where attempt_id=p_attempt_id and question_index=v_s.current_question_index;
        perform private.exam_log(p_attempt_id,v_q.question_id,v_q.question_index,'QUESTION_AUTO_ADVANCED_SAVED_ANSWER',
          jsonb_build_object('reason','DEADLINE_REACHED_WITH_SAVED_ANSWER'));
        perform private.exam_open_next(p_attempt_id,0,0);
        continue;
      end if;
      update public.exam_attempt_questions set state='TIMEOUT',closed_at=v_s.current_question_deadline,
        elapsed_seconds=v_s.current_allocated_seconds where attempt_id=p_attempt_id and question_index=v_s.current_question_index;
      update public.exam_attempt_sessions set state='TIMEOUT_DECISION', time_bank_seconds=0,
        decision_deadline=v_s.current_question_deadline + make_interval(secs=>(v_s.config_snapshot->>'decision_window_seconds')::integer),
        updated_at=v_now,lock_version=lock_version+1 where attempt_id=p_attempt_id;
      perform private.exam_log(p_attempt_id,v_q.question_id,v_q.question_index,'QUESTION_TIMEOUT','{}'::jsonb);
      continue;
    end if;

    if v_s.state='TIMEOUT_DECISION' and v_s.decision_deadline is not null and v_now >= v_s.decision_deadline then
      v_elapsed := greatest(0,coalesce((v_s.config_snapshot->>'overtime_grace_seconds')::integer,30));
      if v_elapsed=0 then
        perform private.exam_skip_current(p_attempt_id,'DECISION_WINDOW_EXPIRED_NO_GRACE');
      else
        update public.exam_attempt_sessions set state='OVERTIME',overtime_type='GRACE',
          overtime_started_at=v_s.decision_deadline,
          overtime_deadline=v_s.decision_deadline + make_interval(secs=>v_elapsed),
          updated_at=v_now,lock_version=lock_version+1 where attempt_id=p_attempt_id;
        perform private.exam_log(p_attempt_id,v_q.question_id,v_q.question_index,'GRACE_STARTED',
          jsonb_build_object('seconds',v_elapsed,'reason','DECISION_WINDOW_EXPIRED'));
      end if;
      continue;
    end if;

    if v_s.state='OVERTIME' and v_s.overtime_deadline is not null and v_now >= v_s.overtime_deadline then
      select private.exam_has_answer(p_attempt_id,v_q.question_id) into v_has_answer;
      if v_has_answer then
        update public.exam_attempt_questions set state='OVERTIME_ANSWERED',closed_at=v_s.overtime_deadline,
          elapsed_seconds=v_s.current_allocated_seconds + coalesce(v_s.current_borrowed_seconds,0) +
            case when v_s.overtime_type='GRACE' then greatest(0,coalesce((v_s.config_snapshot->>'overtime_grace_seconds')::integer,30)) else 0 end,
          borrowed_seconds=v_s.current_borrowed_seconds,
          grace_seconds_used=case when v_s.overtime_type='GRACE' then greatest(0,coalesce((v_s.config_snapshot->>'overtime_grace_seconds')::integer,30)) else 0 end
          where attempt_id=p_attempt_id and question_index=v_s.current_question_index;
        perform private.exam_log(p_attempt_id,v_q.question_id,v_q.question_index,'QUESTION_AUTO_ADVANCED_SAVED_OVERTIME_ANSWER',
          jsonb_build_object('overtime_type',v_s.overtime_type));
      else
        update public.exam_attempt_questions set state='SKIPPED',closed_at=v_s.overtime_deadline,
          borrowed_seconds=v_s.current_borrowed_seconds,
          grace_seconds_used=case when v_s.overtime_type='GRACE' then greatest(0,coalesce((v_s.config_snapshot->>'overtime_grace_seconds')::integer,30)) else 0 end
          where attempt_id=p_attempt_id and question_index=v_s.current_question_index;
        perform private.exam_log(p_attempt_id,v_q.question_id,v_q.question_index,'QUESTION_SKIPPED',
          jsonb_build_object('reason','OVERTIME_EXPIRED','overtime_type',v_s.overtime_type));
      end if;
      v_carry := case when v_s.overtime_type='BORROW' then greatest(0,v_s.current_borrowed_seconds - greatest(0,extract(epoch from (v_s.overtime_deadline-v_s.overtime_started_at))::integer)) else 0 end;
      v_debt := case when v_s.overtime_type='BORROW' then v_s.pending_next_debt_seconds else 0 end;
      perform private.exam_open_next(p_attempt_id,v_carry,v_debt);
      continue;
    end if;

    return;
  end loop;
  raise exception 'EXAM_STATE_CATCHUP_LIMIT';
end;
$$;
revoke all on function private.exam_tick(uuid) from public, anon, authenticated;

create or replace function private.exam_initialize_attempt(p_attempt_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare
  v_a public.attempts%rowtype;
  v_c public.competitions%rowtype;
  v_cfg public.competition_exam_configs%rowtype;
  v_q record;
  v_count integer := 0;
  v_base integer;
  v_now timestamptz := clock_timestamp();
begin
  select * into v_a from public.attempts where id=p_attempt_id for update;
  if not found then raise exception 'ATTEMPT_NOT_FOUND'; end if;
  if exists(select 1 from public.exam_attempt_sessions where attempt_id=p_attempt_id) then return; end if;
  select * into v_c from public.competitions where id=v_a.competition_id;
  if not found then raise exception 'COMPETITION_NOT_FOUND'; end if;

  insert into public.competition_exam_configs(competition_id,duration_seconds,created_by,updated_by)
  values (
    v_a.competition_id,
    greatest(60,case when coalesce(v_c.config->>'duration_minutes','') ~ '^[0-9]+$'
      then least(360, (v_c.config->>'duration_minutes')::integer) * 60 else 1800 end),
    auth.uid(),auth.uid()
  )
  on conflict (competition_id) do nothing;
  select * into v_cfg from public.competition_exam_configs where competition_id=v_a.competition_id for update;
  if v_cfg.frozen_at is null then
    update public.competition_exam_configs set frozen_at=v_now,updated_at=v_now where competition_id=v_a.competition_id;
    v_cfg.frozen_at := v_now;
  end if;

  -- Freeze question text, scoring metadata and answer key inside a private table.
  for v_q in
    select q.*,
      coalesce((
        select jsonb_agg(
          jsonb_build_object('id',o.id,'label',o.label,'value',o.value,'is_correct',o.is_correct)
          order by (case when v_cfg.randomize_options then random() end),o.display_order,o.id
        )
        from public.question_options o where o.question_id=q.id
      ),'[]'::jsonb) as options_snapshot
    from public.questions q
    where q.competition_id=v_a.competition_id and q.status='PUBLISHED'
    order by (case when v_cfg.randomize_questions then random() end),q.display_order,q.id
    limit coalesce(v_cfg.question_count,1000)
  loop
    v_count := v_count + 1;
    insert into public.exam_attempt_questions(
      attempt_id,question_id,question_index,question_type,prompt_snapshot,points_snapshot,
      required_snapshot,config_snapshot,options_snapshot,state
    ) values (
      p_attempt_id,v_q.id,v_count,v_q.type,v_q.prompt,v_q.points,v_q.required,
      coalesce(v_q.config,'{}'::jsonb),coalesce(v_q.options_snapshot,'[]'::jsonb),
      case when v_count=1 then 'ACTIVE' else 'QUEUED' end
    );
  end loop;

  if v_count=0 then raise exception 'NO_PUBLISHED_QUESTIONS'; end if;
  v_base := greatest(1,floor(v_cfg.duration_seconds::numeric/v_count)::integer);

  -- Keep the normal exam budget separate from the bounded maximum allowed by configured timeouts.
  update public.attempts
    set expires_at=v_now
      + make_interval(secs=>v_cfg.duration_seconds + v_count*(v_cfg.decision_window_seconds+v_cfg.overtime_grace_seconds)),
        updated_at=v_now
    where id=p_attempt_id;

  update public.exam_attempt_questions
    set opened_at=v_now,deadline_at=v_now+make_interval(secs=>v_base),allocated_seconds=v_base
    where attempt_id=p_attempt_id and question_index=1;

  insert into public.exam_attempt_sessions(
    attempt_id,competition_id,current_question_index,question_count,state,current_question_id,
    current_question_opened_at,current_question_deadline,current_allocated_seconds,
    base_seconds,config_snapshot,updated_at
  )
  select p_attempt_id,v_a.competition_id,1,v_count,'ACTIVE',eq.question_id,
    v_now,v_now+make_interval(secs=>v_base),v_base,v_base,
    jsonb_build_object(
      'duration_seconds',v_cfg.duration_seconds,
      'decision_window_seconds',v_cfg.decision_window_seconds,
      'borrow_seconds',v_cfg.borrow_seconds,
      'overtime_grace_seconds',v_cfg.overtime_grace_seconds,
      'min_next_question_seconds',v_cfg.min_next_question_seconds,
      'randomize_questions',v_cfg.randomize_questions,
      'randomize_options',v_cfg.randomize_options
    ),v_now
  from public.exam_attempt_questions eq
  where eq.attempt_id=p_attempt_id and eq.question_index=1;

  perform private.exam_log(p_attempt_id,
    (select question_id from public.exam_attempt_questions where attempt_id=p_attempt_id and question_index=1),
    1,'EXAM_STARTED',jsonb_build_object('question_count',v_count,'duration_seconds',v_cfg.duration_seconds,'base_seconds',v_base));
  perform private.exam_log(p_attempt_id,
    (select question_id from public.exam_attempt_questions where attempt_id=p_attempt_id and question_index=1),
    1,'QUESTION_OPENED',jsonb_build_object('allocated_seconds',v_base));
end;
$$;
revoke all on function private.exam_initialize_attempt(uuid) from public, anon, authenticated;

create or replace function private.exam_state_payload(p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare
  v_s public.exam_attempt_sessions%rowtype;
  v_a public.attempts%rowtype;
  v_q public.exam_attempt_questions%rowtype;
  v_answer jsonb;
  v_question jsonb := null;
  v_can_borrow boolean := false;
  v_next_alloc integer;
  v_now timestamptz := clock_timestamp();
begin
  perform private.exam_tick(p_attempt_id);
  select * into v_s from public.exam_attempt_sessions where attempt_id=p_attempt_id;
  select * into v_a from public.attempts where id=p_attempt_id;
  if not found then raise exception 'ATTEMPT_NOT_FOUND'; end if;

  if v_s.state <> 'COMPLETED' and v_s.current_question_id is not null then
    select * into v_q from public.exam_attempt_questions
      where attempt_id=p_attempt_id and question_index=v_s.current_question_index;
    select a.answer_json into v_answer from public.answers a
      where a.attempt_id=p_attempt_id and a.question_id=v_q.question_id;
    v_question := jsonb_build_object(
      'id',v_q.question_id,'index',v_q.question_index,'type',v_q.question_type,
      'prompt',v_q.prompt_snapshot,'points',v_q.points_snapshot,'required',v_q.required_snapshot,
      'config',(coalesce(v_q.config_snapshot,'{}'::jsonb) - 'accepted_answers' - 'correct_answer' - 'answer_key' - 'correct_option_id'),
      'options',coalesce((
        select jsonb_agg(jsonb_build_object('id',opt->>'id','label',opt->>'label') order by ord)
        from jsonb_array_elements(v_q.options_snapshot) with ordinality as options(opt,ord)
      ),'[]'::jsonb)
    );
    v_next_alloc := v_s.base_seconds - v_s.pending_next_debt_seconds;
    v_can_borrow := v_s.state='TIMEOUT_DECISION'
      and v_s.current_question_index < v_s.question_count
      and v_s.config_snapshot->>'borrow_seconds' is not null
      and v_next_alloc - (v_s.config_snapshot->>'borrow_seconds')::integer >=
        (v_s.config_snapshot->>'min_next_question_seconds')::integer;
  end if;

  return jsonb_build_object(
    'attempt_id',v_a.id,
    'attempt_status',v_a.status,
    'state',coalesce(v_s.state,'COMPLETED'),
    'question_index',v_s.current_question_index,
    'question_count',v_s.question_count,
    'base_seconds',v_s.base_seconds,
    'time_bank_seconds',v_s.time_bank_seconds,
    'current_allocated_seconds',v_s.current_allocated_seconds,
    'question_deadline',v_s.current_question_deadline,
    'decision_deadline',v_s.decision_deadline,
    'overtime_deadline',v_s.overtime_deadline,
    'overtime_type',v_s.overtime_type,
    'borrow_seconds',coalesce((v_s.config_snapshot->>'borrow_seconds')::integer,30),
    'can_borrow',v_can_borrow,
    'server_now',v_now,
    'question',v_question,
    'saved_answer',case
      when v_answer is null then null::jsonb
      when jsonb_typeof(v_answer->'option_ids')='array' then v_answer->'option_ids'
      when jsonb_typeof(v_answer)='object' then to_jsonb(coalesce(v_answer->>'option_id',v_answer->>'value'))
      else v_answer
    end
  );
end;
$$;
revoke all on function private.exam_state_payload(uuid) from public, anon, authenticated;

create or replace function private.exam_save_answer(p_attempt_id uuid,p_question_id uuid,p_answer_json jsonb,p_actor_user uuid,p_actor_collective uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare
  v_a public.attempts%rowtype;
  v_s public.exam_attempt_sessions%rowtype;
  v_q public.exam_attempt_questions%rowtype;
  v_input jsonb := coalesce(p_answer_json,'{}'::jsonb);
  v_value text;
  v_option jsonb;
  v_values jsonb := '[]'::jsonb;
  v_ids jsonb := '[]'::jsonb;
  v_now timestamptz := clock_timestamp();
begin
  select * into v_a from public.attempts where id=p_attempt_id for update;
  if not found then raise exception 'ATTEMPT_NOT_FOUND'; end if;
  if (p_actor_user is not null and v_a.participant_id is distinct from p_actor_user)
     or (p_actor_collective is not null and v_a.collective_participant_id is distinct from p_actor_collective)
     or (p_actor_user is null and p_actor_collective is null) then raise exception 'ATTEMPT_NOT_FOUND'; end if;

  perform private.exam_tick(p_attempt_id);
  select * into v_s from public.exam_attempt_sessions where attempt_id=p_attempt_id for update;
  if not found or v_s.state not in ('ACTIVE','OVERTIME') then raise exception 'QUESTION_NOT_ACTIVE'; end if;
  if v_s.current_question_id is distinct from p_question_id then raise exception 'QUESTION_LOCKED'; end if;
  if v_s.state='ACTIVE' and v_s.current_question_deadline <= v_now then raise exception 'QUESTION_TIMEOUT'; end if;
  if v_s.state='OVERTIME' and v_s.overtime_deadline <= v_now then raise exception 'OVERTIME_EXPIRED'; end if;

  select * into v_q from public.exam_attempt_questions
    where attempt_id=p_attempt_id and question_index=v_s.current_question_index for update;
  if not found then raise exception 'QUESTION_NOT_ACTIVE'; end if;

  if v_q.question_type in ('multiple_choice','multiple-choice','true_false','true-false') then
    v_value := nullif(v_input->>'value','');
    if v_value is not null then
      select opt into v_option
      from jsonb_array_elements(v_q.options_snapshot) as item(opt)
      where opt->>'id'=v_value
      limit 1;
      if v_option is null then raise exception 'INVALID_QUESTION_OPTION'; end if;
      v_input := jsonb_build_object('value',v_option->>'value','option_id',v_option->>'id');
    end if;
  elsif v_q.question_type in ('multiple_checkbox','multiple-checkbox') then
    for v_value in select jsonb_array_elements_text(coalesce(v_input->'values','[]'::jsonb))
    loop
      select opt into v_option
      from jsonb_array_elements(v_q.options_snapshot) as item(opt)
      where opt->>'id'=v_value limit 1;
      if v_option is null then raise exception 'INVALID_QUESTION_OPTION'; end if;
      v_values := v_values || jsonb_build_array(v_option->>'value');
      v_ids := v_ids || jsonb_build_array(v_option->>'id');
    end loop;
    v_input := jsonb_build_object('values',v_values,'option_ids',v_ids);
  else
    v_value := coalesce(v_input->>'value','');
    if length(v_value)>20000 then raise exception 'ANSWER_TOO_LONG'; end if;
    v_input := jsonb_build_object('value',v_value);
  end if;

  perform set_config('app.sequential_exam_rpc','on',true);
  insert into public.answers(attempt_id,question_id,answer_json,saved_at,updated_at)
  values(p_attempt_id,p_question_id,v_input,v_now,v_now)
  on conflict (attempt_id,question_id) do update
  set answer_json=excluded.answer_json,saved_at=excluded.saved_at,updated_at=excluded.updated_at;

  perform private.exam_log(p_attempt_id,p_question_id,v_s.current_question_index,'ANSWER_SAVED',
    jsonb_build_object('answer_present',v_input<>'{}'::jsonb));
  update public.exam_attempt_sessions set updated_at=v_now,lock_version=lock_version+1 where attempt_id=p_attempt_id;
  return private.exam_state_payload(p_attempt_id);
end;
$$;
revoke all on function private.exam_save_answer(uuid,uuid,jsonb,uuid,uuid) from public, anon, authenticated;

create or replace function private.exam_advance(p_attempt_id uuid,p_actor_user uuid,p_actor_collective uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare
  v_a public.attempts%rowtype;
  v_s public.exam_attempt_sessions%rowtype;
  v_q public.exam_attempt_questions%rowtype;
  v_has_answer boolean;
  v_now timestamptz := clock_timestamp();
  v_elapsed integer;
  v_carry integer := 0;
  v_debt integer := 0;
begin
  select * into v_a from public.attempts where id=p_attempt_id for update;
  if not found then raise exception 'ATTEMPT_NOT_FOUND'; end if;
  if (p_actor_user is not null and v_a.participant_id is distinct from p_actor_user)
     or (p_actor_collective is not null and v_a.collective_participant_id is distinct from p_actor_collective)
     or (p_actor_user is null and p_actor_collective is null) then raise exception 'ATTEMPT_NOT_FOUND'; end if;
  perform private.exam_tick(p_attempt_id);
  select * into v_s from public.exam_attempt_sessions where attempt_id=p_attempt_id for update;
  if v_s.state='COMPLETED' then return private.exam_state_payload(p_attempt_id); end if;
  if v_s.state not in ('ACTIVE','OVERTIME') then raise exception 'TIMEOUT_DECISION_REQUIRED'; end if;
  if v_s.state='ACTIVE' and v_s.current_question_deadline <= v_now then raise exception 'QUESTION_TIMEOUT'; end if;
  if v_s.state='OVERTIME' and v_s.overtime_deadline <= v_now then raise exception 'OVERTIME_EXPIRED'; end if;

  select * into v_q from public.exam_attempt_questions
    where attempt_id=p_attempt_id and question_index=v_s.current_question_index for update;
  select private.exam_has_answer(p_attempt_id,v_q.question_id) into v_has_answer;
  if not v_has_answer then raise exception 'ANSWER_REQUIRED'; end if;

  if v_s.state='ACTIVE' then
    v_elapsed := greatest(0,extract(epoch from (v_now-v_s.current_question_opened_at))::integer);
    v_carry := greatest(0,v_s.current_allocated_seconds-v_elapsed);
    update public.exam_attempt_questions set state='ANSWERED',closed_at=v_now,elapsed_seconds=v_elapsed
      where attempt_id=p_attempt_id and question_index=v_s.current_question_index;
    perform private.exam_log(p_attempt_id,v_q.question_id,v_q.question_index,'QUESTION_ANSWERED',
      jsonb_build_object('elapsed_seconds',v_elapsed,'carry_seconds',v_carry));
  else
    v_elapsed := greatest(0,extract(epoch from (v_now-v_s.overtime_started_at))::integer);
    if v_s.overtime_type='BORROW' then
      v_carry := greatest(0,v_s.current_borrowed_seconds-v_elapsed);
      v_debt := v_s.pending_next_debt_seconds;
    else
      v_carry := 0;
      v_debt := 0;
    end if;
    update public.exam_attempt_questions set state='OVERTIME_ANSWERED',closed_at=v_now,elapsed_seconds=v_s.current_allocated_seconds+v_elapsed,
      borrowed_seconds=v_s.current_borrowed_seconds,
      grace_seconds_used=case when v_s.overtime_type='GRACE' then v_elapsed else 0 end
      where attempt_id=p_attempt_id and question_index=v_s.current_question_index;
    perform private.exam_log(p_attempt_id,v_q.question_id,v_q.question_index,'QUESTION_OVERTIME_ANSWERED',
      jsonb_build_object('overtime_type',v_s.overtime_type,'elapsed_overtime_seconds',v_elapsed,'carry_seconds',v_carry));
  end if;

  perform private.exam_open_next(p_attempt_id,v_carry,v_debt);
  return private.exam_state_payload(p_attempt_id);
end;
$$;
revoke all on function private.exam_advance(uuid,uuid,uuid) from public, anon, authenticated;

create or replace function private.exam_resolve_timeout(p_attempt_id uuid,p_action text,p_actor_user uuid,p_actor_collective uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare
  v_a public.attempts%rowtype;
  v_s public.exam_attempt_sessions%rowtype;
  v_q public.exam_attempt_questions%rowtype;
  v_now timestamptz := clock_timestamp();
  v_borrow integer;
  v_next_alloc integer;
  v_grace integer;
begin
  select * into v_a from public.attempts where id=p_attempt_id for update;
  if not found then raise exception 'ATTEMPT_NOT_FOUND'; end if;
  if (p_actor_user is not null and v_a.participant_id is distinct from p_actor_user)
     or (p_actor_collective is not null and v_a.collective_participant_id is distinct from p_actor_collective)
     or (p_actor_user is null and p_actor_collective is null) then raise exception 'ATTEMPT_NOT_FOUND'; end if;
  perform private.exam_tick(p_attempt_id);
  select * into v_s from public.exam_attempt_sessions where attempt_id=p_attempt_id for update;
  if v_s.state <> 'TIMEOUT_DECISION' then raise exception 'TIMEOUT_DECISION_NOT_ACTIVE'; end if;
  if v_s.decision_deadline is null or v_now > v_s.decision_deadline then raise exception 'TIMEOUT_DECISION_EXPIRED'; end if;
  select * into v_q from public.exam_attempt_questions
    where attempt_id=p_attempt_id and question_index=v_s.current_question_index for update;

  if upper(p_action)='BORROW' then
    v_borrow := (v_s.config_snapshot->>'borrow_seconds')::integer;
    v_next_alloc := v_s.base_seconds + v_s.time_bank_seconds - v_s.pending_next_debt_seconds;
    if v_s.current_question_index >= v_s.question_count
      or v_next_alloc-v_borrow < (v_s.config_snapshot->>'min_next_question_seconds')::integer then
      raise exception 'BORROW_NOT_ALLOWED';
    end if;
    update public.exam_attempt_sessions set state='OVERTIME',overtime_type='BORROW',
      overtime_started_at=v_now,overtime_deadline=v_now+make_interval(secs=>v_borrow),
      current_borrowed_seconds=v_borrow,pending_next_debt_seconds=v_borrow,
      updated_at=v_now,lock_version=lock_version+1 where attempt_id=p_attempt_id;
    update public.exam_attempt_questions set borrowed_seconds=v_borrow where attempt_id=p_attempt_id and question_index=v_q.question_index;
    perform private.exam_log(p_attempt_id,v_q.question_id,v_q.question_index,'BORROW_ACCEPTED',
      jsonb_build_object('seconds',v_borrow,'next_question_minimum',(v_s.config_snapshot->>'min_next_question_seconds')::integer));
  elsif upper(p_action)='CONTINUE' then
    v_grace := greatest(0,(v_s.config_snapshot->>'overtime_grace_seconds')::integer);
    if v_grace=0 then
      perform private.exam_skip_current(p_attempt_id,'NO_GRACE_CONFIGURED');
    else
      update public.exam_attempt_sessions set state='OVERTIME',overtime_type='GRACE',
        overtime_started_at=v_now,overtime_deadline=v_now+make_interval(secs=>v_grace),
        current_borrowed_seconds=0,pending_next_debt_seconds=0,
        updated_at=v_now,lock_version=lock_version+1 where attempt_id=p_attempt_id;
      perform private.exam_log(p_attempt_id,v_q.question_id,v_q.question_index,'GRACE_STARTED',
        jsonb_build_object('seconds',v_grace,'reason','PARTICIPANT_DECLINED_BORROW'));
    end if;
  else
    raise exception 'INVALID_TIMEOUT_ACTION';
  end if;
  return private.exam_state_payload(p_attempt_id);
end;
$$;
revoke all on function private.exam_resolve_timeout(uuid,text,uuid,uuid) from public, anon, authenticated;

create or replace function public.start_sequential_exam(p_competition_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $
declare
  v_a public.attempts%rowtype;
  v_existing public.attempts%rowtype;
  v_uid uuid:=auth.uid();
  v_c public.competitions%rowtype;
  v_cfg public.competition_exam_configs%rowtype;
  v_count integer;
begin
  if v_uid is null then raise exception 'AUTHORIZATION_REQUIRED'; end if;
  select * into v_c from public.competitions where id=p_competition_id;
  if not found or v_c.status<>'LIVE' then raise exception 'COMPETITION_NOT_LIVE'; end if;
  if not exists(select 1 from public.registrations r where r.competition_id=p_competition_id and r.user_id=v_uid and r.status in ('APPROVED','ACTIVE')) then
    raise exception 'REGISTRATION_NOT_APPROVED';
  end if;
  insert into public.competition_exam_configs(competition_id,duration_seconds,created_by,updated_by)
  values(p_competition_id,
    greatest(60,case when coalesce(v_c.config->>'duration_minutes','') ~ '^[0-9]+
revoke all on function public.start_sequential_exam(uuid) from public, anon;
grant execute on function public.start_sequential_exam(uuid) to authenticated;

create or replace function public.start_collective_sequential_exam(p_access_token text,p_competition_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $
declare
  v_a public.attempts%rowtype;
  v_existing public.attempts%rowtype;
  v_cp uuid:=private.collective_session_participant(p_access_token);
  v_c public.competitions%rowtype;
  v_cfg public.competition_exam_configs%rowtype;
  v_count integer;
begin
  if v_cp is null then raise exception 'COLLECTIVE_SESSION_INVALID'; end if;
  select * into v_c from public.competitions where id=p_competition_id;
  if not found or v_c.status<>'LIVE' then raise exception 'COMPETITION_NOT_LIVE'; end if;
  if not exists(select 1 from public.collective_participants cp where cp.id=v_cp and cp.competition_id=p_competition_id and cp.status='ACTIVE') then
    raise exception 'PARTICIPANT_NOT_REGISTERED';
  end if;
  insert into public.competition_exam_configs(competition_id,duration_seconds)
  values(p_competition_id,
    greatest(60,case when coalesce(v_c.config->>'duration_minutes','') ~ '^[0-9]+
revoke all on function public.start_collective_sequential_exam(text,uuid) from public;
grant execute on function public.start_collective_sequential_exam(text,uuid) to anon, authenticated;

create or replace function public.get_sequential_exam_state(p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
begin
  if auth.uid() is null then raise exception 'AUTHORIZATION_REQUIRED'; end if;
  if not exists(select 1 from public.attempts where id=p_attempt_id and participant_id=auth.uid()) then raise exception 'ATTEMPT_NOT_FOUND'; end if;
  if not exists(select 1 from public.exam_attempt_sessions where attempt_id=p_attempt_id) then raise exception 'SEQUENTIAL_EXAM_NOT_INITIALIZED'; end if;
  return private.exam_state_payload(p_attempt_id);
end;
$$;
revoke all on function public.get_sequential_exam_state(uuid) from public, anon;
grant execute on function public.get_sequential_exam_state(uuid) to authenticated;

create or replace function public.get_collective_sequential_exam_state(p_access_token text,p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare v_cp uuid:=private.collective_session_participant(p_access_token);
begin
  if v_cp is null then raise exception 'COLLECTIVE_SESSION_INVALID'; end if;
  if not exists(select 1 from public.attempts where id=p_attempt_id and collective_participant_id=v_cp) then raise exception 'ATTEMPT_NOT_FOUND'; end if;
  if not exists(select 1 from public.exam_attempt_sessions where attempt_id=p_attempt_id) then raise exception 'SEQUENTIAL_EXAM_NOT_INITIALIZED'; end if;
  return private.exam_state_payload(p_attempt_id);
end;
$$;
revoke all on function public.get_collective_sequential_exam_state(text,uuid) from public;
grant execute on function public.get_collective_sequential_exam_state(text,uuid) to anon, authenticated;

create or replace function public.save_sequential_exam_answer(p_attempt_id uuid,p_question_id uuid,p_answer_json jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
begin
  if auth.uid() is null then raise exception 'AUTHORIZATION_REQUIRED'; end if;
  return private.exam_save_answer(p_attempt_id,p_question_id,p_answer_json,auth.uid(),null);
end;
$$;
revoke all on function public.save_sequential_exam_answer(uuid,uuid,jsonb) from public, anon;
grant execute on function public.save_sequential_exam_answer(uuid,uuid,jsonb) to authenticated;

create or replace function public.save_collective_sequential_exam_answer(p_access_token text,p_attempt_id uuid,p_question_id uuid,p_answer_json jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare v_cp uuid:=private.collective_session_participant(p_access_token);
begin
  if v_cp is null then raise exception 'COLLECTIVE_SESSION_INVALID'; end if;
  return private.exam_save_answer(p_attempt_id,p_question_id,p_answer_json,null,v_cp);
end;
$$;
revoke all on function public.save_collective_sequential_exam_answer(text,uuid,uuid,jsonb) from public;
grant execute on function public.save_collective_sequential_exam_answer(text,uuid,uuid,jsonb) to anon, authenticated;

create or replace function public.advance_sequential_exam_question(p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
begin
  if auth.uid() is null then raise exception 'AUTHORIZATION_REQUIRED'; end if;
  return private.exam_advance(p_attempt_id,auth.uid(),null);
end;
$$;
revoke all on function public.advance_sequential_exam_question(uuid) from public, anon;
grant execute on function public.advance_sequential_exam_question(uuid) to authenticated;

create or replace function public.advance_collective_sequential_exam_question(p_access_token text,p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare v_cp uuid:=private.collective_session_participant(p_access_token);
begin
  if v_cp is null then raise exception 'COLLECTIVE_SESSION_INVALID'; end if;
  return private.exam_advance(p_attempt_id,null,v_cp);
end;
$$;
revoke all on function public.advance_collective_sequential_exam_question(text,uuid) from public;
grant execute on function public.advance_collective_sequential_exam_question(text,uuid) to anon, authenticated;

create or replace function public.resolve_sequential_exam_timeout(p_attempt_id uuid,p_action text)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
begin
  if auth.uid() is null then raise exception 'AUTHORIZATION_REQUIRED'; end if;
  return private.exam_resolve_timeout(p_attempt_id,p_action,auth.uid(),null);
end;
$$;
revoke all on function public.resolve_sequential_exam_timeout(uuid,text) from public, anon;
grant execute on function public.resolve_sequential_exam_timeout(uuid,text) to authenticated;

create or replace function public.resolve_collective_sequential_exam_timeout(p_access_token text,p_attempt_id uuid,p_action text)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare v_cp uuid:=private.collective_session_participant(p_access_token);
begin
  if v_cp is null then raise exception 'COLLECTIVE_SESSION_INVALID'; end if;
  return private.exam_resolve_timeout(p_attempt_id,p_action,null,v_cp);
end;
$$;
revoke all on function public.resolve_collective_sequential_exam_timeout(text,uuid,text) from public;
grant execute on function public.resolve_collective_sequential_exam_timeout(text,uuid,text) to anon, authenticated;

create or replace function public.get_organizer_exam_config(p_competition_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare v_uid uuid:=auth.uid(); v_c public.competitions%rowtype; v_cfg public.competition_exam_configs%rowtype; v_count integer;
begin
  if v_uid is null or not private.exam_is_manager(p_competition_id,v_uid) then raise exception 'FORBIDDEN'; end if;
  select * into v_c from public.competitions where id=p_competition_id;
  if not found then raise exception 'COMPETITION_NOT_FOUND'; end if;
  insert into public.competition_exam_configs(competition_id,duration_seconds,created_by,updated_by)
  values(p_competition_id,
    greatest(60,case when coalesce(v_c.config->>'duration_minutes','') ~ '^[0-9]+$'
      then least(360,(v_c.config->>'duration_minutes')::integer)*60 else 1800 end),v_uid,v_uid)
  on conflict (competition_id) do nothing;
  select * into v_cfg from public.competition_exam_configs where competition_id=p_competition_id;
  select count(*) into v_count from public.questions where competition_id=p_competition_id and status='PUBLISHED';
  return to_jsonb(v_cfg)||jsonb_build_object('published_question_count',v_count,'frozen',v_cfg.frozen_at is not null);
end;
$$;
revoke all on function public.get_organizer_exam_config(uuid) from public, anon;
grant execute on function public.get_organizer_exam_config(uuid) to authenticated;

create or replace function public.save_organizer_exam_config(p_competition_id uuid,p_config jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare
  v_uid uuid:=auth.uid(); v_cfg public.competition_exam_configs%rowtype;
  v_duration integer; v_question_count integer; v_attempt_limit integer; v_decision integer; v_borrow integer;
  v_grace integer; v_minimum integer; v_rand_q boolean; v_rand_o boolean;
begin
  if v_uid is null or not private.exam_is_manager(p_competition_id,v_uid) then raise exception 'FORBIDDEN'; end if;
  select * into v_cfg from public.competition_exam_configs where competition_id=p_competition_id for update;
  if not found then raise exception 'EXAM_CONFIG_NOT_FOUND'; end if;
  if v_cfg.frozen_at is not null or exists(select 1 from public.exam_attempt_sessions where competition_id=p_competition_id) then
    raise exception 'EXAM_CONFIG_FROZEN';
  end if;
  v_duration := coalesce((p_config->>'duration_seconds')::integer,v_cfg.duration_seconds);
  v_question_count := nullif(p_config->>'question_count','')::integer;
  v_attempt_limit := coalesce((p_config->>'attempt_limit')::integer,v_cfg.attempt_limit);
  v_decision := coalesce((p_config->>'decision_window_seconds')::integer,v_cfg.decision_window_seconds);
  v_borrow := coalesce((p_config->>'borrow_seconds')::integer,v_cfg.borrow_seconds);
  v_grace := coalesce((p_config->>'overtime_grace_seconds')::integer,v_cfg.overtime_grace_seconds);
  v_minimum := coalesce((p_config->>'min_next_question_seconds')::integer,v_cfg.min_next_question_seconds);
  v_rand_q := coalesce((p_config->>'randomize_questions')::boolean,v_cfg.randomize_questions);
  v_rand_o := coalesce((p_config->>'randomize_options')::boolean,v_cfg.randomize_options);

  if v_duration not between 60 and 21600 then raise exception 'INVALID_DURATION_SECONDS'; end if;
  if v_question_count is not null and v_question_count not between 1 and 1000 then raise exception 'INVALID_QUESTION_COUNT'; end if;
  if v_question_count is not null and v_question_count>(select count(*) from public.questions where competition_id=p_competition_id and status='PUBLISHED') then raise exception 'QUESTION_COUNT_EXCEEDS_PUBLISHED'; end if;
  if v_attempt_limit not between 1 and 10 then raise exception 'INVALID_ATTEMPT_LIMIT'; end if;
  if v_decision not between 0 and 120 then raise exception 'INVALID_DECISION_WINDOW'; end if;
  if v_borrow not between 1 and 120 then raise exception 'INVALID_BORROW_SECONDS'; end if;
  if v_grace not between 0 and 120 then raise exception 'INVALID_GRACE_SECONDS'; end if;
  if v_minimum not between 5 and 300 then raise exception 'INVALID_MINIMUM_NEXT_TIME'; end if;

  update public.competition_exam_configs set
    duration_seconds=v_duration,question_count=v_question_count,attempt_limit=v_attempt_limit,
    decision_window_seconds=v_decision,borrow_seconds=v_borrow,overtime_grace_seconds=v_grace,
    min_next_question_seconds=v_minimum,randomize_questions=v_rand_q,randomize_options=v_rand_o,
    updated_by=v_uid,updated_at=clock_timestamp()
  where competition_id=p_competition_id returning * into v_cfg;
  return to_jsonb(v_cfg)||jsonb_build_object('frozen',false);
end;
$$;
revoke all on function public.save_organizer_exam_config(uuid,jsonb) from public, anon;
grant execute on function public.save_organizer_exam_config(uuid,jsonb) to authenticated;

create or replace function public.get_organizer_exam_monitor(p_competition_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare v_uid uuid:=auth.uid(); v_output jsonb;
begin
  if v_uid is null or not private.exam_is_manager(p_competition_id,v_uid) then raise exception 'FORBIDDEN'; end if;
  with base as (
    select a.id attempt_id,a.status attempt_status,a.started_at,a.submitted_at,
      s.current_question_index,s.question_count,s.state exam_state,s.current_question_deadline,
      coalesce(cp.full_name,p.full_name,p.username,'Peserta') participant_name,
      cp.participant_code,
      coalesce((select count(*) from public.exam_attempt_questions eq where eq.attempt_id=a.id and eq.state in ('ANSWERED','OVERTIME_ANSWERED')),0) answered_count,
      coalesce((select count(*) from public.exam_attempt_events ev where ev.attempt_id=a.id and ev.event_type='QUESTION_TIMEOUT'),0) timeout_count,
      coalesce((select count(*) from public.exam_attempt_questions eq where eq.attempt_id=a.id and eq.state='SKIPPED'),0) skipped_count,
      coalesce((select jsonb_agg(jsonb_build_object('question_index',eq.question_index,'state',eq.state,
        'allocated_seconds',eq.allocated_seconds,'elapsed_seconds',eq.elapsed_seconds,
        'borrowed_seconds',eq.borrowed_seconds,'grace_seconds_used',eq.grace_seconds_used,
        'timed_out_before',exists(select 1 from public.exam_attempt_events ev where ev.attempt_id=eq.attempt_id and ev.question_index=eq.question_index and ev.event_type='QUESTION_TIMEOUT'),
        'events',coalesce((select jsonb_agg(jsonb_build_object('type',ev.event_type,'at',ev.created_at,'metadata',ev.metadata) order by ev.created_at) from public.exam_attempt_events ev where ev.attempt_id=eq.attempt_id and ev.question_index=eq.question_index),'[]'::jsonb),
        'opened_at',eq.opened_at,'closed_at',eq.closed_at) order by eq.question_index)
        from public.exam_attempt_questions eq where eq.attempt_id=a.id),'[]'::jsonb) questions
    from public.attempts a
    join public.exam_attempt_sessions s on s.attempt_id=a.id
    left join public.profiles p on p.id=a.participant_id
    left join public.collective_participants cp on cp.id=a.collective_participant_id
    where a.competition_id=p_competition_id
    order by a.started_at desc nulls last
    limit 200
  )
  select jsonb_build_object(
    'total',count(*),
    'active',count(*) filter(where exam_state in ('ACTIVE','TIMEOUT_DECISION','OVERTIME')),
    'completed',count(*) filter(where exam_state='COMPLETED'),
    'timed_out',coalesce(sum(timeout_count),0),
    'skipped',coalesce(sum(skipped_count),0),
    'sessions',coalesce(jsonb_agg(to_jsonb(base) order by started_at desc nulls last),'[]'::jsonb)
  ) into v_output from base;
  return coalesce(v_output,'{"total":0,"active":0,"completed":0,"timed_out":0,"skipped":0,"sessions":[]}'::jsonb);
end;
$$;
revoke all on function public.get_organizer_exam_monitor(uuid) from public, anon;
grant execute on function public.get_organizer_exam_monitor(uuid) to authenticated;

-- Direct access to exam snapshots, answer keys and logs stays private. Legacy APIs are
-- blocked only for competitions configured for the sequential engine; other legacy data
-- is left in place for a safe migration window.
create or replace function private.guard_sequential_exam_answer_write()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare v_attempt_id uuid;
begin
  v_attempt_id := case when tg_op='DELETE' then old.attempt_id else new.attempt_id end;
  if exists (
    select 1 from public.attempts a
    join public.competition_exam_configs c on c.competition_id=a.competition_id
    where a.id=v_attempt_id
  ) and coalesce(current_setting('app.sequential_exam_rpc',true),'') <> 'on' then
    raise exception 'SEQUENTIAL_EXAM_ENGINE_REQUIRED';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function private.guard_sequential_exam_answer_write() from public, anon, authenticated;
drop trigger if exists guard_sequential_exam_answer_write on public.answers;
create trigger guard_sequential_exam_answer_write
before insert or update or delete on public.answers
for each row execute function private.guard_sequential_exam_answer_write();

create or replace function private.guard_sequential_exam_attempt_transition()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
begin
  if new.status is distinct from old.status
    and new.status in ('SUBMITTED','GRADING','FINALIZED','EXPIRED')
    and exists(select 1 from public.competition_exam_configs c where c.competition_id=new.competition_id)
    and coalesce(current_setting('app.sequential_exam_rpc',true),'') <> 'on' then
    raise exception 'SEQUENTIAL_EXAM_ENGINE_REQUIRED';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_sequential_exam_attempt_transition() from public, anon, authenticated;
drop trigger if exists guard_sequential_exam_attempt_transition on public.attempts;
create trigger guard_sequential_exam_attempt_transition
before update of status on public.attempts
for each row execute function private.guard_sequential_exam_attempt_transition();

-- Existing participant question RPCs must not reveal the complete question set once
-- a competition opts into the sequential engine.
create or replace function public.get_participant_questions(p_competition_id uuid)
returns table(id uuid,type text,prompt text,points numeric,required boolean,display_order integer,config jsonb,options jsonb)
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
begin
  if exists(select 1 from public.competition_exam_configs where competition_id=p_competition_id) then
    raise exception 'SEQUENTIAL_EXAM_ENGINE_REQUIRED';
  end if;
  return query
  select q.id,q.type,q.prompt,q.points,q.required,q.display_order,
    (coalesce(q.config,'{}'::jsonb)-'accepted_answers'-'correct_answer'-'answer_key'-'correct_option_id') as config,
    coalesce(jsonb_agg(jsonb_build_object('id',qo.id,'label',qo.label) order by qo.display_order,qo.id)
      filter(where qo.id is not null),'[]'::jsonb) as options
  from public.questions q
  left join public.question_options qo on qo.question_id=q.id
  join public.registrations r on r.competition_id=q.competition_id and r.user_id=auth.uid() and r.status in ('APPROVED','ACTIVE')
  join public.competitions c on c.id=q.competition_id and c.status='LIVE'
  where q.competition_id=p_competition_id and q.status='PUBLISHED'
  group by q.id
  order by q.display_order,q.id;
end;
$$;
revoke all on function public.get_participant_questions(uuid) from public, anon;
grant execute on function public.get_participant_questions(uuid) to authenticated;

create or replace function public.get_attempt_resume(p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare u uuid:=auth.uid(); a public.attempts; c public.competitions; qs jsonb; ans jsonb;
begin
  if u is null then raise exception 'AUTHORIZATION_REQUIRED'; end if;
  select * into a from public.attempts where id=p_attempt_id and participant_id=u;
  if not found then raise exception 'ATTEMPT_NOT_FOUND'; end if;
  if exists(select 1 from public.competition_exam_configs where competition_id=a.competition_id) then
    raise exception 'SEQUENTIAL_EXAM_ENGINE_REQUIRED';
  end if;
  select * into c from public.competitions where id=a.competition_id;
  select coalesce(jsonb_agg(qobj order by qobj->>'display_order'),'[]'::jsonb) into qs from (
    select jsonb_build_object('id',q.id,'type',q.type,'prompt',q.prompt,'points',q.points,'required',q.required,
      'display_order',q.display_order,'config',(coalesce(q.config,'{}'::jsonb)-'accepted_answers'-'correct_answer'-'answer_key'-'correct_option_id'),
      'options',coalesce((select jsonb_agg(jsonb_build_object('id',qo.id,'label',qo.label) order by qo.display_order)
      from public.question_options qo where qo.question_id=q.id),'[]'::jsonb)) qobj
    from public.questions q where q.competition_id=a.competition_id and q.status='PUBLISHED'
  ) t;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.saved_at),'[]'::jsonb) into ans from public.answers x where x.attempt_id=a.id;
  return jsonb_build_object('attempt',to_jsonb(a)-'score','competition',to_jsonb(c),'questions',qs,'answers',ans);
end;
$$;
revoke all on function public.get_attempt_resume(uuid) from public, anon;
grant execute on function public.get_attempt_resume(uuid) to authenticated;

create or replace function public.get_collective_participant_questions(p_access_token text,p_competition_id uuid)
returns table(id uuid,type text,prompt text,points numeric,required boolean,display_order integer,config jsonb,options jsonb)
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare v_cp uuid:=private.collective_session_participant(p_access_token);
begin
  if v_cp is null then raise exception 'COLLECTIVE_SESSION_INVALID'; end if;
  if exists(select 1 from public.competition_exam_configs where competition_id=p_competition_id) then
    raise exception 'SEQUENTIAL_EXAM_ENGINE_REQUIRED';
  end if;
  if not exists(select 1 from public.collective_participants where id=v_cp and competition_id=p_competition_id and status='ACTIVE') then
    raise exception 'PARTICIPANT_NOT_REGISTERED';
  end if;
  return query
  select q.id,q.type,q.prompt,q.points,q.required,q.display_order,
    (coalesce(q.config,'{}'::jsonb)-'accepted_answers'-'correct_answer'-'answer_key'-'correct_option_id') as config,
    coalesce(jsonb_agg(jsonb_build_object('id',qo.id,'label',qo.label,'value',qo.value) order by qo.display_order,qo.id)
      filter(where qo.id is not null),'[]'::jsonb) as options
  from public.questions q left join public.question_options qo on qo.question_id=q.id
  join public.competitions c on c.id=q.competition_id and c.status='LIVE'
  where q.competition_id=p_competition_id and q.status='PUBLISHED'
  group by q.id order by q.display_order,q.id;
end;
$$;
revoke all on function public.get_collective_participant_questions(text,uuid) from public;
grant execute on function public.get_collective_participant_questions(text,uuid) to anon, authenticated;

-- A completed attempt's score/rank is withheld until the organizer publishes results.
create or replace function public.get_canonical_competition_result(p_participant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare p public.participants; a public.attempts; v_rank bigint; c public.competitions;
begin
  select * into p from public.participants where id=p_participant_id;
  if not found then raise exception 'PARTICIPANT_NOT_FOUND'; end if;
  if not private.current_user_is_admin()
    and (p.user_id is null or p.user_id<>auth.uid())
    and not exists(select 1 from public.collective_participants cp where cp.id=p.collective_participant_id and cp.managed_by_user_id=auth.uid()) then
    raise exception 'NOT_AUTHORIZED';
  end if;
  select * into c from public.competitions where id=p.competition_id;
  if exists(select 1 from public.competition_exam_configs ec where ec.competition_id=p.competition_id)
    and c.status not in ('RESULT_PUBLISHED','ARCHIVED') then
    return jsonb_build_object('participant_id',p.id,'competition_id',p.competition_id,
      'participant_type',p.participant_type,'name',p.full_name,'attempt',null,'rank',null,'published',false);
  end if;
  select * into a from public.attempts where canonical_participant_id=p.id and status='FINALIZED'
    order by finalized_at desc nulls last,created_at desc limit 1;
  if not found then
    return jsonb_build_object('participant_id',p.id,'competition_id',p.competition_id,'participant_type',p.participant_type,
      'name',p.full_name,'attempt',null,'rank',null,'published',true);
  end if;
  select 1+count(*) into v_rank from public.attempts x
    where x.competition_id=p.competition_id and x.status='FINALIZED'
      and x.canonical_participant_id is not null and x.score>a.score;
  return jsonb_build_object('participant_id',p.id,'competition_id',p.competition_id,'participant_type',p.participant_type,
    'name',p.full_name,'attempt',jsonb_build_object('id',a.id,'status',a.status,'score',a.score,'finalized_at',a.finalized_at),
    'rank',v_rank,'published',true);
end;
$$;
revoke all on function public.get_canonical_competition_result(uuid) from public, anon;
grant execute on function public.get_canonical_competition_result(uuid) to authenticated;

create or replace function public.get_my_canonical_competition_result(p_competition_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare v_pid uuid;
begin
  if auth.uid() is null then raise exception 'AUTHORIZATION_REQUIRED'; end if;
  select id into v_pid from public.participants
    where competition_id=p_competition_id and user_id=auth.uid() limit 1;
  if v_pid is null then raise exception 'PARTICIPANT_NOT_FOUND'; end if;
  return public.get_canonical_competition_result(v_pid);
end;
$$;
revoke all on function public.get_my_canonical_competition_result(uuid) from public, anon;
grant execute on function public.get_my_canonical_competition_result(uuid) to authenticated;
 then least(360,(v_c.config->>'duration_minutes')::integer)*60 else 1800 end),
    v_uid,v_uid)
  on conflict (competition_id) do nothing;
  select * into v_cfg from public.competition_exam_configs where competition_id=p_competition_id for update;

  select * into v_existing from public.attempts
    where competition_id=p_competition_id and participant_id=v_uid and status='IN_PROGRESS'
    order by attempt_number desc limit 1;
  if found then
    if not exists(select 1 from public.exam_attempt_sessions where attempt_id=v_existing.id) then
      select count(*) into v_count from public.attempts a join public.exam_attempt_sessions s on s.attempt_id=a.id
      where a.competition_id=p_competition_id and a.participant_id=v_uid;
      if v_count >= v_cfg.attempt_limit then raise exception 'ATTEMPT_LIMIT_REACHED'; end if;
      perform private.exam_initialize_attempt(v_existing.id);
    end if;
    return private.exam_state_payload(v_existing.id);
  end if;

  select count(*) into v_count from public.attempts a join public.exam_attempt_sessions s on s.attempt_id=a.id where a.competition_id=p_competition_id and a.participant_id=v_uid;
  if v_count >= v_cfg.attempt_limit then
    select * into v_existing from public.attempts where competition_id=p_competition_id and participant_id=v_uid order by attempt_number desc limit 1;
    if found and exists(select 1 from public.exam_attempt_sessions where attempt_id=v_existing.id) then
      return private.exam_state_payload(v_existing.id);
    end if;
    raise exception 'ATTEMPT_LIMIT_REACHED';
  end if;

  v_a := public.start_competition_attempt(p_competition_id);
  perform private.exam_initialize_attempt(v_a.id);
  return private.exam_state_payload(v_a.id);
end;
$;
revoke all on function public.start_sequential_exam(uuid) from public, anon;
grant execute on function public.start_sequential_exam(uuid) to authenticated;

create or replace function public.start_collective_sequential_exam(p_access_token text,p_competition_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare v_a public.attempts%rowtype; v_cp uuid:=private.collective_session_participant(p_access_token);
begin
  if v_cp is null then raise exception 'COLLECTIVE_SESSION_INVALID'; end if;
  v_a := public.start_collective_competition_attempt(p_access_token,p_competition_id);
  perform private.exam_initialize_attempt(v_a.id);
  return private.exam_state_payload(v_a.id);
end;
$$;
revoke all on function public.start_collective_sequential_exam(text,uuid) from public;
grant execute on function public.start_collective_sequential_exam(text,uuid) to anon, authenticated;

create or replace function public.get_sequential_exam_state(p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
begin
  if auth.uid() is null then raise exception 'AUTHORIZATION_REQUIRED'; end if;
  if not exists(select 1 from public.attempts where id=p_attempt_id and participant_id=auth.uid()) then raise exception 'ATTEMPT_NOT_FOUND'; end if;
  if not exists(select 1 from public.exam_attempt_sessions where attempt_id=p_attempt_id) then raise exception 'SEQUENTIAL_EXAM_NOT_INITIALIZED'; end if;
  return private.exam_state_payload(p_attempt_id);
end;
$$;
revoke all on function public.get_sequential_exam_state(uuid) from public, anon;
grant execute on function public.get_sequential_exam_state(uuid) to authenticated;

create or replace function public.get_collective_sequential_exam_state(p_access_token text,p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare v_cp uuid:=private.collective_session_participant(p_access_token);
begin
  if v_cp is null then raise exception 'COLLECTIVE_SESSION_INVALID'; end if;
  if not exists(select 1 from public.attempts where id=p_attempt_id and collective_participant_id=v_cp) then raise exception 'ATTEMPT_NOT_FOUND'; end if;
  if not exists(select 1 from public.exam_attempt_sessions where attempt_id=p_attempt_id) then raise exception 'SEQUENTIAL_EXAM_NOT_INITIALIZED'; end if;
  return private.exam_state_payload(p_attempt_id);
end;
$$;
revoke all on function public.get_collective_sequential_exam_state(text,uuid) from public;
grant execute on function public.get_collective_sequential_exam_state(text,uuid) to anon, authenticated;

create or replace function public.save_sequential_exam_answer(p_attempt_id uuid,p_question_id uuid,p_answer_json jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
begin
  if auth.uid() is null then raise exception 'AUTHORIZATION_REQUIRED'; end if;
  return private.exam_save_answer(p_attempt_id,p_question_id,p_answer_json,auth.uid(),null);
end;
$$;
revoke all on function public.save_sequential_exam_answer(uuid,uuid,jsonb) from public, anon;
grant execute on function public.save_sequential_exam_answer(uuid,uuid,jsonb) to authenticated;

create or replace function public.save_collective_sequential_exam_answer(p_access_token text,p_attempt_id uuid,p_question_id uuid,p_answer_json jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare v_cp uuid:=private.collective_session_participant(p_access_token);
begin
  if v_cp is null then raise exception 'COLLECTIVE_SESSION_INVALID'; end if;
  return private.exam_save_answer(p_attempt_id,p_question_id,p_answer_json,null,v_cp);
end;
$$;
revoke all on function public.save_collective_sequential_exam_answer(text,uuid,uuid,jsonb) from public;
grant execute on function public.save_collective_sequential_exam_answer(text,uuid,uuid,jsonb) to anon, authenticated;

create or replace function public.advance_sequential_exam_question(p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
begin
  if auth.uid() is null then raise exception 'AUTHORIZATION_REQUIRED'; end if;
  return private.exam_advance(p_attempt_id,auth.uid(),null);
end;
$$;
revoke all on function public.advance_sequential_exam_question(uuid) from public, anon;
grant execute on function public.advance_sequential_exam_question(uuid) to authenticated;

create or replace function public.advance_collective_sequential_exam_question(p_access_token text,p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare v_cp uuid:=private.collective_session_participant(p_access_token);
begin
  if v_cp is null then raise exception 'COLLECTIVE_SESSION_INVALID'; end if;
  return private.exam_advance(p_attempt_id,null,v_cp);
end;
$$;
revoke all on function public.advance_collective_sequential_exam_question(text,uuid) from public;
grant execute on function public.advance_collective_sequential_exam_question(text,uuid) to anon, authenticated;

create or replace function public.resolve_sequential_exam_timeout(p_attempt_id uuid,p_action text)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
begin
  if auth.uid() is null then raise exception 'AUTHORIZATION_REQUIRED'; end if;
  return private.exam_resolve_timeout(p_attempt_id,p_action,auth.uid(),null);
end;
$$;
revoke all on function public.resolve_sequential_exam_timeout(uuid,text) from public, anon;
grant execute on function public.resolve_sequential_exam_timeout(uuid,text) to authenticated;

create or replace function public.resolve_collective_sequential_exam_timeout(p_access_token text,p_attempt_id uuid,p_action text)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare v_cp uuid:=private.collective_session_participant(p_access_token);
begin
  if v_cp is null then raise exception 'COLLECTIVE_SESSION_INVALID'; end if;
  return private.exam_resolve_timeout(p_attempt_id,p_action,null,v_cp);
end;
$$;
revoke all on function public.resolve_collective_sequential_exam_timeout(text,uuid,text) from public;
grant execute on function public.resolve_collective_sequential_exam_timeout(text,uuid,text) to anon, authenticated;

create or replace function public.get_organizer_exam_config(p_competition_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare v_uid uuid:=auth.uid(); v_c public.competitions%rowtype; v_cfg public.competition_exam_configs%rowtype; v_count integer;
begin
  if v_uid is null or not private.exam_is_manager(p_competition_id,v_uid) then raise exception 'FORBIDDEN'; end if;
  select * into v_c from public.competitions where id=p_competition_id;
  if not found then raise exception 'COMPETITION_NOT_FOUND'; end if;
  insert into public.competition_exam_configs(competition_id,duration_seconds,created_by,updated_by)
  values(p_competition_id,
    greatest(60,case when coalesce(v_c.config->>'duration_minutes','') ~ '^[0-9]+$'
      then least(360,(v_c.config->>'duration_minutes')::integer)*60 else 1800 end),v_uid,v_uid)
  on conflict (competition_id) do nothing;
  select * into v_cfg from public.competition_exam_configs where competition_id=p_competition_id;
  select count(*) into v_count from public.questions where competition_id=p_competition_id and status='PUBLISHED';
  return to_jsonb(v_cfg)||jsonb_build_object('published_question_count',v_count,'frozen',v_cfg.frozen_at is not null);
end;
$$;
revoke all on function public.get_organizer_exam_config(uuid) from public, anon;
grant execute on function public.get_organizer_exam_config(uuid) to authenticated;

create or replace function public.save_organizer_exam_config(p_competition_id uuid,p_config jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare
  v_uid uuid:=auth.uid(); v_cfg public.competition_exam_configs%rowtype;
  v_duration integer; v_question_count integer; v_attempt_limit integer; v_decision integer; v_borrow integer;
  v_grace integer; v_minimum integer; v_rand_q boolean; v_rand_o boolean;
begin
  if v_uid is null or not private.exam_is_manager(p_competition_id,v_uid) then raise exception 'FORBIDDEN'; end if;
  select * into v_cfg from public.competition_exam_configs where competition_id=p_competition_id for update;
  if not found then raise exception 'EXAM_CONFIG_NOT_FOUND'; end if;
  if v_cfg.frozen_at is not null or exists(select 1 from public.exam_attempt_sessions where competition_id=p_competition_id) then
    raise exception 'EXAM_CONFIG_FROZEN';
  end if;
  v_duration := coalesce((p_config->>'duration_seconds')::integer,v_cfg.duration_seconds);
  v_question_count := nullif(p_config->>'question_count','')::integer;
  v_attempt_limit := coalesce((p_config->>'attempt_limit')::integer,v_cfg.attempt_limit);
  v_decision := coalesce((p_config->>'decision_window_seconds')::integer,v_cfg.decision_window_seconds);
  v_borrow := coalesce((p_config->>'borrow_seconds')::integer,v_cfg.borrow_seconds);
  v_grace := coalesce((p_config->>'overtime_grace_seconds')::integer,v_cfg.overtime_grace_seconds);
  v_minimum := coalesce((p_config->>'min_next_question_seconds')::integer,v_cfg.min_next_question_seconds);
  v_rand_q := coalesce((p_config->>'randomize_questions')::boolean,v_cfg.randomize_questions);
  v_rand_o := coalesce((p_config->>'randomize_options')::boolean,v_cfg.randomize_options);

  if v_duration not between 60 and 21600 then raise exception 'INVALID_DURATION_SECONDS'; end if;
  if v_question_count is not null and v_question_count not between 1 and 1000 then raise exception 'INVALID_QUESTION_COUNT'; end if;
  if v_attempt_limit not between 1 and 10 then raise exception 'INVALID_ATTEMPT_LIMIT'; end if;
  if v_decision not between 0 and 120 then raise exception 'INVALID_DECISION_WINDOW'; end if;
  if v_borrow not between 1 and 120 then raise exception 'INVALID_BORROW_SECONDS'; end if;
  if v_grace not between 0 and 120 then raise exception 'INVALID_GRACE_SECONDS'; end if;
  if v_minimum not between 5 and 300 then raise exception 'INVALID_MINIMUM_NEXT_TIME'; end if;

  update public.competition_exam_configs set
    duration_seconds=v_duration,question_count=v_question_count,attempt_limit=v_attempt_limit,
    decision_window_seconds=v_decision,borrow_seconds=v_borrow,overtime_grace_seconds=v_grace,
    min_next_question_seconds=v_minimum,randomize_questions=v_rand_q,randomize_options=v_rand_o,
    updated_by=v_uid,updated_at=clock_timestamp()
  where competition_id=p_competition_id returning * into v_cfg;
  return to_jsonb(v_cfg)||jsonb_build_object('frozen',false);
end;
$$;
revoke all on function public.save_organizer_exam_config(uuid,jsonb) from public, anon;
grant execute on function public.save_organizer_exam_config(uuid,jsonb) to authenticated;

create or replace function public.get_organizer_exam_monitor(p_competition_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare v_uid uuid:=auth.uid(); v_output jsonb;
begin
  if v_uid is null or not private.exam_is_manager(p_competition_id,v_uid) then raise exception 'FORBIDDEN'; end if;
  with base as (
    select a.id attempt_id,a.status attempt_status,a.started_at,a.submitted_at,
      s.current_question_index,s.question_count,s.state exam_state,s.current_question_deadline,
      coalesce(cp.full_name,p.full_name,p.username,'Peserta') participant_name,
      cp.participant_code,
      coalesce((select count(*) from public.exam_attempt_questions eq where eq.attempt_id=a.id and eq.state in ('ANSWERED','OVERTIME_ANSWERED')),0) answered_count,
      coalesce((select count(*) from public.exam_attempt_questions eq where eq.attempt_id=a.id and eq.state='TIMEOUT'),0) timeout_count,
      coalesce((select count(*) from public.exam_attempt_questions eq where eq.attempt_id=a.id and eq.state='SKIPPED'),0) skipped_count,
      coalesce((select jsonb_agg(jsonb_build_object('question_index',eq.question_index,'state',eq.state,
        'allocated_seconds',eq.allocated_seconds,'elapsed_seconds',eq.elapsed_seconds,
        'borrowed_seconds',eq.borrowed_seconds,'grace_seconds_used',eq.grace_seconds_used,
        'opened_at',eq.opened_at,'closed_at',eq.closed_at) order by eq.question_index)
        from public.exam_attempt_questions eq where eq.attempt_id=a.id),'[]'::jsonb) questions
    from public.attempts a
    join public.exam_attempt_sessions s on s.attempt_id=a.id
    left join public.profiles p on p.id=a.participant_id
    left join public.collective_participants cp on cp.id=a.collective_participant_id
    where a.competition_id=p_competition_id
    order by a.started_at desc nulls last
    limit 200
  )
  select jsonb_build_object(
    'total',count(*),
    'active',count(*) filter(where exam_state in ('ACTIVE','TIMEOUT_DECISION','OVERTIME')),
    'completed',count(*) filter(where exam_state='COMPLETED'),
    'timed_out',coalesce(sum(timeout_count),0),
    'skipped',coalesce(sum(skipped_count),0),
    'sessions',coalesce(jsonb_agg(to_jsonb(base) order by started_at desc nulls last),'[]'::jsonb)
  ) into v_output from base;
  return coalesce(v_output,'{"total":0,"active":0,"completed":0,"timed_out":0,"skipped":0,"sessions":[]}'::jsonb);
end;
$$;
revoke all on function public.get_organizer_exam_monitor(uuid) from public, anon;
grant execute on function public.get_organizer_exam_monitor(uuid) to authenticated;

-- Direct access to exam snapshots, answer keys and logs stays private. Legacy APIs are
-- blocked only for competitions configured for the sequential engine; other legacy data
-- is left in place for a safe migration window.
create or replace function private.guard_sequential_exam_answer_write()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare v_attempt_id uuid;
begin
  v_attempt_id := case when tg_op='DELETE' then old.attempt_id else new.attempt_id end;
  if exists (
    select 1 from public.attempts a
    join public.competition_exam_configs c on c.competition_id=a.competition_id
    where a.id=v_attempt_id
  ) and coalesce(current_setting('app.sequential_exam_rpc',true),'') <> 'on' then
    raise exception 'SEQUENTIAL_EXAM_ENGINE_REQUIRED';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function private.guard_sequential_exam_answer_write() from public, anon, authenticated;
drop trigger if exists guard_sequential_exam_answer_write on public.answers;
create trigger guard_sequential_exam_answer_write
before insert or update or delete on public.answers
for each row execute function private.guard_sequential_exam_answer_write();

create or replace function private.guard_sequential_exam_attempt_transition()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
begin
  if new.status is distinct from old.status
    and new.status in ('SUBMITTED','GRADING','FINALIZED','EXPIRED')
    and exists(select 1 from public.competition_exam_configs c where c.competition_id=new.competition_id)
    and coalesce(current_setting('app.sequential_exam_rpc',true),'') <> 'on' then
    raise exception 'SEQUENTIAL_EXAM_ENGINE_REQUIRED';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_sequential_exam_attempt_transition() from public, anon, authenticated;
drop trigger if exists guard_sequential_exam_attempt_transition on public.attempts;
create trigger guard_sequential_exam_attempt_transition
before update of status on public.attempts
for each row execute function private.guard_sequential_exam_attempt_transition();

-- Existing participant question RPCs must not reveal the complete question set once
-- a competition opts into the sequential engine.
create or replace function public.get_participant_questions(p_competition_id uuid)
returns table(id uuid,type text,prompt text,points numeric,required boolean,display_order integer,config jsonb,options jsonb)
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
begin
  if exists(select 1 from public.competition_exam_configs where competition_id=p_competition_id) then
    raise exception 'SEQUENTIAL_EXAM_ENGINE_REQUIRED';
  end if;
  return query
  select q.id,q.type,q.prompt,q.points,q.required,q.display_order,
    (coalesce(q.config,'{}'::jsonb)-'accepted_answers'-'correct_answer'-'answer_key'-'correct_option_id') as config,
    coalesce(jsonb_agg(jsonb_build_object('id',qo.id,'label',qo.label) order by qo.display_order,qo.id)
      filter(where qo.id is not null),'[]'::jsonb) as options
  from public.questions q
  left join public.question_options qo on qo.question_id=q.id
  join public.registrations r on r.competition_id=q.competition_id and r.user_id=auth.uid() and r.status in ('APPROVED','ACTIVE')
  join public.competitions c on c.id=q.competition_id and c.status='LIVE'
  where q.competition_id=p_competition_id and q.status='PUBLISHED'
  group by q.id
  order by q.display_order,q.id;
end;
$$;
revoke all on function public.get_participant_questions(uuid) from public, anon;
grant execute on function public.get_participant_questions(uuid) to authenticated;

create or replace function public.get_attempt_resume(p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare u uuid:=auth.uid(); a public.attempts; c public.competitions; qs jsonb; ans jsonb;
begin
  if u is null then raise exception 'AUTHORIZATION_REQUIRED'; end if;
  select * into a from public.attempts where id=p_attempt_id and participant_id=u;
  if not found then raise exception 'ATTEMPT_NOT_FOUND'; end if;
  if exists(select 1 from public.competition_exam_configs where competition_id=a.competition_id) then
    raise exception 'SEQUENTIAL_EXAM_ENGINE_REQUIRED';
  end if;
  select * into c from public.competitions where id=a.competition_id;
  select coalesce(jsonb_agg(qobj order by qobj->>'display_order'),'[]'::jsonb) into qs from (
    select jsonb_build_object('id',q.id,'type',q.type,'prompt',q.prompt,'points',q.points,'required',q.required,
      'display_order',q.display_order,'config',(coalesce(q.config,'{}'::jsonb)-'accepted_answers'-'correct_answer'-'answer_key'-'correct_option_id'),
      'options',coalesce((select jsonb_agg(jsonb_build_object('id',qo.id,'label',qo.label) order by qo.display_order)
      from public.question_options qo where qo.question_id=q.id),'[]'::jsonb)) qobj
    from public.questions q where q.competition_id=a.competition_id and q.status='PUBLISHED'
  ) t;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.saved_at),'[]'::jsonb) into ans from public.answers x where x.attempt_id=a.id;
  return jsonb_build_object('attempt',to_jsonb(a)-'score','competition',to_jsonb(c),'questions',qs,'answers',ans);
end;
$$;
revoke all on function public.get_attempt_resume(uuid) from public, anon;
grant execute on function public.get_attempt_resume(uuid) to authenticated;

create or replace function public.get_collective_participant_questions(p_access_token text,p_competition_id uuid)
returns table(id uuid,type text,prompt text,points numeric,required boolean,display_order integer,config jsonb,options jsonb)
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare v_cp uuid:=private.collective_session_participant(p_access_token);
begin
  if v_cp is null then raise exception 'COLLECTIVE_SESSION_INVALID'; end if;
  if exists(select 1 from public.competition_exam_configs where competition_id=p_competition_id) then
    raise exception 'SEQUENTIAL_EXAM_ENGINE_REQUIRED';
  end if;
  if not exists(select 1 from public.collective_participants where id=v_cp and competition_id=p_competition_id and status='ACTIVE') then
    raise exception 'PARTICIPANT_NOT_REGISTERED';
  end if;
  return query
  select q.id,q.type,q.prompt,q.points,q.required,q.display_order,
    (coalesce(q.config,'{}'::jsonb)-'accepted_answers'-'correct_answer'-'answer_key'-'correct_option_id') as config,
    coalesce(jsonb_agg(jsonb_build_object('id',qo.id,'label',qo.label,'value',qo.value) order by qo.display_order,qo.id)
      filter(where qo.id is not null),'[]'::jsonb) as options
  from public.questions q left join public.question_options qo on qo.question_id=q.id
  join public.competitions c on c.id=q.competition_id and c.status='LIVE'
  where q.competition_id=p_competition_id and q.status='PUBLISHED'
  group by q.id order by q.display_order,q.id;
end;
$$;
revoke all on function public.get_collective_participant_questions(text,uuid) from public;
grant execute on function public.get_collective_participant_questions(text,uuid) to anon, authenticated;

-- A completed attempt's score/rank is withheld until the organizer publishes results.
create or replace function public.get_canonical_competition_result(p_participant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare p public.participants; a public.attempts; v_rank bigint; c public.competitions;
begin
  select * into p from public.participants where id=p_participant_id;
  if not found then raise exception 'PARTICIPANT_NOT_FOUND'; end if;
  if not private.current_user_is_admin()
    and (p.user_id is null or p.user_id<>auth.uid())
    and not exists(select 1 from public.collective_participants cp where cp.id=p.collective_participant_id and cp.managed_by_user_id=auth.uid()) then
    raise exception 'NOT_AUTHORIZED';
  end if;
  select * into c from public.competitions where id=p.competition_id;
  if c.status not in ('RESULT_PUBLISHED','ARCHIVED') then
    return jsonb_build_object('participant_id',p.id,'competition_id',p.competition_id,
      'participant_type',p.participant_type,'name',p.full_name,'attempt',null,'rank',null,'published',false);
  end if;
  select * into a from public.attempts where canonical_participant_id=p.id and status='FINALIZED'
    order by finalized_at desc nulls last,created_at desc limit 1;
  if not found then
    return jsonb_build_object('participant_id',p.id,'competition_id',p.competition_id,'participant_type',p.participant_type,
      'name',p.full_name,'attempt',null,'rank',null,'published',true);
  end if;
  select 1+count(*) into v_rank from public.attempts x
    where x.competition_id=p.competition_id and x.status='FINALIZED'
      and x.canonical_participant_id is not null and x.score>a.score;
  return jsonb_build_object('participant_id',p.id,'competition_id',p.competition_id,'participant_type',p.participant_type,
    'name',p.full_name,'attempt',jsonb_build_object('id',a.id,'status',a.status,'score',a.score,'finalized_at',a.finalized_at),
    'rank',v_rank,'published',true);
end;
$$;
revoke all on function public.get_canonical_competition_result(uuid) from public, anon;
grant execute on function public.get_canonical_competition_result(uuid) to authenticated;

create or replace function public.get_my_canonical_competition_result(p_competition_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare v_pid uuid;
begin
  if auth.uid() is null then raise exception 'AUTHORIZATION_REQUIRED'; end if;
  select id into v_pid from public.participants
    where competition_id=p_competition_id and user_id=auth.uid() limit 1;
  if v_pid is null then raise exception 'PARTICIPANT_NOT_FOUND'; end if;
  return public.get_canonical_competition_result(v_pid);
end;
$$;
revoke all on function public.get_my_canonical_competition_result(uuid) from public, anon;
grant execute on function public.get_my_canonical_competition_result(uuid) to authenticated;
 then least(360,(v_c.config->>'duration_minutes')::integer)*60 else 1800 end))
  on conflict (competition_id) do nothing;
  select * into v_cfg from public.competition_exam_configs where competition_id=p_competition_id for update;

  select * into v_existing from public.attempts
    where competition_id=p_competition_id and collective_participant_id=v_cp and status='IN_PROGRESS'
    order by attempt_number desc limit 1;
  if found then
    if not exists(select 1 from public.exam_attempt_sessions where attempt_id=v_existing.id) then
      select count(*) into v_count from public.attempts a join public.exam_attempt_sessions s on s.attempt_id=a.id
      where a.competition_id=p_competition_id and a.collective_participant_id=v_cp;
      if v_count >= v_cfg.attempt_limit then raise exception 'ATTEMPT_LIMIT_REACHED'; end if;
      perform private.exam_initialize_attempt(v_existing.id);
    end if;
    return private.exam_state_payload(v_existing.id);
  end if;

  select count(*) into v_count from public.attempts a join public.exam_attempt_sessions s on s.attempt_id=a.id where a.competition_id=p_competition_id and a.collective_participant_id=v_cp;
  if v_count >= v_cfg.attempt_limit then
    select * into v_existing from public.attempts where competition_id=p_competition_id and collective_participant_id=v_cp order by attempt_number desc limit 1;
    if found and exists(select 1 from public.exam_attempt_sessions where attempt_id=v_existing.id) then
      return private.exam_state_payload(v_existing.id);
    end if;
    raise exception 'ATTEMPT_LIMIT_REACHED';
  end if;

  v_a := public.start_collective_competition_attempt(p_access_token,p_competition_id);
  perform private.exam_initialize_attempt(v_a.id);
  return private.exam_state_payload(v_a.id);
end;
$;
revoke all on function public.start_collective_sequential_exam(text,uuid) from public;
grant execute on function public.start_collective_sequential_exam(text,uuid) to anon, authenticated;

create or replace function public.get_sequential_exam_state(p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
begin
  if auth.uid() is null then raise exception 'AUTHORIZATION_REQUIRED'; end if;
  if not exists(select 1 from public.attempts where id=p_attempt_id and participant_id=auth.uid()) then raise exception 'ATTEMPT_NOT_FOUND'; end if;
  if not exists(select 1 from public.exam_attempt_sessions where attempt_id=p_attempt_id) then raise exception 'SEQUENTIAL_EXAM_NOT_INITIALIZED'; end if;
  return private.exam_state_payload(p_attempt_id);
end;
$$;
revoke all on function public.get_sequential_exam_state(uuid) from public, anon;
grant execute on function public.get_sequential_exam_state(uuid) to authenticated;

create or replace function public.get_collective_sequential_exam_state(p_access_token text,p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare v_cp uuid:=private.collective_session_participant(p_access_token);
begin
  if v_cp is null then raise exception 'COLLECTIVE_SESSION_INVALID'; end if;
  if not exists(select 1 from public.attempts where id=p_attempt_id and collective_participant_id=v_cp) then raise exception 'ATTEMPT_NOT_FOUND'; end if;
  if not exists(select 1 from public.exam_attempt_sessions where attempt_id=p_attempt_id) then raise exception 'SEQUENTIAL_EXAM_NOT_INITIALIZED'; end if;
  return private.exam_state_payload(p_attempt_id);
end;
$$;
revoke all on function public.get_collective_sequential_exam_state(text,uuid) from public;
grant execute on function public.get_collective_sequential_exam_state(text,uuid) to anon, authenticated;

create or replace function public.save_sequential_exam_answer(p_attempt_id uuid,p_question_id uuid,p_answer_json jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
begin
  if auth.uid() is null then raise exception 'AUTHORIZATION_REQUIRED'; end if;
  return private.exam_save_answer(p_attempt_id,p_question_id,p_answer_json,auth.uid(),null);
end;
$$;
revoke all on function public.save_sequential_exam_answer(uuid,uuid,jsonb) from public, anon;
grant execute on function public.save_sequential_exam_answer(uuid,uuid,jsonb) to authenticated;

create or replace function public.save_collective_sequential_exam_answer(p_access_token text,p_attempt_id uuid,p_question_id uuid,p_answer_json jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare v_cp uuid:=private.collective_session_participant(p_access_token);
begin
  if v_cp is null then raise exception 'COLLECTIVE_SESSION_INVALID'; end if;
  return private.exam_save_answer(p_attempt_id,p_question_id,p_answer_json,null,v_cp);
end;
$$;
revoke all on function public.save_collective_sequential_exam_answer(text,uuid,uuid,jsonb) from public;
grant execute on function public.save_collective_sequential_exam_answer(text,uuid,uuid,jsonb) to anon, authenticated;

create or replace function public.advance_sequential_exam_question(p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
begin
  if auth.uid() is null then raise exception 'AUTHORIZATION_REQUIRED'; end if;
  return private.exam_advance(p_attempt_id,auth.uid(),null);
end;
$$;
revoke all on function public.advance_sequential_exam_question(uuid) from public, anon;
grant execute on function public.advance_sequential_exam_question(uuid) to authenticated;

create or replace function public.advance_collective_sequential_exam_question(p_access_token text,p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare v_cp uuid:=private.collective_session_participant(p_access_token);
begin
  if v_cp is null then raise exception 'COLLECTIVE_SESSION_INVALID'; end if;
  return private.exam_advance(p_attempt_id,null,v_cp);
end;
$$;
revoke all on function public.advance_collective_sequential_exam_question(text,uuid) from public;
grant execute on function public.advance_collective_sequential_exam_question(text,uuid) to anon, authenticated;

create or replace function public.resolve_sequential_exam_timeout(p_attempt_id uuid,p_action text)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
begin
  if auth.uid() is null then raise exception 'AUTHORIZATION_REQUIRED'; end if;
  return private.exam_resolve_timeout(p_attempt_id,p_action,auth.uid(),null);
end;
$$;
revoke all on function public.resolve_sequential_exam_timeout(uuid,text) from public, anon;
grant execute on function public.resolve_sequential_exam_timeout(uuid,text) to authenticated;

create or replace function public.resolve_collective_sequential_exam_timeout(p_access_token text,p_attempt_id uuid,p_action text)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare v_cp uuid:=private.collective_session_participant(p_access_token);
begin
  if v_cp is null then raise exception 'COLLECTIVE_SESSION_INVALID'; end if;
  return private.exam_resolve_timeout(p_attempt_id,p_action,null,v_cp);
end;
$$;
revoke all on function public.resolve_collective_sequential_exam_timeout(text,uuid,text) from public;
grant execute on function public.resolve_collective_sequential_exam_timeout(text,uuid,text) to anon, authenticated;

create or replace function public.get_organizer_exam_config(p_competition_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare v_uid uuid:=auth.uid(); v_c public.competitions%rowtype; v_cfg public.competition_exam_configs%rowtype; v_count integer;
begin
  if v_uid is null or not private.exam_is_manager(p_competition_id,v_uid) then raise exception 'FORBIDDEN'; end if;
  select * into v_c from public.competitions where id=p_competition_id;
  if not found then raise exception 'COMPETITION_NOT_FOUND'; end if;
  insert into public.competition_exam_configs(competition_id,duration_seconds,created_by,updated_by)
  values(p_competition_id,
    greatest(60,case when coalesce(v_c.config->>'duration_minutes','') ~ '^[0-9]+$'
      then least(360,(v_c.config->>'duration_minutes')::integer)*60 else 1800 end),v_uid,v_uid)
  on conflict (competition_id) do nothing;
  select * into v_cfg from public.competition_exam_configs where competition_id=p_competition_id;
  select count(*) into v_count from public.questions where competition_id=p_competition_id and status='PUBLISHED';
  return to_jsonb(v_cfg)||jsonb_build_object('published_question_count',v_count,'frozen',v_cfg.frozen_at is not null);
end;
$$;
revoke all on function public.get_organizer_exam_config(uuid) from public, anon;
grant execute on function public.get_organizer_exam_config(uuid) to authenticated;

create or replace function public.save_organizer_exam_config(p_competition_id uuid,p_config jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare
  v_uid uuid:=auth.uid(); v_cfg public.competition_exam_configs%rowtype;
  v_duration integer; v_question_count integer; v_attempt_limit integer; v_decision integer; v_borrow integer;
  v_grace integer; v_minimum integer; v_rand_q boolean; v_rand_o boolean;
begin
  if v_uid is null or not private.exam_is_manager(p_competition_id,v_uid) then raise exception 'FORBIDDEN'; end if;
  select * into v_cfg from public.competition_exam_configs where competition_id=p_competition_id for update;
  if not found then raise exception 'EXAM_CONFIG_NOT_FOUND'; end if;
  if v_cfg.frozen_at is not null or exists(select 1 from public.exam_attempt_sessions where competition_id=p_competition_id) then
    raise exception 'EXAM_CONFIG_FROZEN';
  end if;
  v_duration := coalesce((p_config->>'duration_seconds')::integer,v_cfg.duration_seconds);
  v_question_count := nullif(p_config->>'question_count','')::integer;
  v_attempt_limit := coalesce((p_config->>'attempt_limit')::integer,v_cfg.attempt_limit);
  v_decision := coalesce((p_config->>'decision_window_seconds')::integer,v_cfg.decision_window_seconds);
  v_borrow := coalesce((p_config->>'borrow_seconds')::integer,v_cfg.borrow_seconds);
  v_grace := coalesce((p_config->>'overtime_grace_seconds')::integer,v_cfg.overtime_grace_seconds);
  v_minimum := coalesce((p_config->>'min_next_question_seconds')::integer,v_cfg.min_next_question_seconds);
  v_rand_q := coalesce((p_config->>'randomize_questions')::boolean,v_cfg.randomize_questions);
  v_rand_o := coalesce((p_config->>'randomize_options')::boolean,v_cfg.randomize_options);

  if v_duration not between 60 and 21600 then raise exception 'INVALID_DURATION_SECONDS'; end if;
  if v_question_count is not null and v_question_count not between 1 and 1000 then raise exception 'INVALID_QUESTION_COUNT'; end if;
  if v_attempt_limit not between 1 and 10 then raise exception 'INVALID_ATTEMPT_LIMIT'; end if;
  if v_decision not between 0 and 120 then raise exception 'INVALID_DECISION_WINDOW'; end if;
  if v_borrow not between 1 and 120 then raise exception 'INVALID_BORROW_SECONDS'; end if;
  if v_grace not between 0 and 120 then raise exception 'INVALID_GRACE_SECONDS'; end if;
  if v_minimum not between 5 and 300 then raise exception 'INVALID_MINIMUM_NEXT_TIME'; end if;

  update public.competition_exam_configs set
    duration_seconds=v_duration,question_count=v_question_count,attempt_limit=v_attempt_limit,
    decision_window_seconds=v_decision,borrow_seconds=v_borrow,overtime_grace_seconds=v_grace,
    min_next_question_seconds=v_minimum,randomize_questions=v_rand_q,randomize_options=v_rand_o,
    updated_by=v_uid,updated_at=clock_timestamp()
  where competition_id=p_competition_id returning * into v_cfg;
  return to_jsonb(v_cfg)||jsonb_build_object('frozen',false);
end;
$$;
revoke all on function public.save_organizer_exam_config(uuid,jsonb) from public, anon;
grant execute on function public.save_organizer_exam_config(uuid,jsonb) to authenticated;

create or replace function public.get_organizer_exam_monitor(p_competition_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare v_uid uuid:=auth.uid(); v_output jsonb;
begin
  if v_uid is null or not private.exam_is_manager(p_competition_id,v_uid) then raise exception 'FORBIDDEN'; end if;
  with base as (
    select a.id attempt_id,a.status attempt_status,a.started_at,a.submitted_at,
      s.current_question_index,s.question_count,s.state exam_state,s.current_question_deadline,
      coalesce(cp.full_name,p.full_name,p.username,'Peserta') participant_name,
      cp.participant_code,
      coalesce((select count(*) from public.exam_attempt_questions eq where eq.attempt_id=a.id and eq.state in ('ANSWERED','OVERTIME_ANSWERED')),0) answered_count,
      coalesce((select count(*) from public.exam_attempt_questions eq where eq.attempt_id=a.id and eq.state='TIMEOUT'),0) timeout_count,
      coalesce((select count(*) from public.exam_attempt_questions eq where eq.attempt_id=a.id and eq.state='SKIPPED'),0) skipped_count,
      coalesce((select jsonb_agg(jsonb_build_object('question_index',eq.question_index,'state',eq.state,
        'allocated_seconds',eq.allocated_seconds,'elapsed_seconds',eq.elapsed_seconds,
        'borrowed_seconds',eq.borrowed_seconds,'grace_seconds_used',eq.grace_seconds_used,
        'opened_at',eq.opened_at,'closed_at',eq.closed_at) order by eq.question_index)
        from public.exam_attempt_questions eq where eq.attempt_id=a.id),'[]'::jsonb) questions
    from public.attempts a
    join public.exam_attempt_sessions s on s.attempt_id=a.id
    left join public.profiles p on p.id=a.participant_id
    left join public.collective_participants cp on cp.id=a.collective_participant_id
    where a.competition_id=p_competition_id
    order by a.started_at desc nulls last
    limit 200
  )
  select jsonb_build_object(
    'total',count(*),
    'active',count(*) filter(where exam_state in ('ACTIVE','TIMEOUT_DECISION','OVERTIME')),
    'completed',count(*) filter(where exam_state='COMPLETED'),
    'timed_out',coalesce(sum(timeout_count),0),
    'skipped',coalesce(sum(skipped_count),0),
    'sessions',coalesce(jsonb_agg(to_jsonb(base) order by started_at desc nulls last),'[]'::jsonb)
  ) into v_output from base;
  return coalesce(v_output,'{"total":0,"active":0,"completed":0,"timed_out":0,"skipped":0,"sessions":[]}'::jsonb);
end;
$$;
revoke all on function public.get_organizer_exam_monitor(uuid) from public, anon;
grant execute on function public.get_organizer_exam_monitor(uuid) to authenticated;

-- Direct access to exam snapshots, answer keys and logs stays private. Legacy APIs are
-- blocked only for competitions configured for the sequential engine; other legacy data
-- is left in place for a safe migration window.
create or replace function private.guard_sequential_exam_answer_write()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare v_attempt_id uuid;
begin
  v_attempt_id := case when tg_op='DELETE' then old.attempt_id else new.attempt_id end;
  if exists (
    select 1 from public.attempts a
    join public.competition_exam_configs c on c.competition_id=a.competition_id
    where a.id=v_attempt_id
  ) and coalesce(current_setting('app.sequential_exam_rpc',true),'') <> 'on' then
    raise exception 'SEQUENTIAL_EXAM_ENGINE_REQUIRED';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function private.guard_sequential_exam_answer_write() from public, anon, authenticated;
drop trigger if exists guard_sequential_exam_answer_write on public.answers;
create trigger guard_sequential_exam_answer_write
before insert or update or delete on public.answers
for each row execute function private.guard_sequential_exam_answer_write();

create or replace function private.guard_sequential_exam_attempt_transition()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
begin
  if new.status is distinct from old.status
    and new.status in ('SUBMITTED','GRADING','FINALIZED','EXPIRED')
    and exists(select 1 from public.competition_exam_configs c where c.competition_id=new.competition_id)
    and coalesce(current_setting('app.sequential_exam_rpc',true),'') <> 'on' then
    raise exception 'SEQUENTIAL_EXAM_ENGINE_REQUIRED';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_sequential_exam_attempt_transition() from public, anon, authenticated;
drop trigger if exists guard_sequential_exam_attempt_transition on public.attempts;
create trigger guard_sequential_exam_attempt_transition
before update of status on public.attempts
for each row execute function private.guard_sequential_exam_attempt_transition();

-- Existing participant question RPCs must not reveal the complete question set once
-- a competition opts into the sequential engine.
create or replace function public.get_participant_questions(p_competition_id uuid)
returns table(id uuid,type text,prompt text,points numeric,required boolean,display_order integer,config jsonb,options jsonb)
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
begin
  if exists(select 1 from public.competition_exam_configs where competition_id=p_competition_id) then
    raise exception 'SEQUENTIAL_EXAM_ENGINE_REQUIRED';
  end if;
  return query
  select q.id,q.type,q.prompt,q.points,q.required,q.display_order,
    (coalesce(q.config,'{}'::jsonb)-'accepted_answers'-'correct_answer'-'answer_key'-'correct_option_id') as config,
    coalesce(jsonb_agg(jsonb_build_object('id',qo.id,'label',qo.label) order by qo.display_order,qo.id)
      filter(where qo.id is not null),'[]'::jsonb) as options
  from public.questions q
  left join public.question_options qo on qo.question_id=q.id
  join public.registrations r on r.competition_id=q.competition_id and r.user_id=auth.uid() and r.status in ('APPROVED','ACTIVE')
  join public.competitions c on c.id=q.competition_id and c.status='LIVE'
  where q.competition_id=p_competition_id and q.status='PUBLISHED'
  group by q.id
  order by q.display_order,q.id;
end;
$$;
revoke all on function public.get_participant_questions(uuid) from public, anon;
grant execute on function public.get_participant_questions(uuid) to authenticated;

create or replace function public.get_attempt_resume(p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare u uuid:=auth.uid(); a public.attempts; c public.competitions; qs jsonb; ans jsonb;
begin
  if u is null then raise exception 'AUTHORIZATION_REQUIRED'; end if;
  select * into a from public.attempts where id=p_attempt_id and participant_id=u;
  if not found then raise exception 'ATTEMPT_NOT_FOUND'; end if;
  if exists(select 1 from public.competition_exam_configs where competition_id=a.competition_id) then
    raise exception 'SEQUENTIAL_EXAM_ENGINE_REQUIRED';
  end if;
  select * into c from public.competitions where id=a.competition_id;
  select coalesce(jsonb_agg(qobj order by qobj->>'display_order'),'[]'::jsonb) into qs from (
    select jsonb_build_object('id',q.id,'type',q.type,'prompt',q.prompt,'points',q.points,'required',q.required,
      'display_order',q.display_order,'config',(coalesce(q.config,'{}'::jsonb)-'accepted_answers'-'correct_answer'-'answer_key'-'correct_option_id'),
      'options',coalesce((select jsonb_agg(jsonb_build_object('id',qo.id,'label',qo.label) order by qo.display_order)
      from public.question_options qo where qo.question_id=q.id),'[]'::jsonb)) qobj
    from public.questions q where q.competition_id=a.competition_id and q.status='PUBLISHED'
  ) t;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.saved_at),'[]'::jsonb) into ans from public.answers x where x.attempt_id=a.id;
  return jsonb_build_object('attempt',to_jsonb(a)-'score','competition',to_jsonb(c),'questions',qs,'answers',ans);
end;
$$;
revoke all on function public.get_attempt_resume(uuid) from public, anon;
grant execute on function public.get_attempt_resume(uuid) to authenticated;

create or replace function public.get_collective_participant_questions(p_access_token text,p_competition_id uuid)
returns table(id uuid,type text,prompt text,points numeric,required boolean,display_order integer,config jsonb,options jsonb)
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare v_cp uuid:=private.collective_session_participant(p_access_token);
begin
  if v_cp is null then raise exception 'COLLECTIVE_SESSION_INVALID'; end if;
  if exists(select 1 from public.competition_exam_configs where competition_id=p_competition_id) then
    raise exception 'SEQUENTIAL_EXAM_ENGINE_REQUIRED';
  end if;
  if not exists(select 1 from public.collective_participants where id=v_cp and competition_id=p_competition_id and status='ACTIVE') then
    raise exception 'PARTICIPANT_NOT_REGISTERED';
  end if;
  return query
  select q.id,q.type,q.prompt,q.points,q.required,q.display_order,
    (coalesce(q.config,'{}'::jsonb)-'accepted_answers'-'correct_answer'-'answer_key'-'correct_option_id') as config,
    coalesce(jsonb_agg(jsonb_build_object('id',qo.id,'label',qo.label,'value',qo.value) order by qo.display_order,qo.id)
      filter(where qo.id is not null),'[]'::jsonb) as options
  from public.questions q left join public.question_options qo on qo.question_id=q.id
  join public.competitions c on c.id=q.competition_id and c.status='LIVE'
  where q.competition_id=p_competition_id and q.status='PUBLISHED'
  group by q.id order by q.display_order,q.id;
end;
$$;
revoke all on function public.get_collective_participant_questions(text,uuid) from public;
grant execute on function public.get_collective_participant_questions(text,uuid) to anon, authenticated;

-- A completed attempt's score/rank is withheld until the organizer publishes results.
create or replace function public.get_canonical_competition_result(p_participant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare p public.participants; a public.attempts; v_rank bigint; c public.competitions;
begin
  select * into p from public.participants where id=p_participant_id;
  if not found then raise exception 'PARTICIPANT_NOT_FOUND'; end if;
  if not private.current_user_is_admin()
    and (p.user_id is null or p.user_id<>auth.uid())
    and not exists(select 1 from public.collective_participants cp where cp.id=p.collective_participant_id and cp.managed_by_user_id=auth.uid()) then
    raise exception 'NOT_AUTHORIZED';
  end if;
  select * into c from public.competitions where id=p.competition_id;
  if c.status not in ('RESULT_PUBLISHED','ARCHIVED') then
    return jsonb_build_object('participant_id',p.id,'competition_id',p.competition_id,
      'participant_type',p.participant_type,'name',p.full_name,'attempt',null,'rank',null,'published',false);
  end if;
  select * into a from public.attempts where canonical_participant_id=p.id and status='FINALIZED'
    order by finalized_at desc nulls last,created_at desc limit 1;
  if not found then
    return jsonb_build_object('participant_id',p.id,'competition_id',p.competition_id,'participant_type',p.participant_type,
      'name',p.full_name,'attempt',null,'rank',null,'published',true);
  end if;
  select 1+count(*) into v_rank from public.attempts x
    where x.competition_id=p.competition_id and x.status='FINALIZED'
      and x.canonical_participant_id is not null and x.score>a.score;
  return jsonb_build_object('participant_id',p.id,'competition_id',p.competition_id,'participant_type',p.participant_type,
    'name',p.full_name,'attempt',jsonb_build_object('id',a.id,'status',a.status,'score',a.score,'finalized_at',a.finalized_at),
    'rank',v_rank,'published',true);
end;
$$;
revoke all on function public.get_canonical_competition_result(uuid) from public, anon;
grant execute on function public.get_canonical_competition_result(uuid) to authenticated;

create or replace function public.get_my_canonical_competition_result(p_competition_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare v_pid uuid;
begin
  if auth.uid() is null then raise exception 'AUTHORIZATION_REQUIRED'; end if;
  select id into v_pid from public.participants
    where competition_id=p_competition_id and user_id=auth.uid() limit 1;
  if v_pid is null then raise exception 'PARTICIPANT_NOT_FOUND'; end if;
  return public.get_canonical_competition_result(v_pid);
end;
$$;
revoke all on function public.get_my_canonical_competition_result(uuid) from public, anon;
grant execute on function public.get_my_canonical_competition_result(uuid) to authenticated;
 then least(360,(v_c.config->>'duration_minutes')::integer)*60 else 1800 end),
    v_uid,v_uid)
  on conflict (competition_id) do nothing;
  select * into v_cfg from public.competition_exam_configs where competition_id=p_competition_id for update;

  select * into v_existing from public.attempts
    where competition_id=p_competition_id and participant_id=v_uid and status='IN_PROGRESS'
    order by attempt_number desc limit 1;
  if found then
    if not exists(select 1 from public.exam_attempt_sessions where attempt_id=v_existing.id) then perform private.exam_initialize_attempt(v_existing.id); end if;
    return private.exam_state_payload(v_existing.id);
  end if;

  select count(*) into v_count from public.attempts where competition_id=p_competition_id and participant_id=v_uid;
  if v_count >= v_cfg.attempt_limit then
    select * into v_existing from public.attempts where competition_id=p_competition_id and participant_id=v_uid order by attempt_number desc limit 1;
    if found and exists(select 1 from public.exam_attempt_sessions where attempt_id=v_existing.id) then
      return private.exam_state_payload(v_existing.id);
    end if;
    raise exception 'ATTEMPT_LIMIT_REACHED';
  end if;

  v_a := public.start_competition_attempt(p_competition_id);
  perform private.exam_initialize_attempt(v_a.id);
  return private.exam_state_payload(v_a.id);
end;
$;
revoke all on function public.start_sequential_exam(uuid) from public, anon;
grant execute on function public.start_sequential_exam(uuid) to authenticated;

create or replace function public.start_collective_sequential_exam(p_access_token text,p_competition_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare v_a public.attempts%rowtype; v_cp uuid:=private.collective_session_participant(p_access_token);
begin
  if v_cp is null then raise exception 'COLLECTIVE_SESSION_INVALID'; end if;
  v_a := public.start_collective_competition_attempt(p_access_token,p_competition_id);
  perform private.exam_initialize_attempt(v_a.id);
  return private.exam_state_payload(v_a.id);
end;
$$;
revoke all on function public.start_collective_sequential_exam(text,uuid) from public;
grant execute on function public.start_collective_sequential_exam(text,uuid) to anon, authenticated;

create or replace function public.get_sequential_exam_state(p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
begin
  if auth.uid() is null then raise exception 'AUTHORIZATION_REQUIRED'; end if;
  if not exists(select 1 from public.attempts where id=p_attempt_id and participant_id=auth.uid()) then raise exception 'ATTEMPT_NOT_FOUND'; end if;
  if not exists(select 1 from public.exam_attempt_sessions where attempt_id=p_attempt_id) then raise exception 'SEQUENTIAL_EXAM_NOT_INITIALIZED'; end if;
  return private.exam_state_payload(p_attempt_id);
end;
$$;
revoke all on function public.get_sequential_exam_state(uuid) from public, anon;
grant execute on function public.get_sequential_exam_state(uuid) to authenticated;

create or replace function public.get_collective_sequential_exam_state(p_access_token text,p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare v_cp uuid:=private.collective_session_participant(p_access_token);
begin
  if v_cp is null then raise exception 'COLLECTIVE_SESSION_INVALID'; end if;
  if not exists(select 1 from public.attempts where id=p_attempt_id and collective_participant_id=v_cp) then raise exception 'ATTEMPT_NOT_FOUND'; end if;
  if not exists(select 1 from public.exam_attempt_sessions where attempt_id=p_attempt_id) then raise exception 'SEQUENTIAL_EXAM_NOT_INITIALIZED'; end if;
  return private.exam_state_payload(p_attempt_id);
end;
$$;
revoke all on function public.get_collective_sequential_exam_state(text,uuid) from public;
grant execute on function public.get_collective_sequential_exam_state(text,uuid) to anon, authenticated;

create or replace function public.save_sequential_exam_answer(p_attempt_id uuid,p_question_id uuid,p_answer_json jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
begin
  if auth.uid() is null then raise exception 'AUTHORIZATION_REQUIRED'; end if;
  return private.exam_save_answer(p_attempt_id,p_question_id,p_answer_json,auth.uid(),null);
end;
$$;
revoke all on function public.save_sequential_exam_answer(uuid,uuid,jsonb) from public, anon;
grant execute on function public.save_sequential_exam_answer(uuid,uuid,jsonb) to authenticated;

create or replace function public.save_collective_sequential_exam_answer(p_access_token text,p_attempt_id uuid,p_question_id uuid,p_answer_json jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare v_cp uuid:=private.collective_session_participant(p_access_token);
begin
  if v_cp is null then raise exception 'COLLECTIVE_SESSION_INVALID'; end if;
  return private.exam_save_answer(p_attempt_id,p_question_id,p_answer_json,null,v_cp);
end;
$$;
revoke all on function public.save_collective_sequential_exam_answer(text,uuid,uuid,jsonb) from public;
grant execute on function public.save_collective_sequential_exam_answer(text,uuid,uuid,jsonb) to anon, authenticated;

create or replace function public.advance_sequential_exam_question(p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
begin
  if auth.uid() is null then raise exception 'AUTHORIZATION_REQUIRED'; end if;
  return private.exam_advance(p_attempt_id,auth.uid(),null);
end;
$$;
revoke all on function public.advance_sequential_exam_question(uuid) from public, anon;
grant execute on function public.advance_sequential_exam_question(uuid) to authenticated;

create or replace function public.advance_collective_sequential_exam_question(p_access_token text,p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare v_cp uuid:=private.collective_session_participant(p_access_token);
begin
  if v_cp is null then raise exception 'COLLECTIVE_SESSION_INVALID'; end if;
  return private.exam_advance(p_attempt_id,null,v_cp);
end;
$$;
revoke all on function public.advance_collective_sequential_exam_question(text,uuid) from public;
grant execute on function public.advance_collective_sequential_exam_question(text,uuid) to anon, authenticated;

create or replace function public.resolve_sequential_exam_timeout(p_attempt_id uuid,p_action text)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
begin
  if auth.uid() is null then raise exception 'AUTHORIZATION_REQUIRED'; end if;
  return private.exam_resolve_timeout(p_attempt_id,p_action,auth.uid(),null);
end;
$$;
revoke all on function public.resolve_sequential_exam_timeout(uuid,text) from public, anon;
grant execute on function public.resolve_sequential_exam_timeout(uuid,text) to authenticated;

create or replace function public.resolve_collective_sequential_exam_timeout(p_access_token text,p_attempt_id uuid,p_action text)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare v_cp uuid:=private.collective_session_participant(p_access_token);
begin
  if v_cp is null then raise exception 'COLLECTIVE_SESSION_INVALID'; end if;
  return private.exam_resolve_timeout(p_attempt_id,p_action,null,v_cp);
end;
$$;
revoke all on function public.resolve_collective_sequential_exam_timeout(text,uuid,text) from public;
grant execute on function public.resolve_collective_sequential_exam_timeout(text,uuid,text) to anon, authenticated;

create or replace function public.get_organizer_exam_config(p_competition_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare v_uid uuid:=auth.uid(); v_c public.competitions%rowtype; v_cfg public.competition_exam_configs%rowtype; v_count integer;
begin
  if v_uid is null or not private.exam_is_manager(p_competition_id,v_uid) then raise exception 'FORBIDDEN'; end if;
  select * into v_c from public.competitions where id=p_competition_id;
  if not found then raise exception 'COMPETITION_NOT_FOUND'; end if;
  insert into public.competition_exam_configs(competition_id,duration_seconds,created_by,updated_by)
  values(p_competition_id,
    greatest(60,case when coalesce(v_c.config->>'duration_minutes','') ~ '^[0-9]+$'
      then least(360,(v_c.config->>'duration_minutes')::integer)*60 else 1800 end),v_uid,v_uid)
  on conflict (competition_id) do nothing;
  select * into v_cfg from public.competition_exam_configs where competition_id=p_competition_id;
  select count(*) into v_count from public.questions where competition_id=p_competition_id and status='PUBLISHED';
  return to_jsonb(v_cfg)||jsonb_build_object('published_question_count',v_count,'frozen',v_cfg.frozen_at is not null);
end;
$$;
revoke all on function public.get_organizer_exam_config(uuid) from public, anon;
grant execute on function public.get_organizer_exam_config(uuid) to authenticated;

create or replace function public.save_organizer_exam_config(p_competition_id uuid,p_config jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare
  v_uid uuid:=auth.uid(); v_cfg public.competition_exam_configs%rowtype;
  v_duration integer; v_question_count integer; v_attempt_limit integer; v_decision integer; v_borrow integer;
  v_grace integer; v_minimum integer; v_rand_q boolean; v_rand_o boolean;
begin
  if v_uid is null or not private.exam_is_manager(p_competition_id,v_uid) then raise exception 'FORBIDDEN'; end if;
  select * into v_cfg from public.competition_exam_configs where competition_id=p_competition_id for update;
  if not found then raise exception 'EXAM_CONFIG_NOT_FOUND'; end if;
  if v_cfg.frozen_at is not null or exists(select 1 from public.exam_attempt_sessions where competition_id=p_competition_id) then
    raise exception 'EXAM_CONFIG_FROZEN';
  end if;
  v_duration := coalesce((p_config->>'duration_seconds')::integer,v_cfg.duration_seconds);
  v_question_count := nullif(p_config->>'question_count','')::integer;
  v_attempt_limit := coalesce((p_config->>'attempt_limit')::integer,v_cfg.attempt_limit);
  v_decision := coalesce((p_config->>'decision_window_seconds')::integer,v_cfg.decision_window_seconds);
  v_borrow := coalesce((p_config->>'borrow_seconds')::integer,v_cfg.borrow_seconds);
  v_grace := coalesce((p_config->>'overtime_grace_seconds')::integer,v_cfg.overtime_grace_seconds);
  v_minimum := coalesce((p_config->>'min_next_question_seconds')::integer,v_cfg.min_next_question_seconds);
  v_rand_q := coalesce((p_config->>'randomize_questions')::boolean,v_cfg.randomize_questions);
  v_rand_o := coalesce((p_config->>'randomize_options')::boolean,v_cfg.randomize_options);

  if v_duration not between 60 and 21600 then raise exception 'INVALID_DURATION_SECONDS'; end if;
  if v_question_count is not null and v_question_count not between 1 and 1000 then raise exception 'INVALID_QUESTION_COUNT'; end if;
  if v_attempt_limit not between 1 and 10 then raise exception 'INVALID_ATTEMPT_LIMIT'; end if;
  if v_decision not between 0 and 120 then raise exception 'INVALID_DECISION_WINDOW'; end if;
  if v_borrow not between 1 and 120 then raise exception 'INVALID_BORROW_SECONDS'; end if;
  if v_grace not between 0 and 120 then raise exception 'INVALID_GRACE_SECONDS'; end if;
  if v_minimum not between 5 and 300 then raise exception 'INVALID_MINIMUM_NEXT_TIME'; end if;

  update public.competition_exam_configs set
    duration_seconds=v_duration,question_count=v_question_count,attempt_limit=v_attempt_limit,
    decision_window_seconds=v_decision,borrow_seconds=v_borrow,overtime_grace_seconds=v_grace,
    min_next_question_seconds=v_minimum,randomize_questions=v_rand_q,randomize_options=v_rand_o,
    updated_by=v_uid,updated_at=clock_timestamp()
  where competition_id=p_competition_id returning * into v_cfg;
  return to_jsonb(v_cfg)||jsonb_build_object('frozen',false);
end;
$$;
revoke all on function public.save_organizer_exam_config(uuid,jsonb) from public, anon;
grant execute on function public.save_organizer_exam_config(uuid,jsonb) to authenticated;

create or replace function public.get_organizer_exam_monitor(p_competition_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare v_uid uuid:=auth.uid(); v_output jsonb;
begin
  if v_uid is null or not private.exam_is_manager(p_competition_id,v_uid) then raise exception 'FORBIDDEN'; end if;
  with base as (
    select a.id attempt_id,a.status attempt_status,a.started_at,a.submitted_at,
      s.current_question_index,s.question_count,s.state exam_state,s.current_question_deadline,
      coalesce(cp.full_name,p.full_name,p.username,'Peserta') participant_name,
      cp.participant_code,
      coalesce((select count(*) from public.exam_attempt_questions eq where eq.attempt_id=a.id and eq.state in ('ANSWERED','OVERTIME_ANSWERED')),0) answered_count,
      coalesce((select count(*) from public.exam_attempt_questions eq where eq.attempt_id=a.id and eq.state='TIMEOUT'),0) timeout_count,
      coalesce((select count(*) from public.exam_attempt_questions eq where eq.attempt_id=a.id and eq.state='SKIPPED'),0) skipped_count,
      coalesce((select jsonb_agg(jsonb_build_object('question_index',eq.question_index,'state',eq.state,
        'allocated_seconds',eq.allocated_seconds,'elapsed_seconds',eq.elapsed_seconds,
        'borrowed_seconds',eq.borrowed_seconds,'grace_seconds_used',eq.grace_seconds_used,
        'opened_at',eq.opened_at,'closed_at',eq.closed_at) order by eq.question_index)
        from public.exam_attempt_questions eq where eq.attempt_id=a.id),'[]'::jsonb) questions
    from public.attempts a
    join public.exam_attempt_sessions s on s.attempt_id=a.id
    left join public.profiles p on p.id=a.participant_id
    left join public.collective_participants cp on cp.id=a.collective_participant_id
    where a.competition_id=p_competition_id
    order by a.started_at desc nulls last
    limit 200
  )
  select jsonb_build_object(
    'total',count(*),
    'active',count(*) filter(where exam_state in ('ACTIVE','TIMEOUT_DECISION','OVERTIME')),
    'completed',count(*) filter(where exam_state='COMPLETED'),
    'timed_out',coalesce(sum(timeout_count),0),
    'skipped',coalesce(sum(skipped_count),0),
    'sessions',coalesce(jsonb_agg(to_jsonb(base) order by started_at desc nulls last),'[]'::jsonb)
  ) into v_output from base;
  return coalesce(v_output,'{"total":0,"active":0,"completed":0,"timed_out":0,"skipped":0,"sessions":[]}'::jsonb);
end;
$$;
revoke all on function public.get_organizer_exam_monitor(uuid) from public, anon;
grant execute on function public.get_organizer_exam_monitor(uuid) to authenticated;

-- Direct access to exam snapshots, answer keys and logs stays private. Legacy APIs are
-- blocked only for competitions configured for the sequential engine; other legacy data
-- is left in place for a safe migration window.
create or replace function private.guard_sequential_exam_answer_write()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare v_attempt_id uuid;
begin
  v_attempt_id := case when tg_op='DELETE' then old.attempt_id else new.attempt_id end;
  if exists (
    select 1 from public.attempts a
    join public.competition_exam_configs c on c.competition_id=a.competition_id
    where a.id=v_attempt_id
  ) and coalesce(current_setting('app.sequential_exam_rpc',true),'') <> 'on' then
    raise exception 'SEQUENTIAL_EXAM_ENGINE_REQUIRED';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function private.guard_sequential_exam_answer_write() from public, anon, authenticated;
drop trigger if exists guard_sequential_exam_answer_write on public.answers;
create trigger guard_sequential_exam_answer_write
before insert or update or delete on public.answers
for each row execute function private.guard_sequential_exam_answer_write();

create or replace function private.guard_sequential_exam_attempt_transition()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
begin
  if new.status is distinct from old.status
    and new.status in ('SUBMITTED','GRADING','FINALIZED','EXPIRED')
    and exists(select 1 from public.competition_exam_configs c where c.competition_id=new.competition_id)
    and coalesce(current_setting('app.sequential_exam_rpc',true),'') <> 'on' then
    raise exception 'SEQUENTIAL_EXAM_ENGINE_REQUIRED';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_sequential_exam_attempt_transition() from public, anon, authenticated;
drop trigger if exists guard_sequential_exam_attempt_transition on public.attempts;
create trigger guard_sequential_exam_attempt_transition
before update of status on public.attempts
for each row execute function private.guard_sequential_exam_attempt_transition();

-- Existing participant question RPCs must not reveal the complete question set once
-- a competition opts into the sequential engine.
create or replace function public.get_participant_questions(p_competition_id uuid)
returns table(id uuid,type text,prompt text,points numeric,required boolean,display_order integer,config jsonb,options jsonb)
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
begin
  if exists(select 1 from public.competition_exam_configs where competition_id=p_competition_id) then
    raise exception 'SEQUENTIAL_EXAM_ENGINE_REQUIRED';
  end if;
  return query
  select q.id,q.type,q.prompt,q.points,q.required,q.display_order,
    (coalesce(q.config,'{}'::jsonb)-'accepted_answers'-'correct_answer'-'answer_key'-'correct_option_id') as config,
    coalesce(jsonb_agg(jsonb_build_object('id',qo.id,'label',qo.label) order by qo.display_order,qo.id)
      filter(where qo.id is not null),'[]'::jsonb) as options
  from public.questions q
  left join public.question_options qo on qo.question_id=q.id
  join public.registrations r on r.competition_id=q.competition_id and r.user_id=auth.uid() and r.status in ('APPROVED','ACTIVE')
  join public.competitions c on c.id=q.competition_id and c.status='LIVE'
  where q.competition_id=p_competition_id and q.status='PUBLISHED'
  group by q.id
  order by q.display_order,q.id;
end;
$$;
revoke all on function public.get_participant_questions(uuid) from public, anon;
grant execute on function public.get_participant_questions(uuid) to authenticated;

create or replace function public.get_attempt_resume(p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare u uuid:=auth.uid(); a public.attempts; c public.competitions; qs jsonb; ans jsonb;
begin
  if u is null then raise exception 'AUTHORIZATION_REQUIRED'; end if;
  select * into a from public.attempts where id=p_attempt_id and participant_id=u;
  if not found then raise exception 'ATTEMPT_NOT_FOUND'; end if;
  if exists(select 1 from public.competition_exam_configs where competition_id=a.competition_id) then
    raise exception 'SEQUENTIAL_EXAM_ENGINE_REQUIRED';
  end if;
  select * into c from public.competitions where id=a.competition_id;
  select coalesce(jsonb_agg(qobj order by qobj->>'display_order'),'[]'::jsonb) into qs from (
    select jsonb_build_object('id',q.id,'type',q.type,'prompt',q.prompt,'points',q.points,'required',q.required,
      'display_order',q.display_order,'config',(coalesce(q.config,'{}'::jsonb)-'accepted_answers'-'correct_answer'-'answer_key'-'correct_option_id'),
      'options',coalesce((select jsonb_agg(jsonb_build_object('id',qo.id,'label',qo.label) order by qo.display_order)
      from public.question_options qo where qo.question_id=q.id),'[]'::jsonb)) qobj
    from public.questions q where q.competition_id=a.competition_id and q.status='PUBLISHED'
  ) t;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.saved_at),'[]'::jsonb) into ans from public.answers x where x.attempt_id=a.id;
  return jsonb_build_object('attempt',to_jsonb(a)-'score','competition',to_jsonb(c),'questions',qs,'answers',ans);
end;
$$;
revoke all on function public.get_attempt_resume(uuid) from public, anon;
grant execute on function public.get_attempt_resume(uuid) to authenticated;

create or replace function public.get_collective_participant_questions(p_access_token text,p_competition_id uuid)
returns table(id uuid,type text,prompt text,points numeric,required boolean,display_order integer,config jsonb,options jsonb)
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare v_cp uuid:=private.collective_session_participant(p_access_token);
begin
  if v_cp is null then raise exception 'COLLECTIVE_SESSION_INVALID'; end if;
  if exists(select 1 from public.competition_exam_configs where competition_id=p_competition_id) then
    raise exception 'SEQUENTIAL_EXAM_ENGINE_REQUIRED';
  end if;
  if not exists(select 1 from public.collective_participants where id=v_cp and competition_id=p_competition_id and status='ACTIVE') then
    raise exception 'PARTICIPANT_NOT_REGISTERED';
  end if;
  return query
  select q.id,q.type,q.prompt,q.points,q.required,q.display_order,
    (coalesce(q.config,'{}'::jsonb)-'accepted_answers'-'correct_answer'-'answer_key'-'correct_option_id') as config,
    coalesce(jsonb_agg(jsonb_build_object('id',qo.id,'label',qo.label,'value',qo.value) order by qo.display_order,qo.id)
      filter(where qo.id is not null),'[]'::jsonb) as options
  from public.questions q left join public.question_options qo on qo.question_id=q.id
  join public.competitions c on c.id=q.competition_id and c.status='LIVE'
  where q.competition_id=p_competition_id and q.status='PUBLISHED'
  group by q.id order by q.display_order,q.id;
end;
$$;
revoke all on function public.get_collective_participant_questions(text,uuid) from public;
grant execute on function public.get_collective_participant_questions(text,uuid) to anon, authenticated;

-- A completed attempt's score/rank is withheld until the organizer publishes results.
create or replace function public.get_canonical_competition_result(p_participant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare p public.participants; a public.attempts; v_rank bigint; c public.competitions;
begin
  select * into p from public.participants where id=p_participant_id;
  if not found then raise exception 'PARTICIPANT_NOT_FOUND'; end if;
  if not private.current_user_is_admin()
    and (p.user_id is null or p.user_id<>auth.uid())
    and not exists(select 1 from public.collective_participants cp where cp.id=p.collective_participant_id and cp.managed_by_user_id=auth.uid()) then
    raise exception 'NOT_AUTHORIZED';
  end if;
  select * into c from public.competitions where id=p.competition_id;
  if c.status not in ('RESULT_PUBLISHED','ARCHIVED') then
    return jsonb_build_object('participant_id',p.id,'competition_id',p.competition_id,
      'participant_type',p.participant_type,'name',p.full_name,'attempt',null,'rank',null,'published',false);
  end if;
  select * into a from public.attempts where canonical_participant_id=p.id and status='FINALIZED'
    order by finalized_at desc nulls last,created_at desc limit 1;
  if not found then
    return jsonb_build_object('participant_id',p.id,'competition_id',p.competition_id,'participant_type',p.participant_type,
      'name',p.full_name,'attempt',null,'rank',null,'published',true);
  end if;
  select 1+count(*) into v_rank from public.attempts x
    where x.competition_id=p.competition_id and x.status='FINALIZED'
      and x.canonical_participant_id is not null and x.score>a.score;
  return jsonb_build_object('participant_id',p.id,'competition_id',p.competition_id,'participant_type',p.participant_type,
    'name',p.full_name,'attempt',jsonb_build_object('id',a.id,'status',a.status,'score',a.score,'finalized_at',a.finalized_at),
    'rank',v_rank,'published',true);
end;
$$;
revoke all on function public.get_canonical_competition_result(uuid) from public, anon;
grant execute on function public.get_canonical_competition_result(uuid) to authenticated;

create or replace function public.get_my_canonical_competition_result(p_competition_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare v_pid uuid;
begin
  if auth.uid() is null then raise exception 'AUTHORIZATION_REQUIRED'; end if;
  select id into v_pid from public.participants
    where competition_id=p_competition_id and user_id=auth.uid() limit 1;
  if v_pid is null then raise exception 'PARTICIPANT_NOT_FOUND'; end if;
  return public.get_canonical_competition_result(v_pid);
end;
$$;
revoke all on function public.get_my_canonical_competition_result(uuid) from public, anon;
grant execute on function public.get_my_canonical_competition_result(uuid) to authenticated;



create or replace function private.exam_is_enabled(p_competition_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, private, pg_catalog
as $
  select exists(select 1 from public.competition_exam_configs ec where ec.competition_id=p_competition_id);
$;
revoke all on function private.exam_is_enabled(uuid) from public, anon, authenticated;
grant execute on function private.exam_is_enabled(uuid) to authenticated;

-- Block direct table reads that can reveal the active question bank/config or finalized score
-- for opted-in sequential exams. Organizers/admins retain their scoped operational visibility.
drop policy if exists attempts_admin_or_owner_read on public.attempts;
create policy attempts_admin_or_owner_read on public.attempts
for select to authenticated
using (
  private.current_user_is_admin()
  or exists (
    select 1 from public.competitions c
    where c.id=attempts.competition_id and c.organizer_id is not null
      and private.current_user_is_organizer_for(c.organizer_id)
  )
  or (
    attempts.participant_id=(select auth.uid())
    and not private.exam_is_enabled(attempts.competition_id)
  )
);

drop policy if exists questions_select on public.questions;
create policy questions_select on public.questions
for select to authenticated
using (
  private.current_user_is_admin()
  or exists (
    select 1 from public.question_banks qb
    where qb.id=questions.question_bank_id and qb.organizer_id is not null
      and private.current_user_is_organizer_for(qb.organizer_id)
  )
  or exists (
    select 1 from public.competitions c
    where c.id=questions.competition_id and c.organizer_id is not null
      and private.current_user_is_organizer_for(c.organizer_id)
  )
  or (
    questions.status='PUBLISHED'
    and not private.exam_is_enabled(questions.competition_id)
    and exists (
      select 1
      from public.competitions c
      join public.registrations r on r.competition_id=c.id
      where c.id=questions.competition_id and c.status='LIVE'
        and r.user_id=(select auth.uid())
        and r.status in ('APPROVED','ACTIVE')
    )
  )
);
