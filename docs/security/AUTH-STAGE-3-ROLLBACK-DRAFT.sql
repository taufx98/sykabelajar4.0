-- DRAFT ONLY — Full Better Auth Stage 3 rollback for a disposable restore/review.
-- NOT A PRODUCTION MIGRATION. Requires the three generated reverse-FK phases
-- to have completed successfully BEFORE this file is considered.
--
-- Preconditions / hard stops:
--   * stop Better Auth provisioning/sign-up and disable the Worker projection flag
--     before invoking this rollback; retain the D1/Worker credentials for audit.
--   * if production Supabase Custom OIDC was enabled, remove only the Better Auth
--     third-party issuer integration via Dashboard/Management API before dropping
--     the restrictive Better Auth-only issuer policies; SQL cannot remove that provider setting.
--   * no Better Auth-only user may have been provisioned;
--   * every private.app_users.id must still exist in auth.users;
--   * all 69 application FK constraints must already reference auth.users;
--   * no application rows are copied, deleted, nulled or fabricated;
--   * no shadow auth.users accounts or credentials are created.
--
-- This restores the original Auth-dependent functions and legacy signup/referral
-- behavior. It keeps the corrected create_organizer output-column qualification
-- fix, since that is an independent SQL correctness fix and changes no business
-- rules. This draft restores the three original Supabase Auth triggers and drops the Better Auth-only issuer guards.
--
-- This file does not disable the Cloudflare Worker or delete D1 credentials,
-- Better Auth accounts or sessions. It is only safe before the first
-- Better Auth-only identity exists. After that point, keep app_users and the
-- Better Auth-compatible session/token adapter; do not revert FKs to auth.users.

BEGIN;

DO $stage3_rollback_timeout$
BEGIN
  IF pg_catalog.current_setting('lock_timeout') = '0' THEN
    RAISE EXCEPTION 'STAGE3_ROLLBACK_LOCK_TIMEOUT_MUST_BE_SET';
  END IF;
  IF pg_catalog.current_setting('statement_timeout') = '0' THEN
    RAISE EXCEPTION 'STAGE3_ROLLBACK_STATEMENT_TIMEOUT_MUST_BE_SET';
  END IF;
END;
$stage3_rollback_timeout$;

DO $stage3_rollback_preflight$
DECLARE
  v_fk_to_auth integer;
  v_fk_to_app_users integer;
  v_issuer_guards integer;
