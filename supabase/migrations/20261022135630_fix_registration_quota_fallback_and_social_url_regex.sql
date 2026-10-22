begin;

-- A competition can remain publicly open after a paid organizer plan expires.
-- If no plan is current, enforce the FREE participant entitlement (not zero).
create or replace function private.guard_registration_entitlement()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $function$
declare
  v_org uuid;
  v_plan text;
  v_limit numeric;
  v_used bigint;
begin
  select organizer_id
    into v_org
  from public.competitions
  where id = new.competition_id;

  if v_org is null then
    raise exception 'COMPETITION_NOT_FOUND';
  end if;

  if private.current_user_is_admin() then
    return new;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(new.competition_id::text || ':participants', 0)
  );

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

  select count(*)
    into v_used
  from public.registrations r
  where r.competition_id = new.competition_id
    and r.status not in ('REJECTED', 'CANCELLED');

  if v_used >= coalesce(v_limit, 0) then
    raise exception 'PARTICIPANT_QUOTA_EXCEEDED';
  end if;

  return new;
end;
$function$;

-- Previous escaping made the regular expression seek a literal backslash,
-- rejecting otherwise valid Instagram and TikTok URLs. Normalize \\. to \.
do $fix_social_url_regex$
declare
  v_definition text;
  v_old text := $old$\\.$old$;
  v_new text := $new$\.$new$;
  v_occurrences integer;
begin
  select pg_get_functiondef('public.validate_registration_insert()'::regprocedure)
    into v_definition;

  v_occurrences :=
    (length(v_definition) - length(replace(v_definition, v_old, '')))
    / length(v_old);

  if v_occurrences <> 4 then
    raise exception 'SOCIAL_URL_REGEX_ANCHOR_MISMATCH:%', v_occurrences;
  end if;

  v_definition := replace(v_definition, v_old, v_new);

  if position(v_old in v_definition) > 0 then
    raise exception 'SOCIAL_URL_REGEX_REPLACEMENT_INCOMPLETE';
  end if;

  execute v_definition;
end;
$fix_social_url_regex$;

-- Fail fast if either platform URL would still be rejected by the corrected expressions.
do $verify_social_url_regex$
begin
  if 'https://www.instagram.com/p/example/' !~* $re$^https?://(www\.)?instagram\.com/$re$ then
    raise exception 'INSTAGRAM_URL_REGEX_STILL_REJECTS_VALID_URL';
  end if;
  if 'https://www.tiktok.com/@sample/video/123' !~* $re$^https?://(www\.)?tiktok\.com/$re$ then
    raise exception 'TIKTOK_URL_REGEX_STILL_REJECTS_VALID_URL';
  end if;
end;
$verify_social_url_regex$;

commit;
