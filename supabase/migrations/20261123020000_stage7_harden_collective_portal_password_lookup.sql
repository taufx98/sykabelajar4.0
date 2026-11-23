BEGIN;

-- Fail closed unless this exact Production source/ACL snapshot is present.
-- Credential rows must be empty: bcrypt hashes cannot be reversed to rebuild a
-- new full-password lookup key. This is a zero-start-only migration.
DO $stage7_portal_lookup_source_preflight$
DECLARE
  v_signature text;
  v_expected_md5 text;
  v_expected_acl text[];
  v_oid oid;
  v_owner oid;
  v_security_definer boolean;
  v_search_path text[];
  v_actual_md5 text;
  v_actual_acl text[];
BEGIN
  IF pg_catalog.to_regclass('public.collective_portal_credentials') IS NULL THEN
    RAISE EXCEPTION 'STAGE7_PORTAL_LOOKUP_CREDENTIAL_TABLE_MISSING';
  END IF;

  IF EXISTS (SELECT 1 FROM public.collective_portal_credentials LIMIT 1) THEN
    RAISE EXCEPTION 'STAGE7_PORTAL_LOOKUP_REBUILD_REQUIRES_ZERO_CREDENTIAL_ROWS';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS c
    WHERE c.conrelid='public.collective_portal_credentials'::regclass
      AND c.conname='collective_portal_credentials_password_lookup_key_key'
      AND c.contype='u'
      AND pg_catalog.pg_get_constraintdef(c.oid)='UNIQUE (password_lookup_key)'
  ) THEN
    RAISE EXCEPTION 'STAGE7_PORTAL_LOOKUP_UNIQUE_CONSTRAINT_DRIFT';
  END IF;

  IF pg_catalog.to_regprocedure('private.collective_portal_password_lookup_key(text)') IS NOT NULL THEN
    RAISE EXCEPTION 'STAGE7_PORTAL_LOOKUP_HELPER_ALREADY_EXISTS';
  END IF;

  IF pg_catalog.has_schema_privilege('anon','private','USAGE')
     OR pg_catalog.has_schema_privilege('authenticated','private','USAGE')
     OR pg_catalog.has_schema_privilege('service_role','private','USAGE') THEN
    RAISE EXCEPTION 'STAGE7_PORTAL_LOOKUP_PRIVATE_SCHEMA_USAGE_DRIFT';
  END IF;

  FOR v_signature,v_expected_md5,v_expected_acl IN
    SELECT expected.signature,expected.source_md5,expected.execute_acl
    FROM (VALUES
      (
        'private.sync_collective_portal_credential(uuid,text,integer)',
        'deeaff8a6abcf615b4b368d6fb58efb7',
        ARRAY['PUBLIC=X/postgres','postgres=X/postgres']::text[]
      ),
      (
        'public.provision_collective_registration(uuid)',
        '754fe1bf3e11bb714d183cf6127a86c0',
        ARRAY['authenticated=X/postgres','postgres=X/postgres','service_role=X/postgres']::text[]
      ),
      (
        'public.regenerate_collective_participant_password(uuid)',
        '9631e5525fef8faf6dcf9bd3ae7fd07c',
        ARRAY['authenticated=X/postgres','postgres=X/postgres','service_role=X/postgres']::text[]
      ),
      (
        'public.verify_collective_portal_password(text)',
        'd85f7c2a1d194151663b4c536c064dad',
        ARRAY['anon=X/postgres','authenticated=X/postgres','postgres=X/postgres','service_role=X/postgres']::text[]
      )
    ) AS expected(signature,source_md5,execute_acl)
  LOOP
    v_oid := pg_catalog.to_regprocedure(v_signature);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'STAGE7_PORTAL_LOOKUP_SOURCE_FUNCTION_MISSING:%',v_signature;
    END IF;

    SELECT p.proowner,p.prosecdef,p.proconfig,
           pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid)),
           COALESCE((
             SELECT pg_catalog.array_agg(
               COALESCE(grantee.rolname,'PUBLIC') || '=X/' || COALESCE(grantor.rolname,'?')
               ORDER BY COALESCE(grantee.rolname,'PUBLIC')
             )
             FROM pg_catalog.aclexplode(
               COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))
             ) AS acl_entry
             LEFT JOIN pg_catalog.pg_roles AS grantee ON grantee.oid=acl_entry.grantee
             LEFT JOIN pg_catalog.pg_roles AS grantor ON grantor.oid=acl_entry.grantor
             WHERE acl_entry.privilege_type='EXECUTE'
           ),ARRAY[]::text[])
      INTO v_owner,v_security_definer,v_search_path,v_actual_md5,v_actual_acl
    FROM pg_catalog.pg_proc AS p
    WHERE p.oid=v_oid;

    IF pg_catalog.pg_get_userbyid(v_owner) IS DISTINCT FROM 'postgres'
       OR v_security_definer IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'STAGE7_PORTAL_LOOKUP_SOURCE_OWNER_OR_KIND_DRIFT:%',v_signature;
    END IF;

    IF v_search_path IS DISTINCT FROM ARRAY['search_path=public, private, extensions']::text[] THEN
      RAISE EXCEPTION 'STAGE7_PORTAL_LOOKUP_SOURCE_SEARCH_PATH_DRIFT:%:%',v_signature,v_search_path;
    END IF;

    IF v_actual_md5 IS DISTINCT FROM v_expected_md5 THEN
      RAISE EXCEPTION 'STAGE7_PORTAL_LOOKUP_SOURCE_DEFINITION_DRIFT:%:%',v_signature,v_actual_md5;
    END IF;

    IF v_actual_acl IS DISTINCT FROM v_expected_acl THEN
      RAISE EXCEPTION 'STAGE7_PORTAL_LOOKUP_SOURCE_ACL_DRIFT:%:%',v_signature,v_actual_acl;
    END IF;
  END LOOP;
