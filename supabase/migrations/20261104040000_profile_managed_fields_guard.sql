-- Protect backend/admin-managed profile fields from direct PostgREST updates.
-- The existing profiles_self_update RLS policy is row-scoped, not column-scoped.

CREATE OR REPLACE FUNCTION private.guard_profile_server_managed_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  -- Read the signed JWT claim rather than current_user (changed by SECURITY DEFINER)
  -- or the legacy role helper.
  v_request_role text := coalesce(auth.jwt() ->> 'role', '');
  v_is_admin boolean := false;
BEGIN
  IF v_request_role = 'authenticated' THEN
    v_is_admin := coalesce(private.current_user_is_admin(), false);
  END IF;

  IF v_request_role IN ('anon', 'authenticated') AND NOT v_is_admin THEN
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

  -- Keep the timestamp authoritative even for trusted server-side name edits.
  IF NEW.full_name IS DISTINCT FROM OLD.full_name THEN
    NEW.last_name_change := statement_timestamp();
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.guard_profile_server_managed_fields() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS zz_profiles_server_managed_fields_guard ON public.profiles;
CREATE TRIGGER zz_profiles_server_managed_fields_guard
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION private.guard_profile_server_managed_fields();

-- Start from no client table privileges, then restore only the intended access.
-- Anonymous visitors may read public profiles; signed-in users may read and
-- update rows allowed by the existing RLS policies. No client can insert/delete.
REVOKE ALL ON TABLE public.profiles FROM anon, authenticated;
GRANT SELECT ON TABLE public.profiles TO anon;
GRANT SELECT, UPDATE ON TABLE public.profiles TO authenticated;

COMMENT ON FUNCTION private.guard_profile_server_managed_fields() IS
  'Blocks unprivileged direct updates to backend-managed profile fields and enforces the seven-day display-name cooldown.';
