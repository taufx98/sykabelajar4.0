-- Stage 2 Lomba Saya dashboard contract checks.
-- Run after applying 20261031140000_stage_2_my_competitions_dashboard.sql.

DO $contract$
DECLARE
  v_definition text;
BEGIN
  IF to_regprocedure('public.list_my_competition_dashboard()') IS NULL THEN
    RAISE EXCEPTION 'Lomba Saya RPC is missing';
  END IF;

  IF NOT has_function_privilege(
    'authenticated',
    'public.list_my_competition_dashboard()',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Authenticated users cannot read their own competition dashboard';
  END IF;

  IF has_function_privilege(
    'anon',
    'public.list_my_competition_dashboard()',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Anonymous users must not read a private competition dashboard';
  END IF;

  SELECT pg_get_functiondef('public.list_my_competition_dashboard()'::regprocedure)
  INTO v_definition;

  IF position('auth.uid()' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Dashboard RPC is not scoped to the authenticated user';
  END IF;

  IF position('private.canonical_competition_rank' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Dashboard results do not use canonical participant ranking';
  END IF;

  IF position('collective_participants' IN v_definition) = 0
     OR position('cp.user_id' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Dashboard does not include only the signed-in user''s claimed collective entries';
  END IF;

  IF position('RESULT_PUBLISHED' IN v_definition) = 0
     OR position('ARCHIVED' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Dashboard score visibility is not tied to published result states';
  END IF;

  IF position('is_preview' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Dashboard attempt history does not exclude preview attempts';
  END IF;
END;
$contract$;

-- Classification behavior contract shared by the page:
-- pending/rejected registrations remain visible, results require a finalized
-- attempt and a published competition, and collective entries keep their own
-- identity type even when claimed by a full account.
DO $classification$
DECLARE
  v_statuses text[];
BEGIN
  SELECT array_agg(status ORDER BY expected_order)
  INTO v_statuses
  FROM (
    SELECT
      CASE
        WHEN registration_status = 'PENDING' AND has_participant = false THEN 'PENDING'
        WHEN registration_status = 'REJECTED' AND has_participant = false THEN 'REJECTED'
        WHEN result_published = true AND attempt_status = 'FINALIZED' THEN 'RESULT_PUBLISHED'
        WHEN attempt_status IN ('IN_PROGRESS', 'RUNNING') THEN 'IN_PROGRESS'
        WHEN attempt_status IN ('SUBMITTED', 'GRADING', 'EXPIRED') THEN 'WAITING_RESULT'
        WHEN attempt_status = 'FINALIZED' AND competition_status IN ('SUBMISSION_CLOSED', 'GRADING') THEN 'WAITING_RESULT'
        WHEN competition_status IN ('SUBMISSION_CLOSED', 'GRADING') THEN 'WAITING_RESULT'
        WHEN competition_status = 'LIVE' THEN 'IN_PROGRESS'
        ELSE 'REGISTERED'
      END AS status,
      expected_order
    FROM (
      VALUES
        ('PENDING', false, false, 'PENDING', 'REGISTRATION_OPEN', 1),
        ('REJECTED', false, false, 'REJECTED', 'REGISTRATION_OPEN', 2),
        ('ACTIVE', true, false, 'FINALIZED', 'GRADING', 3),
        ('ACTIVE', true, true, 'FINALIZED', 'RESULT_PUBLISHED', 4),
        ('ACTIVE', true, false, 'IN_PROGRESS', 'LIVE', 5),
        ('ACTIVE', true, false, null::text, 'LIVE', 6)
    ) AS fixture(
      registration_status,
      has_participant,
      result_published,
      attempt_status,
      competition_status,
      expected_order
    )
  ) classified;

  IF v_statuses IS DISTINCT FROM ARRAY[
    'PENDING',
    'REJECTED',
    'WAITING_RESULT',
    'RESULT_PUBLISHED',
    'IN_PROGRESS',
    'IN_PROGRESS'
  ]::text[] THEN
    RAISE EXCEPTION 'Lomba Saya status classification regression: %', v_statuses;
  END IF;
END;
$classification$;
