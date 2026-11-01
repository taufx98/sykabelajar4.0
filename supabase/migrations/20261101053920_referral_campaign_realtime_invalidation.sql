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

  -- Broadcast only an invalidation timestamp; clients refetch authorized settings via RPC.
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
    v_row.is_active;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_update_referral_program_settings(boolean, integer, integer, text, text, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_referral_program_settings(boolean, integer, integer, text, text, timestamptz, timestamptz) TO authenticated;
