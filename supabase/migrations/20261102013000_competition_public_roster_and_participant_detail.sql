begin;

-- Organizer-configurable registration target. Minimum is an informational goal;
-- maximum remains the server-enforced registration capacity.
alter table public.registration_rules
  add column if not exists minimum_participants integer;

do $minimum_participant_constraints$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.registration_rules'::regclass
      and conname = 'registration_rules_minimum_participants_positive'
  ) then
    alter table public.registration_rules
      add constraint registration_rules_minimum_participants_positive
      check (minimum_participants is null or minimum_participants >= 1);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.registration_rules'::regclass
      and conname = 'registration_rules_minimum_not_exceed_maximum'
  ) then
    alter table public.registration_rules
      add constraint registration_rules_minimum_not_exceed_maximum
      check (
        minimum_participants is null
        or max_participants is null
        or minimum_participants <= max_participants
      );
  end if;
end;
$minimum_participant_constraints$;

create or replace function public.save_organizer_competition_config(
  p_competition_id uuid,
  p_level jsonb default '{}'::jsonb,
  p_registration_rule jsonb default '{}'::jsonb,
  p_rewards jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private'
as $function$
declare
  v_uid uuid := auth.uid();
  v_org uuid;
  v_level_id uuid;
  v_level jsonb := coalesce(p_level, '{}'::jsonb);
  v_rule jsonb := coalesce(p_registration_rule, '{}'::jsonb);
  v_reward jsonb;
  v_minimum integer := nullif(v_rule->>'minimum_participants', '')::integer;
  v_maximum integer := nullif(v_rule->>'max_participants', '')::integer;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select organizer_id into v_org
  from public.competitions
  where id = p_competition_id;

  if v_org is null then
    raise exception 'COMPETITION_NOT_FOUND';
  end if;

  if not exists (
    select 1 from public.organizer_members
    where organizer_id = v_org and user_id = v_uid and is_active = true
  ) and not exists (
    select 1 from public.user_roles
    where user_id = v_uid and role = 'admin' and is_active = true
  ) then
    raise exception 'FORBIDDEN';
  end if;

  if v_minimum is not null and v_minimum < 1 then
    raise exception 'MINIMUM_PARTICIPANTS_INVALID';
  end if;
  if v_maximum is not null and v_maximum < 1 then
    raise exception 'MAXIMUM_PARTICIPANTS_INVALID';
  end if;
  if v_minimum is not null and v_maximum is not null and v_minimum > v_maximum then
    raise exception 'MINIMUM_EXCEEDS_MAXIMUM';
  end if;

  update public.competitions
  set
    registration_starts_at = nullif(v_level->>'registration_starts_at', '')::timestamptz,
    registration_ends_at = nullif(v_level->>'registration_ends_at', '')::timestamptz,
    starts_at = nullif(v_level->>'starts_at', '')::timestamptz,
    ends_at = nullif(v_level->>'ends_at', '')::timestamptz,
    announcement_at = nullif(v_level->>'announcement_at', '')::timestamptz,
    updated_at = now()
  where id = p_competition_id;

  select id into v_level_id
  from public.competition_levels
  where competition_id = p_competition_id
  order by created_at
  limit 1;

  if v_level_id is null then
    insert into public.competition_levels (
      competition_id, code, label, allowed_grades, points, config
    )
    values (
      p_competition_id,
      coalesce(v_level->>'code', 'general'),
      coalesce(v_level->>'label', 'Umum'),
      array(select jsonb_array_elements_text(coalesce(v_level->'allowed_grades', '[]'::jsonb))),
      coalesce((v_level->>'points')::numeric, 0),
      coalesce(v_level->'config', '{}'::jsonb)
    )
    returning id into v_level_id;
  else
    update public.competition_levels
    set
      code = coalesce(v_level->>'code', code),
      label = coalesce(v_level->>'label', label),
      allowed_grades = array(select jsonb_array_elements_text(coalesce(v_level->'allowed_grades', '[]'::jsonb))),
      points = coalesce((v_level->>'points')::numeric, points),
      config = coalesce(v_level->'config', config),
      updated_at = now()
    where id = v_level_id;
  end if;

  insert into public.registration_rules (
    competition_id, allowed_grades, require_twibbon, require_social_proof,
    express_enabled, express_cost, max_participants, minimum_participants,
    config, approval_mode
  )
  values (
    p_competition_id,
    array(select jsonb_array_elements_text(coalesce(v_rule->'allowed_grades', '[]'::jsonb))),
    coalesce((v_rule->>'require_twibbon')::boolean, false),
    coalesce((v_rule->>'require_social_proof')::boolean, false),
    coalesce((v_rule->>'express_enabled')::boolean, false),
    coalesce((v_rule->>'express_cost')::numeric, 0),
    v_maximum,
    v_minimum,
    coalesce(v_rule->'config', '{}'::jsonb),
    coalesce(v_rule->>'approval_mode', 'MANUAL')
  )
  on conflict (competition_id) do update set
    allowed_grades = excluded.allowed_grades,
    require_twibbon = excluded.require_twibbon,
    require_social_proof = excluded.require_social_proof,
    express_enabled = excluded.express_enabled,
    express_cost = excluded.express_cost,
    max_participants = excluded.max_participants,
    minimum_participants = excluded.minimum_participants,
    config = excluded.config,
    approval_mode = excluded.approval_mode,
    updated_at = now();

  delete from public.competition_rewards
  where competition_id = p_competition_id;

  for v_reward in
    select * from jsonb_array_elements(coalesce(p_rewards, '[]'::jsonb))
  loop
    insert into public.competition_rewards (
      competition_id, competition_level_id, rank_code, title, points,
      emblem_name, certificate_enabled, config
    )
    values (
      p_competition_id,
      v_level_id,
      coalesce(v_reward->>'rank_code', 'PARTICIPANT'),
      coalesce(v_reward->>'title', 'Penghargaan'),
      coalesce((v_reward->>'points')::numeric, 0),
      v_reward->>'emblem_name',
      coalesce((v_reward->>'certificate_enabled')::boolean, false),
      coalesce(v_reward->'config', '{}'::jsonb)
    );
  end loop;

  return jsonb_build_object(
    'competition_id', p_competition_id,
    'level_id', v_level_id,
    'saved', true,
    'minimum_participants', v_minimum,
    'max_participants', v_maximum
  );
end;
$function$;

-- Public participant totals follow the canonical participant identity table.
-- Pending/rejected registrations are not counted as visible participants.
create or replace function public.get_public_competition_detail_summary(
  p_competition_id uuid
)
returns table (
  participant_count bigint,
  organizer_name text,
  organizer_logo_url text,
  question_bank_name text,
  question_provider_name text,
  question_count bigint
)
language sql
stable
security definer
set search_path to ''
as $function$
  select
    (
      select count(*)::bigint
      from public.participants p
      where p.competition_id = c.id
    ) as participant_count,
    coalesce(nullif(o.name, ''), 'Penyelenggara') as organizer_name,
    coalesce(nullif(o.logo_asset_url, ''), nullif(op.avatar_url, '')) as organizer_logo_url,
    nullif(qb.name, '') as question_bank_name,
    case
      when qb.id is not null and qb.organizer_id is distinct from c.organizer_id
        then coalesce(nullif(qbo.name, ''), 'Mitra penyedia soal')
      else null
    end as question_provider_name,
    (
      select count(distinct q.id)::bigint
      from public.questions q
      where q.status = 'PUBLISHED'
        and (
          q.competition_id = c.id
          or (c.question_bank_id is not null and q.question_bank_id = c.question_bank_id)
        )
    ) as question_count
  from public.competitions c
  left join public.organizers o on o.id = c.organizer_id
  left join public.profiles op on op.id = o.owner_user_id
  left join public.question_banks qb on qb.id = c.question_bank_id
  left join public.organizers qbo on qbo.id = qb.organizer_id
  where c.id = p_competition_id
    and c.visibility = 'PUBLIC'
    and c.status in (
      'PUBLISHED', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'LIVE',
      'SUBMISSION_CLOSED', 'GRADING', 'RESULT_PUBLISHED', 'ARCHIVED'
    );
$function$;

revoke all on function public.get_public_competition_detail_summary(uuid) from public;
grant execute on function public.get_public_competition_detail_summary(uuid) to anon, authenticated;

-- Public roster + separated confirmed and reserved counts. Only canonical
-- participants are returned; profile IDs, registration metadata and social
-- proof are intentionally omitted.
create or replace function public.get_public_competition_participants(
  p_slug text,
  p_limit integer default 20,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_comp public.competitions%rowtype;
  v_minimum integer;
  v_maximum integer;
  v_participant_count integer;
  v_quota_count integer;
  v_participants jsonb;
  v_limit integer := greatest(1, least(coalesce(p_limit, 20), 50));
  v_offset integer := greatest(0, coalesce(p_offset, 0));
begin
  select * into v_comp
  from public.competitions c
  where c.slug = trim(coalesce(p_slug, ''))
    and c.visibility = 'PUBLIC'
    and c.status::text in (
      'PUBLISHED', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'LIVE',
      'SUBMISSION_CLOSED', 'GRADING', 'RESULT_PUBLISHED', 'ARCHIVED'
    );

  if not found then
    raise exception 'COMPETITION_NOT_FOUND';
  end if;

  select rr.minimum_participants, rr.max_participants
  into v_minimum, v_maximum
  from public.registration_rules rr
  where rr.competition_id = v_comp.id;

  select count(*)::integer into v_participant_count
  from public.participants p
  where p.competition_id = v_comp.id;

  v_quota_count := private.competition_reserved_participant_count(v_comp.id);

  select coalesce(jsonb_agg(
    page.row_data order by page.rank_position nulls last, lower(page.full_name), page.participant_id
  ), '[]'::jsonb)
  into v_participants
  from (
    select
      p.full_name,
      p.id as participant_id,
      official_result.rank_position as rank_position,
      jsonb_build_object(
        'participant_id', p.id,
        'full_name', p.full_name,
        'participant_type', p.participant_type,
        'grade', p.grade,
        'class_name', p.class_name,
        'school_name', s.name,
        'rank', official_result.rank_position,
        'score', official_result.score
      ) as row_data
    from public.participants p
    left join public.schools s on s.id = p.school_id
    left join private.canonical_competition_results(v_comp.id) official_result
      on official_result.canonical_participant_id = p.id
     and v_comp.status::text in ('RESULT_PUBLISHED', 'ARCHIVED')
    where p.competition_id = v_comp.id
    order by
      case
        when v_comp.status::text in ('RESULT_PUBLISHED', 'ARCHIVED')
          and official_result.rank_position is not null then 0
        else 1
      end,
      official_result.rank_position nulls last,
      lower(p.full_name),
      p.id
    limit v_limit offset v_offset
  ) page;

  return jsonb_build_object(
    'participant_count', v_participant_count,
    'quota_count', v_quota_count,
    'minimum_participants', v_minimum,
    'maximum_participants', v_maximum,
    'participants', v_participants,
    'limit', v_limit,
    'offset', v_offset
  );
end;
$function$;

revoke all on function public.get_public_competition_participants(text, integer, integer) from public;
grant execute on function public.get_public_competition_participants(text, integer, integer) to anon, authenticated;

-- Participant performance is visible publicly only after an official result
-- publication. Before publication, only the competition's organizer editors
-- and administrators may inspect it. Raw answers and answer keys never leave
-- this function.
create or replace function public.get_competition_participant_detail(
  p_slug text,
  p_participant_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_comp public.competitions%rowtype;
  v_participant public.participants%rowtype;
  v_attempt public.attempts%rowtype;
  v_published boolean;
  v_rank bigint;
  v_total integer := 0;
  v_correct integer := 0;
  v_incorrect integer := 0;
  v_manual integer := 0;
  v_unanswered integer := 0;
  v_elapsed integer := 0;
  v_awards jsonb := '[]'::jsonb;
  v_badges jsonb := '[]'::jsonb;
  v_certificates jsonb := '[]'::jsonb;
begin
  select * into v_comp
  from public.competitions c
  where c.slug = trim(coalesce(p_slug, ''));

  if not found then
    raise exception 'COMPETITION_NOT_FOUND';
  end if;

  v_published := v_comp.visibility = 'PUBLIC'
    and v_comp.status::text in ('RESULT_PUBLISHED', 'ARCHIVED');

  if not v_published then
    if auth.uid() is null then
      raise exception 'RESULT_NOT_PUBLISHED';
    end if;
    if not (
      private.current_user_is_admin()
      or (
        v_comp.organizer_id is not null
        and private.current_user_can_edit_competition(v_comp.organizer_id)
      )
    ) then
      raise exception 'ACCESS_DENIED';
    end if;
  end if;

  select * into v_participant
  from public.participants p
  where p.id = p_participant_id
    and p.competition_id = v_comp.id;

  if not found then
    raise exception 'PARTICIPANT_NOT_FOUND';
  end if;

  select * into v_attempt
  from public.attempts a
  where a.competition_id = v_comp.id
    and a.canonical_participant_id = v_participant.id
    and a.is_preview = false
    and a.status::text = 'FINALIZED'
  order by a.finalized_at desc nulls last, a.created_at desc, a.id desc
  limit 1;

  if not found then
    return jsonb_build_object(
      'has_result', false,
      'participant', jsonb_build_object(
        'full_name', v_participant.full_name,
        'participant_type', v_participant.participant_type,
        'grade', v_participant.grade,
        'class_name', v_participant.class_name,
        'school_name', (select s.name from public.schools s where s.id = v_participant.school_id)
      ),
      'scores', null,
      'awards', '[]'::jsonb,
      'badges', '[]'::jsonb,
      'certificates', '[]'::jsonb
    );
  end if;

  select r.rank_position into v_rank
  from private.canonical_competition_results(v_comp.id) r
  where r.canonical_participant_id = v_participant.id;

  select
    count(*)::integer,
    count(*) filter (where evaluated.result_status = 'CORRECT')::integer,
    count(*) filter (where evaluated.result_status = 'INCORRECT')::integer,
    count(*) filter (where evaluated.result_status = 'MANUAL_REVIEW')::integer,
    count(*) filter (where evaluated.result_status in ('UNANSWERED', 'SKIPPED', 'TIMEOUT'))::integer
  into v_total, v_correct, v_incorrect, v_manual, v_unanswered
  from (
    select (private.evaluate_linear_preview_answer(
      eq.state,
      eq.transition_reason,
      eq.question_snapshot,
      eq.answer_key_snapshot,
      coalesce(a.answer_json, '{}'::jsonb)
    )->>'result_status') as result_status
    from public.exam_attempt_questions eq
    left join public.answers a
      on a.attempt_id = eq.attempt_id
     and a.question_id = eq.question_id
    where eq.attempt_id = v_attempt.id
  ) evaluated;

  select coalesce(sum(eq.elapsed_seconds), 0)::integer
  into v_elapsed
  from public.exam_attempt_questions eq
  where eq.attempt_id = v_attempt.id;

  if v_elapsed = 0 and v_attempt.started_at is not null then
    v_elapsed := greatest(
      0,
      extract(epoch from (coalesce(v_attempt.submitted_at, v_attempt.finalized_at) - v_attempt.started_at))::integer
    );
  end if;

  if v_participant.user_id is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
      'title', aw.title,
      'rank_code', aw.rank_code,
      'points', aw.points,
      'emblem_url', aw.emblem_url,
      'issued_at', aw.issued_at
    ) order by aw.issued_at desc), '[]'::jsonb)
    into v_awards
    from public.awards aw
    where aw.user_id = v_participant.user_id
      and aw.competition_id = v_comp.id
      and aw.visibility = 'PUBLIC';

    select coalesce(jsonb_agg(jsonb_build_object(
      'name', b.name,
      'description', b.description,
      'icon_url', b.icon_url,
      'icon_emoji', b.icon_emoji,
      'rarity', b.rarity,
      'awarded_at', ub.awarded_at
    ) order by ub.awarded_at desc), '[]'::jsonb)
    into v_badges
    from public.user_badges ub
    join public.badges b on b.id = ub.badge_id
    where ub.user_id = v_participant.user_id
      and ub.source_reference = v_comp.id::text
      and b.status = 'ACTIVE';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'serial_number', cert.serial_number,
    'certificate_url', cert.certificate_url,
    'issued_at', cert.issued_at
  ) order by cert.issued_at desc), '[]'::jsonb)
  into v_certificates
  from public.certificates cert
  where cert.canonical_participant_id = v_participant.id
    and cert.competition_id = v_comp.id
    and cert.status::text = 'PUBLISHED'
    and cert.certificate_url is not null;

  select v_certificates || coalesce(jsonb_agg(jsonb_build_object(
    'serial_number', cc.serial_number,
    'certificate_url', cc.certificate_url,
    'issued_at', cc.issued_at
  ) order by cc.issued_at desc), '[]'::jsonb)
  into v_certificates
  from public.collective_certificates cc
  where cc.canonical_participant_id = v_participant.id
    and cc.competition_id = v_comp.id
    and cc.status = 'PUBLISHED'
    and cc.certificate_url is not null;

  return jsonb_build_object(
    'has_result', true,
    'participant', jsonb_build_object(
      'full_name', v_participant.full_name,
      'participant_type', v_participant.participant_type,
      'grade', v_participant.grade,
      'class_name', v_participant.class_name,
      'school_name', (select s.name from public.schools s where s.id = v_participant.school_id)
    ),
    'result', jsonb_build_object(
      'rank', v_rank,
      'score', v_attempt.score,
      'finalized_at', v_attempt.finalized_at,
      'duration_seconds', v_elapsed
    ),
    'question_summary', jsonb_build_object(
      'total', v_total,
      'correct', v_correct,
      'incorrect', v_incorrect,
      'manual_review', v_manual,
      'unanswered', v_unanswered
    ),
    'awards', v_awards,
    'badges', v_badges,
    'certificates', v_certificates
  );
