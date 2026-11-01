CREATE OR REPLACE FUNCTION public.get_my_referral_tier_awards()
RETURNS TABLE (
  milestone_target integer,
  bonus_amount numeric,
  referred_count integer,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTHORIZATION_REQUIRED';
  END IF;

  RETURN QUERY
  SELECT
    awards.milestone_target,
    awards.bonus_amount,
    awards.referred_count,
    awards.created_at
  FROM private.referral_tier_awards awards
  WHERE awards.referrer_user_id = (SELECT auth.uid())
  ORDER BY awards.milestone_target;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_my_referral_tier_awards() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_referral_tier_awards() TO authenticated;
