-- Protect backend/admin-managed profile fields from direct PostgREST updates.
-- The existing profiles_self_update RLS policy is row-scoped, not column-scoped.

CREATE OR REPLACE FUNCTION public.guard_profile_server_managed_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
  IF current_user IN ('anon', 'authenticated') THEN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.status IS DISTINCT FROM OLD.status
       OR NEW.verification_type IS DISTINCT FROM OLD.verification_type
       OR NEW.school_id IS DISTINCT FROM OLD.school_id
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'PROFILE_FIELD_MANAGED_BY_BACKEND'
        USING ERRCODE = '42501';
    END IF;

    IF NEW.full_name IS DISTINCT FROM OLD.full_name THEN
      IF OLD.last_name_change IS NOT NULL
         AND OLD.last_name_change > statement_timestamp() - interval '7 days' THEN
        RAISE EXCEPTION 'PROFILE_NAME_CHANGE_COOLDOWN'
          USING ERRCODE = 'P0001';
      END IF;
    ELSIF NEW.last_name_change IS DISTINCT FROM OLD.last_name_change THEN
      RAISE EXCEPTION 'PROFILE_NAME_CHANGE_TIMESTAMP_MANAGED_BY_BACKEND'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NEW.full_name IS DISTINCT FROM OLD.full_name THEN
    NEW.last_name_change := statement_timestamp();
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS zz_profiles_server_managed_fields_guard ON public.profiles;

CREATE TRIGGER zz_profiles_server_managed_fields_guard
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.guard_profile_server_managed_fields();

REVOKE INSERT, UPDATE, DELETE ON TABLE public.profiles FROM anon;

COMMENT ON FUNCTION public.guard_profile_server_managed_fields() IS
  'Blocks direct client updates to backend-managed profile fields and enforces the seven-day display-name cooldown.';