end;
$function$;

revoke all on function public.get_competition_participant_detail(text, uuid) from public;
grant execute on function public.get_competition_participant_detail(text, uuid) to anon, authenticated;



-- Keep the participant key in the same canonical result projection so both
-- the organizer dashboard and the public results table can open one detail RPC.
create or replace function public.get_organizer_competition_result_overview(
  p_competition_id uuid,
  p_limit integer default 500,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_comp public.competitions%rowtype;
  v_results jsonb;
  v_participant_count integer;
  v_result_count integer;
  v_pending_attempt_count integer;
  v_manual_pending_count integer;
  v_expired_attempt_count integer;
  v_legacy_active_count integer;
  v_missing_canonical_count integer;
  v_limit integer := greatest(1, least(coalesce(p_limit, 500), 1000));
  v_offset integer := greatest(0, coalesce(p_offset, 0));
begin
  if auth.uid() is null then
    raise exception 'AUTHORIZATION_REQUIRED';
  end if;

  select * into v_comp
  from public.competitions
  where id = p_competition_id;

  if not found then
    raise exception 'COMPETITION_NOT_FOUND';
  end if;

  if not (
    private.current_user_is_admin()
    or (
      v_comp.organizer_id is not null
      and private.current_user_can_edit_competition(v_comp.organizer_id)
    )
  ) then
    raise exception 'ACCESS_DENIED';
  end if;

  select count(*)::integer into v_participant_count
  from public.participants p
  where p.competition_id = v_comp.id;

  select count(*)::integer into v_result_count
  from private.canonical_competition_results(v_comp.id);

  select coalesce(jsonb_agg(row_data order by rank_position, full_name), '[]'::jsonb)
  into v_results
  from (
    select
      r.rank_position,
      r.full_name,
      jsonb_build_object(
        'participant_id', r.canonical_participant_id,
        'rank', r.rank_position,
        'full_name', r.full_name,
        'participant_type', r.participant_type,
        'participant_code', r.participant_code,
        'class_name', r.class_name,
        'grade', r.grade,
        'school_name', r.school_name,
        'score', r.score,
        'finalized_at', r.finalized_at
      ) as row_data
    from private.canonical_competition_results(v_comp.id) r
    order by r.rank_position, r.full_name
    limit v_limit offset v_offset
  ) page;

  select
    count(*) filter (
      where a.status::text in ('NOT_STARTED', 'IN_PROGRESS', 'SUBMITTED', 'GRADING')
    )::integer,
    count(*) filter (where a.status::text = 'EXPIRED')::integer,
    count(*) filter (
      where a.status::text = 'IN_PROGRESS'
        and not exists (
          select 1
          from public.exam_attempt_runtime runtime
          where runtime.attempt_id = a.id
        )
    )::integer,
    count(*) filter (
      where a.status::text = 'FINALIZED'
        and a.canonical_participant_id is null
    )::integer
  into
    v_pending_attempt_count,
    v_expired_attempt_count,
    v_legacy_active_count,
    v_missing_canonical_count
  from public.attempts a
  where a.competition_id = v_comp.id
    and a.is_preview = false;

  select count(*)::integer
  into v_manual_pending_count
  from public.grading_items gi
  join public.attempts a on a.id = gi.attempt_id
  where a.competition_id = v_comp.id
    and a.is_preview = false
    and a.status::text in ('SUBMITTED', 'GRADING')
    and gi.grader_id is null
    and gi.automatic_score is null;

  return jsonb_build_object(
    'competition', jsonb_build_object(
      'id', v_comp.id,
      'slug', v_comp.slug,
      'title', v_comp.title,
      'category', v_comp.category,
      'status', v_comp.status,
      'visibility', v_comp.visibility,
      'announcement_at', v_comp.announcement_at,
      'poster_url', v_comp.poster_url
    ),
    'readiness', jsonb_build_object(
      'participant_count', v_participant_count,
      'result_count', v_result_count,
      'pending_attempt_count', v_pending_attempt_count,
      'manual_pending_count', v_manual_pending_count,
      'expired_attempt_count', v_expired_attempt_count,
      'legacy_active_count', v_legacy_active_count,
      'missing_canonical_count', v_missing_canonical_count,
      'can_publish',
        v_comp.status::text = 'GRADING'
        and v_result_count > 0
        and v_pending_attempt_count = 0
        and v_manual_pending_count = 0
        and v_missing_canonical_count = 0
    ),
    'results', v_results,
    'result_limit', v_limit,
    'result_offset', v_offset
  );
end;
$function$;

create or replace function public.get_public_competition_results(
  p_slug text,
  p_limit integer default 500,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_comp public.competitions%rowtype;
  v_results jsonb;
  v_result_count integer;
  v_limit integer := greatest(1, least(coalesce(p_limit, 500), 1000));
  v_offset integer := greatest(0, coalesce(p_offset, 0));
  v_published_at timestamptz;
begin
  select * into v_comp
  from public.competitions
  where slug = trim(coalesce(p_slug, ''))
    and visibility = 'PUBLIC'
    and status::text in ('RESULT_PUBLISHED', 'ARCHIVED');

  if not found then
    raise exception 'COMPETITION_RESULTS_NOT_FOUND';
  end if;

  select count(*)::integer into v_result_count
  from private.canonical_competition_results(v_comp.id);

  select coalesce(jsonb_agg(row_data order by rank_position, full_name), '[]'::jsonb)
  into v_results
  from (
    select
      r.rank_position,
      r.full_name,
      jsonb_build_object(
        'participant_id', r.canonical_participant_id,
        'rank', r.rank_position,
        'full_name', r.full_name,
        'participant_type', r.participant_type,
        'participant_code', r.participant_code,
        'class_name', r.class_name,
        'grade', r.grade,
        'school_name', r.school_name,
        'score', r.score,
        'finalized_at', r.finalized_at
      ) as row_data
    from private.canonical_competition_results(v_comp.id) r
    order by r.rank_position, r.full_name
    limit v_limit offset v_offset
  ) page;

  select max(h.created_at) into v_published_at
  from public.competition_status_history h
  where h.competition_id = v_comp.id
    and h.to_status::text = 'RESULT_PUBLISHED';

  return jsonb_build_object(
    'competition', jsonb_build_object(
      'id', v_comp.id,
      'slug', v_comp.slug,
      'title', v_comp.title,
      'category', v_comp.category,
      'status', v_comp.status,
      'poster_url', v_comp.poster_url,
      'announcement_at', v_comp.announcement_at,
      'published_at', v_published_at
    ),
    'result_count', v_result_count,
    'results', v_results,
    'result_limit', v_limit,
    'result_offset', v_offset
  );
end;
$function$;


-- One quota counter shared by individual and collective registration paths.
-- Collective orders reserve student_count while awaiting payment; provisioned
-- collective students are counted by their actual participant rows instead.
create or replace function private.competition_reserved_participant_count(
  p_competition_id uuid
)
returns integer
language sql
stable
set search_path to ''
as $quota_count$
  select
    coalesce((
      select count(*)::integer
      from public.registrations r
      where r.competition_id = p_competition_id
        and r.status::text in ('PENDING', 'APPROVED', 'ACTIVE')
        and not exists (
          select 1
          from public.collective_participants cp
          where cp.registration_id = r.id
        )
    ), 0)
    + coalesce((
      select count(*)::integer
      from public.collective_participants cp
      where cp.competition_id = p_competition_id
        and cp.status in ('ACTIVE', 'PROVISIONED')
    ), 0)
    + coalesce((
      select sum(cr.student_count)::integer
      from public.collective_registrations cr
      where cr.competition_id = p_competition_id
        and cr.status in ('PENDING_PAYMENT', 'PAID')
    ), 0);
$quota_count$;

revoke all on function private.competition_reserved_participant_count(uuid)
  from public, anon, authenticated, service_role;

-- Keep the eligibility preflight aligned with the same mixed-mode counter.
create or replace function public.check_registration_eligibility(
  p_competition_id uuid,
  p_grade text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $eligibility$
declare
  c public.competitions;
  r public.registration_rules;
  current_count integer := 0;
  u uuid := auth.uid();
begin
  if u is null then
    return jsonb_build_object('eligible', false, 'reason', 'LOGIN_REQUIRED');
  end if;

  perform public.sync_competition_registration_status(p_competition_id);

  select * into c
  from public.competitions
  where id = p_competition_id;

  if not found then
    return jsonb_build_object('eligible', false, 'reason', 'COMPETITION_NOT_FOUND');
  end if;

  if c.status <> 'REGISTRATION_OPEN' then
    return jsonb_build_object('eligible', false, 'reason', 'REGISTRATION_NOT_OPEN');
  end if;

  if c.registration_starts_at is not null and now() < c.registration_starts_at then
    return jsonb_build_object('eligible', false, 'reason', 'REGISTRATION_NOT_OPEN');
  end if;

  if c.registration_ends_at is not null and now() > c.registration_ends_at then
    return jsonb_build_object('eligible', false, 'reason', 'REGISTRATION_CLOSED');
  end if;

  if exists (
    select 1 from public.registrations
    where competition_id = p_competition_id
      and user_id = u
      and status <> 'CANCELLED'
  ) then
    return jsonb_build_object('eligible', false, 'reason', 'ALREADY_REGISTERED');
  end if;

  select * into r
  from public.registration_rules
  where competition_id = p_competition_id;

  if coalesce(cardinality(r.allowed_grades), 0) > 0 then
    if p_grade is null or not exists (
      select 1
      from unnest(r.allowed_grades) allowed(grade_code)
      where private.normalize_registration_grade(allowed.grade_code)
        = private.normalize_registration_grade(p_grade)
    ) then
      return jsonb_build_object(
        'eligible', false,
        'reason', 'ELIGIBILITY_FAILED',
        'allowed_grades', to_jsonb(r.allowed_grades)
      );
    end if;
  end if;

  if r.max_participants is not null then
    current_count := private.competition_reserved_participant_count(p_competition_id);
    if current_count >= r.max_participants then
      return jsonb_build_object('eligible', false, 'reason', 'PARTICIPANT_LIMIT_REACHED');
    end if;
  end if;

  return jsonb_build_object('eligible', true, 'reason', null);
end;
$eligibility$;

-- The insert trigger serializes all admission paths on the competition row,
-- then checks the same reserved-seat counter before accepting a new person.
create or replace function public.validate_registration_insert()
returns trigger
language plpgsql
security definer
set search_path to ''
as $registration_guard$
declare
  c public.competitions;
  r public.registration_rules;
  p public.profiles;
  org_plan text;
  auto_allowed boolean := false;
  current_count integer;
  twibbon_completed boolean := coalesce((new.metadata->>'twibbon_completed')::boolean, false);
  proof_url text := nullif(trim(new.social_proof_url), '');
  social_platform text := lower(nullif(trim(new.metadata->>'social_platform'), ''));
  social_username text := nullif(trim(new.metadata->>'social_username'), '');
  reg_end timestamptz;
begin
  if auth.uid() is null or new.user_id <> auth.uid() then
    raise exception 'AUTHORIZATION_REQUIRED';
  end if;

  perform public.sync_competition_registration_status(new.competition_id);

  select * into c
  from public.competitions
  where id = new.competition_id
  for update;

  if not found then
    raise exception 'COMPETITION_NOT_FOUND';
  end if;

  if c.visibility <> 'PUBLIC' or c.status <> 'REGISTRATION_OPEN' then
    raise exception 'REGISTRATION_CLOSED';
  end if;

  if c.registration_starts_at is not null and now() < c.registration_starts_at then
    raise exception 'REGISTRATION_NOT_OPEN';
  end if;

  if c.registration_ends_at is not null and now() > c.registration_ends_at then
    raise exception 'REGISTRATION_CLOSED';
  end if;

  if exists (
    select 1 from public.registrations
    where competition_id = c.id
      and user_id = new.user_id
      and status <> 'CANCELLED'
  ) then
    raise exception 'ALREADY_REGISTERED';
  end if;

  select * into r
  from public.registration_rules
  where competition_id = c.id;

  select * into p
  from public.profiles
  where id = new.user_id;

  if coalesce(cardinality(r.allowed_grades), 0) > 0
     and (
       p.grade is null
       or not exists (
         select 1
         from unnest(r.allowed_grades) allowed(grade_code)
         where private.normalize_registration_grade(allowed.grade_code)
           = private.normalize_registration_grade(p.grade)
       )
     ) then
    raise exception 'ELIGIBILITY_FAILED';
  end if;

  if r.max_participants is not null then
    current_count := private.competition_reserved_participant_count(c.id);
    if current_count >= r.max_participants then
      raise exception 'PARTICIPANT_LIMIT_REACHED';
    end if;
  end if;

  if r.require_twibbon
     and not twibbon_completed
     and coalesce(current_setting('app.registration_coin_bypass', true), 'false') <> 'true' then
    raise exception 'TWIBBON_REQUIRED';
  end if;

  if r.require_social_proof
     and (proof_url is null or social_platform is null or social_username is null)
     and coalesce(current_setting('app.registration_coin_bypass', true), 'false') <> 'true' then
    raise exception 'SOCIAL_PROOF_REQUIRED';
  end if;

  if proof_url is not null then
    if social_platform = 'instagram' and proof_url !~* '^https?://(www\.)?instagram\.com/' then
      raise exception 'SOCIAL_PROOF_PLATFORM_MISMATCH';
    end if;
    if social_platform = 'tiktok' and proof_url !~* '^https?://(www\.)?tiktok\.com/' then
      raise exception 'SOCIAL_PROOF_PLATFORM_MISMATCH';
    end if;
    if social_platform not in ('instagram', 'tiktok') then
      raise exception 'SOCIAL_PROOF_PLATFORM_INVALID';
    end if;
  end if;

  if social_username is not null
     and length(regexp_replace(social_username, '[^A-Za-z0-9._]', '', 'g')) < 2 then
    raise exception 'SOCIAL_USERNAME_INVALID';
  end if;

  new.submitted_at := coalesce(new.submitted_at, now());
  new.status := 'PENDING'::public.registration_status;

  select op.plan_code into org_plan
  from public.organizer_plans op
  where op.organizer_id = c.organizer_id
    and op.is_active = true
    and (op.ends_at is null or op.ends_at > now())
  order by op.starts_at desc
  limit 1;

  if upper(coalesce(r.approval_mode, 'MANUAL')) = 'AUTO' then
    if upper(coalesce(org_plan, '')) = 'PRO' then
      auto_allowed := true;
    elsif upper(coalesce(org_plan, '')) = 'PREMIUM' then
      reg_end := c.registration_ends_at;
      auto_allowed := reg_end is not null and now() >= reg_end - interval '3 days';
    elsif upper(coalesce(org_plan, '')) not in ('FREE', '') then
      select exists (
        select 1
        from public.plan_entitlements pe
        where pe.plan_code = org_plan
          and pe.capability = 'auto_registration_approval'
          and coalesce(pe.limit_value, 1) > 0
      ) into auto_allowed;
    end if;
  end if;

  if auto_allowed then
    new.status := 'ACTIVE'::public.registration_status;
    new.approved_at := now();
    new.approved_by := null;
  end if;

  return new;
end;
$registration_guard$;

-- Collective quotes reserve all selected seats while payment is pending.
-- A row lock on competitions serializes quotes with individual registrations.
create or replace function public.quote_collective_registration(
  p_competition_id uuid,
  p_roster_student_ids uuid[],
  p_certificate_policy text default 'EVENT_DEFAULT'
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $collective_quote$
declare
  v_uid uuid := auth.uid();
  v_comp public.competitions%rowtype;
  v_rule public.registration_rules%rowtype;
  v_unit numeric := 0;
  v_count integer;
  v_eligible integer;
  v_student_ids uuid[];
  v_invalid integer;
  v_reserved_count integer;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_certificate_policy not in ('EVENT_DEFAULT', 'INCLUDED', 'OPTIONAL', 'NONE') then
    raise exception 'INVALID_CERTIFICATE_POLICY';
  end if;

  select c.* into v_comp
  from public.competitions c
  where c.id = p_competition_id
  for update;

  if not found then raise exception 'COMPETITION_NOT_FOUND'; end if;
  if not private.competition_allows_collective(v_comp.participant_mode, v_comp.config) then
    raise exception 'COMPETITION_NOT_COLLECTIVE';
  end if;
  if v_comp.status not in ('PUBLISHED', 'REGISTRATION_OPEN') then
    raise exception 'REGISTRATION_NOT_OPEN';
  end if;
  if v_comp.registration_starts_at is not null and now() < v_comp.registration_starts_at then
    raise exception 'REGISTRATION_NOT_OPEN';
  end if;
  if v_comp.registration_ends_at is not null and now() > v_comp.registration_ends_at then
    raise exception 'REGISTRATION_CLOSED';
  end if;

  v_student_ids := coalesce(p_roster_student_ids, '{}'::uuid[]);
  v_count := coalesce(array_length(v_student_ids, 1), 0);
  if v_count < 1 then raise exception 'NO_STUDENTS_SELECTED'; end if;
  if v_count > 500 then raise exception 'TOO_MANY_STUDENTS'; end if;

  select count(*) into v_invalid
  from public.roster_students rs
  join public.teacher_rosters tr on tr.id = rs.roster_id
  where rs.id = any(v_student_ids)
    and rs.is_active = true
    and tr.is_active = true
    and tr.teacher_user_id = v_uid;

  if v_invalid <> v_count then raise exception 'ROSTER_ACCESS_DENIED'; end if;

  select rr.* into v_rule
  from public.registration_rules rr
  where rr.competition_id = p_competition_id
  limit 1;

  select coalesce(
    nullif(v_comp.config->>'collective_price_per_participant', '')::numeric,
    nullif(v_comp.config->>'registration_price_per_participant', '')::numeric,
    nullif(v_rule.config->>'collective_price_per_participant', '')::numeric,
    nullif(v_rule.config->>'registration_price_per_participant', '')::numeric,
    0
  ) into v_unit;

  select count(*) into v_eligible
  from public.roster_students rs
  join public.teacher_rosters tr on tr.id = rs.roster_id
  where rs.id = any(v_student_ids)
    and rs.is_active = true
    and tr.is_active = true
    and tr.teacher_user_id = v_uid
    and (
      coalesce(array_length(v_comp.target_grades, 1), 0) = 0
      or rs.grade = any(v_comp.target_grades)
    )
    and not (
      coalesce(array_length(v_comp.excluded_grades, 1), 0) > 0
      and rs.grade = any(v_comp.excluded_grades)
    )
    and not exists (
      select 1 from public.collective_participants cp
      where cp.competition_id = p_competition_id
        and cp.roster_student_id = rs.id
        and cp.status in ('ACTIVE', 'PROVISIONED')
    )
    and not exists (
      select 1 from public.collective_registrations cr
      where cr.competition_id = p_competition_id
        and cr.status in ('PENDING_PAYMENT', 'PAID')
        and rs.id = any(cr.roster_student_ids)
    );

  if v_eligible <> v_count then
    raise exception 'STUDENT_NOT_ELIGIBLE_OR_ALREADY_REGISTERED';
  end if;

  if v_rule.max_participants is not null then
    v_reserved_count := private.competition_reserved_participant_count(p_competition_id);
    if v_reserved_count + v_count > v_rule.max_participants then
      raise exception 'PARTICIPANT_LIMIT_REACHED';
    end if;
  end if;

  return jsonb_build_object(
    'competition_id', p_competition_id,
    'student_count', v_count,
    'student_ids', to_jsonb(v_student_ids),
    'unit_price', v_unit,
    'subtotal', v_unit * v_count,
    'total', v_unit * v_count,
    'currency', 'IDR',
    'certificate_policy', p_certificate_policy
  );
end;
$collective_quote$;

-- Keep the collective enrollment wizard aligned with the organizer's quota controls.
create or replace function public.get_collective_registration_options(
  p_competition_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $collective_options$
declare
  v_comp public.competitions%rowtype;
  v_rule public.registration_rules%rowtype;
  v_levels jsonb;
  v_price numeric;
begin
  select c.* into v_comp
  from public.competitions c
  where c.id = p_competition_id;

  if not found then raise exception 'COMPETITION_NOT_FOUND'; end if;
  if not private.competition_allows_collective(v_comp.participant_mode, v_comp.config) then
    raise exception 'COMPETITION_NOT_COLLECTIVE';
  end if;
  if v_comp.status not in ('PUBLISHED', 'REGISTRATION_OPEN') then
    raise exception 'REGISTRATION_NOT_OPEN';
  end if;

  select rr.* into v_rule
  from public.registration_rules rr
  where rr.competition_id = p_competition_id
  limit 1;

  select coalesce(
    nullif(v_comp.config->>'collective_price_per_participant', '')::numeric,
    nullif(v_comp.config->>'registration_price_per_participant', '')::numeric,
    nullif(v_rule.config->>'collective_price_per_participant', '')::numeric,
    nullif(v_rule.config->>'registration_price_per_participant', '')::numeric,
    0
  ) into v_price;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', cl.id,
        'code', cl.code,
        'label', cl.label,
        'allowed_grades', cl.allowed_grades,
        'points', cl.points,
        'config', cl.config
      ) order by cl.created_at
    ),
    '[]'::jsonb
  ) into v_levels
  from public.competition_levels cl
  where cl.competition_id = p_competition_id;

  return jsonb_build_object(
    'competition', jsonb_build_object(
      'id', v_comp.id,
      'title', v_comp.title,
      'participant_mode', v_comp.participant_mode,
      'status', v_comp.status,
      'registration_ends_at', v_comp.registration_ends_at,
      'target_grades', coalesce(v_comp.target_grades, '{}'::text[]),
      'excluded_grades', coalesce(v_comp.excluded_grades, '{}'::text[])
    ),
    'levels', v_levels,
    'registration_rules', case
      when v_rule.id is null then '{}'::jsonb
      else jsonb_build_object(
        'allowed_grades', v_rule.allowed_grades,
        'minimum_participants', v_rule.minimum_participants,
        'max_participants', v_rule.max_participants,
        'approval_mode', v_rule.approval_mode,
        'require_twibbon', v_rule.require_twibbon,
        'require_social_proof', v_rule.require_social_proof,
        'config', v_rule.config
      )
    end,
    'pricing', jsonb_build_object('unit_price', v_price, 'currency', 'IDR'),
    'certificate_policies', jsonb_build_array('EVENT_DEFAULT', 'INCLUDED', 'OPTIONAL', 'NONE')
  );
end;
$collective_options$;

-- Legacy direct collective provisioning remains supported, but cannot bypass
-- the same participant ceiling used by paid collective and individual flows.
create or replace function public.create_collective_participants(
  p_competition_id uuid,
  p_roster_student_ids uuid[]
)
returns table (
  participant_id uuid,
  roster_student_id uuid,
  participant_code text,
  temporary_password text,
  full_name text,
  class_name text,
  grade text,
  photo_url text
)
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $collective_direct$
declare
  v_uid uuid := auth.uid();
  v_competition record;
  v_maximum integer;
  v_new_count integer := 0;
  v_reserved_count integer := 0;
  v_participant_id uuid;
  v_code text;
  v_password text;
  r_student record;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;

  select c.id, c.participant_mode, c.config
  into v_competition
  from public.competitions c
  where c.id = p_competition_id
  for update;

  if not found then raise exception 'COMPETITION_NOT_FOUND'; end if;
  if not private.competition_allows_collective(v_competition.participant_mode, v_competition.config) then
    raise exception 'COMPETITION_NOT_COLLECTIVE';
  end if;
  if not exists (
    select 1 from public.user_roles ur
    where ur.user_id = v_uid and ur.is_active = true and ur.role in ('teacher', 'admin')
  ) then
    raise exception 'FORBIDDEN';
  end if;

  select rr.max_participants into v_maximum
  from public.registration_rules rr
  where rr.competition_id = p_competition_id;

  select count(*) into v_new_count
  from (
    select distinct unnest(coalesce(p_roster_student_ids, '{}'::uuid[])) as roster_student_id
  ) requested
  join public.roster_students rs on rs.id = requested.roster_student_id
  join public.teacher_rosters tr on tr.id = rs.roster_id
  where rs.is_active = true
    and tr.is_active = true
    and tr.teacher_user_id = v_uid
    and not exists (
      select 1 from public.collective_participants cp
      where cp.competition_id = p_competition_id
        and cp.roster_student_id = rs.id
        and cp.status in ('ACTIVE', 'PROVISIONED')
    )
    and not exists (
      select 1 from public.collective_registrations cr
      where cr.competition_id = p_competition_id
        and cr.status in ('PENDING_PAYMENT', 'PAID')
        and rs.id = any(cr.roster_student_ids)
    );

  if v_maximum is not null and v_new_count > 0 then
    v_reserved_count := private.competition_reserved_participant_count(p_competition_id);
    if v_reserved_count + v_new_count > v_maximum then
      raise exception 'PARTICIPANT_LIMIT_REACHED';
    end if;
  end if;

  for r_student in
    select rs.id, rs.full_name, rs.class_name, rs.grade, rs.photo_url, tr.school_id
    from public.roster_students rs
    join public.teacher_rosters tr on tr.id = rs.roster_id
    where rs.id = any(coalesce(p_roster_student_ids, '{}'::uuid[]))
      and rs.is_active = true
      and tr.is_active = true
      and tr.teacher_user_id = v_uid
  loop
    if exists (
      select 1 from public.collective_participants cp
      where cp.competition_id = p_competition_id
        and cp.roster_student_id = r_student.id
        and cp.status in ('ACTIVE', 'PROVISIONED')
    ) then
      continue;
    end if;

    if exists (
      select 1 from public.collective_registrations cr
      where cr.competition_id = p_competition_id
        and cr.status in ('PENDING_PAYMENT', 'PAID')
        and r_student.id = any(cr.roster_student_ids)
    ) then
      continue;
    end if;

    v_code := 'CP-' || upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 10));
    while exists (
      select 1 from public.collective_participants cp where cp.participant_code = v_code
    ) loop
      v_code := 'CP-' || upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 10));
    end loop;
    v_password := 'SK' || upper(substr(encode(gen_random_bytes(7), 'hex'), 1, 12));

    insert into public.collective_participants(
      competition_id, roster_student_id, managed_by_user_id, participant_code,
      full_name, class_name, grade, school_id, photo_url, status
    )
    values (
      p_competition_id, r_student.id, v_uid, v_code,
      r_student.full_name, r_student.class_name, r_student.grade,
      r_student.school_id, r_student.photo_url, 'ACTIVE'
    )
    returning id into v_participant_id;

    insert into public.participant_access_credentials(
      collective_participant_id, password_hash, password_version, failed_attempts, enabled
    )
    values (
      v_participant_id, crypt(v_password, gen_salt('bf', 12)), 1, 0, true
    );

    participant_id := v_participant_id;
    roster_student_id := r_student.id;
    participant_code := v_code;
    temporary_password := v_password;
    full_name := r_student.full_name;
    class_name := r_student.class_name;
    grade := r_student.grade;
    photo_url := r_student.photo_url;
    return next;
  end loop;