BEGIN
  IF to_regclass('private.app_users') IS NULL THEN
    RAISE EXCEPTION 'STAGE3_ROLLBACK_APP_USERS_TABLE_MISSING';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM private.app_users app_user
    LEFT JOIN auth.users legacy_user ON legacy_user.id = app_user.id
    WHERE legacy_user.id IS NULL
  ) THEN
    RAISE EXCEPTION 'ROLLBACK_BLOCKED_BETTER_AUTH_ONLY_IDENTITY_EXISTS';
  END IF;

  SELECT count(*) INTO v_fk_to_auth
  FROM pg_constraint c
  JOIN pg_class src ON src.oid = c.conrelid
  JOIN pg_namespace src_ns ON src_ns.oid = src.relnamespace
  JOIN pg_class dst ON dst.oid = c.confrelid
  JOIN pg_namespace dst_ns ON dst_ns.oid = dst.relnamespace
  WHERE c.contype = 'f'
    AND src_ns.nspname IN ('public', 'private')
    AND dst_ns.nspname = 'auth'
    AND dst.relname = 'users';

  SELECT count(*) INTO v_fk_to_app_users
  FROM pg_constraint c
  JOIN pg_class src ON src.oid = c.conrelid
  JOIN pg_namespace src_ns ON src_ns.oid = src.relnamespace
  JOIN pg_class dst ON dst.oid = c.confrelid
  JOIN pg_namespace dst_ns ON dst_ns.oid = dst.relnamespace
  WHERE c.contype = 'f'
    AND src_ns.nspname IN ('public', 'private')
    AND dst_ns.nspname = 'private'
    AND dst.relname = 'app_users';

  IF v_fk_to_auth <> 69 OR v_fk_to_app_users <> 0 THEN
    RAISE EXCEPTION 'STAGE3_ROLLBACK_FK_STATE_MISMATCH: auth.users=%, app_users=%',
      v_fk_to_auth, v_fk_to_app_users;
  END IF;

  SELECT count(*) INTO v_issuer_guards
  FROM pg_policy pol
  JOIN pg_class tbl ON tbl.oid = pol.polrelid
  JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
  WHERE ns.nspname IN ('public', 'private')
    AND pol.polname = 'better_auth_issuer_guard'
    AND NOT pol.polpermissive
    AND pol.polcmd = '*'
    AND pol.polroles = ARRAY['authenticated'::regrole::oid]
    AND COALESCE(pg_catalog.pg_get_expr(pol.polqual, pol.polrelid), '') LIKE '%https://auth.sykabelajar.my.id/api/auth%'
    AND COALESCE(pg_catalog.pg_get_expr(pol.polwithcheck, pol.polrelid), '') LIKE '%https://auth.sykabelajar.my.id/api/auth%';
  IF v_issuer_guards <> 61 THEN
    RAISE EXCEPTION 'STAGE3_ROLLBACK_ISSUER_GUARD_COUNT_MISMATCH: expected 61 restrictive policies, found %',
      v_issuer_guards;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_trigger tr
    JOIN pg_class tbl ON tbl.oid = tr.tgrelid
    JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
    WHERE NOT tr.tgisinternal AND ns.nspname = 'auth' AND tbl.relname = 'users'
      AND tr.tgname IN ('on_auth_user_created','trg_referral_signup_attribution','trg_referral_email_confirmed')
  ) THEN
    RAISE EXCEPTION 'STAGE3_ROLLBACK_LEGACY_AUTH_TRIGGERS_ALREADY_PRESENT';
  END IF;
END;
$stage3_rollback_preflight$;

-- Remove only the exact 61 restrictive guards added by the Stage 3 issuer draft.
DO $stage3_rollback_issuer_guards$
DECLARE
  v_policy record;
  v_dropped integer := 0;
BEGIN
  FOR v_policy IN
    SELECT ns.nspname AS schema_name, tbl.relname AS table_name
    FROM pg_policy pol
    JOIN pg_class tbl ON tbl.oid = pol.polrelid
    JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
    WHERE ns.nspname IN ('public', 'private')
      AND pol.polname = 'better_auth_issuer_guard'
      AND NOT pol.polpermissive
      AND pol.polcmd = '*'
      AND pol.polroles = ARRAY['authenticated'::regrole::oid]
      AND COALESCE(pg_catalog.pg_get_expr(pol.polqual, pol.polrelid), '') LIKE '%https://auth.sykabelajar.my.id/api/auth%'
      AND COALESCE(pg_catalog.pg_get_expr(pol.polwithcheck, pol.polrelid), '') LIKE '%https://auth.sykabelajar.my.id/api/auth%'
    ORDER BY ns.nspname, tbl.relname
  LOOP
    EXECUTE pg_catalog.format(
      'DROP POLICY %I ON %I.%I',
      'better_auth_issuer_guard', v_policy.schema_name, v_policy.table_name
    );
    v_dropped := v_dropped + 1;
  END LOOP;
  IF v_dropped <> 61 THEN
    RAISE EXCEPTION 'STAGE3_ROLLBACK_ISSUER_GUARD_DROP_COUNT_MISMATCH: %', v_dropped;
  END IF;
END;
$stage3_rollback_issuer_guards$;

-- Restore the Auth-backed function bodies. Existing EXECUTE ACLs are preserved
-- by CREATE OR REPLACE FUNCTION; no grants are rewritten here.
CREATE OR REPLACE FUNCTION private.apply_referral_qualification(p_referred_user_id uuid, p_activity text, p_occurred_at timestamp with time zone)
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
$function$
;

