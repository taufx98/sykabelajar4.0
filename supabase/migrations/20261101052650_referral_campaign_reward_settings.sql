CREATE TABLE IF NOT EXISTS private.referral_program_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  is_active boolean NOT NULL DEFAULT true,
  base_reward_amount integer NOT NULL DEFAULT 5 CHECK (base_reward_amount BETWEEN 1 AND 100000),
  event_reward_amount integer CHECK (event_reward_amount IS NULL OR event_reward_amount BETWEEN 1 AND 100000),
  event_name text,
  event_description text,
  starts_at timestamptz,
  ends_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT referral_program_settings_date_range_check
    CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at)
);

ALTER TABLE private.referral_program_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.referral_program_settings FROM PUBLIC, anon, authenticated, service_role;

INSERT INTO private.referral_program_settings (id)
VALUES (true)
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.get_referral_program_settings()
RETURNS TABLE (
  is_active boolean,
  reward_amount integer,
  base_reward_amount integer,
  event_reward_amount integer,
  event_name text,
  event_description text,
  starts_at timestamptz,
  ends_at timestamptz,
  is_event_active boolean,
  is_available boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_settings private.referral_program_settings%ROWTYPE;
  v_now timestamptz := statement_timestamp();
  v_event_active boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTHORIZATION_REQUIRED';
  END IF;

  SELECT s.*
    INTO v_settings
  FROM private.referral_program_settings s
  WHERE s.id = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'REFERRAL_SETTINGS_NOT_CONFIGURED';
  END IF;

  v_event_active := v_settings.is_active
    AND v_settings.event_reward_amount IS NOT NULL
    AND (v_settings.starts_at IS NULL OR v_now >= v_settings.starts_at)
    AND (v_settings.ends_at IS NULL OR v_now < v_settings.ends_at);

  RETURN QUERY
  SELECT
    v_settings.is_active,
    CASE WHEN v_event_active THEN v_settings.event_reward_amount ELSE v_settings.base_reward_amount END,
    v_settings.base_reward_amount,
    v_settings.event_reward_amount,
    v_settings.event_name,
    v_settings.event_description,
    v_settings.starts_at,
    v_settings.ends_at,
    v_event_active,
    v_settings.is_active;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_referral_program_settings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_referral_program_settings() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_update_referral_program_settings(
  p_is_active boolean,
  p_base_reward_amount integer,
  p_event_reward_amount integer DEFAULT NULL,
  p_event_name text DEFAULT NULL,
  p_event_description text DEFAULT NULL,
  p_starts_at timestamptz DEFAULT NULL,
  p_ends_at timestamptz DEFAULT NULL
)
RETURNS TABLE (
  is_active boolean,
  reward_amount integer,
  base_reward_amount integer,
  event_reward_amount integer,
  event_name text,
  event_description text,
  starts_at timestamptz,
  ends_at timestamptz,
  is_event_active boolean,
  is_available boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_now timestamptz := statement_timestamp();
  v_event_active boolean;
  v_row private.referral_program_settings%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTHORIZATION_REQUIRED';
  END IF;

  IF NOT private.current_user_is_admin() THEN
    RAISE EXCEPTION 'ADMIN_REQUIRED';
  END IF;

  IF p_is_active IS NULL THEN
    RAISE EXCEPTION 'ACTIVE_FLAG_REQUIRED';
  END IF;

  IF p_base_reward_amount IS NULL OR p_base_reward_amount NOT BETWEEN 1 AND 100000 THEN
    RAISE EXCEPTION 'INVALID_BASE_REWARD_AMOUNT';
  END IF;

  IF p_event_reward_amount IS NOT NULL AND p_event_reward_amount NOT BETWEEN 1 AND 100000 THEN
    RAISE EXCEPTION 'INVALID_EVENT_REWARD_AMOUNT';
  END IF;

  IF p_starts_at IS NOT NULL AND p_ends_at IS NOT NULL AND p_ends_at <= p_starts_at THEN
    RAISE EXCEPTION 'INVALID_EVENT_DATE_RANGE';
  END IF;

  INSERT INTO private.referral_program_settings (
    id, is_active, base_reward_amount, event_reward_amount,
    event_name, event_description, starts_at, ends_at, updated_at, updated_by
  )
  VALUES (
    true,
    p_is_active,
    p_base_reward_amount,
    p_event_reward_amount,
    nullif(left(trim(coalesce(p_event_name, '')), 100), ''),
    nullif(left(trim(coalesce(p_event_description, '')), 500), ''),
    p_starts_at,
    p_ends_at,
    v_now,
    auth.uid()
  )
  ON CONFLICT (id) DO UPDATE SET
    is_active = EXCLUDED.is_active,
    base_reward_amount = EXCLUDED.base_reward_amount,
    event_reward_amount = EXCLUDED.event_reward_amount,
    event_name = EXCLUDED.event_name,
    event_description = EXCLUDED.event_description,
    starts_at = EXCLUDED.starts_at,
    ends_at = EXCLUDED.ends_at,
    updated_at = EXCLUDED.updated_at,
    updated_by = EXCLUDED.updated_by
  RETURNING * INTO v_row;

  v_event_active := v_row.is_active
    AND v_row.event_reward_amount IS NOT NULL
    AND (v_row.starts_at IS NULL OR v_now >= v_row.starts_at)
    AND (v_row.ends_at IS NULL OR v_now < v_row.ends_at);

  RETURN QUERY
  SELECT
    v_row.is_active,
    CASE WHEN v_event_active THEN v_row.event_reward_amount ELSE v_row.base_reward_amount END,
    v_row.base_reward_amount,
    v_row.event_reward_amount,
    v_row.event_name,
    v_row.event_description,
    v_row.starts_at,
    v_row.ends_at,
    v_event_active,
    v_row.is_active;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_update_referral_program_settings(boolean, integer, integer, text, text, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_referral_program_settings(boolean, integer, integer, text, text, timestamptz, timestamptz) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_my_referrals_v2()
RETURNS TABLE (
  referred_user_id uuid,
  full_name text,
  username text,
  joined_at timestamptz,
  last_login_at timestamptz,
  status text,
  verified_at timestamptz,
  verified_activity text,
  reward_amount numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
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
$function$;

REVOKE ALL ON FUNCTION public.get_my_referrals_v2() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_referrals_v2() TO authenticated;

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
$function$;

REVOKE ALL ON FUNCTION private.capture_signup_referral() FROM PUBLIC, anon, authenticated, service_role;