END;
$stage7_portal_lookup_source_preflight$;

-- One canonical key derivation: the full, exact password string. This matches
-- the byte-for-byte input supplied to crypt(); no short prefix or trimming.
CREATE FUNCTION private.collective_portal_password_lookup_key(p_password text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path TO ''
AS $function$
  SELECT pg_catalog.encode(extensions.digest(p_password,'sha256'),'hex');
$function$;

-- Only the database owner may execute the helper directly. Existing public
-- portal RPC ACLs remain byte-for-byte unchanged.
REVOKE ALL ON FUNCTION private.collective_portal_password_lookup_key(text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.sync_collective_portal_credential(
  p_participant_id uuid,
  p_plaintext_password text,
  p_password_version integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'extensions'
AS $function$
DECLARE
  cp public.collective_participants%rowtype;
  pi_id uuid;
  lk text;
BEGIN
  SELECT * INTO cp
  FROM public.collective_participants
  WHERE id=p_participant_id;

  IF cp.id IS NULL THEN
    RAISE EXCEPTION 'COLLECTIVE_PARTICIPANT_NOT_FOUND';
  END IF;

  SELECT id INTO pi_id
  FROM public.collective_portal_identities
  WHERE owner_user_id=cp.managed_by_user_id
    AND roster_student_id=cp.roster_student_id;

  IF pi_id IS NULL THEN
    INSERT INTO public.collective_portal_identities(
      roster_student_id,owner_user_id,school_id
    )
    VALUES(cp.roster_student_id,cp.managed_by_user_id,cp.school_id)
    RETURNING id INTO pi_id;
  END IF;

  IF trim(coalesce(p_plaintext_password,''))<>'' THEN
    lk:=private.collective_portal_password_lookup_key(p_plaintext_password);

    INSERT INTO public.collective_portal_credentials(
      portal_identity_id,password_hash,password_lookup_key,password_version,
      failed_attempts,locked_until,enabled
    )
    VALUES(
      pi_id,crypt(p_plaintext_password,gen_salt('bf',12)),lk,
      greatest(1,p_password_version),0,null,true
    )
    ON CONFLICT(portal_identity_id) DO NOTHING;
  END IF;

  RETURN pi_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.provision_collective_registration(p_registration_id uuid)
RETURNS TABLE(
  participant_id uuid,
  participant_code text,
  temporary_password text,
  full_name text,
  class_name text,
  grade text,
  photo_url text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'extensions'
AS $function$
DECLARE
  v_uid uuid:=auth.uid();
  v_reg public.collective_registrations%rowtype;
  r record;
  v_password text;
  v_pi uuid;
  v_portal public.collective_portal_credentials%rowtype;
  v_pac public.participant_access_credentials%rowtype;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  SELECT * INTO v_reg
  FROM public.collective_registrations
  WHERE id=p_registration_id
    AND teacher_user_id=v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  IF v_reg.status NOT IN ('PAID','PROVISIONED') THEN
    RAISE EXCEPTION 'REGISTRATION_NOT_READY';
  END IF;

  PERFORM private.provision_collective_registration(p_registration_id);

  FOR r IN
    SELECT cp.id,cp.participant_code,cp.full_name,cp.class_name,cp.grade,
           cp.photo_url,cp.roster_student_id,pac.id AS pac_id,
           pac.password_version,pac.enabled
    FROM public.collective_participants AS cp
    LEFT JOIN public.participant_access_credentials AS pac
      ON pac.collective_participant_id=cp.id
    WHERE cp.registration_id=p_registration_id
      AND cp.managed_by_user_id=v_uid
      AND cp.status='ACTIVE'
    ORDER BY cp.created_at
  LOOP
    SELECT id INTO v_pi
    FROM public.collective_portal_identities
    WHERE owner_user_id=v_uid
      AND roster_student_id=r.roster_student_id;

    IF v_pi IS NULL THEN
      INSERT INTO public.collective_portal_identities(
        roster_student_id,owner_user_id,school_id
      )
      SELECT r.roster_student_id,v_uid,cp.school_id
      FROM public.collective_participants AS cp
      WHERE cp.id=r.id
      RETURNING id INTO v_pi;
    END IF;

    SELECT * INTO v_portal
    FROM public.collective_portal_credentials
    WHERE portal_identity_id=v_pi
    FOR UPDATE;

    v_password:='';

    IF v_portal.id IS NULL THEN
      v_password:='SK'||upper(substr(encode(gen_random_bytes(7),'hex'),1,12));

      INSERT INTO public.collective_portal_credentials(
        portal_identity_id,password_hash,password_lookup_key,password_version,
        failed_attempts,locked_until,enabled
      )
      VALUES(
        v_pi,
        crypt(v_password,gen_salt('bf',12)),
        private.collective_portal_password_lookup_key(v_password),
        1,0,null,true
      )
      RETURNING * INTO v_portal;

    ELSIF NOT v_portal.enabled THEN
      v_password:='SK'||upper(substr(encode(gen_random_bytes(7),'hex'),1,12));

      UPDATE public.collective_portal_credentials
      SET password_hash=crypt(v_password,gen_salt('bf',12)),
          password_lookup_key=private.collective_portal_password_lookup_key(v_password),
          password_version=password_version+1,
          failed_attempts=0,
          locked_until=null,
          enabled=true,
          updated_at=now()
      WHERE id=v_portal.id
      RETURNING * INTO v_portal;

      UPDATE public.collective_portal_sessions
      SET revoked_at=coalesce(revoked_at,now())
      WHERE portal_identity_id=v_pi
        AND revoked_at IS NULL;
    END IF;

    IF r.pac_id IS NULL THEN
      INSERT INTO public.participant_access_credentials(
        collective_participant_id,password_hash,password_version,
        failed_attempts,locked_until,enabled
      )
      VALUES(
        r.id,v_portal.password_hash,v_portal.password_version,0,null,true
      );
    ELSIF NOT r.enabled THEN
      UPDATE public.participant_access_credentials
      SET password_hash=v_portal.password_hash,
          password_version=v_portal.password_version,
          failed_attempts=0,
          locked_until=null,
          enabled=true,
          updated_at=now()
      WHERE id=r.pac_id;
    END IF;

    participant_id:=r.id;
    participant_code:=r.participant_code;
    temporary_password:=v_password;
    full_name:=r.full_name;
    class_name:=r.class_name;
    grade:=r.grade;
    photo_url:=r.photo_url;
    RETURN NEXT;
  END LOOP;

  UPDATE public.collective_registrations
  SET status='PROVISIONED',updated_at=now()
  WHERE id=v_reg.id
    AND status='PAID';
END;
$function$;

CREATE OR REPLACE FUNCTION public.regenerate_collective_participant_password(p_participant_id uuid)
RETURNS TABLE(participant_code text,temporary_password text,password_version integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'extensions'
AS $function$
DECLARE
  v_uid uuid:=auth.uid();
  cp public.collective_participants%rowtype;
  v_old integer;
  v_new integer;
  raw text;
  pi_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  SELECT * INTO cp
  FROM public.collective_participants
  WHERE id=p_participant_id
    AND managed_by_user_id=v_uid
    AND status='ACTIVE'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  SELECT pac.password_version INTO v_old
  FROM public.participant_access_credentials AS pac
  WHERE pac.collective_participant_id=p_participant_id
  FOR UPDATE;

  IF v_old IS NULL THEN
    RAISE EXCEPTION 'ACCESS_NOT_READY';
  END IF;

  raw:='SK'||upper(substr(encode(gen_random_bytes(7),'hex'),1,12));
  v_new:=v_old+1;

  UPDATE public.participant_access_credentials
  SET password_hash=crypt(raw,gen_salt('bf',12)),
      password_version=v_new,
      failed_attempts=0,
      locked_until=null,
      enabled=true,
      updated_at=now()
  WHERE collective_participant_id=p_participant_id;

  SELECT id INTO pi_id
  FROM public.collective_portal_identities
  WHERE owner_user_id=cp.managed_by_user_id
    AND roster_student_id=cp.roster_student_id;

  IF pi_id IS NULL THEN
    INSERT INTO public.collective_portal_identities(
      roster_student_id,owner_user_id,school_id
    )
    VALUES(cp.roster_student_id,cp.managed_by_user_id,cp.school_id)
    RETURNING id INTO pi_id;
  END IF;

  INSERT INTO public.collective_portal_credentials(
    portal_identity_id,password_hash,password_lookup_key,password_version,
    failed_attempts,locked_until,enabled
  )
  VALUES(
    pi_id,
    crypt(raw,gen_salt('bf',12)),
    private.collective_portal_password_lookup_key(raw),
    v_new,0,null,true
  )
  ON CONFLICT(portal_identity_id) DO UPDATE
  SET password_hash=excluded.password_hash,
      password_lookup_key=excluded.password_lookup_key,
      password_version=excluded.password_version,
      failed_attempts=0,
      locked_until=null,
      enabled=true,
      updated_at=now();

  UPDATE public.collective_portal_sessions
  SET revoked_at=coalesce(revoked_at,now())
  WHERE portal_identity_id=pi_id
    AND revoked_at IS NULL;

  UPDATE public.collective_access_sessions
  SET revoked_at=coalesce(revoked_at,now())
  WHERE collective_participant_id=p_participant_id
    AND revoked_at IS NULL;

  INSERT INTO public.audit_logs(
    actor_user_id,action,entity_type,entity_id,before_data,after_data
  )
  VALUES(
    v_uid,
    'COLLECTIVE_CREDENTIAL_REGENERATED',
    'collective_participant',
    p_participant_id::text,
    jsonb_build_object('password_version',v_old),
    jsonb_build_object('password_version',v_new,'previous_credential_invalidated',true)
  );

  participant_code:=cp.participant_code;
  temporary_password:=raw;
  password_version:=v_new;
  RETURN NEXT;
END;
$function$;

CREATE OR REPLACE FUNCTION public.verify_collective_portal_password(p_password text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'extensions'
AS $function$
DECLARE
  c public.collective_portal_credentials%rowtype;
  pi public.collective_portal_identities%rowtype;
  token text;
  lk text;
BEGIN
  lk:=private.collective_portal_password_lookup_key(coalesce(p_password,''));

  SELECT * INTO c
  FROM public.collective_portal_credentials
  WHERE enabled=true
    AND password_lookup_key=lk
  LIMIT 1;

  IF c.id IS NULL THEN
    RETURN jsonb_build_object('ok',false,'reason','INVALID_CREDENTIALS');
  END IF;

  IF c.locked_until IS NOT NULL AND c.locked_until>now() THEN
    RETURN jsonb_build_object('ok',false,'reason','LOCKED');
  END IF;

  IF crypt(coalesce(p_password,''),c.password_hash) IS DISTINCT FROM c.password_hash THEN
    UPDATE public.collective_portal_credentials
    SET failed_attempts=failed_attempts+1,
        locked_until=CASE WHEN failed_attempts+1>=5 THEN now()+interval '15 minutes' ELSE locked_until END,
        updated_at=now()
    WHERE id=c.id;

    RETURN jsonb_build_object('ok',false,'reason','INVALID_CREDENTIALS');
  END IF;

  SELECT * INTO pi
  FROM public.collective_portal_identities
  WHERE id=c.portal_identity_id
    AND status='ACTIVE';

  IF pi.id IS NULL THEN
    RETURN jsonb_build_object('ok',false,'reason','ACCESS_NOT_READY');
  END IF;

  UPDATE public.collective_portal_credentials
  SET failed_attempts=0,
      locked_until=null,
      last_login_at=now(),
      updated_at=now()
  WHERE id=c.id;

  token:=encode(gen_random_bytes(32),'hex');

  INSERT INTO public.collective_portal_sessions(
    portal_identity_id,credential_version,token_hash,expires_at
  )
  VALUES(
    pi.id,c.password_version,private.hash_collective_token(token),now()+interval '8 hours'
  );

  RETURN jsonb_build_object('ok',true,'portal_token',token,'portal_identity_id',pi.id);
END;
$function$;

-- Postconditions: the four existing RPC owners, kinds, search_path values and
-- EXECUTE surfaces are unchanged; only their source uses the canonical helper.
DO $stage7_portal_lookup_postflight$
DECLARE
  v_signature text;
  v_expected_acl text[];
  v_oid oid;
  v_owner oid;
  v_security_definer boolean;
  v_search_path text[];
  v_actual_acl text[];
  v_source text;
BEGIN
  FOR v_signature,v_expected_acl IN
    SELECT expected.signature,expected.execute_acl
    FROM (VALUES
      (
        'private.sync_collective_portal_credential(uuid,text,integer)',
        ARRAY['PUBLIC=X/postgres','postgres=X/postgres']::text[]
      ),
      (
        'public.provision_collective_registration(uuid)',
        ARRAY['authenticated=X/postgres','postgres=X/postgres','service_role=X/postgres']::text[]
      ),
      (
        'public.regenerate_collective_participant_password(uuid)',
        ARRAY['authenticated=X/postgres','postgres=X/postgres','service_role=X/postgres']::text[]
      ),
      (
        'public.verify_collective_portal_password(text)',
        ARRAY['anon=X/postgres','authenticated=X/postgres','postgres=X/postgres','service_role=X/postgres']::text[]
      )
    ) AS expected(signature,execute_acl)
  LOOP
    v_oid:=pg_catalog.to_regprocedure(v_signature);

    SELECT p.proowner,p.prosecdef,p.proconfig,
           pg_catalog.pg_get_functiondef(p.oid),
           COALESCE((
             SELECT pg_catalog.array_agg(
               COALESCE(grantee.rolname,'PUBLIC') || '=X/' || COALESCE(grantor.rolname,'?')
               ORDER BY COALESCE(grantee.rolname,'PUBLIC')
             )
             FROM pg_catalog.aclexplode(
               COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))
             ) AS acl_entry
             LEFT JOIN pg_catalog.pg_roles AS grantee ON grantee.oid=acl_entry.grantee
             LEFT JOIN pg_catalog.pg_roles AS grantor ON grantor.oid=acl_entry.grantor
             WHERE acl_entry.privilege_type='EXECUTE'
           ),ARRAY[]::text[])
      INTO v_owner,v_security_definer,v_search_path,v_source,v_actual_acl
    FROM pg_catalog.pg_proc AS p
    WHERE p.oid=v_oid;

    IF pg_catalog.pg_get_userbyid(v_owner) IS DISTINCT FROM 'postgres'
       OR v_security_definer IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'STAGE7_PORTAL_LOOKUP_POST_OWNER_OR_KIND_DRIFT:%',v_signature;
    END IF;

    IF v_search_path IS DISTINCT FROM ARRAY['search_path=public, private, extensions']::text[] THEN
      RAISE EXCEPTION 'STAGE7_PORTAL_LOOKUP_POST_SEARCH_PATH_DRIFT:%:%',v_signature,v_search_path;
    END IF;

    IF v_actual_acl IS DISTINCT FROM v_expected_acl THEN
      RAISE EXCEPTION 'STAGE7_PORTAL_LOOKUP_POST_ACL_DRIFT:%:%',v_signature,v_actual_acl;
    END IF;

    IF position('private.collective_portal_password_lookup_key' IN v_source)=0
       OR v_source ILIKE '%digest(left%' THEN
      RAISE EXCEPTION 'STAGE7_PORTAL_LOOKUP_FULL_PASSWORD_DERIVATION_MISSING:%',v_signature;
    END IF;
  END LOOP;

  IF pg_catalog.to_regprocedure('private.collective_portal_password_lookup_key(text)') IS NULL THEN
    RAISE EXCEPTION 'STAGE7_PORTAL_LOOKUP_HELPER_MISSING_AFTER_MIGRATION';
  END IF;

  IF pg_catalog.pg_get_userbyid((
       SELECT p.proowner FROM pg_catalog.pg_proc AS p
       WHERE p.oid=pg_catalog.to_regprocedure('private.collective_portal_password_lookup_key(text)')
     )) IS DISTINCT FROM 'postgres'
     OR EXISTS (
       SELECT 1
       FROM (VALUES ('anon'),('authenticated'),('service_role')) AS r(role_name)
       WHERE pg_catalog.has_function_privilege(
         r.role_name,
         'private.collective_portal_password_lookup_key(text)',
         'EXECUTE'
       )
     ) THEN
    RAISE EXCEPTION 'STAGE7_PORTAL_LOOKUP_HELPER_ACL_POSTCONDITION_FAILED';
  END IF;

  IF NOT (
    SELECT p.proisstrict AND p.provolatile='i' AND p.proconfig=ARRAY['search_path=""']::text[]
    FROM pg_catalog.pg_proc AS p
    WHERE p.oid=pg_catalog.to_regprocedure('private.collective_portal_password_lookup_key(text)')
  ) THEN
    RAISE EXCEPTION 'STAGE7_PORTAL_LOOKUP_HELPER_ATTRIBUTES_POSTCONDITION_FAILED';
  END IF;
END;
$stage7_portal_lookup_postflight$;

COMMIT;
