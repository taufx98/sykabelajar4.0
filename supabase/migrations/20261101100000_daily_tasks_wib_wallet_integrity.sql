-- Keep daily claim dates aligned with the product's Asia/Jakarta calendar and
-- synchronize reward ledgers with the canonical balances used by checkout.

CREATE OR REPLACE FUNCTION private.credit_profile_currency(
  p_user_id uuid,
  p_currency text,
  p_amount numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF p_user_id IS NULL OR p_amount IS NULL OR p_amount = 0 THEN
    RETURN;
  END IF;

  IF p_amount < 0 OR p_amount <> trunc(p_amount) THEN
    RAISE EXCEPTION 'INVALID_PROFILE_REWARD_AMOUNT';
  END IF;

  IF upper(p_currency) = 'COIN' THEN
    UPDATE public.profiles
    SET edu_coin = coalesce(edu_coin, 0) + p_amount::bigint,
        updated_at = pg_catalog.clock_timestamp()
    WHERE id = p_user_id;
  ELSIF upper(p_currency) = 'XP' THEN
    UPDATE public.profiles
    SET total_xp = coalesce(total_xp, 0) + p_amount::bigint,
        updated_at = pg_catalog.clock_timestamp()
    WHERE id = p_user_id;
  ELSE
    RAISE EXCEPTION 'INVALID_PROFILE_CURRENCY';
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROFILE_NOT_FOUND';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION private.credit_profile_currency(uuid, text, numeric)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.claim_daily_checkin(
  p_date date DEFAULT ((pg_catalog.now() AT TIME ZONE 'Asia/Jakarta')::date),
  p_day_number integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private'
AS $function$
DECLARE
  u uuid := auth.uid();
  v_today date := (pg_catalog.clock_timestamp() AT TIME ZONE 'Asia/Jakarta')::date;
  r jsonb;
  existing public.daily_checkins;
  rid text;
  amt numeric;
  typ text;
  next_day integer;
  v_ledger_id uuid;
  v_coin_amount numeric := 0;
BEGIN
  IF u IS NULL THEN
    RAISE EXCEPTION 'LOGIN_REQUIRED';
  END IF;

  IF p_date IS DISTINCT FROM v_today THEN
    RAISE EXCEPTION 'CHECKIN_DATE_MUST_BE_TODAY';
  END IF;

  SELECT *
    INTO existing
  FROM public.daily_checkins
  WHERE user_id = u AND checkin_date = p_date;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'already', true,
      'reward_type', existing.reward_type,
      'reward_amount', existing.reward_amount,
      'streak_day', existing.streak_day,
      'event_id', existing.event_id
    );
  END IF;

  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM public.daily_checkins dc
      WHERE dc.user_id = u AND dc.checkin_date = p_date - 1
    )
    THEN coalesce((
      SELECT streak_day
      FROM public.daily_checkins
      WHERE user_id = u AND checkin_date = p_date - 1
    ), 0) + 1
    ELSE 1
  END
  INTO next_day;

  -- Always resolve the reward using the streak calculated by the database.
  r := public.resolve_daily_checkin_reward(p_date, next_day);
  typ := coalesce(r ->> 'reward_type', 'XP');
  amt := coalesce((r ->> 'reward_amount')::numeric, 0);
  v_coin_amount := coalesce((r ->> 'coin_amount')::numeric, 0);

  INSERT INTO public.daily_checkins (
    user_id, checkin_date, reward_type, reward_amount, streak_day, event_id
  )
  VALUES (
    u, p_date, typ, amt, next_day, nullif(r ->> 'event_id', '')::uuid
  )
  RETURNING * INTO existing;

  rid := existing.user_id::text || ':' || existing.checkin_date::text;

  IF typ = 'XP' AND amt > 0 THEN
    v_ledger_id := NULL;
    INSERT INTO public.xp_ledger(user_id, event_type, event_id, amount, reason)
    VALUES (u, 'DAILY_CHECKIN', rid, amt, 'Hadiah check-in harian')
    ON CONFLICT (user_id, event_type, event_id) DO NOTHING
    RETURNING id INTO v_ledger_id;

    IF v_ledger_id IS NOT NULL THEN
      PERFORM private.credit_profile_currency(u, 'XP', amt);
    END IF;
  ELSIF typ = 'COIN' AND amt > 0 THEN
    v_ledger_id := NULL;
    INSERT INTO public.edu_coin_ledger(user_id, event_type, event_id, amount, reason)
    VALUES (u, 'DAILY_CHECKIN', rid, amt, 'Hadiah check-in harian')
    ON CONFLICT (user_id, event_type, event_id) DO NOTHING
    RETURNING id INTO v_ledger_id;

    IF v_ledger_id IS NOT NULL THEN
      PERFORM private.credit_profile_currency(u, 'COIN', amt);
    END IF;
  END IF;

  IF v_coin_amount > 0 THEN
    v_ledger_id := NULL;
    INSERT INTO public.edu_coin_ledger(user_id, event_type, event_id, amount, reason)
    VALUES (u, 'DAILY_CHECKIN', rid || ':coin', v_coin_amount, 'Koin reguler check-in')
    ON CONFLICT (user_id, event_type, event_id) DO NOTHING
    RETURNING id INTO v_ledger_id;

    IF v_ledger_id IS NOT NULL THEN
      PERFORM private.credit_profile_currency(u, 'COIN', v_coin_amount);
    END IF;
  END IF;

  RETURN r || jsonb_build_object(
    'already', false,
    'streak_day', existing.streak_day
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_daily_checkin(date, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_daily_checkin(date, integer) TO authenticated;

ALTER TABLE public.daily_task_claims
  ALTER COLUMN claim_date
  SET DEFAULT ((pg_catalog.now() AT TIME ZONE 'Asia/Jakarta')::date);

CREATE OR REPLACE FUNCTION public.claim_daily_task(p_task_id uuid)
RETURNS public.daily_task_claims
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private'
AS $function$
DECLARE
  u uuid := auth.uid();
  t public.daily_tasks;
  claim public.daily_task_claims;
  v_claim_count integer := 0;
  v_claim_date date := (pg_catalog.clock_timestamp() AT TIME ZONE 'Asia/Jakarta')::date;
BEGIN
  IF u IS NULL THEN
    RAISE EXCEPTION 'LOGIN_REQUIRED';
  END IF;

  SELECT *
    INTO t
  FROM public.daily_tasks
  WHERE id = p_task_id
    AND is_active = true
    AND (starts_at IS NULL OR starts_at <= pg_catalog.now())
    AND (ends_at IS NULL OR ends_at >= pg_catalog.now());

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TASK_NOT_FOUND';
  END IF;

  IF t.max_claims_per_user IS NOT NULL THEN
    SELECT count(*)::integer
      INTO v_claim_count
    FROM public.daily_task_claims
    WHERE task_id = p_task_id AND user_id = u;

    IF v_claim_count >= t.max_claims_per_user THEN
      RAISE EXCEPTION 'TASK_CLAIM_LIMIT_REACHED';
    END IF;
  END IF;

  INSERT INTO public.daily_task_claims(task_id, user_id, claim_date, status)
  VALUES (p_task_id, u, v_claim_date, 'CLAIMED')
  ON CONFLICT (task_id, user_id, claim_date)
  DO UPDATE SET status = public.daily_task_claims.status
  RETURNING * INTO claim;

  RETURN claim;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_daily_task(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_daily_task(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.complete_daily_task(p_task_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private'
AS $function$
DECLARE
  u uuid := auth.uid();
  t public.daily_tasks;
  claim public.daily_task_claims;
  v_claim_date date := (pg_catalog.clock_timestamp() AT TIME ZONE 'Asia/Jakarta')::date;
  v_ledger_id uuid;
BEGIN
  IF u IS NULL THEN
    RAISE EXCEPTION 'LOGIN_REQUIRED';
  END IF;

  SELECT *
    INTO t
  FROM public.daily_tasks
  WHERE id = p_task_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TASK_NOT_FOUND';
  END IF;

  SELECT *
    INTO claim
  FROM public.daily_task_claims
  WHERE task_id = p_task_id
    AND user_id = u
    AND claim_date = v_claim_date
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TASK_NOT_CLAIMED';
  END IF;

  IF claim.status = 'COMPLETED' THEN
    RETURN jsonb_build_object(
      'completed', true,
      'already', true,
      'points', coalesce(t.points, 0),
      'exp', coalesce(t.exp, 0)
    );
  END IF;

  UPDATE public.daily_task_claims
  SET status = 'COMPLETED',
      completed_at = pg_catalog.clock_timestamp()
  WHERE id = claim.id;

  IF coalesce(t.points, 0) > 0 THEN
    v_ledger_id := NULL;
    INSERT INTO public.edu_coin_ledger(user_id, event_type, event_id, amount, reason)
    VALUES (u, 'DAILY_TASK_COMPLETED', claim.id::text, t.points, 'Menyelesaikan misi harian')
    ON CONFLICT (user_id, event_type, event_id) DO NOTHING
    RETURNING id INTO v_ledger_id;

    IF v_ledger_id IS NOT NULL THEN
      PERFORM private.credit_profile_currency(u, 'COIN', t.points);
    END IF;
  END IF;

  IF coalesce(t.exp, 0) > 0 THEN
    v_ledger_id := NULL;
    INSERT INTO public.xp_ledger(user_id, event_type, event_id, amount, reason)
    VALUES (u, 'DAILY_TASK_COMPLETED', claim.id::text, t.exp, 'EXP dari misi harian')
    ON CONFLICT (user_id, event_type, event_id) DO NOTHING
    RETURNING id INTO v_ledger_id;

    IF v_ledger_id IS NOT NULL THEN
      PERFORM private.credit_profile_currency(u, 'XP', t.exp);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'completed', true,
    'already', false,
    'points', coalesce(t.points, 0),
    'exp', coalesce(t.exp, 0)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.complete_daily_task(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_daily_task(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION private.apply_referral_qualification(
  p_referred_user_id uuid,
  p_activity text,
  p_occurred_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_referral public.referral_events%rowtype;
  v_email_confirmed_at timestamptz;
  v_activity text;
  v_activity_at timestamptz;
  v_ledger_id uuid;
BEGIN
  IF p_referred_user_id IS NULL
     OR p_occurred_at IS NULL
     OR p_activity NOT IN ('daily_checkin', 'comment', 'follow', 'chat', 'daily_task') THEN
    RETURN false;
  END IF;

  SELECT re.*
    INTO v_referral
  FROM public.referral_events re
  WHERE re.referred_user_id = p_referred_user_id
    AND re.status = 'PENDING'
    AND re.verified_at IS NULL
    AND p_occurred_at >= re.created_at
    AND p_occurred_at < re.created_at + interval '24 hours'
    AND pg_catalog.clock_timestamp() < re.created_at + interval '24 hours'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_referral.verified_activity IS NOT NULL
     AND v_referral.last_checked_at IS NOT NULL THEN
    v_activity := v_referral.verified_activity;
    v_activity_at := v_referral.last_checked_at;
  ELSE
    v_activity := p_activity;
    v_activity_at := p_occurred_at;
  END IF;

  IF v_activity_at < v_referral.created_at
     OR v_activity_at >= v_referral.created_at + interval '24 hours'
     OR pg_catalog.clock_timestamp() >= v_referral.created_at + interval '24 hours' THEN
    RETURN false;
  END IF;

  SELECT au.email_confirmed_at
    INTO v_email_confirmed_at
  FROM auth.users au
  WHERE au.id = p_referred_user_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_email_confirmed_at IS NULL THEN
    IF v_referral.verified_activity IS NULL THEN
      UPDATE public.referral_events
      SET verified_activity = v_activity,
          last_checked_at = v_activity_at
      WHERE id = v_referral.id
        AND status = 'PENDING'
        AND verified_at IS NULL
        AND verified_activity IS NULL;
    END IF;
    RETURN false;
  END IF;

  UPDATE public.referral_events
  SET verified_at = v_activity_at,
      verified_activity = v_activity,
      status = 'VERIFIED',
      last_checked_at = pg_catalog.clock_timestamp()
  WHERE id = v_referral.id
    AND status = 'PENDING'
    AND verified_at IS NULL;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  v_ledger_id := NULL;
  INSERT INTO public.edu_coin_ledger (
    user_id, event_type, event_id, amount, reason
  )
  VALUES (
    v_referral.referrer_user_id,
    'REFERRAL_REGISTRATION',
    v_referral.id::text,
    v_referral.reward_amount,
    'Referral pendaftaran tervalidasi'
  )
  ON CONFLICT (user_id, event_type, event_id) DO NOTHING
  RETURNING id INTO v_ledger_id;

  IF v_ledger_id IS NOT NULL THEN
    PERFORM private.credit_profile_currency(
      v_referral.referrer_user_id,
      'COIN',
      v_referral.reward_amount
    );
  END IF;

  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION private.apply_referral_qualification(uuid, text, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.apply_referral_milestone_rewards(p_referrer_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_tiers jsonb;
  v_referral_count integer;
  v_tier jsonb;
  v_target integer;
  v_bonus numeric;
  v_award_id uuid;
  v_ledger_id uuid;
BEGIN
  IF p_referrer_user_id IS NULL THEN
    RETURN;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_referrer_user_id::text, 0)
  );

  SELECT s.milestone_tiers INTO v_tiers
  FROM private.referral_program_settings s
  WHERE s.id = true;

  IF v_tiers IS NULL OR jsonb_typeof(v_tiers) <> 'array' THEN
    RETURN;
  END IF;

  SELECT count(*)::integer INTO v_referral_count
  FROM public.referral_events re
  WHERE re.referrer_user_id = p_referrer_user_id
    AND re.status IN ('VERIFIED', 'CREDITED');

  FOR v_tier IN
    SELECT item.value
    FROM jsonb_array_elements(v_tiers) AS item(value)
    ORDER BY (item.value ->> 'target')::integer
  LOOP
    v_target := (v_tier ->> 'target')::integer;
    v_bonus := coalesce((v_tier ->> 'bonus_amount')::numeric, 0);

    IF v_referral_count < v_target OR v_bonus <= 0 THEN
      CONTINUE;
    END IF;

    v_award_id := NULL;
    INSERT INTO private.referral_tier_awards (
      referrer_user_id, milestone_target, bonus_amount, referred_count, tier_snapshot
    )
    VALUES (p_referrer_user_id, v_target, v_bonus, v_referral_count, v_tier)
    ON CONFLICT (referrer_user_id, milestone_target) DO NOTHING
    RETURNING id INTO v_award_id;

    IF v_award_id IS NOT NULL THEN
      v_ledger_id := NULL;
      INSERT INTO public.edu_coin_ledger (
        user_id, event_type, event_id, amount, reason
      )
      VALUES (
        p_referrer_user_id,
        'REFERRAL_TIER_BONUS',
        v_award_id::text,
        v_bonus,
        'Bonus milestone referral ' || v_target::text || ' pengguna'
      )
      ON CONFLICT (user_id, event_type, event_id) DO NOTHING
      RETURNING id INTO v_ledger_id;

      IF v_ledger_id IS NOT NULL THEN
        PERFORM private.credit_profile_currency(p_referrer_user_id, 'COIN', v_bonus);
      END IF;
    END IF;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION private.apply_referral_milestone_rewards(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.verify_pending_referrals()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private'
AS $function$
DECLARE
  r record;
  n integer := 0;
  activity text;
  ts timestamptz;
  v_ledger_id uuid;
BEGIN
  FOR r IN
    SELECT re.*
    FROM public.referral_events re
    JOIN auth.users au ON au.id = re.referred_user_id
    WHERE re.verified_at IS NULL
      AND re.status = 'PENDING'
      AND au.email_confirmed_at IS NOT NULL
      AND re.created_at >= pg_catalog.now() - interval '24 hours'
  LOOP
    activity := NULL;
    ts := NULL;

    SELECT 'daily_checkin', created_at INTO activity, ts
    FROM public.daily_checkins
    WHERE user_id = r.referred_user_id AND created_at >= r.created_at
    ORDER BY created_at LIMIT 1;

    IF activity IS NULL THEN
      SELECT 'comment', created_at INTO activity, ts
      FROM public.comments
      WHERE user_id = r.referred_user_id AND created_at >= r.created_at
      ORDER BY created_at LIMIT 1;
    END IF;

    IF activity IS NULL THEN
      SELECT 'follow', created_at INTO activity, ts
      FROM public.follows
      WHERE follower_id = r.referred_user_id AND created_at >= r.created_at
      ORDER BY created_at LIMIT 1;
    END IF;

    IF activity IS NULL THEN
      SELECT 'chat', created_at INTO activity, ts
      FROM public.chat_messages
      WHERE sender_id = r.referred_user_id AND created_at >= r.created_at
      ORDER BY created_at LIMIT 1;
    END IF;

    IF activity IS NULL THEN
      SELECT 'daily_task', completed_at INTO activity, ts
      FROM public.daily_task_claims
      WHERE user_id = r.referred_user_id
        AND status = 'COMPLETED'
        AND completed_at >= r.created_at
      ORDER BY completed_at LIMIT 1;
    END IF;

    IF activity IS NOT NULL THEN
      UPDATE public.referral_events
      SET verified_at = coalesce(ts, pg_catalog.now()),
          verified_activity = activity,
          status = 'VERIFIED',
          last_checked_at = pg_catalog.now()
      WHERE id = r.id AND verified_at IS NULL;

      v_ledger_id := NULL;
      INSERT INTO public.edu_coin_ledger(
        user_id, event_type, event_id, amount, reason
      )
      VALUES (
        r.referrer_user_id, 'REFERRAL_REGISTRATION', r.id::text,
        r.reward_amount, 'Referral pendaftaran tervalidasi'
      )
      ON CONFLICT (user_id, event_type, event_id) DO NOTHING
      RETURNING id INTO v_ledger_id;

      IF v_ledger_id IS NOT NULL THEN
        PERFORM private.credit_profile_currency(r.referrer_user_id, 'COIN', r.reward_amount);
      END IF;

      n := n + 1;
    ELSE
      UPDATE public.referral_events
      SET last_checked_at = pg_catalog.now()
      WHERE id = r.id;
    END IF;
  END LOOP;

  RETURN n;
END;
$function$;

