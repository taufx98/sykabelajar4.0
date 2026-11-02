begin;

create or replace function private.competition_plan_participant_limit(
  p_competition_id uuid
)
returns integer
language sql
stable
security definer
set search_path to ''
as $function$
  select coalesce((
    select coalesce(pe.limit_value, 0)::integer
    from public.competitions c
    left join lateral (
      select op.plan_code
      from public.organizer_plans op
      where op.organizer_id = c.organizer_id
        and op.is_active = true
        and op.starts_at <= now()
        and (op.ends_at is null or op.ends_at > now())
      order by op.starts_at desc, op.created_at desc
      limit 1
    ) active_plan on true
    left join public.plan_entitlements pe
      on pe.plan_code = coalesce(active_plan.plan_code, 'FREE')
     and pe.capability = 'participant_limit'
    where c.id = p_competition_id
  ), 0);
$function$;

create or replace function private.competition_effective_participant_limit(
  p_competition_id uuid
)
returns integer
language sql
stable
security definer
set search_path to ''
as $function$
  select case
    when rr.max_participants is null then private.competition_plan_participant_limit(c.id)
    else least(rr.max_participants, private.competition_plan_participant_limit(c.id))
  end
  from public.competitions c
  left join public.registration_rules rr on rr.competition_id = c.id
  where c.id = p_competition_id;
$function$;;

CREATE OR REPLACE FUNCTION private.competition_reserved_participant_count(p_competition_id uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select
    coalesce((
      select count(*)::integer
      from public.registrations r
      where r.competition_id = p_competition_id
        and r.status::text not in ('REJECTED', 'CANCELLED')
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
$function$;

CREATE OR REPLACE FUNCTION private.guard_registration_entitlement()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_org uuid;
  v_plan text;
  v_limit numeric;
  v_used bigint;
begin
  select organizer_id
    into v_org
  from public.competitions
  where id = new.competition_id
  for update;

  if v_org is null then
    raise exception 'COMPETITION_NOT_FOUND';
  end if;

  if private.current_user_is_admin() then
    return new;
  end if;

  select op.plan_code
    into v_plan
  from public.organizer_plans op
  where op.organizer_id = v_org
    and op.is_active = true
    and op.starts_at <= now()
    and (op.ends_at is null or op.ends_at > now())
  order by op.starts_at desc, op.created_at desc
  limit 1;

  v_plan := coalesce(v_plan, 'FREE');

  select pe.limit_value
    into v_limit
  from public.plan_entitlements pe
  where pe.plan_code = v_plan
    and pe.capability = 'participant_limit';

  v_used := private.competition_reserved_participant_count(new.competition_id);

  if v_used >= coalesce(v_limit, 0) then
    raise exception 'PARTICIPANT_QUOTA_EXCEEDED';
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.check_registration_eligibility(p_competition_id uuid, p_grade text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  current_count := private.competition_reserved_participant_count(p_competition_id);
  if current_count >= private.competition_effective_participant_limit(p_competition_id) then
    return jsonb_build_object('eligible', false, 'reason', 'PARTICIPANT_LIMIT_REACHED');
  end if;

  return jsonb_build_object('eligible', true, 'reason', null);
end;
$function$;

CREATE OR REPLACE FUNCTION public.quote_collective_registration(p_competition_id uuid, p_roster_student_ids uuid[], p_certificate_policy text DEFAULT 'EVENT_DEFAULT'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  v_reserved_count := private.competition_reserved_participant_count(p_competition_id);
  if v_reserved_count + v_count > private.competition_effective_participant_limit(p_competition_id) then
    raise exception 'PARTICIPANT_LIMIT_REACHED';
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
$function$;

CREATE OR REPLACE FUNCTION public.create_collective_participants(p_competition_id uuid, p_roster_student_ids uuid[])
 RETURNS TABLE(participant_id uuid, roster_student_id uuid, participant_code text, temporary_password text, full_name text, class_name text, grade text, photo_url text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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

  if private.current_user_is_admin() then
    select rr.max_participants into v_maximum
    from public.registration_rules rr
    where rr.competition_id = p_competition_id;
  else
    v_maximum := private.competition_effective_participant_limit(p_competition_id);
  end if;

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
$function$;

CREATE OR REPLACE FUNCTION public.get_public_competition_participants(p_slug text, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_comp public.competitions%rowtype;
  v_minimum integer;
  v_competition_maximum integer;
  v_plan_maximum integer;
  v_effective_maximum integer;
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
  into v_minimum, v_competition_maximum
  from public.registration_rules rr
  where rr.competition_id = v_comp.id;

  v_plan_maximum := private.competition_plan_participant_limit(v_comp.id);
  v_effective_maximum := private.competition_effective_participant_limit(v_comp.id);

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
    'maximum_participants', v_effective_maximum,
    'competition_maximum_participants', v_competition_maximum,
    'plan_maximum_participants', v_plan_maximum,
    'effective_maximum_participants', v_effective_maximum,
    'participants', v_participants,
    'limit', v_limit,
    'offset', v_offset
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_collective_registration_options(p_competition_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
        'plan_maximum_participants', private.competition_plan_participant_limit(p_competition_id),
        'effective_maximum_participants', private.competition_effective_participant_limit(p_competition_id),
        'approval_mode', v_rule.approval_mode,
        'require_twibbon', v_rule.require_twibbon,
        'require_social_proof', v_rule.require_social_proof,
        'config', v_rule.config
      )
    end,
    'participant_limits', jsonb_build_object(
      'competition_maximum_participants', v_rule.max_participants,
      'plan_maximum_participants', private.competition_plan_participant_limit(p_competition_id),
      'effective_maximum_participants', private.competition_effective_participant_limit(p_competition_id)
    ),
    'pricing', jsonb_build_object('unit_price', v_price, 'currency', 'IDR'),
    'certificate_policies', jsonb_build_array('EVENT_DEFAULT', 'INCLUDED', 'OPTIONAL', 'NONE')
  );
end;
$function$;

revoke all on function private.competition_plan_participant_limit(uuid) from public, anon, authenticated, service_role;
revoke all on function private.competition_effective_participant_limit(uuid) from public, anon, authenticated, service_role;

commit;
