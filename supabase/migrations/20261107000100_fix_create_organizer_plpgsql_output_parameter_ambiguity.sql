-- Fix the PL/pgSQL output-parameter/column ambiguity in create_organizer.
-- Read-only production audit on 7 November 2026 confirmed that the live
-- plpgsql.variable_conflict setting is "error". Because RETURNS TABLE exposes
-- an output variable named "id", the unqualified auth.users.id reference in
-- the previous body is ambiguous when PL/pgSQL compiles it in a fresh session.
-- This forward migration changes only that reference; all business checks,
-- verification requirements, hashing, ownership, FREE-plan, and access-code
-- behavior remain unchanged. This file is prepared for review and is NOT
-- applied to production by the Stage 3 baseline workflow.

BEGIN;

CREATE OR REPLACE FUNCTION public.create_organizer(p_name text, p_slug text)
RETURNS TABLE(id uuid, name text, slug text, access_code text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_user auth.users;
  v_id uuid;
  v_code text := encode(extensions.gen_random_bytes(5), 'hex');
  v_slug text := lower(regexp_replace(trim(p_slug), '[^a-zA-Z0-9]+', '-', 'g'));
  v_phone text;
  v_identity_hash text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = v_uid
      AND ur.role = 'organizer_member'::public.app_role
      AND ur.is_active = true
  ) THEN
    RAISE EXCEPTION 'ORGANIZER_ROLE_REQUIRED';
  END IF;

  IF NULLIF(trim(p_name), '') IS NULL THEN
    RAISE EXCEPTION 'ORGANIZER_NAME_REQUIRED';
  END IF;
  IF NULLIF(trim(v_slug), '') IS NULL THEN
    RAISE EXCEPTION 'ORGANIZER_SLUG_REQUIRED';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.organizers
    WHERE owner_user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'ORGANIZER_LIMIT_REACHED';
  END IF;

  -- Qualify the table column: RETURNS TABLE creates an output variable named id.
  SELECT au.* INTO v_user
  FROM auth.users AS au
  WHERE au.id = v_uid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'USER_NOT_FOUND';
  END IF;
  IF v_user.email_confirmed_at IS NULL THEN
    RAISE EXCEPTION 'EMAIL_VERIFICATION_REQUIRED';
  END IF;
  IF v_user.phone_confirmed_at IS NULL THEN
    RAISE EXCEPTION 'PHONE_VERIFICATION_REQUIRED';
  END IF;

  v_phone := regexp_replace(coalesce(v_user.phone, ''), '[^0-9]+', '', 'g');
  IF length(v_phone) < 8 THEN
    RAISE EXCEPTION 'PHONE_VERIFICATION_REQUIRED';
  END IF;
  v_identity_hash := encode(extensions.digest(v_phone, 'sha256'), 'hex');

  IF EXISTS (
    SELECT 1
    FROM private.organizer_free_identity_claims
    WHERE identity_hash = v_identity_hash
  ) THEN
    RAISE EXCEPTION 'FREE_ORGANIZER_ALREADY_CLAIMED';
  END IF;

  INSERT INTO public.organizers AS inserted_organizer(name, slug, owner_user_id, status)
  VALUES (trim(p_name), trim(both '-' from v_slug), v_uid, 'ACTIVE')
  RETURNING inserted_organizer.id INTO v_id;

  INSERT INTO public.organizer_members(organizer_id, user_id, member_role, is_active, role, status)
  VALUES (v_id, v_uid, 'owner', true, 'owner', 'ACTIVE')
  ON CONFLICT (organizer_id, user_id) DO UPDATE
    SET member_role = 'owner',
        is_active = true,
        role = 'owner',
        status = 'ACTIVE',
        updated_at = now();

  INSERT INTO public.organizer_plans(organizer_id, plan_code, starts_at, ends_at, is_active)
  VALUES (v_id, 'FREE', now(), now() + interval '6 months', true);

  INSERT INTO private.organizer_access_codes(organizer_id, code_hash, rotated_by)
  VALUES (v_id, extensions.crypt(v_code, extensions.gen_salt('bf', 10)), v_uid);

  INSERT INTO private.organizer_free_identity_claims(identity_hash, owner_user_id, organizer_id)
  VALUES (v_identity_hash, v_uid, v_id);

  RETURN QUERY
    SELECT o.id, o.name, o.slug, v_code
    FROM public.organizers AS o
    WHERE o.id = v_id;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'FREE_ORGANIZER_ALREADY_CLAIMED';
END;
$function$;

COMMIT;
