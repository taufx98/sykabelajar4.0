-- Event-driven referral qualification and lazy competition registration status sync.
-- The referral reward is issued only from database-owned activity/auth triggers.
-- No recurring Cron worker is required for either workflow.

BEGIN;

-- Resolve referrals by the account UUID shared on the referral page, while keeping
-- previously-issued short referral codes valid for existing users and links.
CREATE OR REPLACE FUNCTION public.register_for_competition(
  p_competition_id uuid,
  p_participation_key text DEFAULT NULL::text,
  p_competition_level_id uuid DEFAULT NULL::uuid,
  p_social_proof_url text DEFAULT NULL::text,
  p_twibbon_completed boolean DEFAULT false,
  p_social_platform text DEFAULT NULL::text,
  p_social_username text DEFAULT NULL::text,
  p_referral_code text DEFAULT NULL::text
)
RETURNS public.registrations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_registration public.registrations;
  v_referrer_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTHORIZATION_REQUIRED';
  END IF;

  IF nullif(trim(coalesce(p_referral_code, '')), '') IS NOT NULL THEN
    SELECT rc.user_id
      INTO v_referrer_id
    FROM public.referral_codes rc
    WHERE rc.code = upper(trim(p_referral_code));

    IF v_referrer_id IS NULL THEN
      BEGIN
        v_referrer_id := trim(p_referral_code)::uuid;
      EXCEPTION
        WHEN invalid_text_representation THEN
          v_referrer_id := NULL;
      END;
    END IF;

    IF v_referrer_id = v_user_id THEN
      v_referrer_id := NULL;
    END IF;

    IF v_referrer_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM auth.users au
      WHERE au.id = v_referrer_id
        AND au.email_confirmed_at IS NOT NULL
    ) THEN
      v_referrer_id := NULL;
    END IF;
  END IF;

  INSERT INTO public.registrations (
    competition_id,
    user_id,
    competition_level_id,
    participation_key,
    social_proof_url,
    metadata
  )
  VALUES (
    p_competition_id,
    v_user_id,
    p_competition_level_id,
    p_participation_key,
    nullif(trim(p_social_proof_url), ''),
    jsonb_build_object(
      'twibbon_completed', coalesce(p_twibbon_completed, false),
      'social_platform', nullif(lower(trim(p_social_platform)), ''),
      'social_username', nullif(regexp_replace(trim(coalesce(p_social_username, '')), '^@', ''), '')
    )
  )
  RETURNING * INTO v_registration;

  IF v_referrer_id IS NOT NULL THEN
    INSERT INTO public.referral_events (
      referrer_user_id,
      referred_user_id,
      competition_id,
      registration_id,
      reward_amount,
      status
    )
    VALUES (
      v_referrer_id,
      v_user_id,
      p_competition_id,
      v_registration.id,
      5,
      'PENDING'
    )
    ON CONFLICT (referred_user_id) DO NOTHING;
  END IF;

  INSERT INTO public.audit_logs (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    after_data
  )
  VALUES (
    v_user_id,
    'registration.create',
    'registration',
    v_registration.id::text,
    to_jsonb(v_registration)
  );

  INSERT INTO public.notifications (user_id, type, title, body, data)
  VALUES (
    v_user_id,
    CASE WHEN v_registration.status = 'ACTIVE' THEN 'REGISTRATION_APPROVED' ELSE 'REGISTRATION_SUBMITTED' END,
    CASE WHEN v_registration.status = 'ACTIVE' THEN 'Pendaftaran otomatis disetujui' ELSE 'Pendaftaran dikirim' END,
    CASE
      WHEN v_registration.status = 'ACTIVE'
        THEN 'Pendaftaran kamu langsung aktif sesuai aturan paket organizer.'
      ELSE 'Pendaftaran kamu menunggu persetujuan penyelenggara.'
    END,
    jsonb_build_object(
      'competition_id', v_registration.competition_id,
      'registration_id', v_registration.id
    )
  );

  RETURN v_registration;
END;
$function$;

