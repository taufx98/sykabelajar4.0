-- Stage 4 organizer membership/invitation regression checks.
-- Read-only: this test inspects schema, function definitions, and role consistency.
DO $stage4$
DECLARE
  v_sync_definition text;
  v_trigger_definition text;
  v_rotate_definition text;
  v_join_definition text;
  v_active_missing integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'organizer_members'
      AND t.tgname = 'trg_sync_organizer_member_user_role'
      AND NOT t.tgisinternal
      AND t.tgenabled IN ('O', 'A')
  ) THEN
    RAISE EXCEPTION 'Stage 4 organizer membership role-sync trigger is missing or disabled';
  END IF;

  SELECT pg_get_functiondef(
    'private.sync_organizer_member_role_for_user(uuid)'::regprocedure
  ) INTO v_sync_definition;

  IF position('SECURITY DEFINER' IN v_sync_definition) = 0
     OR position('SET search_path TO ' || chr(39) || chr(39) IN v_sync_definition) = 0
     OR position('public.organizer_members' IN v_sync_definition) = 0
     OR position('status = ''ACTIVE''' IN v_sync_definition) = 0
     OR position('is_active = true' IN v_sync_definition) = 0
     OR position('organizer_member' IN v_sync_definition) = 0
     OR position('profile.account_type = ''organizer''' IN v_sync_definition) = 0 THEN
    RAISE EXCEPTION 'Stage 4 role-sync function lacks fixed search path or membership/account-type safeguards';
  END IF;

  IF has_function_privilege('anon', 'private.sync_organizer_member_role_for_user(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'private.sync_organizer_member_role_for_user(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'private.sync_organizer_member_user_role()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'private.sync_organizer_member_user_role()', 'EXECUTE') THEN
    RAISE EXCEPTION 'Private role-sync functions must not be directly executable by API roles';
  END IF;

  SELECT pg_get_triggerdef(t.oid)
  INTO v_trigger_definition
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'organizer_members'
    AND t.tgname = 'trg_sync_organizer_member_user_role';

  IF position('AFTER' IN v_trigger_definition) = 0
     OR position('INSERT' IN v_trigger_definition) = 0
     OR position('UPDATE' IN v_trigger_definition) = 0
     OR position('DELETE' IN v_trigger_definition) = 0 THEN
    RAISE EXCEPTION 'Role-sync trigger must cover insert, update, and delete';
  END IF;

  SELECT count(DISTINCT om.user_id)::integer
  INTO v_active_missing
  FROM public.organizer_members om
  WHERE om.status = 'ACTIVE'
    AND om.is_active = true
    AND NOT EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.user_id = om.user_id
        AND ur.role = 'organizer_member'::public.app_role
        AND ur.is_active = true
    );

  IF v_active_missing <> 0 THEN
    RAISE EXCEPTION 'Stage 4 backfill/trigger left % active organizer members without organizer role', v_active_missing;
  END IF;

  SELECT pg_get_functiondef(
    'public.rotate_organizer_access_code(uuid)'::regprocedure
  ) INTO v_rotate_definition;

  IF position('SECURITY DEFINER' IN v_rotate_definition) = 0
     OR position('SET search_path TO ' || chr(39) || chr(39) IN v_rotate_definition) = 0
     OR position('private.current_user_is_admin()' IN v_rotate_definition) = 0
     OR position('private.current_user_can_manage_organizer(p_organizer_id)' IN v_rotate_definition) = 0
     OR position('private.organizer_access_codes' IN v_rotate_definition) = 0
     OR position('extensions.crypt' IN v_rotate_definition) = 0 THEN
    RAISE EXCEPTION 'Invitation rotation must be server-side, hashed, and restricted to admin or workspace owner';
  END IF;

  IF has_function_privilege('anon', 'public.rotate_organizer_access_code(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.rotate_organizer_access_code(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Invitation rotation RPC grants must be authenticated-only';
  END IF;

  SELECT pg_get_functiondef(
    'public.join_organizer(text,text)'::regprocedure
  ) INTO v_join_definition;

  IF position('private.organizer_access_codes' IN v_join_definition) = 0
     OR position('public.organizer_members' IN v_join_definition) = 0 THEN
    RAISE EXCEPTION 'Existing join_organizer RPC must continue to verify hashed codes and create memberships';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'organizer_members'
      AND t.tgname = 'trg_guard_organizer_member_governance'
      AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 'Existing organizer membership governance trigger must remain installed';
  END IF;
END;
$stage4$;
