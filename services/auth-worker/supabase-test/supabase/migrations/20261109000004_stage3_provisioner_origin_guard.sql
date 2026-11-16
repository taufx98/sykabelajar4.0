-- Align the isolated Stage 3 fixture provisioning RPC with the reviewed
-- identity-origin guard in AUTH-STAGE-3-IDENTITY-ROOT-DRAFT.sql.
CREATE OR REPLACE FUNCTION private.provision_better_auth_user(
  p_user_id uuid,
  p_account_type text,
  p_full_name text,
  p_username text,
  p_referral_code text DEFAULT NULL,
  p_email_verified boolean DEFAULT false,
  p_birth_date date DEFAULT NULL,
  p_institution text DEFAULT NULL,
  p_grade text DEFAULT NULL,
  p_subjects text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_type text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_account_type, 'student')));
  v_role public.app_role;
  v_referrer_id uuid;
  v_reward_amount integer;
  v_profile_rows integer := 0;
  v_identity_origin text;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'USER_ID_REQUIRED';
  END IF;
  IF v_type NOT IN ('student', 'teacher', 'organizer') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'UNSUPPORTED_ACCOUNT_TYPE';
  END IF;

  INSERT INTO private.app_users (id, email_verified_at, identity_origin)
  VALUES (
    p_user_id,
    CASE WHEN coalesce(p_email_verified, false)
      THEN pg_catalog.clock_timestamp() ELSE NULL END,
    'better_auth'
  )
  ON CONFLICT (id) DO NOTHING;

  SELECT au.identity_origin
    INTO v_identity_origin
  FROM private.app_users au
  WHERE au.id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'USER_IDENTITY_NOT_FOUND';
  END IF;
  IF v_identity_origin IS DISTINCT FROM 'better_auth' THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'LEGACY_REFERENCE_IDENTITY_CANNOT_AUTHENTICATE';
  END IF;

  INSERT INTO public.profiles
    (id, full_name, username, account_type, birth_date, institution, grade, subjects)
  VALUES (
    p_user_id,
    coalesce(nullif(pg_catalog.btrim(p_full_name), ''), ''),
    nullif(pg_catalog.lower(pg_catalog.btrim(p_username)), ''),
    v_type,
    p_birth_date,
    nullif(pg_catalog.upper(pg_catalog.btrim(p_institution)), ''),
    nullif(pg_catalog.lower(pg_catalog.btrim(p_grade)), ''),
    nullif(pg_catalog.btrim(p_subjects), '')
  )
  ON CONFLICT (id) DO NOTHING;
  GET DIAGNOSTICS v_profile_rows = ROW_COUNT;

  SELECT pg_catalog.lower(p.account_type)
    INTO v_type
  FROM public.profiles p
  WHERE p.id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'APPLICATION_PROFILE_NOT_READY';
  END IF;

  v_role := CASE v_type
    WHEN 'teacher' THEN 'teacher'::public.app_role
    WHEN 'organizer' THEN 'organizer_member'::public.app_role
    ELSE 'student'::public.app_role
  END;

  IF v_profile_rows > 0 THEN
    INSERT INTO public.user_roles (user_id, role, is_active)
    SELECT p_user_id, v_role, true
    WHERE NOT EXISTS (
      SELECT 1 FROM public.user_roles existing_role
      WHERE existing_role.user_id = p_user_id
    )
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;

  INSERT INTO public.user_settings (user_id)
  VALUES (p_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  IF nullif(pg_catalog.btrim(p_referral_code), '') IS NOT NULL THEN
    SELECT rc.user_id INTO v_referrer_id
    FROM public.referral_codes rc
    JOIN private.app_users au ON au.id = rc.user_id
    WHERE rc.code = pg_catalog.btrim(p_referral_code)
      AND rc.user_id <> p_user_id
      AND au.email_verified_at IS NOT NULL;

    IF v_referrer_id IS NOT NULL THEN
      SELECT CASE
        WHEN s.event_reward_amount IS NOT NULL
         AND (s.starts_at IS NULL OR pg_catalog.clock_timestamp() >= s.starts_at)
         AND (s.ends_at IS NULL OR pg_catalog.clock_timestamp() < s.ends_at)
          THEN s.event_reward_amount
        ELSE s.base_reward_amount
      END INTO v_reward_amount
      FROM private.referral_program_settings s
      WHERE s.id = true AND s.is_active = true;

      IF v_reward_amount IS NOT NULL THEN
        INSERT INTO public.referral_events
          (referrer_user_id, referred_user_id, reward_amount, status, created_at)
        VALUES
          (v_referrer_id, p_user_id, v_reward_amount, 'PENDING',
           pg_catalog.clock_timestamp())
        ON CONFLICT (referred_user_id) DO NOTHING;
      END IF;
    END IF;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'user_id', p_user_id, 'account_type', v_type, 'role', v_role
  );
END;
$function$;

REVOKE ALL ON FUNCTION private.provision_better_auth_user(
  uuid,text,text,text,text,boolean,date,text,text,text
) FROM PUBLIC, anon, authenticated, service_role;
