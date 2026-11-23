-- Stage 7: bind participant access tokens to their active portal parent session.
-- This migration changes function definitions only; it does not rewrite rows,
-- revoke existing credentials, migrate identities, or change table/RPC grants.
-- Apply first to the schema-only PostgreSQL 17.6 disposable restore. Production
-- remains NO-GO until the complete Stage 7 acceptance and separate cutover approval.

BEGIN;

DO $stage7_portal_parent_preflight$
DECLARE
  v_signature text;
  v_oid oid;
  v_owner text;
  v_is_definer boolean;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'private.collective_session_participant(text)',
    'private.collective_portal_identity(text)',
    'public.open_collective_competition_session(text,uuid,text)',
    'public.revoke_collective_portal_session(text)',
    'public.get_collective_participant_certificate(text)',
    'public.list_collective_portal_competitions(text)',
    'public.revoke_collective_access_session(text)',
    'public.verify_collective_portal_password(text)'
  ] LOOP
    v_oid := pg_catalog.to_regprocedure(v_signature);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'STAGE7_PORTAL_PARENT_FUNCTION_MISSING:%',v_signature;
    END IF;
    SELECT pg_catalog.pg_get_userbyid(p.proowner),p.prosecdef
      INTO v_owner,v_is_definer
    FROM pg_catalog.pg_proc p
    WHERE p.oid=v_oid;
    IF v_owner IS DISTINCT FROM 'postgres' OR v_is_definer IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'STAGE7_PORTAL_PARENT_FUNCTION_OWNER_OR_KIND_DRIFT:%:%:%',
        v_signature,v_owner,v_is_definer;
    END IF;
  END LOOP;

  IF NOT pg_catalog.has_function_privilege('anon','public.open_collective_competition_session(text,uuid,text)','EXECUTE')
     OR NOT pg_catalog.has_function_privilege('authenticated','public.open_collective_competition_session(text,uuid,text)','EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role','public.open_collective_competition_session(text,uuid,text)','EXECUTE')
     OR NOT pg_catalog.has_function_privilege('anon','public.revoke_collective_portal_session(text)','EXECUTE')
     OR NOT pg_catalog.has_function_privilege('authenticated','public.revoke_collective_portal_session(text)','EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role','public.revoke_collective_portal_session(text)','EXECUTE')
     OR NOT pg_catalog.has_function_privilege('anon','public.get_collective_participant_certificate(text)','EXECUTE')
     OR NOT pg_catalog.has_function_privilege('authenticated','public.get_collective_participant_certificate(text)','EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role','public.get_collective_participant_certificate(text)','EXECUTE') THEN
    RAISE EXCEPTION 'STAGE7_PORTAL_PARENT_PUBLIC_RPC_EXECUTE_BASELINE_MISSING';
  END IF;
END;
$stage7_portal_parent_preflight$;


DO $stage7_portal_search_path_preflight$
DECLARE
  v_signature text;
  v_expected_md5 text;
  v_expected_search_path text;
  v_oid oid;
  v_owner oid;
  v_actual_md5 text;
  v_actual_search_path text[];
  v_acl aclitem[];
