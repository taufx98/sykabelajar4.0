begin;

-- Resolve plan entitlements from the same effective-plan function used by the
-- rest of the billing system. This restores the included FREE plan during its
-- six-month eligibility window after an assigned paid plan has ended.
create or replace function public.get_active_organizer_entitlements(p_organizer_id uuid)
returns table(plan_code text, entitlement_capability text, limit_value numeric, config jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_plan_code text;
begin
  if not (
    private.current_user_is_admin()
    or private.current_user_is_organizer_for(p_organizer_id)
  ) then
    raise exception 'ACCESS_DENIED';
  end if;

  select effective.plan_code
    into v_plan_code
  from private.get_effective_organizer_plan(p_organizer_id) effective
  limit 1;

  if v_plan_code is null then
    return;
  end if;

  return query
  select v_plan_code, pe.capability::text, pe.limit_value, coalesce(pe.config, '{}'::jsonb)
  from public.plan_entitlements pe
  where pe.plan_code = v_plan_code
  order by pe.capability;
end;
$function$;

revoke all on function public.get_active_organizer_entitlements(uuid) from public, anon;
grant execute on function public.get_active_organizer_entitlements(uuid) to authenticated;

-- A secure UI-facing wrapper exposes only the caller's effective plan and dates.
create or replace function public.get_organizer_effective_plan(p_organizer_id uuid)
returns table(plan_code text, starts_at timestamptz, ends_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if not (
    private.current_user_is_admin()
    or private.current_user_is_organizer_for(p_organizer_id)
  ) then
    raise exception 'ACCESS_DENIED';
  end if;

  return query
  select effective.plan_code, effective.starts_at, effective.ends_at
  from private.get_effective_organizer_plan(p_organizer_id) effective;
end;
$function$;

revoke all on function public.get_organizer_effective_plan(uuid) from public, anon;
grant execute on function public.get_organizer_effective_plan(uuid) to authenticated;

-- Enforce exactly the same effective plan and capability limit as the UI.
-- Adding a question to an existing bank does not execute this bank INSERT guard.
create or replace function private.guard_question_bank_entitlement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_plan text;
  v_limit numeric;
  v_used bigint;
begin
  if private.current_user_is_admin() then
    return new;
  end if;

  if not private.current_user_is_organizer_for(new.organizer_id) then
    raise exception 'FORBIDDEN';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(new.organizer_id::text || ':question_banks', 0)
  );

  select effective.plan_code
    into v_plan
  from private.get_effective_organizer_plan(new.organizer_id) effective
  limit 1;

  select pe.limit_value
    into v_limit
  from public.plan_entitlements pe
  where pe.plan_code = v_plan
    and pe.capability = 'question_bank';

  if tg_op = 'INSERT' then
    select count(*)
      into v_used
    from public.question_banks qb
    where qb.organizer_id = new.organizer_id;

    if v_used >= coalesce(v_limit, 0) then
      raise exception 'QUESTION_BANK_QUOTA_EXCEEDED'
        using detail = jsonb_build_object(
          'plan_code', coalesce(v_plan, 'NONE'),
          'used', v_used,
          'limit', coalesce(v_limit, 0)
        )::text;
    end if;
  end if;

  return new;
end;
$function$;

commit;
