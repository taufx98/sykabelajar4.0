ALTER TABLE private.referral_program_settings
  ADD COLUMN IF NOT EXISTS milestone_tiers jsonb NOT NULL DEFAULT '[
    {"target":1,"title":"Target Pertama","display_amount":"5 Coin","bonus_amount":0,"bonus_label":null,"total_note":null,"tag":null},
    {"target":25,"title":"Progress Konsisten","display_amount":"145 Coin","bonus_amount":20,"bonus_label":"+20 Bonus","total_note":null,"tag":null},
    {"target":100,"title":"Komunitas Berkembang","display_amount":"650 Coin","bonus_amount":150,"bonus_label":"+150 Coin Bonus","total_note":null,"tag":null},
    {"target":1000,"title":"Target Komunitas","display_amount":"950 Coin","bonus_amount":250,"bonus_label":"+250 Bonus Coin","total_note":"(700 + 250)","tag":"ULTRA"}
  ]'::jsonb,
  ADD COLUMN IF NOT EXISTS promo_is_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS promo_title text NOT NULL DEFAULT 'Ajak Teman, Dapatkan Edu Coin!',
  ADD COLUMN IF NOT EXISTS promo_description text NOT NULL DEFAULT 'Dapatkan {reward} Edu Coin untuk setiap teman yang memenuhi syarat program referral.',
  ADD COLUMN IF NOT EXISTS promo_badge text NOT NULL DEFAULT 'Bonus Aktif',
  ADD COLUMN IF NOT EXISTS promo_cta text NOT NULL DEFAULT 'Buka Program Referral';

CREATE TABLE IF NOT EXISTS private.referral_tier_awards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  milestone_target integer NOT NULL CHECK (milestone_target > 0),
  bonus_amount numeric NOT NULL CHECK (bonus_amount > 0),
  referred_count integer NOT NULL CHECK (referred_count >= milestone_target),
  tier_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (referrer_user_id, milestone_target)
);