BEGIN
  FOR v_signature,v_expected_md5,v_expected_search_path IN
    SELECT expected.signature,expected.definition_md5,expected.search_path_setting
    FROM (VALUES
      ('public.list_collective_portal_competitions(text)','ea78645f37913438f2f0e300b1bdcdf9','search_path=public, private'),
      ('public.revoke_collective_access_session(text)','1e5abe9a8d31beef996ce1091045de2d','search_path=public, private, pg_catalog'),
      ('public.verify_collective_portal_password(text)','d85f7c2a1d194151663b4c536c064dad','search_path=public, private, extensions')
    ) AS expected(signature,definition_md5,search_path_setting)
  LOOP
    v_oid := pg_catalog.to_regprocedure(v_signature);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'STAGE7_PORTAL_RPC_MISSING:%',v_signature;
    END IF;
    SELECT pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid)),p.proconfig,p.proacl,p.proowner
      INTO v_actual_md5,v_actual_search_path,v_acl,v_owner
    FROM pg_catalog.pg_proc AS p
    WHERE p.oid=v_oid;
    IF v_actual_md5 IS DISTINCT FROM v_expected_md5 THEN
      RAISE EXCEPTION 'STAGE7_PORTAL_RPC_DEFINITION_DRIFT:%:%',v_signature,v_actual_md5;
    END IF;
    IF v_actual_search_path IS DISTINCT FROM ARRAY[v_expected_search_path]::text[] THEN
      RAISE EXCEPTION 'STAGE7_PORTAL_RPC_SEARCH_PATH_DRIFT:%:%',v_signature,v_actual_search_path;
    END IF;
    IF NOT pg_catalog.has_function_privilege('anon',v_oid,'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('authenticated',v_oid,'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('service_role',v_oid,'EXECUTE')
       OR EXISTS (
         SELECT 1
         FROM pg_catalog.aclexplode(coalesce(v_acl,pg_catalog.acldefault('f',v_owner))) AS a
         WHERE a.grantee=0 AND a.privilege_type='EXECUTE'
       ) THEN
      RAISE EXCEPTION 'STAGE7_PORTAL_RPC_PUBLIC_EXECUTE_BASELINE_DRIFT:%',v_signature;
    END IF;
  END LOOP;
END;
$stage7_portal_search_path_preflight$;

-- An exam access token is a child credential, not an independent login. Every
-- use must prove that both the child token and its originating portal session
-- are still active, and that the same identity/credential version is current.
CREATE OR REPLACE FUNCTION private.collective_session_participant(p_token text)
RETURNS uuid
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT s.collective_participant_id
  FROM public.collective_access_sessions AS s
  JOIN public.collective_portal_sessions AS ps
    ON ps.id=s.portal_session_id
  JOIN public.collective_portal_identities AS pi
    ON pi.id=ps.portal_identity_id
  JOIN public.collective_portal_credentials AS pc
    ON pc.portal_identity_id=pi.id
  JOIN public.collective_participants AS cp
    ON cp.id=s.collective_participant_id
  WHERE s.token_hash=private.hash_collective_token(pg_catalog.btrim(coalesce(p_token,'')))
    AND s.revoked_at IS NULL
    AND s.expires_at>pg_catalog.now()
    AND s.session_type='COMPETITION'
    AND s.collective_participant_id IS NOT NULL
    AND s.portal_session_id IS NOT NULL
    AND ps.revoked_at IS NULL
    AND ps.expires_at>pg_catalog.now()
    AND pi.status='ACTIVE'
    AND pc.enabled IS TRUE
    AND pc.password_version=ps.credential_version
    AND cp.status='ACTIVE'
    AND cp.roster_student_id=pi.roster_student_id
    AND cp.managed_by_user_id=pi.owner_user_id
    AND cp.competition_id=s.competition_id
  ORDER BY s.created_at DESC
  LIMIT 1;
$function$;

-- A portal token is valid only while its identity and matching credential
-- version remain active. open_collective_competition_session rechecks these
-- values before issuing a child token.
CREATE OR REPLACE FUNCTION private.collective_portal_identity(p_token text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT ps.portal_identity_id
  FROM public.collective_portal_sessions AS ps
  JOIN public.collective_portal_identities AS pi
    ON pi.id=ps.portal_identity_id
  JOIN public.collective_portal_credentials AS pc
    ON pc.portal_identity_id=pi.id
  WHERE ps.token_hash=private.hash_collective_token(pg_catalog.btrim(coalesce(p_token,'')))
    AND ps.revoked_at IS NULL
    AND ps.expires_at>pg_catalog.now()
    AND pi.status='ACTIVE'
    AND pc.enabled IS TRUE
    AND pc.password_version=ps.credential_version
  ORDER BY ps.created_at DESC
  LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.open_collective_competition_session(
  p_portal_token text,
  p_competition_id uuid,
  p_participant_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_identity_id uuid := private.collective_portal_identity(p_portal_token);
  v_participant public.collective_participants%rowtype;
  v_portal_session public.collective_portal_sessions%rowtype;
  v_access_token text;
  v_access_expiry timestamptz;
BEGIN
  IF v_identity_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'reason','PORTAL_SESSION_INVALID');
  END IF;

  SELECT ps.*
    INTO v_portal_session
  FROM public.collective_portal_sessions AS ps
  JOIN public.collective_portal_credentials AS pc
    ON pc.portal_identity_id=ps.portal_identity_id
   AND pc.enabled IS TRUE
   AND pc.password_version=ps.credential_version
  JOIN public.collective_portal_identities AS pi
    ON pi.id=ps.portal_identity_id
   AND pi.status='ACTIVE'
  WHERE ps.id IS NOT NULL
    AND ps.portal_identity_id=v_identity_id
    AND ps.token_hash=private.hash_collective_token(pg_catalog.btrim(coalesce(p_portal_token,'')))
    AND ps.revoked_at IS NULL
    AND ps.expires_at>pg_catalog.now()
  ORDER BY ps.created_at DESC
  LIMIT 1;

  IF v_portal_session.id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'reason','PORTAL_SESSION_INVALID');
  END IF;

  IF p_competition_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'reason','COMPETITION_REQUIRED');
  END IF;

  SELECT cp.*
    INTO v_participant
  FROM public.collective_participants AS cp
  JOIN public.collective_portal_identities AS pi
    ON pi.roster_student_id=cp.roster_student_id
   AND pi.owner_user_id=cp.managed_by_user_id
  WHERE pi.id=v_identity_id
    AND pi.status='ACTIVE'
    AND cp.competition_id=p_competition_id
    AND pg_catalog.upper(cp.participant_code)=pg_catalog.upper(pg_catalog.btrim(coalesce(p_participant_code,'')))
    AND cp.status='ACTIVE'
  LIMIT 1;

  IF v_participant.id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'reason','INVALID_PARTICIPANT_CODE');
  END IF;

  v_access_token := pg_catalog.encode(extensions.gen_random_bytes(32),'hex');
  v_access_expiry := LEAST(v_portal_session.expires_at,pg_catalog.now()+interval '8 hours');

  INSERT INTO public.collective_access_sessions(
    collective_participant_id,competition_id,session_type,portal_session_id,token_hash,expires_at
  )
  VALUES(
    v_participant.id,
    v_participant.competition_id,
    'COMPETITION',
    v_portal_session.id,
    private.hash_collective_token(v_access_token),
    v_access_expiry
  );

  UPDATE public.collective_portal_sessions
  SET last_seen_at=pg_catalog.clock_timestamp()
  WHERE id=v_portal_session.id;

  RETURN pg_catalog.jsonb_build_object(
    'ok',true,
    'access_token',v_access_token,
    'participant_id',v_participant.id,
    'competition_id',v_participant.competition_id,
    'participant_code',v_participant.participant_code,
    'full_name',v_participant.full_name,
    'class_name',v_participant.class_name,
    'grade',v_participant.grade,
    'school_id',v_participant.school_id,
    'photo_url',v_participant.photo_url,
    'user_id',v_participant.user_id
  );
