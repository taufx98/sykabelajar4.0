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
    'public.get_collective_participant_certificate(text)'
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

-- An exam access token is a child credential, not an independent login. Every
-- use must prove that both the child token and its originating portal session
-- are still active, and that the same identity/credential version is current.
CREATE OR REPLACE FUNCTION private.collective_session_participant(p_token text)
RETURNS uuid
LANGUAGE sql
STABLE
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
STABLE
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
    'public.get_collective_participant_certificate(text)'
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

COMMIT;
