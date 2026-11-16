-- Keep the hosted staging fixture aligned with the Worker phone-status RPC contract.
-- This additive migration is for the isolated auth staging project only.
-- It does not alter production schemas or enable phone verification by itself.

CREATE OR REPLACE FUNCTION private.get_better_auth_phone_verification_status(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM private.app_users AS au
    WHERE au.id = p_user_id
      AND au.phone_verified_at IS NOT NULL
      AND au.verified_phone_identity_hash ~ '^[a-f0-9]{64}$'
  );
$function$;

CREATE OR REPLACE FUNCTION public.better_auth_get_phone_verification_status(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT private.get_better_auth_phone_verification_status(p_user_id);
$function$;

REVOKE ALL ON FUNCTION private.get_better_auth_phone_verification_status(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.better_auth_get_phone_verification_status(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.better_auth_get_phone_verification_status(uuid)
  TO service_role;