END;
$function$;

-- Revoke parent and all child tokens atomically. Repeated requests remain safe:
-- the function still cleans any surviving child even if the parent was revoked
-- by an earlier path, while its boolean return retains the prior active-state
-- signal (true only when this call changed an active parent).
CREATE OR REPLACE FUNCTION public.revoke_collective_portal_session(p_portal_token text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_session_id uuid;
  v_was_active boolean;
BEGIN
  SELECT ps.id,(ps.revoked_at IS NULL)
    INTO v_session_id,v_was_active
  FROM public.collective_portal_sessions AS ps
  WHERE ps.token_hash=private.hash_collective_token(pg_catalog.btrim(coalesce(p_portal_token,'')))
  ORDER BY ps.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_session_id IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.collective_portal_sessions
  SET revoked_at=coalesce(revoked_at,pg_catalog.clock_timestamp()),
      last_seen_at=pg_catalog.clock_timestamp()
  WHERE id=v_session_id;

  UPDATE public.collective_access_sessions
  SET revoked_at=coalesce(revoked_at,pg_catalog.clock_timestamp()),
      last_seen_at=pg_catalog.clock_timestamp()
  WHERE portal_session_id=v_session_id
    AND revoked_at IS NULL;

  RETURN v_was_active;
END;
$function$;

-- Published collective certificates remain publicly verifiable only through
-- the separate certificate verification code. The participant endpoint must
-- require a live child token and its live parent portal/credential boundary.
CREATE OR REPLACE FUNCTION public.get_collective_participant_certificate(p_access_token text)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT pg_catalog.jsonb_build_object(
    'ok',true,
    'has_certificate',true,
    'certificate_id',cc.id,
    'verification_code',cc.verification_code,
    'serial_number',cc.serial_number,
    'status',cc.status,
    'certificate_url',cc.certificate_url,
    'issued_at',cc.issued_at,
    'competition_title',c.title
  )
  FROM public.collective_access_sessions AS s
  JOIN public.collective_participants AS cp
    ON cp.id=s.collective_participant_id
  JOIN public.collective_certificates AS cc
    ON cc.collective_participant_id=cp.id
   AND cc.competition_id=s.competition_id
   AND cc.status='PUBLISHED'
  JOIN public.competitions AS c
    ON c.id=cc.competition_id
  WHERE s.token_hash=private.hash_collective_token(pg_catalog.btrim(coalesce(p_access_token,'')))
    AND s.revoked_at IS NULL
    AND s.expires_at>pg_catalog.now()
    AND s.portal_session_id IS NOT NULL
    AND s.collective_participant_id=private.collective_session_participant(p_access_token)
  LIMIT 1;
$function$;


-- Pin the remaining portal RPCs to an empty search_path. Their behavior and
-- EXECUTE ACLs are preserved; every non-catalog dependency is schema-qualified.
CREATE OR REPLACE FUNCTION public.list_collective_portal_competitions(p_portal_token text)
RETURNS TABLE(
  participant_id uuid,
  competition_id uuid,
  competition_title text,
  competition_status text,
  starts_at timestamp with time zone,
  ends_at timestamp with time zone,
  participant_code text,
  participant_status text
)
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT cp.id,c.id,c.title,c.status,c.starts_at,c.ends_at,cp.participant_code,cp.status
  FROM public.collective_portal_sessions AS ps
  JOIN public.collective_portal_identities AS pi
    ON pi.id=ps.portal_identity_id
  JOIN public.collective_participants AS cp
    ON cp.roster_student_id=pi.roster_student_id
   AND cp.managed_by_user_id=pi.owner_user_id
  JOIN public.competitions AS c
    ON c.id=cp.competition_id
  JOIN public.collective_portal_credentials AS pc
    ON pc.portal_identity_id=pi.id
   AND pc.enabled IS TRUE
   AND pc.password_version=ps.credential_version
  WHERE ps.token_hash=private.hash_collective_token(pg_catalog.btrim(coalesce(p_portal_token,'')))
    AND ps.revoked_at IS NULL
    AND ps.expires_at>pg_catalog.now()
    AND pi.status='ACTIVE'
    AND cp.status='ACTIVE'
  ORDER BY coalesce(c.starts_at,c.created_at),c.id;
$function$;

CREATE OR REPLACE FUNCTION public.revoke_collective_access_session(p_access_token text)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_hash text := private.hash_collective_token(pg_catalog.btrim(coalesce(p_access_token,'')));
  v_updated integer;
BEGIN
  IF pg_catalog.length(pg_catalog.btrim(coalesce(p_access_token,'')))<16 THEN
    RETURN false;
  END IF;
  UPDATE public.collective_access_sessions
  SET revoked_at=coalesce(revoked_at,pg_catalog.now()),
      last_seen_at=pg_catalog.now()
  WHERE token_hash=v_hash
    AND revoked_at IS NULL;
  GET DIAGNOSTICS v_updated=ROW_COUNT;
  RETURN v_updated>0;
END;
$function$;

CREATE OR REPLACE FUNCTION public.verify_collective_portal_password(p_password text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  c public.collective_portal_credentials%rowtype;
  pi public.collective_portal_identities%rowtype;
  token text;
  lk text;
BEGIN
  lk := pg_catalog.encode(
    extensions.digest(
      pg_catalog.left(pg_catalog.btrim(coalesce(p_password,'')),8),
      'sha256'
    ),
    'hex'
  );
  SELECT *
    INTO c
  FROM public.collective_portal_credentials
  WHERE enabled IS TRUE
    AND password_lookup_key=lk
  LIMIT 1;
  IF c.id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'reason','INVALID_CREDENTIALS');
  END IF;
  IF c.locked_until IS NOT NULL AND c.locked_until>pg_catalog.now() THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'reason','LOCKED');
  END IF;
  IF extensions.crypt(coalesce(p_password,''),c.password_hash) IS DISTINCT FROM c.password_hash THEN
    UPDATE public.collective_portal_credentials
    SET failed_attempts=failed_attempts+1,
        locked_until=CASE
          WHEN failed_attempts+1>=5 THEN pg_catalog.now()+interval '15 minutes'
          ELSE locked_until
        END,
        updated_at=pg_catalog.now()
    WHERE id=c.id;
    RETURN pg_catalog.jsonb_build_object('ok',false,'reason','INVALID_CREDENTIALS');
  END IF;
  SELECT *
    INTO pi
  FROM public.collective_portal_identities
  WHERE id=c.portal_identity_id
    AND status='ACTIVE';
  IF pi.id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'reason','ACCESS_NOT_READY');
  END IF;
  UPDATE public.collective_portal_credentials
  SET failed_attempts=0,
      locked_until=NULL,
      last_login_at=pg_catalog.now(),
      updated_at=pg_catalog.now()
  WHERE id=c.id;
  token := pg_catalog.encode(extensions.gen_random_bytes(32),'hex');
  INSERT INTO public.collective_portal_sessions(
    portal_identity_id,credential_version,token_hash,expires_at
  )
  VALUES(
    pi.id,c.password_version,private.hash_collective_token(token),
    pg_catalog.now()+interval '8 hours'
  );
  RETURN pg_catalog.jsonb_build_object('ok',true,'portal_token',token,'portal_identity_id',pi.id);
