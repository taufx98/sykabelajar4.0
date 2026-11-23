-- Stage 7 full-password lookup-key collision regression.
-- PostgreSQL 17.6 schema-only disposable restore only. All rows roll back.
-- Two different temporary passwords share the legacy 8-character prefix.
-- A 5,000-password deterministic scale probe verifies full-key uniqueness.

\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE stage7_portal_lookup_key_probe (
  password text NOT NULL,
  lookup_key text NOT NULL UNIQUE
) ON COMMIT DROP;

INSERT INTO stage7_portal_lookup_key_probe(password,lookup_key)
SELECT
  'SKABCDEF'||pg_catalog.lpad(pg_catalog.to_hex(generated.n),6,'0'),
  private.collective_portal_password_lookup_key(
    'SKABCDEF'||pg_catalog.lpad(pg_catalog.to_hex(generated.n),6,'0')
  )
FROM pg_catalog.generate_series(1,5000) AS generated(n);

DO $stage7_portal_lookup_scale_probe$
DECLARE
  v_total bigint;
  v_distinct_prefixes bigint;
  v_distinct_keys bigint;
  v_key_length_min integer;
  v_key_length_max integer;
BEGIN
  SELECT count(*),
         count(DISTINCT pg_catalog.left(password,8)),
         count(DISTINCT lookup_key),
         min(pg_catalog.length(lookup_key)),
         max(pg_catalog.length(lookup_key))
    INTO v_total,v_distinct_prefixes,v_distinct_keys,v_key_length_min,v_key_length_max
  FROM stage7_portal_lookup_key_probe;

  IF v_total<>5000
     OR v_distinct_prefixes<>1
     OR v_distinct_keys<>5000
     OR v_key_length_min<>64
     OR v_key_length_max<>64 THEN
    RAISE EXCEPTION 'STAGE7_PORTAL_LOOKUP_5000_PASSWORD_SCALE_PROBE_FAILED:%:%:%:%:%',
      v_total,v_distinct_prefixes,v_distinct_keys,v_key_length_min,v_key_length_max;
  END IF;
END;
$stage7_portal_lookup_scale_probe$;

-- Seed two synthetic participants with different passwords but identical
-- first eight characters. The old prefix-only key would violate the global
-- UNIQUE(password_lookup_key) constraint on the second credential.
INSERT INTO private.app_users(id)
VALUES ('00000000-0000-4000-8000-00000000f731');

INSERT INTO public.profiles(id,full_name,account_type)
VALUES (
  '00000000-0000-4000-8000-00000000f731',
  'Stage 7 Lookup Key Synthetic Teacher',
  'teacher'
);

INSERT INTO public.teacher_rosters(id,teacher_user_id,name)
VALUES (
  '00000000-0000-4000-8000-00000000f732',
  '00000000-0000-4000-8000-00000000f731',
  'Stage 7 Lookup Key Synthetic Roster'
);

INSERT INTO public.roster_students(id,roster_id,full_name,metadata)
VALUES
  (
    '00000000-0000-4000-8000-00000000f733',
    '00000000-0000-4000-8000-00000000f732',
    'Stage 7 Lookup Key Participant A',
    '{"source":"stage7-password-lookup-collision"}'::jsonb
  ),
  (
    '00000000-0000-4000-8000-00000000f734',
    '00000000-0000-4000-8000-00000000f732',
    'Stage 7 Lookup Key Participant B',
    '{"source":"stage7-password-lookup-collision"}'::jsonb
  );

INSERT INTO public.competitions(
  id,slug,title,status,visibility,participant_mode,starts_at,ends_at
)
VALUES(
  '00000000-0000-4000-8000-00000000f735',
  'stage7-portal-full-password-lookup-synthetic',
  'Stage 7 Portal Full Password Lookup Synthetic',
  'LIVE',
  'PRIVATE',
  'COLLECTIVE_TEACHER',
  pg_catalog.clock_timestamp()-interval '1 hour',
  pg_catalog.clock_timestamp()+interval '1 hour'
);

INSERT INTO public.collective_participants(
  id,competition_id,roster_student_id,managed_by_user_id,
  participant_code,full_name,status
)
VALUES
  (
    '00000000-0000-4000-8000-00000000f736',
    '00000000-0000-4000-8000-00000000f735',
    '00000000-0000-4000-8000-00000000f733',
    '00000000-0000-4000-8000-00000000f731',
    'STAGE7-LOOKUP-A',
    'Stage 7 Lookup Key Participant A',
    'ACTIVE'
  ),
  (
    '00000000-0000-4000-8000-00000000f737',
    '00000000-0000-4000-8000-00000000f735',
    '00000000-0000-4000-8000-00000000f734',
    '00000000-0000-4000-8000-00000000f731',
    'STAGE7-LOOKUP-B',
    'Stage 7 Lookup Key Participant B',
    'ACTIVE'
  );

DO $stage7_portal_lookup_seed_credentials$
DECLARE
  v_identity_a uuid;
  v_identity_b uuid;
