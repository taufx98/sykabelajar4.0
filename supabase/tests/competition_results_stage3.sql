-- Stage 3 result/publication contract regression checks.
-- This file is intentionally read-only and safe to run after the migration.
DO $stage3$
DECLARE
  v_rank_definition text;
  v_publish_definition text;
  v_public_definition text;
  v_finalize_definition text;
  v_overview_definition text;
  v_limits_definition text;
  v_trigger_definition text;
  v_ai_definition text;
  v_canonical_rank_definition text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'grading_items'
      AND column_name = 'automatic_score'
  ) THEN
    RAISE EXCEPTION 'Stage 3 automatic_score column is missing';
  END IF;

  SELECT pg_get_functiondef(
    'private.canonical_competition_results(uuid)'::regprocedure
  ) INTO v_rank_definition;

  IF position('DISTINCT ON (a.canonical_participant_id)' IN v_rank_definition) = 0
     OR position('FINALIZED' IN v_rank_definition) = 0
     OR position('is_preview = false' IN v_rank_definition) = 0
     OR position('rank() OVER' IN v_rank_definition) = 0 THEN
    RAISE EXCEPTION 'Canonical results must use latest finalized non-preview attempts and tie-aware ranking';
  END IF;

  SELECT pg_get_functiondef(
    'private.capture_automatic_grading_score()'::regprocedure
  ) INTO v_trigger_definition;

  IF position('automatic_score' IN v_trigger_definition) = 0
     OR position('grader_id' IN v_trigger_definition) = 0
     OR position('AI Similarity Grade:' IN v_trigger_definition) = 0
     OR position('current_user = ''postgres''' IN v_trigger_definition) = 0
     OR position('exam_attempt_runtime runtime' IN v_trigger_definition) = 0
     OR position('AUTOMATIC_SCORE_IS_SERVER_MANAGED' IN v_trigger_definition) = 0
     OR position('ELSIF NEW.grader_id IS NULL' IN v_trigger_definition) > 0 THEN
    RAISE EXCEPTION 'Automatic AI score snapshot trigger is incomplete or not server-controlled';
  END IF;

  IF has_table_privilege('authenticated', 'public.grading_items', 'INSERT')
     OR has_table_privilege('authenticated', 'public.grading_items', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.grading_items', 'DELETE')
     OR has_table_privilege('authenticated', 'public.grading_items', 'TRUNCATE')
     OR has_table_privilege('authenticated', 'public.grading_items', 'TRIGGER')
     OR has_table_privilege('anon', 'public.grading_items', 'SELECT')
     OR has_table_privilege('anon', 'public.grading_items', 'INSERT')
     OR has_table_privilege('anon', 'public.grading_items', 'UPDATE')
     OR has_table_privilege('anon', 'public.grading_items', 'DELETE')
     OR has_table_privilege('anon', 'public.grading_items', 'TRUNCATE')
     OR has_table_privilege('anon', 'public.grading_items', 'TRIGGER') THEN
    RAISE EXCEPTION 'PostgREST roles must use authorized grading RPCs, not direct table access';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.grading_items', 'SELECT') THEN
    RAISE EXCEPTION 'Organizer grading UI needs read access to grading items';
  END IF;

  SELECT pg_get_functiondef(
    'public.get_attempt_grading_limits(uuid)'::regprocedure
  ) INTO v_limits_definition;

  IF position('exam_attempt_questions' IN v_limits_definition) = 0
     OR position('points_snapshot' IN v_limits_definition) = 0
     OR position('question_snapshot' IN v_limits_definition) = 0
     OR position('ai_assessment_enabled' IN v_limits_definition) = 0
     OR position('answer_key_snapshot->>''answer_key''' IN v_limits_definition) > 0
     OR position('private.current_user_can_edit_competition' IN v_limits_definition) = 0 THEN
    RAISE EXCEPTION 'Grading-limit RPC does not use attempt snapshots or organizer authorization';
  END IF;

  IF has_table_privilege('authenticated', 'public.exam_attempt_questions', 'SELECT') THEN
    RAISE EXCEPTION 'Authenticated clients must not read exam attempt snapshots directly';
  END IF;
  IF has_function_privilege('anon', 'public.get_attempt_grading_limits(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon must not execute grading-limit RPC';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.get_attempt_grading_limits(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated organizer UI needs grading-limit RPC';
  END IF;

  SELECT pg_get_functiondef(
    'public.grade_essay_similarity(uuid,uuid)'::regprocedure
  ) INTO v_ai_definition;

  IF position('answer_key_snapshot' IN v_ai_definition) = 0
     OR position('v_question_points' IN v_ai_definition) = 0
     OR position('v_similarity' IN v_ai_definition) = 0
     OR position('v_ai_enabled' IN v_ai_definition) = 0
     OR position('AI_ASSESSMENT_DISABLED' IN v_ai_definition) = 0
     OR position('question_bank_id' IN v_ai_definition) = 0
     OR position('exam_attempt_runtime' IN v_ai_definition) = 0
     OR position('RETURN v_similarity' IN v_ai_definition) = 0 THEN
    RAISE EXCEPTION 'AI essay grading must use answer-key snapshots and save weighted points';
  END IF;

  SELECT pg_get_functiondef(
    'public.publish_competition_results(uuid)'::regprocedure
  ) INTO v_publish_definition;

  IF position('private.resolve_linear_exam_timeouts' IN v_publish_definition) = 0
     OR position('runtime.global_deadline <= clock_timestamp()' IN v_publish_definition) = 0
     OR position('PENDING_ATTEMPTS' IN v_publish_definition) = 0
     OR position('LINEAR_TIMEOUT_RECONCILIATION_STALLED' IN v_publish_definition) = 0
     OR position('v_runtime_position = v_previous_position' IN v_publish_definition) = 0
     OR position('MISSING_CANONICAL_IDENTITY' IN v_publish_definition) = 0
     OR position('RESULT_PUBLISHED' IN v_publish_definition) = 0
     OR position('a.status::text IN (''SUBMITTED'', ''GRADING'')' IN v_publish_definition) = 0 THEN
    RAISE EXCEPTION 'Publication does not reconcile expired linear attempts and enforce readiness';
  END IF;

  SELECT pg_get_functiondef(
    'public.get_public_competition_results(text,integer,integer)'::regprocedure
  ) INTO v_public_definition;

  IF position('visibility = ''PUBLIC''' IN v_public_definition) = 0
     OR position('RESULT_PUBLISHED' IN v_public_definition) = 0
     OR position('ARCHIVED' IN v_public_definition) = 0
     OR position('private.canonical_competition_results' IN v_public_definition) = 0 THEN
    RAISE EXCEPTION 'Public results are not gated by visibility/publication status or canonical ranking';
  END IF;

  SELECT pg_get_functiondef(
    'private.canonical_competition_rank(uuid,uuid)'::regprocedure
  ) INTO v_canonical_rank_definition;

  IF position('distinct on (a.canonical_participant_id)' IN lower(v_canonical_rank_definition)) = 0
     OR position('finalized' IN lower(v_canonical_rank_definition)) = 0
     OR position('is_preview = false' IN lower(v_canonical_rank_definition)) = 0
     OR position('rank() over' IN lower(v_canonical_rank_definition)) = 0 THEN
    RAISE EXCEPTION 'Stage 1 participant rank lookup must keep canonical latest-finalized tie ranking';
  END IF;

  SELECT pg_get_functiondef(
    'public.get_organizer_competition_result_overview(uuid,integer,integer)'::regprocedure
  ) INTO v_overview_definition;

  IF position('private.current_user_can_edit_competition' IN v_overview_definition) = 0
     OR position('can_publish' IN v_overview_definition) = 0
     OR position('a.status::text IN (''SUBMITTED'', ''GRADING'')' IN v_overview_definition) = 0 THEN
    RAISE EXCEPTION 'Organizer overview lacks authorization, readiness summary or manual grading scope';
  END IF;

  SELECT pg_get_functiondef(
    'public.finalize_attempt_manual(uuid,numeric,text)'::regprocedure
  ) INTO v_finalize_definition;

  IF position('v_attempt.score' IN v_finalize_definition) = 0
     OR position('automatic_score' IN v_finalize_definition) = 0
     OR position('MANUAL_GRADING_INCOMPLETE' IN v_finalize_definition) = 0
     OR position('SET score = v_final_score' IN v_finalize_definition) = 0
     OR position('SET score = p_score' IN v_finalize_definition) > 0
     OR position('MANUAL_GRADING_ITEMS_NOT_FOUND' IN v_finalize_definition) > 0 THEN
    RAISE EXCEPTION 'Manual finalization must preserve automatic base points and calculate final score server-side';
  END IF;

  IF has_function_privilege(
    'anon',
    'public.get_organizer_competition_result_overview(uuid,integer,integer)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'anon must not execute organizer result overview';
  END IF;
  IF has_function_privilege(
    'anon',
    'public.publish_competition_results(uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'anon must not publish competition results';
  END IF;
  IF NOT has_function_privilege(
    'anon',
    'public.get_public_competition_results(text,integer,integer)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'anon must be able to read published public results';
  END IF;
END;
$stage3$;
