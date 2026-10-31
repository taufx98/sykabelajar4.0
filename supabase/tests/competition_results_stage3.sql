-- Stage 3 result/publication contract regression checks.
-- This file is intentionally read-only and safe to run against production.
DO $stage3$
DECLARE
  v_rank_definition text;
  v_publish_definition text;
  v_public_definition text;
  v_finalize_definition text;
  v_overview_definition text;
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
    RAISE EXCEPTION 'Canonical result helper does not preserve latest-finalized, non-preview, tie ranking';
  END IF;

  SELECT pg_get_functiondef(
    'public.publish_competition_results(uuid)'::regprocedure
  ) INTO v_publish_definition;

  IF position('private.resolve_linear_exam_timeouts' IN v_publish_definition) = 0
     OR position('runtime.global_deadline <= clock_timestamp()' IN v_publish_definition) = 0
     OR position('PENDING_ATTEMPTS' IN v_publish_definition) = 0
     OR position('MISSING_CANONICAL_IDENTITY' IN v_publish_definition) = 0
     OR position('RESULT_PUBLISHED' IN v_publish_definition) = 0 THEN
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
    'public.get_organizer_competition_result_overview(uuid,integer,integer)'::regprocedure
  ) INTO v_overview_definition;

  IF position('private.current_user_can_edit_competition' IN v_overview_definition) = 0
     OR position('can_publish' IN v_overview_definition) = 0 THEN
    RAISE EXCEPTION 'Organizer overview lacks authorization or readiness summary';
  END IF;

  SELECT pg_get_functiondef(
    'public.finalize_attempt_manual(uuid,numeric,text)'::regprocedure
  ) INTO v_finalize_definition;

  IF position('v_attempt.score' IN v_finalize_definition) = 0
     OR position('automatic_score' IN v_finalize_definition) = 0
     OR position('MANUAL_GRADING_INCOMPLETE' IN v_finalize_definition) = 0
     OR position('p_score' IN v_finalize_definition) > 0 THEN
    -- p_score remains in the function signature for backward compatibility.
    -- It must not determine the persisted score.
    IF position('p_score' IN v_finalize_definition) > 0
       AND position('SET score = v_final_score' IN v_finalize_definition) > 0
       AND position('v_attempt.score' IN v_finalize_definition) > 0
       AND position('MANUAL_GRADING_INCOMPLETE' IN v_finalize_definition) > 0 THEN
      NULL;
    ELSE
      RAISE EXCEPTION 'Manual finalization is not server-calculated or does not require completed manual items';
    END IF;
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