end;
$collective_direct$;

-- User-submitted reports flow through a narrow RPC because report records are
-- intentionally not directly writable through the public Data API.
create or replace function public.report_competition_comment(
  p_comment_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_report_id uuid;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_uid is null then
    raise exception 'AUTHORIZATION_REQUIRED';
  end if;
  if p_comment_id is null then
    raise exception 'COMMENT_REQUIRED';
  end if;
  if v_reason is null or char_length(v_reason) < 3 or char_length(v_reason) > 200 then
    raise exception 'REPORT_REASON_INVALID';
  end if;
  if not exists (
    select 1 from public.comments c
    where c.id = p_comment_id
      and c.moderation_state in ('PUBLISHED', 'VISIBLE')
      and c.user_id <> v_uid
  ) then
    raise exception 'COMMENT_NOT_REPORTABLE';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_comment_id::text), hashtext(v_uid::text));

  if exists (
    select 1 from public.comment_reports cr
    where cr.comment_id = p_comment_id
      and cr.reporter_user_id = v_uid
      and cr.status in ('OPEN', 'REVIEWED')
  ) then
    raise exception 'COMMENT_ALREADY_REPORTED';
  end if;

  insert into public.comment_reports(comment_id, reporter_user_id, reason, status)
  values (p_comment_id, v_uid, v_reason, 'OPEN')
  returning id into v_report_id;

  return v_report_id;
end;
$function$;

revoke all on function public.report_competition_comment(uuid, text) from public, anon;
grant execute on function public.report_competition_comment(uuid, text) to authenticated;

commit;
