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
    AND COALESCE(pg_catalog.pg_get_expr(pol.polqual, pol.polrelid), '') LIKE '%https://auth-prod.sykabelajar.my.id/api/auth%'
    AND COALESCE(pg_catalog.pg_get_expr(pol.polwithcheck, pol.polrelid), '') LIKE '%https://auth-prod.sykabelajar.my.id/api/auth%';
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
      AND COALESCE(pg_catalog.pg_get_expr(pol.polqual, pol.polrelid), '') LIKE '%https://auth-prod.sykabelajar.my.id/api/auth%'
      AND COALESCE(pg_catalog.pg_get_expr(pol.polwithcheck, pol.polrelid), '') LIKE '%https://auth-prod.sykabelajar.my.id/api/auth%'
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

-- Restore the exact pre-Stage-3 Production definitions for functions

-- modified by the issuer guard drafts. CREATE OR REPLACE preserves each

-- existing function owner and EXECUTE ACL while restoring its previous

-- Supabase Auth authorization behavior before private.app_users is removed.

CREATE OR REPLACE FUNCTION private.current_user_has_role(p_role app_role)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$ select exists (select 1 from public.user_roles ur where ur.user_id=(select auth.uid()) and ur.role=p_role and ur.is_active=true); $function$;

CREATE OR REPLACE FUNCTION public.is_active_admin(p_uid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$ select case when (select auth.uid()) is null then false when p_uid is null then false when p_uid <> (select auth.uid()) and not private.current_user_is_admin() then false else exists (select 1 from public.user_roles ur where ur.user_id=p_uid and ur.role='admin'::app_role and ur.is_active=true) end; $function$;

CREATE OR REPLACE FUNCTION private.current_user_is_active_organizer_member(p_organizer_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$ select exists (select 1 from public.organizer_members om where om.organizer_id=p_organizer_id and om.user_id=auth.uid() and coalesce(om.status,'ACTIVE')='ACTIVE' and coalesce(om.is_active,true)=true); $function$;

CREATE OR REPLACE FUNCTION private.current_user_organizer_role(p_organizer_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$ select case when exists(select 1 from public.organizers o where o.id=p_organizer_id and o.owner_user_id=(select auth.uid())) then 'owner' else (select coalesce(om.role,om.member_role) from public.organizer_members om where om.organizer_id=p_organizer_id and om.user_id=(select auth.uid()) and coalesce(om.is_active,true)=true and coalesce(om.status,'ACTIVE')='ACTIVE' limit 1) end; $function$;

CREATE OR REPLACE FUNCTION private.collective_realtime_can_read(p_competition_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$ select auth.uid() is not null and(exists(select 1 from private.collective_chat_realtime_sessions s where s.auth_user_id=auth.uid() and s.competition_id=p_competition_id and s.expires_at>now()) or exists(select 1 from public.collective_participants cp where cp.competition_id=p_competition_id and cp.managed_by_user_id=auth.uid() and cp.status='ACTIVE') or exists(select 1 from public.organizer_members om join public.competitions c on c.organizer_id=om.organizer_id where c.id=p_competition_id and om.user_id=auth.uid() and om.is_active=true and om.status='ACTIVE') or exists(select 1 from public.user_roles ur where ur.user_id=auth.uid() and ur.role='admin' and ur.is_active=true));$function$;

CREATE OR REPLACE FUNCTION public.admin_adjust_user_currency(p_target_user_id uuid, p_currency_type text, p_delta bigint, p_reason text DEFAULT 'Admin adjustment'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$ DECLARE v_admin_id uuid:=auth.uid();v_is_admin boolean:=false;v_column text;v_old_balance bigint:=0;v_new_balance bigint:=0;v_row jsonb; BEGIN IF p_currency_type NOT IN('xp','edu_coin') THEN RAISE EXCEPTION 'Invalid currency_type: %. Must be "xp" or "edu_coin".',p_currency_type;END IF;IF p_delta=0 THEN RAISE EXCEPTION 'Delta must not be zero.';END IF;IF trim(p_reason)='' THEN RAISE EXCEPTION 'Reason must not be empty.';END IF;SELECT EXISTS(SELECT 1 FROM user_roles WHERE user_id=v_admin_id AND role='admin' AND is_active=true) INTO v_is_admin;IF NOT v_is_admin THEN RAISE EXCEPTION 'Unauthorized: only admins can adjust currency.';END IF;IF p_currency_type='xp' THEN v_column:='total_xp';ELSE v_column:='edu_coin';END IF;EXECUTE format('SELECT COALESCE(%I, 0) FROM profiles WHERE id = $1 FOR UPDATE',v_column) INTO v_old_balance USING p_target_user_id;IF v_old_balance IS NULL THEN RAISE EXCEPTION 'User not found: %',p_target_user_id;END IF;v_new_balance:=v_old_balance+p_delta;IF v_new_balance<0 THEN RAISE EXCEPTION 'Insufficient %: current %, delta % would result in %.',p_currency_type,v_old_balance,p_delta,v_new_balance;END IF;EXECUTE format('UPDATE profiles SET %I = $1, updated_at = now() WHERE id = $2',v_column) USING v_new_balance,p_target_user_id;INSERT INTO currency_adjustment_logs(admin_id,target_user_id,currency_type,delta,reason,balance_before,balance_after) VALUES(v_admin_id,p_target_user_id,p_currency_type,p_delta,p_reason,v_old_balance,v_new_balance) RETURNING to_jsonb(currency_adjustment_logs.*) INTO v_row;RETURN v_row;END;$function$;

CREATE OR REPLACE FUNCTION public.admin_bulk_adjust_currency(p_user_ids uuid[], p_currency_type text, p_delta bigint, p_reason text DEFAULT 'Bulk admin adjustment'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$ DECLARE v_admin_id uuid:=auth.uid();v_is_admin boolean:=false;v_column text;v_success int:=0;v_failed int:=0;v_skipped int:=0;v_results jsonb:='[]'::jsonb;v_uid uuid;v_old bigint;v_new bigint;v_username text;v_display text; BEGIN IF p_currency_type NOT IN('xp','edu_coin') THEN RAISE EXCEPTION 'Invalid currency_type: %',p_currency_type;END IF;IF p_delta=0 THEN RAISE EXCEPTION 'Delta must not be zero.';END IF;IF trim(p_reason)='' THEN RAISE EXCEPTION 'Reason must not be empty.';END IF;IF array_length(p_user_ids,1) IS NULL OR array_length(p_user_ids,1)=0 THEN RAISE EXCEPTION 'No users selected.';END IF;SELECT EXISTS(SELECT 1 FROM user_roles WHERE user_id=v_admin_id AND role='admin' AND is_active=true) INTO v_is_admin;IF NOT v_is_admin THEN RAISE EXCEPTION 'Unauthorized: only admins can bulk adjust currency.';END IF;IF p_currency_type='xp' THEN v_column:='total_xp';ELSE v_column:='edu_coin';END IF;FOREACH v_uid IN ARRAY p_user_ids LOOP BEGIN EXECUTE format('SELECT COALESCE(%I, 0) FROM profiles WHERE id = $1',v_column) INTO v_old USING v_uid;IF v_old IS NULL THEN v_failed:=v_failed+1;v_results:=v_results||jsonb_build_object('user_id',v_uid,'status','not_found');CONTINUE;END IF;v_new:=v_old+p_delta;IF v_new<0 THEN v_skipped:=v_skipped+1;v_results:=v_results||jsonb_build_object('user_id',v_uid,'status','insufficient','balance',v_old);CONTINUE;END IF;EXECUTE format('UPDATE profiles SET %I = $1, updated_at = now() WHERE id = $2',v_column) USING v_new,v_uid;INSERT INTO currency_adjustment_logs(admin_id,target_user_id,currency_type,delta,reason,balance_before,balance_after) VALUES(v_admin_id,v_uid,p_currency_type,p_delta,p_reason,v_old,v_new);SELECT username,COALESCE(full_name,username,'Pengguna') INTO v_username,v_display FROM profiles WHERE id=v_uid;INSERT INTO notifications(user_id,type,title,body,data) VALUES(v_uid,'rank-up',CASE WHEN p_delta>0 THEN 'Selamat! Kamu menerima '||p_delta||' '||CASE WHEN p_currency_type='xp' THEN 'XP' ELSE 'Coin EDU' END ELSE 'Penyesuaian '||CASE WHEN p_currency_type='xp' THEN 'XP' ELSE 'Coin EDU' END||' oleh Admin' END,CASE WHEN p_delta>0 THEN 'Kamu menerima +'||p_delta||' '||CASE WHEN p_currency_type='xp' THEN 'XP' ELSE 'Coin EDU' END||' dari Admin. Alasan: '||p_reason ELSE 'Saldo kamu dikurangi '||abs(p_delta)||' '||CASE WHEN p_currency_type='xp' THEN 'XP' ELSE 'Coin EDU' END||' oleh Admin. Alasan: '||p_reason END,jsonb_build_object('link','/leaderboard','icon','coins'));v_success:=v_success+1;v_results:=v_results||jsonb_build_object('user_id',v_uid,'username',v_username,'status','ok','old',v_old,'new',v_new);EXCEPTION WHEN OTHERS THEN v_failed:=v_failed+1;v_results:=v_results||jsonb_build_object('user_id',v_uid,'status','error','message',SQLERRM);END;END LOOP;RETURN jsonb_build_object('success',v_success,'failed',v_failed,'skipped',v_skipped,'total',array_length(p_user_ids,1),'results',v_results);END;$function$;

CREATE OR REPLACE FUNCTION public.admin_set_certificate_status(p_certificate_verification_id uuid, p_to_status certificate_status, p_reason text DEFAULT NULL::text)
 RETURNS certificate_verifications
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_catalog'
AS $function$
declare v_uid uuid:=auth.uid();v_before public.certificate_verifications%rowtype;v_after public.certificate_verifications%rowtype;v_cert_status public.certificate_status;
begin
 if v_uid is null or not exists(select 1 from public.user_roles where user_id=v_uid and role='admin' and is_active=true) then raise exception 'FORBIDDEN'; end if;
 select * into v_before from public.certificate_verifications where id=p_certificate_verification_id for update;
 if not found then raise exception 'CERTIFICATE_NOT_FOUND'; end if;
 select status into v_cert_status from public.certificates where id=v_before.certificate_id for update;
 if v_cert_status is null then raise exception 'CERTIFICATE_NOT_FOUND'; end if;
 if not private.is_valid_certificate_transition(v_cert_status,p_to_status) then raise exception 'INVALID_CERTIFICATE_TRANSITION:%:%',v_cert_status,p_to_status; end if;
 if p_to_status='REVOKED' and nullif(trim(p_reason),'') is null then raise exception 'REVOCATION_REASON_REQUIRED'; end if;
 update public.certificate_verifications set status=p_to_status,revoked_at=case when p_to_status='REVOKED' then now() else null end where id=p_certificate_verification_id returning * into v_after;
 update public.certificates set status=p_to_status,updated_at=now(),current_revision=case when p_to_status=v_cert_status then current_revision else coalesce(current_revision,0)+1 end where id=v_before.certificate_id;
 insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,reason,before_data,after_data) values(v_uid,'CERTIFICATE_STATUS_CHANGE','certificate',p_certificate_verification_id::text,p_reason,to_jsonb(v_before),to_jsonb(v_after));
 return v_after;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_set_collective_certificate_price(p_amount numeric)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
begin
  if auth.uid() is null or not exists(select 1 from public.user_roles ur where ur.user_id=auth.uid() and ur.role='admin' and ur.is_active=true) then raise exception 'FORBIDDEN'; end if;
  if p_amount is null or p_amount < 0 then raise exception 'INVALID_AMOUNT'; end if;
  insert into public.platform_settings(key,value,updated_at)
  values('collective_certificate_price',jsonb_build_object('amount',round(p_amount,2)),now())
  on conflict(key) do update set value=excluded.value,updated_at=now();
  return round(p_amount,2);
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_transition_certificate(p_certificate_id uuid, p_to_status certificate_status, p_reason text DEFAULT NULL::text)
 RETURNS certificates
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_catalog'
AS $function$
declare v_uid uuid:=auth.uid();v_before public.certificates%rowtype;v_after public.certificates%rowtype;
begin
 if v_uid is null or not exists(select 1 from public.user_roles where user_id=v_uid and role='admin' and is_active=true) then raise exception 'FORBIDDEN'; end if;
 select * into v_before from public.certificates where id=p_certificate_id for update;
 if not found then raise exception 'CERTIFICATE_NOT_FOUND'; end if;
 if not private.is_valid_certificate_transition(v_before.status,p_to_status) then raise exception 'INVALID_CERTIFICATE_TRANSITION:%:%',v_before.status,p_to_status; end if;
 if p_to_status='REVOKED' and nullif(trim(p_reason),'') is null then raise exception 'REVOCATION_REASON_REQUIRED'; end if;
 update public.certificates set status=p_to_status,current_revision=case when p_to_status=v_before.status then coalesce(current_revision,0) else coalesce(current_revision,0)+1 end,updated_at=now() where id=p_certificate_id returning * into v_after;
 update public.certificate_verifications set status=p_to_status,revoked_at=case when p_to_status='REVOKED' then now() else null end where certificate_id=p_certificate_id;
 insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,reason,before_data,after_data) values(v_uid,'CERTIFICATE_TRANSITION','certificate',p_certificate_id::text,p_reason,to_jsonb(v_before),to_jsonb(v_after));
 return v_after;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_transition_order(p_order_id uuid, p_to_status order_status, p_reason text DEFAULT NULL::text, p_tracking_number text DEFAULT NULL::text, p_provider text DEFAULT NULL::text)
 RETURNS orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_catalog'
AS $function$
declare v_uid uuid:=auth.uid();v_before public.orders%rowtype;v_after public.orders%rowtype;
begin
 if v_uid is null or not exists(select 1 from public.user_roles where user_id=v_uid and role='admin' and is_active=true) then raise exception 'FORBIDDEN'; end if;
 select * into v_before from public.orders where id=p_order_id for update;
 if not found then raise exception 'ORDER_NOT_FOUND'; end if;
 if not private.is_valid_order_transition(v_before.status,p_to_status) then raise exception 'INVALID_ORDER_TRANSITION:%:%',v_before.status,p_to_status; end if;
 if p_to_status='REFUNDED' and nullif(trim(p_reason),'') is null then raise exception 'REFUND_REASON_REQUIRED'; end if;
 update public.orders set status=p_to_status,updated_at=now() where id=p_order_id returning * into v_after;
 if p_to_status='SHIPPED' then
   insert into public.shipments(order_id,provider,tracking_number,status,raw_meta) values(p_order_id,p_provider,p_tracking_number,'SHIPPED',jsonb_build_object('source','admin_transition')) on conflict(order_id) do update set provider=excluded.provider,tracking_number=excluded.tracking_number,status='SHIPPED',updated_at=now();
 end if;
 insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,reason,before_data,after_data) values(v_uid,'ORDER_STATUS_CHANGE','order',p_order_id::text,p_reason,to_jsonb(v_before),to_jsonb(v_after));
 return v_after;
end;
$function$;

CREATE OR REPLACE FUNCTION public.auto_grade_essay_item(p_attempt_id uuid, p_question_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$ DECLARE v_uid uuid:=auth.uid();v_attempt public.attempts%ROWTYPE;v_question public.questions%ROWTYPE;v_answer public.answers%ROWTYPE;v_org uuid;v_plan text;v_key text;v_answer_text text;v_similarity numeric:=0;v_score numeric:=0;BEGIN IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED';END IF;SELECT * INTO v_attempt FROM public.attempts WHERE id=p_attempt_id;IF NOT FOUND THEN RAISE EXCEPTION 'ATTEMPT_NOT_FOUND';END IF;SELECT * INTO v_question FROM public.questions WHERE id=p_question_id;IF NOT FOUND OR lower(v_question.type) NOT IN('essay','long-answer') THEN RAISE EXCEPTION 'ESSAY_QUESTION_REQUIRED';END IF;SELECT organizer_id INTO v_org FROM public.competitions WHERE id=v_attempt.competition_id;IF NOT(EXISTS(SELECT 1 FROM public.organizer_members om WHERE om.organizer_id=v_org AND om.user_id=v_uid AND om.status='ACTIVE') OR EXISTS(SELECT 1 FROM public.user_roles ur WHERE ur.user_id=v_uid AND ur.role='admin' AND ur.is_active=true)) THEN RAISE EXCEPTION 'FORBIDDEN';END IF;SELECT op.plan_code INTO v_plan FROM public.organizer_plans op WHERE op.organizer_id=v_org AND op.is_active=true AND op.starts_at<=now() AND(op.ends_at IS NULL OR op.ends_at>now()) ORDER BY op.starts_at DESC,op.created_at DESC LIMIT 1;IF NOT EXISTS(SELECT 1 FROM public.plan_entitlements pe WHERE pe.plan_code=v_plan AND pe.capability='essay_ai_assessment' AND coalesce(pe.limit_value,0)>0) THEN RAISE EXCEPTION 'PREMIUM_REQUIRED';END IF;IF coalesce(v_question.config->'ai_assessment'->>'enabled','false')<>'true' THEN RAISE EXCEPTION 'AI_ASSESSMENT_DISABLED';END IF;v_key:=coalesce(v_question.config->>'answer_key','');IF v_key='' THEN RAISE EXCEPTION 'ANSWER_KEY_REQUIRED';END IF;SELECT * INTO v_answer FROM public.answers WHERE attempt_id=p_attempt_id AND question_id=p_question_id LIMIT 1;v_answer_text:=coalesce(v_answer.answer_json->>'value',v_answer.answer_json->>'answer','');v_similarity:=public.calculate_essay_similarity(v_key,v_answer_text);v_score:=round(coalesce(v_question.points,0)*v_similarity/100,2);INSERT INTO public.grading_items(attempt_id,question_id,grader_id,score,feedback) VALUES(p_attempt_id,p_question_id,v_uid,v_score,'AI Similarity Grade: '||to_char(v_similarity,'FM990D00')||'%') ON CONFLICT(attempt_id,question_id) DO UPDATE SET grader_id=excluded.grader_id,score=excluded.score,feedback=excluded.feedback,updated_at=now();RETURN jsonb_build_object('score',v_score,'max_score',coalesce(v_question.points,0),'similarity_percent',v_similarity,'feedback','AI Similarity Grade: '||to_char(v_similarity,'FM990D00')||'%');END;$function$;

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

CREATE OR REPLACE FUNCTION public.generate_awards_for_competition(p_competition_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$ DECLARE v_uid uuid:=auth.uid();v_org uuid;v_count integer:=0;r record;v_rank text;v_title text;v_points numeric;v_cert boolean;v_award_id uuid;BEGIN IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED';END IF;SELECT organizer_id INTO v_org FROM public.competitions WHERE id=p_competition_id;IF v_org IS NULL THEN RAISE EXCEPTION 'COMPETITION_NOT_FOUND';END IF;IF NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=v_uid AND role='admin' AND is_active=true) AND NOT EXISTS(SELECT 1 FROM public.organizer_members WHERE organizer_id=v_org AND user_id=v_uid AND status='ACTIVE') THEN RAISE EXCEPTION 'FORBIDDEN';END IF;FOR r IN SELECT a.participant_id,max(a.score) AS score,row_number() over(order by max(a.score) desc,min(a.finalized_at),a.participant_id) AS pos FROM public.attempts a WHERE a.competition_id=p_competition_id AND a.status='FINALIZED' GROUP BY a.participant_id ORDER BY max(a.score) DESC LOOP IF r.pos=1 THEN v_rank:='FIRST';ELSIF r.pos=2 THEN v_rank:='SECOND';ELSIF r.pos=3 THEN v_rank:='THIRD';ELSE v_rank:='PARTICIPANT';END IF;SELECT cr.title,cr.points,cr.certificate_enabled INTO v_title,v_points,v_cert FROM public.competition_rewards cr WHERE cr.competition_id=p_competition_id AND cr.rank_code=v_rank ORDER BY cr.created_at LIMIT 1;IF v_title IS NULL THEN v_title:=CASE v_rank WHEN 'FIRST' THEN 'Juara 1' WHEN 'SECOND' THEN 'Juara 2' WHEN 'THIRD' THEN 'Juara 3' ELSE 'Peserta' END;v_points:=0;v_cert:=(v_rank<>'PARTICIPANT');END IF;SELECT id INTO v_award_id FROM public.awards WHERE user_id=r.participant_id AND competition_id=p_competition_id AND rank_code=v_rank LIMIT 1;IF v_award_id IS NULL THEN INSERT INTO public.awards(user_id,competition_id,rank_code,title,points,issued_at,visibility) VALUES(r.participant_id,p_competition_id,v_rank,v_title,coalesce(v_points,0),now(),'PUBLIC') RETURNING id INTO v_award_id;v_count:=v_count+1;END IF;IF v_cert THEN BEGIN PERFORM public.issue_certificate_for_award(v_award_id);EXCEPTION WHEN OTHERS THEN INSERT INTO public.audit_logs(actor_user_id,action,entity_type,entity_id,reason) VALUES(v_uid,'CERTIFICATE_ISSUE_DEFERRED','award',v_award_id::text,SQLERRM);END;END IF;END LOOP;INSERT INTO public.audit_logs(actor_user_id,action,entity_type,entity_id,reason) VALUES(v_uid,'AWARDS_GENERATED','competition',p_competition_id::text,'Generated from finalized attempts');RETURN v_count;END;$function$;

CREATE OR REPLACE FUNCTION public.is_public_profile_admin(p_profile_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1
    from public.user_roles as ur
    join public.profiles as p on p.id = ur.user_id
    where ur.user_id = p_profile_id
      and ur.role::text = 'admin'
      and ur.is_active is true
      and (coalesce(p.is_public, true) is true or p.id = (select auth.uid()))
  );
$function$;

CREATE OR REPLACE FUNCTION public.issue_certificate_for_award(p_award_id uuid)
 RETURNS certificates
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_catalog'
AS $function$
declare v_uid uuid:=auth.uid();v_award public.awards%rowtype;v_certificate public.certificates%rowtype;v_code text;v_org uuid;v_canonical uuid;v_profile public.profiles%rowtype;
begin
 if v_uid is null then raise exception 'AUTH_REQUIRED';end if;
 select * into v_award from public.awards where id=p_award_id;
 if not found then raise exception 'AWARD_NOT_FOUND';end if;
 select organizer_id into v_org from public.competitions where id=v_award.competition_id;
 if not exists(select 1 from public.user_roles where user_id=v_uid and role='admin' and is_active=true) and not exists(select 1 from public.organizer_members where organizer_id=v_org and user_id=v_uid and status='ACTIVE') then raise exception 'FORBIDDEN';end if;
 select id into v_canonical from public.participants where competition_id=v_award.competition_id and user_id=v_award.user_id limit 1;
 if v_canonical is null then
   select * into v_profile from public.profiles where id=v_award.user_id;
   insert into public.participants(competition_id,user_id,participant_type,full_name,grade,school_id,photo_url)
   values(v_award.competition_id,v_award.user_id,'INDIVIDUAL',coalesce(v_profile.full_name,v_profile.username,'Participant'),v_profile.grade,v_profile.school_id,v_profile.avatar_url)
   returning id into v_canonical;
 end if;
 select * into v_certificate from public.certificates where user_id=v_award.user_id and competition_id=v_award.competition_id order by created_at desc limit 1;
 if found then update public.certificates set canonical_participant_id=coalesce(canonical_participant_id,v_canonical) where id=v_certificate.id returning * into v_certificate; return v_certificate;end if;
 insert into public.certificates(user_id,competition_id,canonical_participant_id,status,current_revision) values(v_award.user_id,v_award.competition_id,v_canonical,'GENERATED',1) returning * into v_certificate;
 v_code:='SYKA-'||upper(substr(encode(gen_random_bytes(7),'hex'),1,12));
 insert into public.certificate_verifications(certificate_id,verification_code,status,public_name,competition_title,achievement_title,issued_at) select v_certificate.id,v_code,'GENERATED',p.full_name,c.title,v_award.title,now() from public.profiles p join public.competitions c on c.id=v_award.competition_id where p.id=v_award.user_id;
 return v_certificate;
end; $function$;

CREATE OR REPLACE FUNCTION public.list_teacher_achievement_report(p_competition_id uuid DEFAULT NULL::uuid, p_search text DEFAULT NULL::text)
 RETURNS TABLE(collective_participant_id uuid, roster_student_id uuid, canonical_participant_id uuid, competition_id uuid, competition_title text, competition_status text, student_name text, class_name text, grade text, participant_code text, participant_status text, attempt_status text, score numeric, rank bigint, finalized_at timestamp with time zone, certificate_status text, certificate_serial_number text, certificate_url text, certificate_issued_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_is_admin boolean := private.current_user_is_admin();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  IF NOT v_is_admin AND NOT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = v_user_id
      AND ur.role = 'teacher'::public.app_role
      AND ur.is_active = true
  ) THEN
    RAISE EXCEPTION 'TEACHER_ROLE_REQUIRED';
  END IF;

  RETURN QUERY
  SELECT
    cp.id,
    cp.roster_student_id,
    p.id,
    cp.competition_id,
    c.title,
    c.status::text,
    cp.full_name,
    cp.class_name,
    cp.grade,
    cp.participant_code,
    cp.status,
    latest_activity.status::text,
    CASE
      WHEN c.status::text IN ('RESULT_PUBLISHED', 'ARCHIVED')
       AND latest_finalized_attempt.status::text = 'FINALIZED'
      THEN latest_finalized_attempt.score
      ELSE NULL
    END,
    CASE
      WHEN c.status::text IN ('RESULT_PUBLISHED', 'ARCHIVED')
       AND latest_finalized_attempt.status::text = 'FINALIZED'
      THEN private.canonical_competition_rank(cp.competition_id, p.id)
      ELSE NULL
    END,
    latest_finalized_attempt.finalized_at,
    CASE
      WHEN c.status::text IN ('RESULT_PUBLISHED', 'ARCHIVED')
      THEN latest_certificate.status
      ELSE NULL
    END,
    CASE
      WHEN c.status::text IN ('RESULT_PUBLISHED', 'ARCHIVED')
      THEN latest_certificate.serial_number
      ELSE NULL
    END,
    CASE
      WHEN c.status::text IN ('RESULT_PUBLISHED', 'ARCHIVED')
      THEN latest_certificate.certificate_url
      ELSE NULL
    END,
    CASE
      WHEN c.status::text IN ('RESULT_PUBLISHED', 'ARCHIVED')
      THEN latest_certificate.issued_at
      ELSE NULL
    END
  FROM public.collective_participants cp
  JOIN public.competitions c
    ON c.id = cp.competition_id
  JOIN public.participants p
    ON p.competition_id = cp.competition_id
   AND p.collective_participant_id = cp.id
   AND p.participant_type = 'COLLECTIVE'
  LEFT JOIN LATERAL (
    SELECT a.status
    FROM public.attempts a
    WHERE a.canonical_participant_id = p.id
      AND a.is_preview = false
    ORDER BY a.created_at DESC, a.attempt_number DESC, a.id DESC
    LIMIT 1
  ) latest_activity ON true
  LEFT JOIN LATERAL (
    SELECT a.status, a.score, a.finalized_at
    FROM public.attempts a
    WHERE a.canonical_participant_id = p.id
      AND a.is_preview = false
      AND a.status::text = 'FINALIZED'
    ORDER BY a.created_at DESC, a.attempt_number DESC, a.id DESC
    LIMIT 1
  ) latest_finalized_attempt ON true
  LEFT JOIN LATERAL (
    SELECT cc.status, cc.serial_number, cc.certificate_url, cc.issued_at
    FROM public.collective_certificates cc
    WHERE cc.collective_participant_id = cp.id
      AND cc.competition_id = cp.competition_id
    ORDER BY cc.issued_at DESC NULLS LAST, cc.created_at DESC
    LIMIT 1
  ) latest_certificate ON true
  WHERE
    (cp.managed_by_user_id = v_user_id OR v_is_admin)
    AND (p_competition_id IS NULL OR cp.competition_id = p_competition_id)
    AND (
      NULLIF(trim(p_search), '') IS NULL
      OR cp.full_name ILIKE '%' || trim(p_search) || '%'
      OR COALESCE(cp.class_name, '') ILIKE '%' || trim(p_search) || '%'
      OR COALESCE(cp.grade, '') ILIKE '%' || trim(p_search) || '%'
      OR c.title ILIKE '%' || trim(p_search) || '%'
      OR cp.participant_code ILIKE '%' || trim(p_search) || '%'
    )
  ORDER BY
    COALESCE(latest_certificate.issued_at, latest_finalized_attempt.finalized_at, cp.created_at) DESC,
    cp.full_name ASC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_teacher_collective_certificates(p_competition_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(certificate_id uuid, participant_id uuid, competition_id uuid, competition_title text, participant_code text, full_name text, attempt_status text, score numeric, certificate_status text, serial_number text, verification_code text, certificate_url text, order_id uuid, order_status text, order_total numeric)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select cc.id,cp.id,cp.competition_id,c.title,cp.participant_code,cp.full_name,
         a.status::text,a.score,cc.status,cc.serial_number,cc.verification_code,cc.certificate_url,
         cco.order_id,o.status::text,o.total
  from public.collective_participants cp
  join public.competitions c on c.id=cp.competition_id
  left join lateral (select a1.status,a1.score from public.attempts a1 where a1.collective_participant_id=cp.id order by a1.created_at desc limit 1) a on true
  left join public.collective_certificates cc on cc.collective_participant_id=cp.id
  left join public.collective_certificate_orders cco on cco.collective_certificate_id=cc.id
  left join public.orders o on o.id=cco.order_id
  where (cp.managed_by_user_id=auth.uid() or exists(select 1 from public.user_roles ur where ur.user_id=auth.uid() and ur.role='admin' and ur.is_active=true))
    and (p_competition_id is null or cp.competition_id=p_competition_id)
  order by cp.created_at desc;
$function$;

CREATE OR REPLACE FUNCTION public.save_organizer_competition_config(p_competition_id uuid, p_level jsonb DEFAULT '{}'::jsonb, p_registration_rule jsonb DEFAULT '{}'::jsonb, p_rewards jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
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

CREATE OR REPLACE FUNCTION public.save_question_with_options(p_question_id uuid, p_question_bank_id uuid, p_type text, p_prompt text, p_points numeric DEFAULT 1, p_required boolean DEFAULT true, p_display_order integer DEFAULT 0, p_status text DEFAULT 'DRAFT'::text, p_config jsonb DEFAULT '{}'::jsonb, p_options jsonb DEFAULT '[]'::jsonb)
 RETURNS questions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$ declare v_uid uuid:=auth.uid();v_question public.questions%rowtype;v_org uuid;v_plan text;v_option jsonb;v_count int;v_correct int;begin if v_uid is null then raise exception 'AUTH_REQUIRED';end if;select organizer_id into v_org from public.question_banks where id=p_question_bank_id;if v_org is null then raise exception 'BANK_NOT_FOUND';end if;if not(exists(select 1 from public.organizer_members om where om.organizer_id=v_org and om.user_id=v_uid and om.status='ACTIVE') or exists(select 1 from public.user_roles ur where ur.user_id=v_uid and ur.role='admin' and ur.is_active=true)) then raise exception 'FORBIDDEN';end if;select op.plan_code into v_plan from public.organizer_plans op where op.organizer_id=v_org and op.is_active=true and op.starts_at<=now() and(op.ends_at is null or op.ends_at>now()) order by op.starts_at desc,op.created_at desc limit 1;if lower(p_type) in('essay','long-answer') and(coalesce(p_config,'{}'::jsonb) ? 'answer_key' or coalesce(p_config,'{}'::jsonb)->'ai_assessment'->>'enabled'='true') then if not exists(select 1 from public.plan_entitlements pe where pe.plan_code=v_plan and pe.capability='essay_ai_assessment' and coalesce(pe.limit_value,0)>0) then raise exception 'PREMIUM_REQUIRED';end if;end if;if lower(p_type) in('multiple-choice','mcq') then v_count:=jsonb_array_length(coalesce(p_options,'[]'::jsonb));if v_count<3 or v_count>6 then raise exception 'MCQ_OPTIONS_3_6';end if;select count(*) into v_correct from jsonb_array_elements(coalesce(p_options,'[]'::jsonb)) x where coalesce((x->>'is_correct')::boolean,false);if v_correct<>1 then raise exception 'MCQ_EXACTLY_ONE_CORRECT';end if;elsif lower(p_type) in('true-false','true_false') then if jsonb_array_length(coalesce(p_options,'[]'::jsonb))<>2 then raise exception 'TRUE_FALSE_REQUIRES_TWO_OPTIONS';end if;select count(*) into v_correct from jsonb_array_elements(coalesce(p_options,'[]'::jsonb)) x where coalesce((x->>'is_correct')::boolean,false);if v_correct<>1 then raise exception 'TRUE_FALSE_EXACTLY_ONE_CORRECT';end if;p_options:=jsonb_build_array(jsonb_build_object('label','Benar','value','Benar','is_correct',coalesce((p_options->0->>'is_correct')::boolean,false),'display_order',0),jsonb_build_object('label','Salah','value','Salah','is_correct',coalesce((p_options->1->>'is_correct')::boolean,false),'display_order',1));end if;if p_question_id is null then insert into public.questions(question_bank_id,type,prompt,points,required,display_order,status,config) values(p_question_bank_id,p_type,p_prompt,p_points,p_required,p_display_order,p_status,p_config) returning * into v_question;else update public.questions set question_bank_id=p_question_bank_id,type=p_type,prompt=p_prompt,points=p_points,required=p_required,display_order=p_display_order,status=p_status,config=p_config,updated_at=now() where id=p_question_id returning * into v_question;if not found then raise exception 'QUESTION_NOT_FOUND';end if;end if;delete from public.question_options where question_id=v_question.id;for v_option in select * from jsonb_array_elements(coalesce(p_options,'[]'::jsonb)) loop insert into public.question_options(question_id,label,value,is_correct,display_order) values(v_question.id,coalesce(v_option->>'label',''),coalesce(v_option->>'value',v_option->>'label',''),coalesce((v_option->>'is_correct')::boolean,false),coalesce((v_option->>'display_order')::int,0));end loop;return v_question;end;$function$;

CREATE OR REPLACE FUNCTION private.collective_realtime_bind(p_access_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'extensions'
AS $function$ declare v_uid uuid:=auth.uid();v_cp uuid:=private.collective_session_participant(trim(coalesce(p_access_token,'')));v_competition uuid;v_expires timestamptz;begin if v_uid is null then raise exception 'AUTH_REQUIRED';end if;if v_cp is null then raise exception 'COLLECTIVE_SESSION_INVALID';end if;select competition_id into v_competition from public.collective_participants where id=v_cp and status='ACTIVE';if v_competition is null then raise exception 'COLLECTIVE_SESSION_INVALID';end if;select least(s.expires_at,now()+interval '8 hours') into v_expires from public.collective_access_sessions s where s.token_hash=private.hash_collective_token(trim(coalesce(p_access_token,''))) and s.revoked_at is null and s.expires_at>now() and s.session_type='COMPETITION' and s.collective_participant_id=v_cp order by s.created_at desc limit 1;if v_expires is null then raise exception 'COLLECTIVE_SESSION_INVALID';end if;insert into private.collective_chat_realtime_sessions(auth_user_id,collective_participant_id,competition_id,expires_at,updated_at) values(v_uid,v_cp,v_competition,v_expires,now()) on conflict(auth_user_id) do update set collective_participant_id=excluded.collective_participant_id,competition_id=excluded.competition_id,expires_at=excluded.expires_at,updated_at=now();return jsonb_build_object('ok',true,'competition_id',v_competition,'expires_at',v_expires);end;$function$;

-- This helper is introduced only by the Better Auth issuer guard draft.

DROP FUNCTION IF EXISTS private.current_user_is_better_auth();


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
