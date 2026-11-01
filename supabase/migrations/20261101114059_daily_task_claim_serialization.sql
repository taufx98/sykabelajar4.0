-- Serialize concurrent claims per user/task so retries remain idempotent
-- and max_claims_per_user cannot be bypassed by parallel requests.

CREATE OR REPLACE FUNCTION public.claim_and_complete_daily_task(p_task_id uuid)
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
  v_claim_count integer := 0;
  v_ledger_id uuid;
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

  IF NOT private.is_daily_task_eligible(u, p_task_id, v_claim_date) THEN
    RAISE EXCEPTION 'TASK_REQUIREMENT_NOT_MET';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(u::text || ':daily-task:' || p_task_id::text, 0)
  );

  SELECT *
    INTO claim
  FROM public.daily_task_claims
  WHERE task_id = p_task_id
    AND user_id = u
    AND claim_date = v_claim_date
  FOR UPDATE;

  IF FOUND AND claim.status = 'COMPLETED' THEN
    RETURN jsonb_build_object(
      'completed', true,
      'already', true,
      'points', coalesce(t.points, 0),
      'exp', coalesce(t.exp, 0)
    );
  END IF;

  IF NOT FOUND THEN
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
    RETURNING * INTO claim;
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


CREATE OR REPLACE FUNCTION public.claim_daily_task(p_task_id uuid)
 RETURNS daily_task_claims
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

  IF NOT private.is_daily_task_eligible(u, p_task_id, v_claim_date) THEN
    RAISE EXCEPTION 'TASK_REQUIREMENT_NOT_MET';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(u::text || ':daily-task:' || p_task_id::text, 0)
  );

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
