-- Additive Stage 3 compatibility fixture for trusted phone verification and organizer creation.
-- Synthetic-only: this is never a production migration.
ALTER TABLE private.app_users
  ADD COLUMN phone_verification_provider text,
  ADD COLUMN phone_verification_subject text;

CREATE UNIQUE INDEX app_users_phone_provider_subject_uidx
  ON private.app_users(phone_verification_provider, phone_verification_subject)
  WHERE phone_verification_provider IS NOT NULL
    AND phone_verification_subject IS NOT NULL;

CREATE TABLE private.organizer_free_identity_claims (
  identity_hash text PRIMARY KEY,
  owner_user_id uuid NOT NULL REFERENCES private.app_users(id) ON DELETE CASCADE,
  organizer_id uuid NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE public.organizers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  owner_user_id uuid REFERENCES private.app_users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE private.organizer_free_identity_claims
  ADD CONSTRAINT organizer_free_identity_claims_organizer_id_fkey
  FOREIGN KEY (organizer_id) REFERENCES public.organizers(id) ON DELETE CASCADE;

CREATE TABLE public.organizer_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_id uuid NOT NULL REFERENCES public.organizers(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES private.app_users(id) ON DELETE CASCADE,
  member_role text NOT NULL DEFAULT 'owner',
  is_active boolean NOT NULL DEFAULT true,
  role text NOT NULL DEFAULT 'owner',
  status text NOT NULL DEFAULT 'ACTIVE',
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (organizer_id, user_id)
);

CREATE TABLE public.organizer_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_id uuid NOT NULL REFERENCES public.organizers(id) ON DELETE CASCADE,
  plan_code text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE private.organizer_access_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_id uuid NOT NULL REFERENCES public.organizers(id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  rotated_by uuid REFERENCES private.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE public.organizers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizer_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizer_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.organizer_free_identity_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.organizer_access_codes ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.organizers, public.organizer_members, public.organizer_plans,
  private.organizer_free_identity_claims, private.organizer_access_codes
FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.organizers, public.organizer_members, public.organizer_plans,
  private.organizer_free_identity_claims, private.organizer_access_codes
TO service_role;

CREATE OR REPLACE FUNCTION private.complete_better_auth_phone_verification(
  p_user_id uuid,
  p_verified_at timestamptz,
  p_phone_hash text,
  p_provider text,
  p_provider_subject text,
  p_phone_digits_count integer
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_user private.app_users%rowtype;
BEGIN
  IF p_user_id IS NULL OR p_verified_at IS NULL
     OR p_verified_at > pg_catalog.clock_timestamp() + interval '2 minutes'
     OR p_verified_at < pg_catalog.clock_timestamp() - interval '15 minutes'
     OR p_provider <> 'telegram'
     OR p_provider_subject !~ '^[0-9]{1,32}$'
     OR p_phone_hash !~ '^[a-f0-9]{64}$'
     OR p_phone_digits_count < 8 OR p_phone_digits_count > 15 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PHONE_VERIFICATION_INPUT_INVALID';
  END IF;

  SELECT * INTO v_user
  FROM private.app_users
  WHERE id = p_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'USER_IDENTITY_NOT_FOUND';
  END IF;

  IF EXISTS (
    SELECT 1 FROM private.app_users au
    WHERE au.phone_verification_provider = p_provider
      AND au.phone_verification_subject = p_provider_subject
      AND au.id <> p_user_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'PHONE_PROVIDER_IDENTITY_ALREADY_LINKED';
  END IF;

  IF v_user.phone_verified_at IS NOT NULL
     AND v_user.verified_phone_identity_hash = p_phone_hash
     AND v_user.phone_verification_provider = p_provider
     AND v_user.phone_verification_subject = p_provider_subject THEN
    RETURN false;
  END IF;

  IF v_user.verified_phone_identity_hash IS NOT NULL
     AND v_user.verified_phone_identity_hash <> p_phone_hash
     AND EXISTS (
       SELECT 1 FROM private.organizer_free_identity_claims c
       WHERE c.identity_hash = v_user.verified_phone_identity_hash
         AND c.owner_user_id = p_user_id
     ) THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'PHONE_IDENTITY_LOCKED_BY_ORGANIZER_CLAIM';
  END IF;

  UPDATE private.app_users
  SET phone_verified_at = p_verified_at,
      verified_phone_identity_hash = p_phone_hash,
      phone_verification_provider = p_provider,
      phone_verification_subject = p_provider_subject,
      updated_at = pg_catalog.clock_timestamp()
  WHERE id = p_user_id;

  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.better_auth_complete_phone_verification(
  p_user_id uuid,
  p_verified_at timestamptz,
  p_phone_hash text,
  p_provider text,
  p_provider_subject text,
  p_phone_digits_count integer
) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $function$
  SELECT private.complete_better_auth_phone_verification(
    p_user_id, p_verified_at, p_phone_hash, p_provider,
    p_provider_subject, p_phone_digits_count
  );
$function$;

REVOKE ALL ON FUNCTION private.complete_better_auth_phone_verification(
  uuid,timestamptz,text,text,text,integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.complete_better_auth_phone_verification(
  uuid,timestamptz,text,text,text,integer
) TO service_role;
REVOKE ALL ON FUNCTION public.better_auth_complete_phone_verification(
  uuid,timestamptz,text,text,text,integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.better_auth_complete_phone_verification(
  uuid,timestamptz,text,text,text,integer
) TO service_role;

CREATE OR REPLACE FUNCTION public.create_organizer(p_name text, p_slug text)
RETURNS TABLE(id uuid, name text, slug text, access_code text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public', 'private'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
  v_code text := encode(extensions.gen_random_bytes(5), 'hex');
  v_slug text := lower(regexp_replace(trim(p_slug), '[^a-zA-Z0-9]+', '-', 'g'));
  v_email_verified_at timestamptz;
  v_phone_verified_at timestamptz;
  v_identity_hash text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'UNAUTHORIZED'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = v_uid
      AND ur.role = 'organizer_member'::public.app_role
      AND ur.is_active = true
  ) THEN
    RAISE EXCEPTION 'ORGANIZER_ROLE_REQUIRED';
  END IF;

  IF nullif(trim(p_name), '') IS NULL THEN RAISE EXCEPTION 'ORGANIZER_NAME_REQUIRED'; END IF;
  IF nullif(trim(v_slug), '') IS NULL THEN RAISE EXCEPTION 'ORGANIZER_SLUG_REQUIRED'; END IF;
  IF EXISTS (SELECT 1 FROM public.organizers o WHERE o.owner_user_id = v_uid) THEN
    RAISE EXCEPTION 'ORGANIZER_LIMIT_REACHED';
  END IF;

  SELECT au.email_verified_at, au.phone_verified_at,
         au.verified_phone_identity_hash
    INTO v_email_verified_at, v_phone_verified_at, v_identity_hash
  FROM private.app_users au
  WHERE au.id = v_uid;

  IF NOT FOUND THEN RAISE EXCEPTION 'USER_NOT_FOUND'; END IF;
  IF v_email_verified_at IS NULL THEN RAISE EXCEPTION 'EMAIL_VERIFICATION_REQUIRED'; END IF;
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

  INSERT INTO public.organizers(name, slug, owner_user_id, status)
  VALUES (trim(p_name), trim(both '-' from v_slug), v_uid, 'ACTIVE')
  RETURNING organizers.id INTO v_id;

  INSERT INTO public.organizer_members(
    organizer_id, user_id, member_role, is_active, role, status
  )
  VALUES (v_id, v_uid, 'owner', true, 'owner', 'ACTIVE')
  ON CONFLICT (organizer_id, user_id) DO UPDATE
    SET member_role = 'owner', is_active = true,
        role = 'owner', status = 'ACTIVE',
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