ALTER TABLE private.referral_tier_awards ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.referral_tier_awards FROM PUBLIC, anon, authenticated, service_role;

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
BEGIN
  IF p_referrer_user_id IS NULL THEN
    RETURN;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_referrer_user_id::text, 0)
  );

  SELECT s.milestone_tiers
    INTO v_tiers
  FROM private.referral_program_settings s
  WHERE s.id = true;

  IF v_tiers IS NULL OR jsonb_typeof(v_tiers) <> 'array' THEN
    RETURN;
  END IF;

  SELECT count(*)::integer
    INTO v_referral_count
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
      referrer_user_id,
      milestone_target,
      bonus_amount,
      referred_count,
      tier_snapshot
    )
    VALUES (
      p_referrer_user_id,
      v_target,
      v_bonus,
      v_referral_count,
      v_tier
    )
    ON CONFLICT (referrer_user_id, milestone_target) DO NOTHING
    RETURNING id INTO v_award_id;

    IF v_award_id IS NOT NULL THEN
      INSERT INTO public.edu_coin_ledger (
        user_id,
        event_type,
        event_id,
        amount,
        reason
      )
      VALUES (
        p_referrer_user_id,
        'REFERRAL_TIER_BONUS',
        v_award_id::text,
        v_bonus,
        'Bonus milestone referral ' || v_target::text || ' pengguna'
      )
      ON CONFLICT (user_id, event_type, event_id) DO NOTHING;
    END IF;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION private.apply_referral_milestone_rewards(uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.capture_referral_milestone_reward()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF NEW.event_type = 'REFERRAL_REGISTRATION' AND NEW.amount > 0 THEN
    PERFORM private.apply_referral_milestone_rewards(NEW.user_id);
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.capture_referral_milestone_reward() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_capture_referral_milestone_reward ON public.edu_coin_ledger;
CREATE TRIGGER trg_capture_referral_milestone_reward
AFTER INSERT ON public.edu_coin_ledger
FOR EACH ROW
EXECUTE FUNCTION private.capture_referral_milestone_reward();

CREATE OR REPLACE FUNCTION public.get_referral_program_settings_v2()
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
  is_available boolean,
  milestone_tiers jsonb,
  promo_is_enabled boolean,
  promo_title text,
  promo_description text,
  promo_badge text,
  promo_cta text
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
    v_settings.is_active,
    v_settings.milestone_tiers,
    v_settings.promo_is_enabled,
    v_settings.promo_title,
    v_settings.promo_description,
    v_settings.promo_badge,
    v_settings.promo_cta;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_referral_program_settings_v2() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_referral_program_settings_v2() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_update_referral_program_settings_v2(
  p_is_active boolean,
  p_base_reward_amount integer,
  p_event_reward_amount integer,
  p_event_name text,
  p_event_description text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_milestone_tiers jsonb,
  p_promo_is_enabled boolean,
  p_promo_title text,
  p_promo_description text,
  p_promo_badge text,
  p_promo_cta text
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
  is_available boolean,
  milestone_tiers jsonb,
  promo_is_enabled boolean,
  promo_title text,
  promo_description text,
  promo_badge text,
  promo_cta text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_now timestamptz := statement_timestamp();
  v_event_active boolean;
  v_row private.referral_program_settings%ROWTYPE;
  v_tier jsonb;
  v_previous_target integer := 0;
  v_target integer;
  v_bonus numeric;
  v_referrer_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTHORIZATION_REQUIRED';
  END IF;

  IF NOT private.current_user_is_admin() THEN
    RAISE EXCEPTION 'ADMIN_REQUIRED';
  END IF;

  IF p_is_active IS NULL OR p_promo_is_enabled IS NULL THEN
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

  IF p_event_reward_amount IS NOT NULL AND nullif(trim(coalesce(p_event_name, '')), '') IS NULL THEN
    RAISE EXCEPTION 'REFERRAL_EVENT_NAME_REQUIRED';
  END IF;

  IF p_milestone_tiers IS NULL
     OR jsonb_typeof(p_milestone_tiers) <> 'array'
     OR jsonb_array_length(p_milestone_tiers) <> 4 THEN
    RAISE EXCEPTION 'REFERRAL_REQUIRES_FOUR_MILESTONES';
  END IF;

  FOR v_tier IN SELECT value FROM jsonb_array_elements(p_milestone_tiers)
  LOOP
    IF jsonb_typeof(v_tier) <> 'object'
       OR coalesce(v_tier ->> 'target', '') !~ '^[1-9][0-9]{0,6}$'
       OR coalesce(v_tier ->> 'bonus_amount', '') !~ '^[0-9]{1,6}$'
       OR nullif(trim(coalesce(v_tier ->> 'display_amount', '')), '') IS NULL
       OR length(v_tier ->> 'display_amount') > 50
       OR length(coalesce(v_tier ->> 'title', '')) > 80
       OR length(coalesce(v_tier ->> 'bonus_label', '')) > 60
       OR length(coalesce(v_tier ->> 'total_note', '')) > 40
       OR length(coalesce(v_tier ->> 'tag', '')) > 20 THEN
      RAISE EXCEPTION 'INVALID_REFERRAL_MILESTONE';
    END IF;

    v_target := (v_tier ->> 'target')::integer;
    v_bonus := (v_tier ->> 'bonus_amount')::numeric;
    IF v_target <= v_previous_target OR v_bonus > 100000 THEN
      RAISE EXCEPTION 'INVALID_REFERRAL_MILESTONE_ORDER_OR_BONUS';
    END IF;
    v_previous_target := v_target;
  END LOOP;

  IF length(trim(coalesce(p_promo_title, ''))) NOT BETWEEN 1 AND 100
     OR length(trim(coalesce(p_promo_description, ''))) NOT BETWEEN 1 AND 240
     OR length(trim(coalesce(p_promo_badge, ''))) > 30
     OR length(trim(coalesce(p_promo_cta, ''))) NOT BETWEEN 1 AND 60 THEN
    RAISE EXCEPTION 'INVALID_REFERRAL_PROMO_CONTENT';
  END IF;

  INSERT INTO private.referral_program_settings (
    id, is_active, base_reward_amount, event_reward_amount,
    event_name, event_description, starts_at, ends_at,
    milestone_tiers, promo_is_enabled, promo_title, promo_description,
    promo_badge, promo_cta, updated_at, updated_by
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
    p_milestone_tiers,
    p_promo_is_enabled,
    left(trim(p_promo_title), 100),
    left(trim(p_promo_description), 240),
    nullif(left(trim(coalesce(p_promo_badge, '')), 30), ''),
    left(trim(p_promo_cta), 60),
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
    milestone_tiers = EXCLUDED.milestone_tiers,
    promo_is_enabled = EXCLUDED.promo_is_enabled,
    promo_title = EXCLUDED.promo_title,
    promo_description = EXCLUDED.promo_description,
    promo_badge = EXCLUDED.promo_badge,
    promo_cta = EXCLUDED.promo_cta,
    updated_at = EXCLUDED.updated_at,
    updated_by = EXCLUDED.updated_by
  RETURNING * INTO v_row;

  -- Tiers newly introduced or newly reached by existing referral counts are
  -- awarded once; existing awards are immutable and never duplicated.
  FOR v_referrer_id IN
    SELECT DISTINCT re.referrer_user_id
    FROM public.referral_events re
    WHERE re.status IN ('VERIFIED', 'CREDITED')
  LOOP
    PERFORM private.apply_referral_milestone_rewards(v_referrer_id);
  END LOOP;

  PERFORM realtime.send(
    jsonb_build_object('updated_at', v_row.updated_at),
    'updated',
    'referral-program-settings',
    false
  );

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
    v_row.is_active,
    v_row.milestone_tiers,
    v_row.promo_is_enabled,
    v_row.promo_title,
    v_row.promo_description,
    v_row.promo_badge,
    v_row.promo_cta;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_update_referral_program_settings_v2(
  boolean, integer, integer, text, text, timestamptz, timestamptz, jsonb,
  boolean, text, text, text, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_referral_program_settings_v2(
  boolean, integer, integer, text, text, timestamptz, timestamptz, jsonb,
  boolean, text, text, text, text
) TO authenticated;