REVOKE ALL ON FUNCTION public.register_for_competition(uuid, text, uuid, text, boolean, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_for_competition(uuid, text, uuid, text, boolean, text, text, text) TO authenticated;

-- Check whether a transition is due without locking an unchanged competition row.
-- Lock and re-read only the row that actually crossed a registration boundary.
CREATE OR REPLACE FUNCTION public.sync_competition_registration_status(p_competition_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_competition public.competitions%rowtype;
  v_status text;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_competition_id IS NULL THEN
    RAISE EXCEPTION 'COMPETITION_ID_REQUIRED';
  END IF;

  SELECT c.status::text
    INTO v_status
  FROM public.competitions c
  WHERE c.id = p_competition_id
    AND (
      (
        c.status = 'PUBLISHED'::public.competition_status
        AND c.registration_starts_at IS NOT NULL
        AND c.registration_starts_at <= v_now
      )
      OR
      (
        c.status = 'REGISTRATION_OPEN'::public.competition_status
        AND c.registration_ends_at IS NOT NULL
        AND c.registration_ends_at < v_now
      )
    );

  IF NOT FOUND THEN
    SELECT c.status::text
      INTO v_status
    FROM public.competitions c
    WHERE c.id = p_competition_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'COMPETITION_NOT_FOUND';
    END IF;

    RETURN v_status;
  END IF;

  SELECT c.*
    INTO v_competition
  FROM public.competitions c
  WHERE c.id = p_competition_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'COMPETITION_NOT_FOUND';
  END IF;

  IF v_competition.status = 'PUBLISHED'::public.competition_status
     AND v_competition.registration_starts_at IS NOT NULL
     AND v_now >= v_competition.registration_starts_at THEN
    PERFORM pg_catalog.set_config('syka.allow_competition_transition', '1', true);

    UPDATE public.competitions
    SET status = 'REGISTRATION_OPEN'::public.competition_status,
        updated_at = clock_timestamp()
    WHERE id = p_competition_id
    RETURNING * INTO v_competition;
  END IF;

  IF v_competition.status = 'REGISTRATION_OPEN'::public.competition_status
     AND v_competition.registration_ends_at IS NOT NULL
     AND v_now > v_competition.registration_ends_at THEN
    PERFORM pg_catalog.set_config('syka.allow_competition_transition', '1', true);

    UPDATE public.competitions
    SET status = 'REGISTRATION_CLOSED'::public.competition_status,
        updated_at = clock_timestamp()
    WHERE id = p_competition_id
    RETURNING * INTO v_competition;
  END IF;

  RETURN v_competition.status::text;
END;
$function$;

REVOKE ALL ON FUNCTION public.sync_competition_registration_status(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_competition_registration_status(uuid) TO anon, authenticated;

-- A user opening the eligibility form gets the current phase, even when the
-- scheduled worker has been removed.
CREATE OR REPLACE FUNCTION public.check_registration_eligibility(
  p_competition_id uuid,
  p_grade text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  c public.competitions;
  r public.registration_rules;
  current_count integer := 0;
  u uuid := auth.uid();
BEGIN
  IF u IS NULL THEN
    RETURN jsonb_build_object('eligible', false, 'reason', 'LOGIN_REQUIRED');
  END IF;

  PERFORM public.sync_competition_registration_status(p_competition_id);

  SELECT * INTO c
  FROM public.competitions
  WHERE id = p_competition_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('eligible', false, 'reason', 'COMPETITION_NOT_FOUND');
  END IF;

  IF c.status <> 'REGISTRATION_OPEN' THEN
    RETURN jsonb_build_object('eligible', false, 'reason', 'REGISTRATION_NOT_OPEN');
  END IF;

  IF c.registration_starts_at IS NOT NULL AND now() < c.registration_starts_at THEN
    RETURN jsonb_build_object('eligible', false, 'reason', 'REGISTRATION_NOT_OPEN');
  END IF;

  IF c.registration_ends_at IS NOT NULL AND now() > c.registration_ends_at THEN
    RETURN jsonb_build_object('eligible', false, 'reason', 'REGISTRATION_CLOSED');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.registrations
    WHERE competition_id = p_competition_id
      AND user_id = u
      AND status <> 'CANCELLED'
  ) THEN
    RETURN jsonb_build_object('eligible', false, 'reason', 'ALREADY_REGISTERED');
  END IF;

  SELECT * INTO r
  FROM public.registration_rules
  WHERE competition_id = p_competition_id;

  IF coalesce(cardinality(r.allowed_grades), 0) > 0 THEN
    IF p_grade IS NULL OR NOT EXISTS (
      SELECT 1
      FROM unnest(r.allowed_grades) allowed(grade_code)
      WHERE private.normalize_registration_grade(allowed.grade_code)
        = private.normalize_registration_grade(p_grade)
    ) THEN
      RETURN jsonb_build_object(
        'eligible', false,
        'reason', 'ELIGIBILITY_FAILED',
        'allowed_grades', to_jsonb(r.allowed_grades)
      );
    END IF;
  END IF;

  IF r.max_participants IS NOT NULL THEN
    SELECT count(*) INTO current_count
    FROM public.registrations
    WHERE competition_id = p_competition_id
      AND status IN ('PENDING', 'APPROVED', 'ACTIVE');

    IF current_count >= r.max_participants THEN
      RETURN jsonb_build_object('eligible', false, 'reason', 'PARTICIPANT_LIMIT_REACHED');
    END IF;
  END IF;

  RETURN jsonb_build_object('eligible', true, 'reason', null);
END;
$function$;

REVOKE ALL ON FUNCTION public.check_registration_eligibility(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_registration_eligibility(uuid, text) TO authenticated;

-- Registration inserts may also arrive through a trusted server path other than
-- the modal. Keep the status transition check at the database write boundary.
CREATE OR REPLACE FUNCTION public.validate_registration_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  c public.competitions;
  r public.registration_rules;
  p public.profiles;
  org_plan text;
  auto_allowed boolean := false;
  current_count integer;
  twibbon_completed boolean := coalesce((NEW.metadata->>'twibbon_completed')::boolean, false);
  proof_url text := nullif(trim(NEW.social_proof_url), '');
  social_platform text := lower(nullif(trim(NEW.metadata->>'social_platform'), ''));
  social_username text := nullif(trim(NEW.metadata->>'social_username'), '');
  reg_end timestamptz;
BEGIN
  IF auth.uid() IS NULL OR NEW.user_id <> auth.uid() THEN
    RAISE EXCEPTION 'AUTHORIZATION_REQUIRED';
  END IF;

  PERFORM public.sync_competition_registration_status(NEW.competition_id);

  SELECT * INTO c
  FROM public.competitions
  WHERE id = NEW.competition_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'COMPETITION_NOT_FOUND';
  END IF;

  IF c.visibility <> 'PUBLIC' OR c.status <> 'REGISTRATION_OPEN' THEN
    RAISE EXCEPTION 'REGISTRATION_CLOSED';
  END IF;

  IF c.registration_starts_at IS NOT NULL AND now() < c.registration_starts_at THEN
    RAISE EXCEPTION 'REGISTRATION_NOT_OPEN';
  END IF;

  IF c.registration_ends_at IS NOT NULL AND now() > c.registration_ends_at THEN
    RAISE EXCEPTION 'REGISTRATION_CLOSED';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.registrations
    WHERE competition_id = c.id
      AND user_id = NEW.user_id
      AND status <> 'CANCELLED'
  ) THEN
    RAISE EXCEPTION 'ALREADY_REGISTERED';
  END IF;

  SELECT * INTO r
  FROM public.registration_rules
  WHERE competition_id = c.id;

  SELECT * INTO p
  FROM public.profiles
  WHERE id = NEW.user_id;

  IF coalesce(cardinality(r.allowed_grades), 0) > 0
     AND (
       p.grade IS NULL
       OR NOT EXISTS (
         SELECT 1
         FROM unnest(r.allowed_grades) allowed(grade_code)
         WHERE private.normalize_registration_grade(allowed.grade_code)
           = private.normalize_registration_grade(p.grade)
       )
     ) THEN
    RAISE EXCEPTION 'ELIGIBILITY_FAILED';
  END IF;

  IF r.max_participants IS NOT NULL THEN
    SELECT count(*) INTO current_count
    FROM public.registrations
    WHERE competition_id = c.id
      AND status IN ('PENDING', 'APPROVED', 'ACTIVE');

    IF current_count >= r.max_participants THEN
      RAISE EXCEPTION 'PARTICIPANT_LIMIT_REACHED';
    END IF;
  END IF;

  IF r.require_twibbon
     AND NOT twibbon_completed
     AND coalesce(current_setting('app.registration_coin_bypass', true), 'false') <> 'true' THEN
    RAISE EXCEPTION 'TWIBBON_REQUIRED';
  END IF;

  IF r.require_social_proof
     AND (proof_url IS NULL OR social_platform IS NULL OR social_username IS NULL)
     AND coalesce(current_setting('app.registration_coin_bypass', true), 'false') <> 'true' THEN
    RAISE EXCEPTION 'SOCIAL_PROOF_REQUIRED';
  END IF;

  IF proof_url IS NOT NULL THEN
    IF social_platform = 'instagram' AND proof_url !~* '^https?://(www\.)?instagram\.com/' THEN
      RAISE EXCEPTION 'SOCIAL_PROOF_PLATFORM_MISMATCH';
    END IF;

    IF social_platform = 'tiktok' AND proof_url !~* '^https?://(www\.)?tiktok\.com/' THEN
      RAISE EXCEPTION 'SOCIAL_PROOF_PLATFORM_MISMATCH';
    END IF;

    IF social_platform NOT IN ('instagram', 'tiktok') THEN
      RAISE EXCEPTION 'SOCIAL_PROOF_PLATFORM_INVALID';
    END IF;
  END IF;

  IF social_username IS NOT NULL
     AND length(regexp_replace(social_username, '[^A-Za-z0-9._]', '', 'g')) < 2 THEN
    RAISE EXCEPTION 'SOCIAL_USERNAME_INVALID';
  END IF;

  NEW.submitted_at := coalesce(NEW.submitted_at, now());
  NEW.status := 'PENDING'::public.registration_status;

  SELECT op.plan_code INTO org_plan
  FROM public.organizer_plans op
  WHERE op.organizer_id = c.organizer_id
    AND op.is_active = true
    AND (op.ends_at IS NULL OR op.ends_at > now())
  ORDER BY op.starts_at DESC
  LIMIT 1;

  IF upper(coalesce(r.approval_mode, 'MANUAL')) = 'AUTO' THEN
    IF upper(coalesce(org_plan, '')) = 'PRO' THEN
      auto_allowed := true;
    ELSIF upper(coalesce(org_plan, '')) = 'PREMIUM' THEN
      reg_end := c.registration_ends_at;
      auto_allowed := reg_end IS NOT NULL AND now() >= reg_end - interval '3 days';
    ELSIF upper(coalesce(org_plan, '')) NOT IN ('FREE', '') THEN
      SELECT EXISTS (
        SELECT 1
        FROM public.plan_entitlements pe
        WHERE pe.plan_code = org_plan
          AND pe.capability = 'auto_registration_approval'
          AND coalesce(pe.limit_value, 1) > 0
      ) INTO auto_allowed;
    END IF;
  END IF;

  IF auto_allowed THEN
    NEW.status := 'ACTIVE'::public.registration_status;
    NEW.approved_at := now();
    NEW.approved_by := NULL;
  END IF;

  RETURN NEW;
END;
$function$;

-- A single transition record is sufficient; do not invoke its trigger function
-- for UPDATE statements that leave the status unchanged.
DROP TRIGGER IF EXISTS trg_competition_status_history ON public.competitions;
CREATE TRIGGER trg_competition_status_history
AFTER UPDATE OF status ON public.competitions
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION public.track_competition_status();

-- Retain the official attempt audit and preview exclusion, but avoid calling its
-- function for ordinary attempt updates that cannot create an audit snapshot.
DROP TRIGGER IF EXISTS trg_audit_attempt_result_snapshot ON public.attempts;
CREATE TRIGGER trg_audit_attempt_result_snapshot
AFTER UPDATE OF score, status, finalized_at ON public.attempts
FOR EACH ROW
WHEN (
  NOT coalesce(NEW.is_preview, false)
  AND NOT coalesce(OLD.is_preview, false)
  AND (
    OLD.score IS DISTINCT FROM NEW.score
    OR (
      OLD.status::text IS DISTINCT FROM NEW.status::text
      AND NEW.status::text IN ('FINALIZED', 'EXPIRED')
    )
  )
)
EXECUTE FUNCTION private.audit_attempt_result_snapshot();

-- Only look up pending referrals for the user whose qualifying event just
-- happened. The row lock and ledger unique key make simultaneous events safe.
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
BEGIN
  IF p_referred_user_id IS NULL
     OR p_occurred_at IS NULL
     OR p_activity NOT IN ('daily_checkin', 'comment', 'follow', 'chat', 'daily_task') THEN
    RETURN false;
  END IF;

  SELECT re.*
    INTO v_referral
  FROM public.referral_events re
  JOIN auth.users au ON au.id = re.referred_user_id
  WHERE re.referred_user_id = p_referred_user_id
    AND re.status = 'PENDING'
    AND re.verified_at IS NULL
    AND au.email_confirmed_at IS NOT NULL
    AND p_occurred_at >= re.created_at
    AND p_occurred_at < re.created_at + interval '24 hours'
    AND clock_timestamp() < re.created_at + interval '24 hours'
  FOR UPDATE OF re;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  UPDATE public.referral_events
  SET verified_at = p_occurred_at,
      verified_activity = p_activity,
      status = 'VERIFIED',
      last_checked_at = clock_timestamp()
  WHERE id = v_referral.id
    AND status = 'PENDING'
    AND verified_at IS NULL;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  INSERT INTO public.edu_coin_ledger (
    user_id,
    event_type,
    event_id,
    amount,
    reason
  )
  VALUES (
    v_referral.referrer_user_id,
    'REFERRAL_REGISTRATION',
    v_referral.id::text,
    v_referral.reward_amount,
    'Referral pendaftaran tervalidasi'
  )
  ON CONFLICT (user_id, event_type, event_id) DO NOTHING;

  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION private.capture_referral_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_user_id uuid;
  v_activity text;
BEGIN
  CASE TG_TABLE_NAME
    WHEN 'daily_checkins' THEN
      v_user_id := NEW.user_id;
      v_activity := 'daily_checkin';
    WHEN 'comments' THEN
      v_user_id := NEW.user_id;
      v_activity := 'comment';
    WHEN 'follows' THEN
      v_user_id := NEW.follower_id;
      v_activity := 'follow';
    WHEN 'chat_messages' THEN
      v_user_id := NEW.sender_id;
      v_activity := 'chat';
    WHEN 'daily_task_claims' THEN
      IF NEW.status = 'COMPLETED' AND NEW.completed_at IS NOT NULL THEN
        v_user_id := NEW.user_id;
        v_activity := 'daily_task';
      END IF;
    ELSE
      RETURN NEW;
  END CASE;

  IF v_user_id IS NOT NULL AND v_activity IS NOT NULL THEN
    PERFORM private.apply_referral_qualification(v_user_id, v_activity, clock_timestamp());
  END IF;

  RETURN NEW;
END;
$function$;

-- If the account was active before email confirmation, a one-user bounded
-- lookup preserves the original rule without restoring a global polling job.
CREATE OR REPLACE FUNCTION private.process_referral_email_confirmation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_referral public.referral_events%rowtype;
  v_activity text;
  v_occurred_at timestamptz;
BEGIN
  IF OLD.email_confirmed_at IS NOT NULL OR NEW.email_confirmed_at IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT re.*
    INTO v_referral
  FROM public.referral_events re
  WHERE re.referred_user_id = NEW.id
    AND re.status = 'PENDING'
    AND re.verified_at IS NULL
    AND re.created_at >= clock_timestamp() - interval '24 hours'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  SELECT activity, occurred_at
    INTO v_activity, v_occurred_at
  FROM (
    SELECT 'daily_checkin'::text AS activity, dc.created_at AS occurred_at
    FROM public.daily_checkins dc
    WHERE dc.user_id = NEW.id
      AND dc.created_at >= v_referral.created_at
      AND dc.created_at < v_referral.created_at + interval '24 hours'

    UNION ALL

    SELECT 'comment'::text, c.created_at
    FROM public.comments c
    WHERE c.user_id = NEW.id
      AND c.created_at >= v_referral.created_at
      AND c.created_at < v_referral.created_at + interval '24 hours'

    UNION ALL

    SELECT 'follow'::text, f.created_at
    FROM public.follows f
    WHERE f.follower_id = NEW.id
      AND f.created_at >= v_referral.created_at
      AND f.created_at < v_referral.created_at + interval '24 hours'

    UNION ALL

    SELECT 'chat'::text, cm.created_at
    FROM public.chat_messages cm
    WHERE cm.sender_id = NEW.id
      AND cm.created_at >= v_referral.created_at
      AND cm.created_at < v_referral.created_at + interval '24 hours'

    UNION ALL

    SELECT 'daily_task'::text, dtc.completed_at
    FROM public.daily_task_claims dtc
    WHERE dtc.user_id = NEW.id
      AND dtc.status = 'COMPLETED'
      AND dtc.completed_at IS NOT NULL
      AND dtc.completed_at >= v_referral.created_at
      AND dtc.completed_at < v_referral.created_at + interval '24 hours'
  ) qualifying_activity
  ORDER BY occurred_at ASC
  LIMIT 1;

  IF v_activity IS NOT NULL AND v_occurred_at IS NOT NULL THEN
    PERFORM private.apply_referral_qualification(NEW.id, v_activity, v_occurred_at);
  END IF;

  RETURN NEW;
END;
$function$;

-- One-time catch-up for referrals still pending at deployment. This is bounded
-- to recent pending referral rows, not a recurring scan of all users or events.
DO $referral_backfill$
DECLARE
  v_referral record;
  v_activity text;
  v_occurred_at timestamptz;
BEGIN
  FOR v_referral IN
    SELECT re.referred_user_id, re.created_at
    FROM public.referral_events re
    JOIN auth.users au ON au.id = re.referred_user_id
    WHERE re.status = 'PENDING'
      AND re.verified_at IS NULL
      AND au.email_confirmed_at IS NOT NULL
      AND re.created_at >= clock_timestamp() - interval '24 hours'
  LOOP
    SELECT activity, occurred_at
      INTO v_activity, v_occurred_at
    FROM (
      SELECT 'daily_checkin'::text AS activity, dc.created_at AS occurred_at
      FROM public.daily_checkins dc
      WHERE dc.user_id = v_referral.referred_user_id
        AND dc.created_at >= v_referral.created_at
        AND dc.created_at < v_referral.created_at + interval '24 hours'
      UNION ALL
      SELECT 'comment'::text, c.created_at
      FROM public.comments c
      WHERE c.user_id = v_referral.referred_user_id
        AND c.created_at >= v_referral.created_at
        AND c.created_at < v_referral.created_at + interval '24 hours'
      UNION ALL
      SELECT 'follow'::text, f.created_at
      FROM public.follows f
      WHERE f.follower_id = v_referral.referred_user_id
        AND f.created_at >= v_referral.created_at
        AND f.created_at < v_referral.created_at + interval '24 hours'
      UNION ALL
      SELECT 'chat'::text, cm.created_at
      FROM public.chat_messages cm
      WHERE cm.sender_id = v_referral.referred_user_id
        AND cm.created_at >= v_referral.created_at
        AND cm.created_at < v_referral.created_at + interval '24 hours'
      UNION ALL
      SELECT 'daily_task'::text, dtc.completed_at
      FROM public.daily_task_claims dtc
      WHERE dtc.user_id = v_referral.referred_user_id
        AND dtc.status = 'COMPLETED'
        AND dtc.completed_at IS NOT NULL
        AND dtc.completed_at >= v_referral.created_at
        AND dtc.completed_at < v_referral.created_at + interval '24 hours'
    ) qualifying_activity
    ORDER BY occurred_at ASC
    LIMIT 1;

    IF v_activity IS NOT NULL AND v_occurred_at IS NOT NULL THEN
      PERFORM private.apply_referral_qualification(
        v_referral.referred_user_id,
        v_activity,
        v_occurred_at
      );
    END IF;
  END LOOP;
END;
$referral_backfill$;

REVOKE ALL ON FUNCTION private.apply_referral_qualification(uuid, text, timestamptz) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.capture_referral_activity() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.process_referral_email_confirmation() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_referral_activity_daily_checkin ON public.daily_checkins;
CREATE TRIGGER trg_referral_activity_daily_checkin
AFTER INSERT ON public.daily_checkins
FOR EACH ROW
EXECUTE FUNCTION private.capture_referral_activity();

DROP TRIGGER IF EXISTS trg_referral_activity_comment ON public.comments;
CREATE TRIGGER trg_referral_activity_comment
AFTER INSERT ON public.comments
FOR EACH ROW
EXECUTE FUNCTION private.capture_referral_activity();

DROP TRIGGER IF EXISTS trg_referral_activity_follow ON public.follows;
CREATE TRIGGER trg_referral_activity_follow
AFTER INSERT ON public.follows
FOR EACH ROW
EXECUTE FUNCTION private.capture_referral_activity();

DROP TRIGGER IF EXISTS trg_referral_activity_chat ON public.chat_messages;
CREATE TRIGGER trg_referral_activity_chat
AFTER INSERT ON public.chat_messages
FOR EACH ROW
EXECUTE FUNCTION private.capture_referral_activity();

DROP TRIGGER IF EXISTS trg_referral_activity_daily_task_insert ON public.daily_task_claims;
CREATE TRIGGER trg_referral_activity_daily_task_insert
AFTER INSERT ON public.daily_task_claims
FOR EACH ROW
WHEN (NEW.status = 'COMPLETED' AND NEW.completed_at IS NOT NULL)
EXECUTE FUNCTION private.capture_referral_activity();

DROP TRIGGER IF EXISTS trg_referral_activity_daily_task_update ON public.daily_task_claims;
CREATE TRIGGER trg_referral_activity_daily_task_update
AFTER UPDATE OF status, completed_at ON public.daily_task_claims
FOR EACH ROW
WHEN (
  NEW.status = 'COMPLETED'
  AND NEW.completed_at IS NOT NULL
  AND (
    OLD.status IS DISTINCT FROM NEW.status
    OR OLD.completed_at IS DISTINCT FROM NEW.completed_at
  )
)
EXECUTE FUNCTION private.capture_referral_activity();

DROP TRIGGER IF EXISTS trg_referral_email_confirmed ON auth.users;
CREATE TRIGGER trg_referral_email_confirmed
AFTER UPDATE OF email_confirmed_at ON auth.users
FOR EACH ROW
WHEN (OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL)
EXECUTE FUNCTION private.process_referral_email_confirmation();

-- The email-confirmation handler checks activity only for that one user.
CREATE INDEX IF NOT EXISTS idx_follows_follower_created
  ON public.follows (follower_id, created_at);

-- Expose referral state changes through the existing authenticated RLS policy.
DO $publication$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'referral_events'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.referral_events;
  END IF;
END;
$publication$;

CREATE OR REPLACE FUNCTION public.get_my_referrals()
RETURNS TABLE (
  referred_user_id uuid,
  full_name text,
  username text,
  joined_at timestamptz,
  last_login_at timestamptz,
  status text,
  verified_at timestamptz,
  verified_activity text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT
    re.referred_user_id,
    coalesce(p.full_name, p.username, 'Pengguna') AS full_name,
    p.username,
    re.created_at AS joined_at,
    au.last_sign_in_at,
    re.status,
    re.verified_at,
    re.verified_activity
  FROM public.referral_events re
  JOIN auth.users au ON au.id = re.referred_user_id
  LEFT JOIN public.profiles p ON p.id = re.referred_user_id
  WHERE re.referrer_user_id = auth.uid()
    AND re.status IN ('PENDING', 'VERIFIED', 'CREDITED')
  ORDER BY re.created_at DESC;
$function$;

REVOKE ALL ON FUNCTION public.get_my_referrals() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_referrals() TO authenticated;

-- Both periodic workers are replaced by on-demand/event-driven execution:
-- referral activity/email triggers above; competition status is synchronized
-- on the competition detail request, eligibility check, and registration write.
DO $unschedule$
DECLARE
  v_job_id bigint;
BEGIN
  FOR v_job_id IN
    SELECT jobid
    FROM cron.job
    WHERE jobname IN (
      'syka-verify-referrals-hourly',
      'syka-sync-competition-registration-status'
    )
  LOOP
    PERFORM cron.unschedule(v_job_id);
  END LOOP;
END;
$unschedule$;

DROP FUNCTION IF EXISTS private.sync_due_competition_registration_statuses();

COMMIT;
