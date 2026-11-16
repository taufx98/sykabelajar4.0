-- Complete the first-time profile for a Better Auth social account.
-- This function is deliberately narrow: it never changes account_type or user_roles,
-- and it may only assign the username while the profile still has no username.
CREATE OR REPLACE FUNCTION public.complete_better_auth_profile(
  p_username text,
  p_full_name text,
  p_birth_date date,
  p_institution text,
  p_grade text,
  p_subjects text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_username text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_username, '')));
  v_full_name text := pg_catalog.btrim(coalesce(p_full_name, ''));
  v_institution text := pg_catalog.btrim(coalesce(p_institution, ''));
  v_grade text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_grade, '')));
  v_subjects text := pg_catalog.btrim(coalesce(p_subjects, ''));
  v_current_username text;
  v_verified_at timestamptz;
  v_subjects_array text[];
BEGIN
  IF v_user_id IS NULL
    OR (auth.jwt() ->> 'role') IS DISTINCT FROM 'authenticated'
    OR (auth.jwt() ->> 'iss') IS DISTINCT FROM 'https://auth.sykabelajar.my.id/api/auth'
  THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'BETTER_AUTH_SESSION_REQUIRED';
  END IF;

  SELECT au.email_verified_at
    INTO v_verified_at
  FROM private.app_users AS au
  WHERE au.id = v_user_id
    AND au.identity_origin = 'better_auth'
  FOR UPDATE;

  IF NOT FOUND OR v_verified_at IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'VERIFIED_BETTER_AUTH_IDENTITY_REQUIRED';
  END IF;

  IF v_username !~ '^[a-z0-9][a-z0-9._-]{2,39}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'USERNAME_INVALID';
  END IF;

  IF pg_catalog.char_length(v_full_name) < 2 OR pg_catalog.char_length(v_full_name) > 120 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'FULL_NAME_INVALID';
  END IF;

  IF p_birth_date IS NULL OR p_birth_date > CURRENT_DATE THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'BIRTH_DATE_INVALID';
  END IF;

  IF pg_catalog.char_length(v_institution) < 2 OR pg_catalog.char_length(v_institution) > 200 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INSTITUTION_INVALID';
  END IF;

  IF v_grade NOT IN ('sd', 'smp', 'sma', 'alumni') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'EDUCATION_LEVEL_INVALID';
  END IF;

  v_subjects_array := pg_catalog.string_to_array(v_subjects, ',');
  IF v_subjects IS NULL OR v_subjects = '' OR pg_catalog.cardinality(v_subjects_array) < 1
    OR EXISTS (
      SELECT 1
      FROM pg_catalog.unnest(v_subjects_array) AS item(value)
      WHERE pg_catalog.btrim(item.value) NOT IN (
        'mtk', 'ipa', 'ips', 'bindo', 'bing', 'seni', 'olahraga', 'tech', 'lingkungan'
      )
    )
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'FAVORITE_CATEGORIES_REQUIRED';
  END IF;

  SELECT p.username
    INTO v_current_username
  FROM public.profiles AS p
  WHERE p.id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'APPLICATION_PROFILE_NOT_FOUND';
  END IF;

  IF v_current_username IS NOT NULL AND v_current_username <> v_username THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'USERNAME_ALREADY_SET';
  END IF;

  IF v_current_username IS NULL AND EXISTS (
    SELECT 1
    FROM public.profiles AS p
    WHERE p.id <> v_user_id
      AND pg_catalog.lower(p.username) = v_username
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'USERNAME_ALREADY_TAKEN';
  END IF;

  UPDATE public.profiles
  SET
    username = v_username,
    full_name = v_full_name,
    birth_date = p_birth_date,
    institution = v_institution,
    grade = v_grade,
    subjects = v_subjects,
    updated_at = pg_catalog.clock_timestamp()
  WHERE id = v_user_id;

  RETURN pg_catalog.jsonb_build_object(
    'user_id', v_user_id,
    'username', v_username,
    'completed', true
  );
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'USERNAME_ALREADY_TAKEN';
END;
$function$;

REVOKE ALL ON FUNCTION public.complete_better_auth_profile(text, text, date, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_better_auth_profile(text, text, date, text, text, text) TO authenticated;
