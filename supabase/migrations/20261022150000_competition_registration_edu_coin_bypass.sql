begin;

-- Permit the transactional registration RPC below to bypass only the two
-- Twibbon/social-proof checks, and only for the lifetime of its transaction.
-- Direct calls to register_for_competition cannot set this value themselves.
do $patch_registration_validation$
declare
  v_definition text;
  v_old_twibbon text := $old$IF r.require_twibbon AND NOT twibbon_completed THEN RAISE EXCEPTION 'TWIBBON_REQUIRED'; END IF;$old$;
  v_new_twibbon text := $new$IF r.require_twibbon AND NOT twibbon_completed AND coalesce(current_setting('app.registration_coin_bypass', true), 'false') <> 'true' THEN RAISE EXCEPTION 'TWIBBON_REQUIRED'; END IF;$new$;
  v_old_social text := $old$IF r.require_social_proof AND (proof_url IS NULL OR social_platform IS NULL OR social_username IS NULL) THEN RAISE EXCEPTION 'SOCIAL_PROOF_REQUIRED'; END IF;$old$;
  v_new_social text := $new$IF r.require_social_proof AND (proof_url IS NULL OR social_platform IS NULL OR social_username IS NULL) AND coalesce(current_setting('app.registration_coin_bypass', true), 'false') <> 'true' THEN RAISE EXCEPTION 'SOCIAL_PROOF_REQUIRED'; END IF;$new$;
begin
  select pg_get_functiondef('public.validate_registration_insert()'::regprocedure)
    into v_definition;

  if position(v_old_twibbon in v_definition) = 0 then
    raise exception 'REGISTRATION_TWIBBON_VALIDATION_ANCHOR_NOT_FOUND';
  end if;
  if position(v_old_social in v_definition) = 0 then
    raise exception 'REGISTRATION_SOCIAL_VALIDATION_ANCHOR_NOT_FOUND';
  end if;

  v_definition := replace(v_definition, v_old_twibbon, v_new_twibbon);
  v_definition := replace(v_definition, v_old_social, v_new_social);
  execute v_definition;
end;
$patch_registration_validation$;

create or replace function public.register_for_competition_with_integrity_and_coin_bypass(
  p_competition_id uuid,
  p_participation_key text,
  p_competition_level_id uuid,
  p_social_proof_url text,
  p_social_platform text,
  p_social_username text,
  p_referral_code text,
  p_integrity_agreed boolean,
  p_edu_coin_bypass boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_bypass boolean := coalesce(p_edu_coin_bypass, false);
  v_balance_before bigint;
  v_balance_after bigint;
  v_registration public.registrations;
  v_competition_title text;
begin
  if v_user_id is null then
    raise exception 'AUTHORIZATION_REQUIRED';
  end if;
  if p_integrity_agreed is not true then
    raise exception 'INTEGRITY_AGREEMENT_REQUIRED';
  end if;

  if not v_bypass and (
    nullif(trim(coalesce(p_social_proof_url, '')), '') is null
    or nullif(regexp_replace(trim(coalesce(p_social_username, '')), '^@+', ''), '') is null
    or nullif(lower(trim(coalesce(p_social_platform, '')), '') is null
  ) then
    raise exception 'SOCIAL_PROOF_OR_COIN_REQUIRED';
  end if;

  if v_bypass then
    -- Serialize spends on the wallet row to prevent simultaneous requests
    -- from using the same 100 Edu Coin twice.
    select coalesce(p.edu_coin, 0)
      into v_balance_before
    from public.profiles p
    where p.id = v_user_id
    for update;

    if not found then
      raise exception 'PROFILE_NOT_FOUND';
    end if;
    if v_balance_before < 100 then
      raise exception 'INSUFFICIENT_EDU_COIN'
        using detail = jsonb_build_object(
          'required', 100,
          'balance', v_balance_before
        )::text;
    end if;

    perform set_config('app.registration_coin_bypass', 'true', true);
  else
    perform set_config('app.registration_coin_bypass', 'false', true);
  end if;

  select c.title
    into v_competition_title
  from public.competitions c
  where c.id = p_competition_id;

  -- A valid username + URL is the participant's confirmation that the
  -- Twibbon/repost requirement has been completed. The alternative is the
  -- explicitly selected, paid Edu Coin bypass.
  v_registration := public.register_for_competition(
    p_competition_id,
    p_participation_key,
    p_competition_level_id,
    case when v_bypass then null else p_social_proof_url end,
    not v_bypass,
    case when v_bypass then null else p_social_platform end,
    case when v_bypass then null else regexp_replace(trim(coalesce(p_social_username, '')), '^@+', '') end,
    p_referral_code
  );

  if v_bypass then
    update public.profiles
      set edu_coin = coalesce(edu_coin, 0) - 100,
          updated_at = clock_timestamp()
    where id = v_user_id
      and coalesce(edu_coin, 0) >= 100
    returning edu_coin into v_balance_after;

    if not found then
      raise exception 'INSUFFICIENT_EDU_COIN';
    end if;

    insert into public.edu_coin_ledger(user_id, event_type, event_id, amount, reason)
    values (
      v_user_id,
      'COMPETITION_REGISTRATION_BYPASS',
      v_registration.id::text,
      -100,
      'Skip Twibbon dan bukti repost untuk ' || coalesce(v_competition_title, p_competition_id::text)
    );
  end if;

  update public.registrations
  set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'integrity_agreed', true,
        'integrity_agreed_at', clock_timestamp(),
        'integrity_version', 'SYKA-COMPETITION-2026-01',
        'edu_coin_bypass', v_bypass,
        'edu_coin_bypass_amount', case when v_bypass then 100 else 0 end,
        'edu_coin_bypass_event_type', case when v_bypass then 'COMPETITION_REGISTRATION_BYPASS' else null end
      ),
      updated_at = clock_timestamp()
  where id = v_registration.id
  returning * into v_registration;

  return jsonb_build_object(
    'registration', to_jsonb(v_registration),
    'edu_coin_balance', case when v_bypass then v_balance_after else null end,
    'edu_coin_spent', case when v_bypass then 100 else 0 end,
    'edu_coin_bypass', v_bypass
  );
end;
$function$;

revoke all on function public.register_for_competition_with_integrity_and_coin_bypass(uuid,text,uuid,text,text,text,text,boolean,boolean)
  from public, anon;
grant execute on function public.register_for_competition_with_integrity_and_coin_bypass(uuid,text,uuid,text,text,text,text,boolean,boolean)
  to authenticated;

commit;