BEGIN
  v_identity_a:=private.sync_collective_portal_credential(
    '00000000-0000-4000-8000-00000000f736',
    'SKABCDEF000001',
    1
  );
  v_identity_b:=private.sync_collective_portal_credential(
    '00000000-0000-4000-8000-00000000f737',
    'SKABCDEF000002',
    1
  );

  IF v_identity_a IS NULL OR v_identity_b IS NULL OR v_identity_a=v_identity_b THEN
    RAISE EXCEPTION 'STAGE7_PORTAL_LOOKUP_TWO_IDENTITIES_NOT_CREATED:%:%',
      v_identity_a,v_identity_b;
  END IF;

  IF private.collective_portal_password_lookup_key('SKABCDEF000001')
       IS NOT DISTINCT FROM
     private.collective_portal_password_lookup_key('SKABCDEF000002') THEN
    RAISE EXCEPTION 'STAGE7_PORTAL_LOOKUP_FULL_PASSWORD_KEYS_COLLIDE';
  END IF;

  IF private.collective_portal_password_lookup_key('SKABCDEF000001')
       IS DISTINCT FROM pg_catalog.encode(
         extensions.digest('SKABCDEF000001','sha256'),'hex'
       )
     OR private.collective_portal_password_lookup_key('SKABCDEF000002')
       IS DISTINCT FROM pg_catalog.encode(
         extensions.digest('SKABCDEF000002','sha256'),'hex'
       ) THEN
    RAISE EXCEPTION 'STAGE7_PORTAL_LOOKUP_KEY_NOT_FULL_SHA256';
  END IF;

  IF pg_catalog.encode(extensions.digest('SKABCDEF','sha256'),'hex')
       IS DISTINCT FROM
     pg_catalog.encode(extensions.digest('SKABCDEF','sha256'),'hex') THEN
    RAISE EXCEPTION 'STAGE7_PORTAL_LOOKUP_LEGACY_PREFIX_CONTROL_INVALID';
  END IF;
END;
$stage7_portal_lookup_seed_credentials$;

DO $stage7_portal_lookup_stored_credentials$
DECLARE
  v_total integer;
  v_distinct_keys integer;
  v_distinct_prefixes integer;
BEGIN
  SELECT count(*),count(DISTINCT c.password_lookup_key),
         count(DISTINCT pg_catalog.left(p.password,8))
    INTO v_total,v_distinct_keys,v_distinct_prefixes
  FROM public.collective_portal_credentials AS c
  JOIN public.collective_portal_identities AS pi
    ON pi.id=c.portal_identity_id
  JOIN public.roster_students AS rs
    ON rs.id=pi.roster_student_id
  JOIN public.collective_participants AS cp
    ON cp.roster_student_id=rs.id
   AND cp.managed_by_user_id=pi.owner_user_id
  JOIN (
    VALUES
      ('00000000-0000-4000-8000-00000000f736'::uuid,'SKABCDEF000001'::text),
      ('00000000-0000-4000-8000-00000000f737'::uuid,'SKABCDEF000002'::text)
  ) AS p(participant_id,password)
    ON p.participant_id=cp.id
  WHERE cp.id IN (
    '00000000-0000-4000-8000-00000000f736',
    '00000000-0000-4000-8000-00000000f737'
  );

  IF v_total<>2 OR v_distinct_keys<>2 OR v_distinct_prefixes<>1 THEN
    RAISE EXCEPTION 'STAGE7_PORTAL_LOOKUP_STORED_COLLISION:%:%:%',
      v_total,v_distinct_keys,v_distinct_prefixes;
  END IF;
END;
$stage7_portal_lookup_stored_credentials$;

SET LOCAL ROLE anon;
SELECT pg_catalog.set_config('request.jwt.claims','{"role":"anon"}',true);
SELECT pg_catalog.set_config('request.jwt.claim.role','anon',true);

DO $stage7_portal_lookup_password_verification$
DECLARE
  v_a jsonb;
  v_b jsonb;
  v_wrong jsonb;
BEGIN
  v_a:=public.verify_collective_portal_password('SKABCDEF000001');
  v_b:=public.verify_collective_portal_password('SKABCDEF000002');
  v_wrong:=public.verify_collective_portal_password('SKABCDEF000003');

  IF coalesce((v_a->>'ok')::boolean,false) IS NOT TRUE
     OR coalesce((v_b->>'ok')::boolean,false) IS NOT TRUE
     OR v_a->>'portal_identity_id' IS NOT DISTINCT FROM v_b->>'portal_identity_id' THEN
    RAISE EXCEPTION 'STAGE7_PORTAL_LOOKUP_SAME_PREFIX_VALID_PASSWORDS_FAILED:%:%',v_a,v_b;
  END IF;

  IF coalesce((v_wrong->>'ok')::boolean,true) IS TRUE
     OR v_wrong->>'reason' IS DISTINCT FROM 'INVALID_CREDENTIALS' THEN
    RAISE EXCEPTION 'STAGE7_PORTAL_LOOKUP_WRONG_SUFFIX_PASSWORD_ACCEPTED:%',v_wrong;
  END IF;
END;
$stage7_portal_lookup_password_verification$;

RESET ROLE;
ROLLBACK;
