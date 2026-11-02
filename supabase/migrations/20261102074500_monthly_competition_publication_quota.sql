begin;

-- Count only first publication events in the current Jakarta calendar month.
-- Drafts can always be saved; the entitlement is consumed when a competition
-- is first published, not when its row is created.
create or replace function private.monthly_organizer_competition_quota(p_organizer_id uuid)
returns table(
  plan_code text,
  quota_limit numeric,
  used_count bigint,
  reset_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_plan_code text;
  v_quota_limit numeric;
  v_used_count bigint := 0;
  v_now timestamptz := clock_timestamp();
  v_local_now timestamp without time zone;
  v_month_start timestamptz;
  v_reset_at timestamptz;
begin
  if p_organizer_id is null then
    raise exception 'ORGANIZER_ID_REQUIRED';
  end if;

  v_local_now := v_now at time zone 'Asia/Jakarta';
  v_month_start := date_trunc('month', v_local_now) at time zone 'Asia/Jakarta';
  v_reset_at := (date_trunc('month', v_local_now) + interval '1 month') at time zone 'Asia/Jakarta';

  select effective.plan_code
    into v_plan_code
  from private.get_effective_organizer_plan(p_organizer_id) effective
  limit 1;

  if v_plan_code is not null then
    select pe.limit_value
      into v_quota_limit
    from public.plan_entitlements pe
    where pe.plan_code = v_plan_code
      and pe.capability = 'competition_create';
  end if;

  select count(distinct h.competition_id)
    into v_used_count
  from public.competition_status_history h
  join public.competitions c on c.id = h.competition_id
  where c.organizer_id = p_organizer_id
    and h.to_status::text = 'PUBLISHED'
    and h.created_at >= v_month_start
    and h.created_at < v_reset_at;

  return query
  select
    coalesce(v_plan_code, 'NONE'),
    coalesce(v_quota_limit, 0),
    coalesce(v_used_count, 0),
    v_reset_at;
end;
$function$;

revoke all on function private.monthly_organizer_competition_quota(uuid) from public, anon, authenticated;

-- Authenticated organizer owners/editors can read the quota status for their
-- workspace. Administrators retain their existing unlimited publish access.
create or replace function public.get_organizer_competition_quota(p_organizer_id uuid)
returns table(
  plan_code text,
  quota_limit numeric,
  used_count bigint,
  reset_at timestamptz,
  can_publish boolean,
  is_admin boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_is_admin boolean := coalesce(private.current_user_is_admin(), false);
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not v_is_admin
     and not private.current_user_can_edit_competition(p_organizer_id) then
    raise exception 'ACCESS_DENIED';
  end if;

  return query
  select
    quota.plan_code,
    case when v_is_admin then null::numeric else quota.quota_limit end,
    quota.used_count,
    quota.reset_at,
    v_is_admin or quota.used_count < coalesce(quota.quota_limit, 0),
    v_is_admin
  from private.monthly_organizer_competition_quota(p_organizer_id) quota;
end;
$function$;

revoke all on function public.get_organizer_competition_quota(uuid) from public, anon;
grant execute on function public.get_organizer_competition_quota(uuid) to authenticated;

-- The create RPC is responsible only for creating a DRAFT and validating plan
-- eligibility plus optional Twibbon Canvas access. Monthly quota is enforced
-- later by transition_competition at first publication.
create or replace function public.create_organizer_competition(
  p_organizer_id uuid,
  p_title text,
  p_slug text,
  p_category text,
  p_short_description text,
  p_description text,
  p_poster_url text,
  p_poster_public_id text,
  p_visibility text,
  p_registration_starts_at timestamptz,
  p_registration_ends_at timestamptz,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_announcement_at timestamptz,
  p_category_codes text[],
  p_excluded_category_codes text[],
  p_target_grades text[],
  p_excluded_grades text[],
  p_twibbon_mode text,
  p_twibbon_external_url text,
  p_twibbon_frame_url text,
  p_twibbon_frame_public_id text
)
returns public.competitions
language plpgsql
security definer
set search_path = 'public', 'private'
as $function$
declare
  v_uid uuid := auth.uid();
  v_plan text;
  v_competition public.competitions;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not private.current_user_is_admin()
     and not private.current_user_is_organizer_for(p_organizer_id) then
    raise exception 'FORBIDDEN';
  end if;

  select effective.plan_code
    into v_plan
  from private.get_effective_organizer_plan(p_organizer_id) effective
  limit 1;

  if v_plan is null then
    raise exception 'PLAN_EXPIRED';
  end if;

  if p_twibbon_mode = 'canvas'
     and not exists (
       select 1
       from public.plan_entitlements pe
       where pe.plan_code = v_plan
         and pe.capability = 'twibbon_canvas'
         and coalesce(pe.limit_value, 0) > 0
     ) then
    raise exception 'PREMIUM_REQUIRED';
  end if;

  insert into public.competitions (
    organizer_id, title, slug, category, short_description, description,
    poster_url, poster_public_id, visibility, status, registration_starts_at,
    registration_ends_at, starts_at, ends_at, announcement_at, category_codes,
    excluded_category_codes, target_grades, excluded_grades, twibbon_mode,
    twibbon_external_url, twibbon_frame_url, twibbon_frame_public_id
  )
  values (
    p_organizer_id, p_title, p_slug, p_category, p_short_description, p_description,
    p_poster_url, p_poster_public_id, coalesce(p_visibility, 'PUBLIC'), 'DRAFT',
    p_registration_starts_at, p_registration_ends_at, p_starts_at, p_ends_at,
    p_announcement_at, p_category_codes, p_excluded_category_codes, p_target_grades,
    p_excluded_grades, coalesce(p_twibbon_mode, 'external'), p_twibbon_external_url,
    p_twibbon_frame_url, p_twibbon_frame_public_id
  )
  returning * into v_competition;

  return v_competition;
end;
$function$;

-- Serialize first-publication checks per organizer so two parallel Release
-- requests cannot both consume the last available slot.
create or replace function public.transition_competition(
  p_competition_id uuid,
  p_to_status public.competition_status,
  p_reason text default null
)
returns public.competitions
language plpgsql
security definer
set search_path = 'public', 'private'
as $function$
declare
  v_before public.competitions;
  v_after public.competitions;
  v_organizer_id uuid;
  v_is_admin boolean := coalesce(private.current_user_is_admin(), false);
  v_already_published boolean := false;
  v_quota record;
  v_allowed boolean := false;
begin
  select c.organizer_id
    into v_organizer_id
  from public.competitions c
  where c.id = p_competition_id;

  if not found then
    raise exception 'COMPETITION_NOT_FOUND';
  end if;

  if not v_is_admin
     and (v_organizer_id is null or not private.current_user_can_edit_competition(v_organizer_id)) then
    raise exception 'ACCESS_DENIED';
  end if;

  if p_to_status = 'PUBLISHED'::public.competition_status
     and v_organizer_id is not null
     and not v_is_admin then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(v_organizer_id::text || ':monthly_competition_publication', 0)
    );
  end if;

  select *
    into v_before
  from public.competitions
  where id = p_competition_id
  for update;

  if not found then
    raise exception 'COMPETITION_NOT_FOUND';
  end if;

  if not v_is_admin
     and (v_before.organizer_id is null or not private.current_user_can_edit_competition(v_before.organizer_id)) then
    raise exception 'ACCESS_DENIED';
  end if;

  if p_to_status = 'PUBLISHED'::public.competition_status
     and v_before.organizer_id is not null
     and not v_is_admin then
    select exists (
      select 1
      from public.competition_status_history h
      where h.competition_id = p_competition_id
        and h.to_status::text = 'PUBLISHED'
    )
    into v_already_published;

    if not v_already_published then
      select *
        into v_quota
      from private.monthly_organizer_competition_quota(v_before.organizer_id);

      if coalesce(v_quota.used_count, 0) >= coalesce(v_quota.quota_limit, 0) then
        raise exception 'COMPETITION_QUOTA_EXCEEDED'
          using detail = jsonb_build_object(
            'plan_code', coalesce(v_quota.plan_code, 'NONE'),
            'used', coalesce(v_quota.used_count, 0),
            'limit', coalesce(v_quota.quota_limit, 0),
            'reset_at', v_quota.reset_at
          )::text;
      end if;
    end if;
  end if;

  v_allowed := case v_before.status
    when 'DRAFT' then p_to_status in ('PUBLISHED', 'CANCELLED', 'SUSPENDED')
    when 'PUBLISHED' then p_to_status in ('REGISTRATION_OPEN', 'CANCELLED', 'SUSPENDED')
    when 'REGISTRATION_OPEN' then p_to_status in ('REGISTRATION_CLOSED', 'CANCELLED', 'SUSPENDED')
    when 'REGISTRATION_CLOSED' then p_to_status in ('LIVE', 'CANCELLED', 'SUSPENDED')
    when 'LIVE' then p_to_status in ('SUBMISSION_CLOSED', 'CANCELLED', 'SUSPENDED')
    when 'SUBMISSION_CLOSED' then p_to_status in ('GRADING', 'CANCELLED', 'SUSPENDED')
    when 'GRADING' then p_to_status in ('RESULT_PUBLISHED', 'SUSPENDED')
    when 'RESULT_PUBLISHED' then p_to_status in ('ARCHIVED', 'SUSPENDED')
    when 'ARCHIVED' then false
    when 'CANCELLED' then false
    when 'SUSPENDED' then p_to_status <> 'ARCHIVED'
    else false
  end;

  if not v_allowed then
    raise exception 'INVALID_COMPETITION_TRANSITION:%:%', v_before.status, p_to_status;
  end if;

  perform pg_catalog.set_config('syka.allow_competition_transition', '1', true);

  update public.competitions
  set status = p_to_status,
      updated_at = now()
  where id = p_competition_id
  returning * into v_after;

  insert into public.competition_status_history (
    competition_id, from_status, to_status, changed_by, reason
  )
  values (
    p_competition_id, v_before.status, p_to_status, auth.uid(), p_reason
  );

  perform private.write_audit(
    'competition.status_transition',
    'competition',
    p_competition_id::text,
    p_reason,
    to_jsonb(v_before),
    to_jsonb(v_after),
    null
  );

  return v_after;
end;
$function$;

commit;