END;
$function$;

DO $stage7_portal_parent_postflight$
DECLARE
  v_signature text;
  v_oid oid;
  v_owner text;
  v_is_definer boolean;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'private.collective_session_participant(text)',
    'private.collective_portal_identity(text)',
    'public.open_collective_competition_session(text,uuid,text)',
    'public.revoke_collective_portal_session(text)',
    'public.get_collective_participant_certificate(text)',
    'public.list_collective_portal_competitions(text)',
    'public.revoke_collective_access_session(text)',
    'public.verify_collective_portal_password(text)'
  ] LOOP
    v_oid := pg_catalog.to_regprocedure(v_signature);
    SELECT pg_catalog.pg_get_userbyid(p.proowner),p.prosecdef
      INTO v_owner,v_is_definer
    FROM pg_catalog.pg_proc p
    WHERE p.oid=v_oid;
    IF v_owner IS DISTINCT FROM 'postgres' OR v_is_definer IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'STAGE7_PORTAL_PARENT_POSTCONDITION_OWNER_OR_KIND_DRIFT:%:%:%',
        v_signature,v_owner,v_is_definer;
    END IF;
  END LOOP;

  IF NOT pg_catalog.has_function_privilege('anon','public.open_collective_competition_session(text,uuid,text)','EXECUTE')
     OR NOT pg_catalog.has_function_privilege('authenticated','public.open_collective_competition_session(text,uuid,text)','EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role','public.open_collective_competition_session(text,uuid,text)','EXECUTE')
     OR NOT pg_catalog.has_function_privilege('anon','public.revoke_collective_portal_session(text)','EXECUTE')
     OR NOT pg_catalog.has_function_privilege('authenticated','public.revoke_collective_portal_session(text)','EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role','public.revoke_collective_portal_session(text)','EXECUTE')
     OR NOT pg_catalog.has_function_privilege('anon','public.get_collective_participant_certificate(text)','EXECUTE')
     OR NOT pg_catalog.has_function_privilege('authenticated','public.get_collective_participant_certificate(text)','EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role','public.get_collective_participant_certificate(text)','EXECUTE') THEN
    RAISE EXCEPTION 'STAGE7_PORTAL_PARENT_EXECUTE_PRIVILEGE_DRIFT';
  END IF;
