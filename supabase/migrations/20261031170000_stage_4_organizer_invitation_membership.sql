-- Stage 4: keep the backend organizer role in sync with trusted workspace membership.
-- Membership inserts/joins are already authorized by organizer RLS policies and
-- private governance checks. This SECURITY DEFINER trigger only mirrors the
-- resulting membership into user_roles so route authorization matches the
-- membership the database already recognizes.

CREATE OR REPLACE FUNCTION private.sync_organizer_member_role_for_user(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF p_user_id IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.organizer_members om
    WHERE om.user_id = p_user_id
      AND om.status = 'ACTIVE'
      AND om.is_active = true
  ) OR EXISTS (
    SELECT 1
    FROM public.profiles profile
    WHERE profile.id = p_user_id
      AND profile.account_type = 'organizer'
  ) THEN
    INSERT INTO public.user_roles (user_id, role, is_active)
    VALUES (p_user_id, 'organizer_member'::public.app_role, true)
    ON CONFLICT (user_id, role) DO UPDATE
      SET is_active = true;
  ELSE
    UPDATE public.user_roles
    SET is_active = false
    WHERE user_id = p_user_id
      AND role = 'organizer_member'::public.app_role;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION private.sync_organizer_member_user_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_old_user_id uuid;
  v_new_user_id uuid;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    v_old_user_id := OLD.user_id;
  END IF;

  IF TG_OP <> 'DELETE' THEN
    v_new_user_id := NEW.user_id;
  END IF;

  IF v_old_user_id IS NOT NULL THEN
    PERFORM private.sync_organizer_member_role_for_user(v_old_user_id);
  END IF;

  IF v_new_user_id IS NOT NULL
     AND v_new_user_id IS DISTINCT FROM v_old_user_id THEN
    PERFORM private.sync_organizer_member_role_for_user(v_new_user_id);
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.sync_organizer_member_role_for_user(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.sync_organizer_member_user_role()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_sync_organizer_member_user_role
  ON public.organizer_members;

CREATE TRIGGER trg_sync_organizer_member_user_role
AFTER INSERT OR UPDATE OR DELETE
ON public.organizer_members
FOR EACH ROW
EXECUTE FUNCTION private.sync_organizer_member_user_role();

-- Reconcile currently active workspace members. Existing self-registered
-- organizer accounts remain eligible even before their first workspace.
INSERT INTO public.user_roles (user_id, role, is_active)
SELECT DISTINCT om.user_id, 'organizer_member'::public.app_role, true
FROM public.organizer_members om
WHERE om.status = 'ACTIVE'
  AND om.is_active = true
ON CONFLICT (user_id, role) DO UPDATE
  SET is_active = true;