CREATE OR REPLACE FUNCTION private.capture_signup_referral()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_referral_id text := nullif(trim(coalesce(NEW.raw_user_meta_data ->> 'referral_id', '')), '');
  v_referrer_id uuid;
  v_reward_amount integer;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF v_referral_id IS NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    v_referrer_id := v_referral_id::uuid;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RETURN NEW;
  END;

  IF v_referrer_id IS NULL OR v_referrer_id = NEW.id THEN
    RETURN NEW;
  END IF;

  SELECT
    CASE
      WHEN s.event_reward_amount IS NOT NULL
       AND (s.starts_at IS NULL OR v_now >= s.starts_at)
       AND (s.ends_at IS NULL OR v_now < s.ends_at)
        THEN s.event_reward_amount
      ELSE s.base_reward_amount
    END
  INTO v_reward_amount
  FROM private.referral_program_settings s
  WHERE s.id = true
    AND s.is_active = true;

  IF v_reward_amount IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM auth.users au
    WHERE au.id = v_referrer_id
      AND au.email_confirmed_at IS NOT NULL
  ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.referral_events (
    referrer_user_id,
    referred_user_id,
    competition_id,
    registration_id,
    reward_amount,
    status,
    created_at
  )
  VALUES (
    v_referrer_id,
    NEW.id,
    NULL,
    NULL,
    v_reward_amount,
    'PENDING',
    v_now
  )
  ON CONFLICT (referred_user_id) DO NOTHING;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION private.process_referral_email_confirmation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_referral public.referral_events%rowtype;
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
    AND re.verified_activity IS NOT NULL
    AND re.last_checked_at IS NOT NULL
    AND re.last_checked_at >= re.created_at
    AND re.last_checked_at < re.created_at + interval '24 hours'
    AND re.created_at >= clock_timestamp() - interval '24 hours'
  FOR UPDATE;

  IF FOUND THEN
    PERFORM private.apply_referral_qualification(
      NEW.id,
      v_referral.verified_activity,
      v_referral.last_checked_at
    );
  END IF;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_my_referrals()
 RETURNS TABLE(referred_user_id uuid, full_name text, username text, joined_at timestamp with time zone, last_login_at timestamp with time zone, status text, verified_at timestamp with time zone, verified_activity text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT
    re.referred_user_id,
    CASE
      WHEN re.status IN ('VERIFIED', 'CREDITED')
        THEN coalesce(p.full_name, p.username, 'Pengguna')
      ELSE 'Pengguna menunggu verifikasi'
    END AS full_name,
    CASE
      WHEN re.status IN ('VERIFIED', 'CREDITED') THEN p.username
      ELSE NULL
    END AS username,
    re.created_at AS joined_at,
    CASE
      WHEN re.status IN ('VERIFIED', 'CREDITED') THEN au.last_sign_in_at
      ELSE NULL
    END AS last_login_at,
    CASE
      WHEN re.status = 'PENDING'
       AND re.created_at + interval '24 hours' <= now()
        THEN 'EXPIRED'
      ELSE re.status
    END AS status,
    re.verified_at,
    re.verified_activity
  FROM public.referral_events re
  JOIN auth.users au ON au.id = re.referred_user_id
  LEFT JOIN public.profiles p ON p.id = re.referred_user_id
  WHERE re.referrer_user_id = auth.uid()
    AND re.status IN ('PENDING', 'VERIFIED', 'CREDITED')
  ORDER BY re.created_at DESC;
$function$
;

CREATE OR REPLACE FUNCTION public.get_my_referrals_v2()
 RETURNS TABLE(referred_user_id uuid, full_name text, username text, joined_at timestamp with time zone, last_login_at timestamp with time zone, status text, verified_at timestamp with time zone, verified_activity text, reward_amount numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT
    re.referred_user_id,
    CASE
      WHEN re.status IN ('VERIFIED', 'CREDITED')
        THEN coalesce(p.full_name, p.username, 'Pengguna')
      ELSE 'Pengguna menunggu verifikasi'
    END AS full_name,
    CASE
      WHEN re.status IN ('VERIFIED', 'CREDITED') THEN p.username
      ELSE NULL
    END AS username,
    re.created_at AS joined_at,
    CASE
      WHEN re.status IN ('VERIFIED', 'CREDITED') THEN au.last_sign_in_at
      ELSE NULL
    END AS last_login_at,
    CASE
      WHEN re.status = 'PENDING'
       AND re.created_at + interval '24 hours' <= statement_timestamp()
        THEN 'EXPIRED'
      ELSE re.status
    END AS status,
    re.verified_at,
    re.verified_activity,
    re.reward_amount
  FROM public.referral_events re
  JOIN auth.users au ON au.id = re.referred_user_id
  LEFT JOIN public.profiles p ON p.id = re.referred_user_id
  WHERE re.referrer_user_id = (SELECT auth.uid())
    AND re.status IN ('PENDING', 'VERIFIED', 'CREDITED')
  ORDER BY re.created_at DESC;
$function$
;

CREATE OR REPLACE FUNCTION public.get_my_verified_referrals()
 RETURNS TABLE(referred_user_id uuid, full_name text, username text, joined_at timestamp with time zone, last_login_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$ SELECT re.referred_user_id,coalesce(p.full_name,p.username,'Pengguna'),p.username,re.created_at,au.last_sign_in_at FROM public.referral_events re JOIN auth.users au ON au.id=re.referred_user_id LEFT JOIN public.profiles p ON p.id=re.referred_user_id WHERE re.referrer_user_id=auth.uid() AND re.verified_at IS NOT NULL ORDER BY re.verified_at DESC; $function$
;

CREATE OR REPLACE FUNCTION public.register_for_competition(p_competition_id uuid, p_participation_key text DEFAULT NULL::text, p_competition_level_id uuid DEFAULT NULL::uuid, p_social_proof_url text DEFAULT NULL::text, p_twibbon_completed boolean DEFAULT false, p_social_platform text DEFAULT NULL::text, p_social_username text DEFAULT NULL::text, p_referral_code text DEFAULT NULL::text)
 RETURNS registrations
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_registration public.registrations;
  v_referrer_id uuid;
  v_referral_reward_amount integer;
  v_now timestamptz := clock_timestamp();
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
    SELECT
      CASE
        WHEN s.event_reward_amount IS NOT NULL
         AND (s.starts_at IS NULL OR v_now >= s.starts_at)
         AND (s.ends_at IS NULL OR v_now < s.ends_at)
          THEN s.event_reward_amount
        ELSE s.base_reward_amount
      END
    INTO v_referral_reward_amount
    FROM private.referral_program_settings s
    WHERE s.id = true
      AND s.is_active = true;

    IF v_referral_reward_amount IS NOT NULL THEN
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
        v_referral_reward_amount,
        'PENDING'
      )
      ON CONFLICT (referred_user_id) DO NOTHING;
    END IF;
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
$function$
;

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
$function$
;

-- Retain the independent create_organizer PL/pgSQL output-column bug fix.
CREATE OR REPLACE FUNCTION public.create_organizer(p_name text, p_slug text)
RETURNS TABLE(id uuid, name text, slug text, access_code text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_user auth.users;
  v_id uuid;
  v_code text := encode(extensions.gen_random_bytes(5), 'hex');
  v_slug text := lower(regexp_replace(trim(p_slug), '[^a-zA-Z0-9]+', '-', 'g'));
  v_phone text;
  v_identity_hash text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = v_uid
      AND ur.role = 'organizer_member'::public.app_role
      AND ur.is_active = true
  ) THEN
    RAISE EXCEPTION 'ORGANIZER_ROLE_REQUIRED';
  END IF;

  IF NULLIF(trim(p_name), '') IS NULL THEN
    RAISE EXCEPTION 'ORGANIZER_NAME_REQUIRED';
  END IF;
  IF NULLIF(trim(v_slug), '') IS NULL THEN
    RAISE EXCEPTION 'ORGANIZER_SLUG_REQUIRED';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.organizers
    WHERE owner_user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'ORGANIZER_LIMIT_REACHED';
  END IF;

  -- Qualify the table column: RETURNS TABLE creates an output variable named id.
  SELECT au.* INTO v_user
  FROM auth.users AS au
  WHERE au.id = v_uid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'USER_NOT_FOUND';
  END IF;
  IF v_user.email_confirmed_at IS NULL THEN
    RAISE EXCEPTION 'EMAIL_VERIFICATION_REQUIRED';
  END IF;
  IF v_user.phone_confirmed_at IS NULL THEN
    RAISE EXCEPTION 'PHONE_VERIFICATION_REQUIRED';
  END IF;

  v_phone := regexp_replace(coalesce(v_user.phone, ''), '[^0-9]+', '', 'g');
  IF length(v_phone) < 8 THEN
    RAISE EXCEPTION 'PHONE_VERIFICATION_REQUIRED';
  END IF;
  v_identity_hash := encode(extensions.digest(v_phone, 'sha256'), 'hex');

  IF EXISTS (
    SELECT 1
    FROM private.organizer_free_identity_claims
    WHERE identity_hash = v_identity_hash
  ) THEN
    RAISE EXCEPTION 'FREE_ORGANIZER_ALREADY_CLAIMED';
  END IF;

  INSERT INTO public.organizers AS inserted_organizer(name, slug, owner_user_id, status)
  VALUES (trim(p_name), trim(both '-' from v_slug), v_uid, 'ACTIVE')
  RETURNING inserted_organizer.id INTO v_id;

  INSERT INTO public.organizer_members(organizer_id, user_id, member_role, is_active, role, status)
  VALUES (v_id, v_uid, 'owner', true, 'owner', 'ACTIVE')
  ON CONFLICT (organizer_id, user_id) DO UPDATE
    SET member_role = 'owner',
        is_active = true,
        role = 'owner',
        status = 'ACTIVE',
        updated_at = now();

  INSERT INTO public.organizer_plans(organizer_id, plan_code, starts_at, ends_at, is_active)
  VALUES (v_id, 'FREE', now(), now() + interval '6 months', true);

  INSERT INTO private.organizer_access_codes(organizer_id, code_hash, rotated_by)
  VALUES (v_id, extensions.crypt(v_code, extensions.gen_salt('bf', 10)), v_uid);

  INSERT INTO private.organizer_free_identity_claims(identity_hash, owner_user_id, organizer_id)
  VALUES (v_identity_hash, v_uid, v_id);

  RETURN QUERY
    SELECT o.id, o.name, o.slug, v_code
    FROM public.organizers AS o
    WHERE o.id = v_id;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'FREE_ORGANIZER_ALREADY_CLAIMED';
END;
$function$;

-- Restore the original three Supabase Auth lifecycle triggers only after
-- all original function definitions have been restored above.
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_auth_user();

CREATE TRIGGER trg_referral_signup_attribution
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION private.capture_signup_referral();

CREATE TRIGGER trg_referral_email_confirmed
AFTER UPDATE OF email_confirmed_at ON auth.users
FOR EACH ROW
WHEN (OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL)
EXECUTE FUNCTION private.process_referral_email_confirmation();

GRANT EXECUTE ON FUNCTION public.handle_new_auth_user() TO service_role;

-- Remove the Better Auth-only provisioning surface added by Stage 3.
DROP FUNCTION public.better_auth_provision_user(uuid,text,text,text,text,boolean,date,text,text,text);
DROP FUNCTION public.better_auth_complete_email_verification(uuid,timestamptz);
DROP FUNCTION public.better_auth_complete_phone_verification(uuid,timestamptz,text,text,text,integer);
DROP FUNCTION private.provision_better_auth_user(uuid,text,text,text,text,boolean,date,text,text,text);
DROP FUNCTION private.complete_better_auth_email_verification(uuid,timestamptz);
DROP FUNCTION private.complete_better_auth_phone_verification(uuid,timestamptz,text,text,text,integer);
DROP TABLE private.app_users;

DO $stage3_rollback_postflight$
DECLARE
  v_auth_fk_count integer;
  v_app_users_fk_count integer;
  v_auth_trigger_count integer;
  v_profile_trigger_count integer;
  v_issuer_guard_count integer;
BEGIN
  SELECT count(*) INTO v_auth_fk_count
  FROM pg_constraint c
  JOIN pg_class dst ON dst.oid = c.confrelid
  JOIN pg_namespace dst_ns ON dst_ns.oid = dst.relnamespace
  JOIN pg_class src ON src.oid = c.conrelid
  JOIN pg_namespace src_ns ON src_ns.oid = src.relnamespace
  WHERE c.contype = 'f'
    AND dst_ns.nspname = 'auth' AND dst.relname = 'users'
    AND src_ns.nspname IN ('public', 'private');

  SELECT count(*) INTO v_app_users_fk_count
  FROM pg_constraint c
  JOIN pg_class dst ON dst.oid = c.confrelid
  JOIN pg_namespace dst_ns ON dst_ns.oid = dst.relnamespace
  JOIN pg_class src ON src.oid = c.conrelid
  JOIN pg_namespace src_ns ON src_ns.oid = src.relnamespace
  WHERE c.contype = 'f'
    AND dst_ns.nspname = 'private' AND dst.relname = 'app_users'
    AND src_ns.nspname IN ('public', 'private');

  SELECT count(*) INTO v_auth_trigger_count
  FROM pg_trigger tr
  JOIN pg_class tbl ON tbl.oid = tr.tgrelid
  JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
  WHERE NOT tr.tgisinternal AND ns.nspname = 'auth' AND tbl.relname = 'users';

  SELECT count(*) INTO v_profile_trigger_count
  FROM pg_trigger tr
  JOIN pg_class tbl ON tbl.oid = tr.tgrelid
  JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
  WHERE NOT tr.tgisinternal AND ns.nspname = 'public' AND tbl.relname = 'profiles';

  SELECT count(*) INTO v_issuer_guard_count
  FROM pg_policy pol
  JOIN pg_class tbl ON tbl.oid = pol.polrelid
  JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
  WHERE ns.nspname IN ('public', 'private')
    AND pol.polname = 'better_auth_issuer_guard';

  IF v_auth_fk_count <> 69 OR v_app_users_fk_count <> 0 THEN
    RAISE EXCEPTION 'STAGE3_ROLLBACK_POST_FK_MISMATCH: auth.users=%, app_users=%',
      v_auth_fk_count, v_app_users_fk_count;
  END IF;
  IF v_auth_trigger_count <> 3 OR v_profile_trigger_count <> 4 THEN
    RAISE EXCEPTION 'STAGE3_ROLLBACK_POST_TRIGGER_MISMATCH: auth.users=%, profiles=%',
      v_auth_trigger_count, v_profile_trigger_count;
  END IF;
  IF v_issuer_guard_count <> 0 THEN
    RAISE EXCEPTION 'STAGE3_ROLLBACK_ISSUER_GUARD_REMAINS: %', v_issuer_guard_count;
  END IF;
  IF to_regclass('private.app_users') IS NOT NULL THEN
    RAISE EXCEPTION 'STAGE3_ROLLBACK_APP_USERS_TABLE_REMAINS';
  END IF;
END;
$stage3_rollback_postflight$;

COMMIT;

-- Final verification should show: 69 validated FKs to auth.users, zero
-- application FKs to private.app_users, exactly 3 non-internal auth.users
-- triggers, 4 public.profiles triggers, and zero better_auth_issuer_guard policies.
-- This file does not reset or delete legacy auth.users or application data.