END;
$stage7_portal_parent_postflight$;


DO $stage7_portal_search_path_postflight$
DECLARE
  v_signature text;
  v_oid oid;
  v_path text[];
  v_owner oid;
  v_acl aclitem[];
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.list_collective_portal_competitions(text)',
    'public.revoke_collective_access_session(text)',
    'public.verify_collective_portal_password(text)'
  ] LOOP
    v_oid := pg_catalog.to_regprocedure(v_signature);
    SELECT p.proconfig,p.proowner,p.proacl
      INTO v_path,v_owner,v_acl
    FROM pg_catalog.pg_proc AS p
    WHERE p.oid=v_oid;
    IF v_path IS DISTINCT FROM ARRAY['search_path=""']::text[] THEN
      RAISE EXCEPTION 'STAGE7_PORTAL_RPC_EMPTY_SEARCH_PATH_POSTCONDITION_FAILED:%:%',v_signature,v_path;
    END IF;
    IF NOT pg_catalog.has_function_privilege('anon',v_oid,'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('authenticated',v_oid,'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('service_role',v_oid,'EXECUTE')
       OR EXISTS (
         SELECT 1
         FROM pg_catalog.aclexplode(coalesce(v_acl,pg_catalog.acldefault('f',v_owner))) AS a
         WHERE a.grantee=0 AND a.privilege_type='EXECUTE'
       ) THEN
      RAISE EXCEPTION 'STAGE7_PORTAL_RPC_EXECUTE_ACL_POSTCONDITION_DRIFT:%',v_signature;
    END IF;
  END LOOP;
END;
$stage7_portal_search_path_postflight$;

COMMIT;
