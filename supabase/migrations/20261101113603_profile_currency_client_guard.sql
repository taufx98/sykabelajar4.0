-- Profile wallet balances are server-owned canonical values.
-- Ledger tables are read-only to browser roles; this guard closes the remaining
-- direct profiles UPDATE path that could otherwise mint Edu Coin or XP.

CREATE OR REPLACE FUNCTION public.prevent_profile_currency_client_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
  IF current_user IN ('anon', 'authenticated') THEN
    IF TG_OP = 'INSERT' THEN
      IF coalesce(NEW.edu_coin, 0) <> 0
         OR coalesce(NEW.total_xp, 0) <> 0 THEN
        RAISE EXCEPTION 'PROFILE_CURRENCY_BACKEND_MANAGED'
          USING ERRCODE = '42501';
      END IF;
    ELSIF NEW.edu_coin IS DISTINCT FROM OLD.edu_coin
       OR NEW.total_xp IS DISTINCT FROM OLD.total_xp THEN
      RAISE EXCEPTION 'PROFILE_CURRENCY_BACKEND_MANAGED'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.prevent_profile_currency_client_mutation()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS profiles_currency_backend_guard ON public.profiles;
CREATE TRIGGER profiles_currency_backend_guard
BEFORE INSERT OR UPDATE OF edu_coin, total_xp
ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.prevent_profile_currency_client_mutation();
