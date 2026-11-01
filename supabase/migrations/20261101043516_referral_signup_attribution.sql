-- Capture referral attribution when a new account is created from an invitation link.
-- The referral event is now independent of competition registration; the existing
-- event-driven activity/email triggers continue to own qualification and rewards.

BEGIN;

ALTER TABLE public.referral_events
  ALTER COLUMN competition_id DROP NOT NULL,
  ALTER COLUMN registration_id DROP NOT NULL;

CREATE OR REPLACE FUNCTION private.capture_signup_referral()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_referral_id text := nullif(trim(coalesce(NEW.raw_user_meta_data ->> 'referral_id', '')), '');
  v_referrer_id uuid;
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

  -- Prevent self-referrals and referrals to accounts that are not verified.
  IF v_referrer_id IS NULL OR v_referrer_id = NEW.id OR NOT EXISTS (
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
    5,
    'PENDING',
    clock_timestamp()
  )
  ON CONFLICT (referred_user_id) DO NOTHING;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.capture_signup_referral() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_referral_signup_attribution ON auth.users;
CREATE TRIGGER trg_referral_signup_attribution
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION private.capture_signup_referral();

COMMIT;
