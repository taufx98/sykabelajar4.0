-- Enforce Better Auth issuer inside the staging SECURITY DEFINER organizer RPC.
-- SECURITY DEFINER bypasses table RLS, so the function must not rely on the
-- issuer policies on user_roles/profiles to establish the caller's authority.
-- Preserve the intentional authenticated onboarding grant; anonymous access
-- remains denied. This migration is isolated-staging/test-only.

CREATE OR REPLACE FUNCTION public.create_organizer(p_name text, p_slug text)
RETURNS TABLE(id uuid, name text, slug text, access_code text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
  v_code text := encode(extensions.gen_random_bytes(5), 'hex');
  v_slug text := lower(regexp_replace(trim(p_slug), '[^a-zA-Z0-9]+', '-', 'g'));
  v_email_verified_at timestamptz;
  v_phone_verified_at timestamptz;
  v_identity_hash text;
  v_identity_origin text;
BEGIN
  IF (SELECT auth.jwt() ->> 'iss') IS DISTINCT FROM 'https://auth.sykabelajar.my.id/api/auth' THEN
    RAISE EXCEPTION 'BETTER_AUTH_ISSUER_REQUIRED';
  END IF;

  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = v_uid
      AND ur.role = 'organizer_member'::public.app_role
      AND ur.is_active = true
  ) THEN
    RAISE EXCEPTION 'ORGANIZER_ROLE_REQUIRED';
  END IF;

  IF nullif(trim(p_name), '') IS NULL THEN
    RAISE EXCEPTION 'ORGANIZER_NAME_REQUIRED';
  END IF;
  IF nullif(trim(v_slug), '') IS NULL THEN
    RAISE EXCEPTION 'ORGANIZER_SLUG_REQUIRED';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.organizers o
    WHERE o.owner_user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'ORGANIZER_LIMIT_REACHED';
  END IF;

  SELECT au.email_verified_at, au.phone_verified_at,
         au.verified_phone_identity_hash, au.identity_origin
    INTO v_email_verified_at, v_phone_verified_at, v_identity_hash, v_identity_origin
  FROM private.app_users au
  WHERE au.id = v_uid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'USER_NOT_FOUND';
  END IF;
  IF v_identity_origin IS DISTINCT FROM 'better_auth' THEN
    RAISE EXCEPTION 'BETTER_AUTH_IDENTITY_REQUIRED';
  END IF;
  IF v_email_verified_at IS NULL THEN
    RAISE EXCEPTION 'EMAIL_VERIFICATION_REQUIRED';
  END IF;
  IF v_phone_verified_at IS NULL OR v_identity_hash IS NULL
     OR v_identity_hash !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'PHONE_VERIFICATION_REQUIRED';
  END IF;

  IF EXISTS (
    SELECT 1 FROM private.organizer_free_identity_claims c
    WHERE c.identity_hash = v_identity_hash
  ) THEN
    RAISE EXCEPTION 'FREE_ORGANIZER_ALREADY_CLAIMED';
  END IF;

  INSERT INTO public.organizers AS inserted_organizer(name, slug, owner_user_id, status)
  VALUES (trim(p_name), trim(both '-' from v_slug), v_uid, 'ACTIVE')
  RETURNING inserted_organizer.id INTO v_id;

  INSERT INTO public.organizer_members(
    organizer_id, user_id, member_role, is_active, role, status
  )
  VALUES (v_id, v_uid, 'owner', true, 'owner', 'ACTIVE')
  ON CONFLICT (organizer_id, user_id) DO UPDATE
    SET member_role = 'owner',
        is_active = true,
        role = 'owner',
        status = 'ACTIVE',
        updated_at = pg_catalog.clock_timestamp();

  INSERT INTO public.organizer_plans(
    organizer_id, plan_code, starts_at, ends_at, is_active
  )
  VALUES (v_id, 'FREE', pg_catalog.now(),
          pg_catalog.now() + interval '6 months', true);

  INSERT INTO private.organizer_access_codes(organizer_id, code_hash, rotated_by)
  VALUES (v_id, extensions.crypt(v_code, extensions.gen_salt('bf', 10)), v_uid);

  INSERT INTO private.organizer_free_identity_claims(
    identity_hash, owner_user_id, organizer_id
  )
  VALUES (v_identity_hash, v_uid, v_id);

  RETURN QUERY
    SELECT o.id, o.name, o.slug, v_code
    FROM public.organizers o
    WHERE o.id = v_id;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'FREE_ORGANIZER_ALREADY_CLAIMED';
END;
$function$;

REVOKE ALL ON FUNCTION public.create_organizer(text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_organizer(text,text) TO authenticated, service_role;
