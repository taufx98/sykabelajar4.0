-- Stage 3: canonical competition results, safe manual score finalization and
-- explicit publication readiness. This migration is append-only and does not
-- rewrite official participant/attempt records.
ALTER TABLE public.grading_items
  ADD COLUMN IF NOT EXISTS automatic_score numeric;

-- Preserve the score originally awarded by automatic essay similarity grading.
-- Manual overrides can then be applied as a delta without double-counting the
-- automatic points already included in attempts.score.
UPDATE public.grading_items
SET automatic_score = score
WHERE automatic_score IS NULL
  AND feedback LIKE 'AI Similarity Grade:%';

CREATE OR REPLACE FUNCTION private.capture_automatic_grading_score()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.automatic_score IS NULL
       AND coalesce(NEW.feedback, '') LIKE 'AI Similarity Grade:%' THEN
      NEW.automatic_score := NEW.score;
    END IF;
  ELSE
    IF OLD.automatic_score IS NOT NULL THEN
      NEW.automatic_score := OLD.automatic_score;
    ELSIF NEW.automatic_score IS NULL
       AND coalesce(NEW.feedback, '') LIKE 'AI Similarity Grade:%' THEN
      NEW.automatic_score := NEW.score;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.capture_automatic_grading_score()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_capture_automatic_grading_score
  ON public.grading_items;
CREATE TRIGGER trg_capture_automatic_grading_score
BEFORE INSERT OR UPDATE OF score, feedback
ON public.grading_items
FOR EACH ROW
EXECUTE FUNCTION private.capture_automatic_grading_score();

-- Manual grade limits must use the exact question snapshot for linear exams.
-- The source question may be edited after an attempt has already started.
CREATE OR REPLACE FUNCTION public.save_manual_grading_item(
  p_grading_item_id uuid,
  p_score numeric,
  p_feedback text DEFAULT NULL
)
RETURNS public.grading_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.grading_items%rowtype;
  v_q public.questions%rowtype;
  v_attempt public.attempts%rowtype;
  v_comp public.competitions%rowtype;
  v_snapshot_max numeric;
  v_max numeric;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  SELECT * INTO v_row
  FROM public.grading_items
  WHERE id = p_grading_item_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'GRADING_ITEM_NOT_FOUND';
  END IF;

  SELECT * INTO v_attempt
  FROM public.attempts
  WHERE id = v_row.attempt_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ATTEMPT_NOT_FOUND';
  END IF;
  IF v_attempt.is_preview THEN
    RAISE EXCEPTION 'PREVIEW_ATTEMPT_NOT_GRADABLE';
  END IF;
  IF v_attempt.status::text NOT IN ('SUBMITTED', 'GRADING') THEN
    RAISE EXCEPTION 'ATTEMPT_NOT_GRADABLE';
  END IF;

  SELECT * INTO v_comp
  FROM public.competitions
  WHERE id = v_attempt.competition_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'COMPETITION_NOT_FOUND';
  END IF;
  IF NOT (
    private.current_user_is_admin()
    OR (
      v_comp.organizer_id IS NOT NULL
      AND private.current_user_can_edit_competition(v_comp.organizer_id)
    )
  ) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  SELECT eq.points_snapshot INTO v_snapshot_max
  FROM public.exam_attempt_questions eq
  WHERE eq.attempt_id = v_attempt.id
    AND eq.question_id = v_row.question_id
  LIMIT 1;

  IF FOUND THEN
    v_max := coalesce(v_snapshot_max, 0);
  ELSE
    SELECT * INTO v_q
    FROM public.questions
    WHERE id = v_row.question_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'GRADING_QUESTION_NOT_FOUND';
    END IF;
    v_max := coalesce(v_q.points, 0);
  END IF;

  IF p_score IS NULL OR p_score < 0 OR p_score > v_max THEN
    RAISE EXCEPTION 'SCORE_OUT_OF_RANGE';
  END IF;

  UPDATE public.grading_items
  SET grader_id = v_uid,
      score = p_score,
      feedback = p_feedback,
      updated_at = clock_timestamp()
  WHERE id = p_grading_item_id
  RETURNING * INTO v_row;

  INSERT INTO public.audit_logs(
    actor_user_id, action, entity_type, entity_id, reason, after_data
  )
  VALUES (
    v_uid, 'MANUAL_GRADING', 'grading_item',
    p_grading_item_id::text, p_feedback, to_jsonb(v_row)
  );

  RETURN v_row;
END;
$function$;

REVOKE ALL ON FUNCTION public.save_manual_grading_item(uuid, numeric, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_manual_grading_item(uuid, numeric, text)
  TO authenticated, service_role;

-- Never trust a score submitted by the browser. attempts.score is the
-- server-calculated objective/automatic base. Manual items are added to that
-- base; an edited automatic-AI item contributes only its delta.
CREATE OR REPLACE FUNCTION public.finalize_attempt_manual(
  p_attempt_id uuid,
  p_score numeric,
  p_reason text DEFAULT NULL
)
RETURNS public.attempts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_attempt public.attempts%rowtype;
  v_comp public.competitions%rowtype;
  v_item_count integer;
  v_pending_manual_count integer;
  v_invalid_score_count integer;
  v_manual_score numeric;
  v_ai_adjustment numeric;
  v_final_score numeric;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'AUTHORIZATION_REQUIRED';
  END IF;

  SELECT * INTO v_attempt
  FROM public.attempts
  WHERE id = p_attempt_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ATTEMPT_NOT_FOUND';
  END IF;
  IF v_attempt.is_preview THEN
    RAISE EXCEPTION 'PREVIEW_ATTEMPT_NOT_GRADABLE';
  END IF;

  SELECT * INTO v_comp
  FROM public.competitions
  WHERE id = v_attempt.competition_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'COMPETITION_NOT_FOUND';
  END IF;
  IF NOT (
    private.current_user_is_admin()
    OR (
      v_comp.organizer_id IS NOT NULL
      AND private.current_user_can_edit_competition(v_comp.organizer_id)
    )
  ) THEN
    RAISE EXCEPTION 'ACCESS_DENIED';
  END IF;

  PERFORM private.require_organizer_entitlement(
    v_comp.organizer_id, 'manual_grading'
  );

  IF v_attempt.status::text NOT IN ('GRADING', 'SUBMITTED') THEN
    RAISE EXCEPTION 'ATTEMPT_NOT_FINALIZABLE';
  END IF;
  IF p_reason IS NULL OR trim(p_reason) = '' THEN
    RAISE EXCEPTION 'FINALIZE_REASON_REQUIRED';
  END IF;

  SELECT
    count(*)::integer,
    count(*) FILTER (
      WHERE gi.grader_id IS NULL
        AND gi.automatic_score IS NULL
    )::integer,
    coalesce(sum(gi.score) FILTER (
      WHERE gi.automatic_score IS NULL
        AND gi.grader_id IS NOT NULL
    ), 0),
    coalesce(sum(gi.score - gi.automatic_score) FILTER (
      WHERE gi.automatic_score IS NOT NULL
        AND gi.grader_id IS NOT NULL
    ), 0)
  INTO
    v_item_count,
    v_pending_manual_count,
    v_manual_score,
    v_ai_adjustment
  FROM public.grading_items gi
  WHERE gi.attempt_id = v_attempt.id;

  IF v_item_count = 0 THEN
    RAISE EXCEPTION 'MANUAL_GRADING_ITEMS_NOT_FOUND';
  END IF;
  IF v_pending_manual_count > 0 THEN
    RAISE EXCEPTION 'MANUAL_GRADING_INCOMPLETE:%', v_pending_manual_count;
  END IF;

  SELECT count(*)::integer
  INTO v_invalid_score_count
  FROM public.grading_items gi
  LEFT JOIN LATERAL (
    SELECT eq.points_snapshot AS points
    FROM public.exam_attempt_questions eq
    WHERE eq.attempt_id = gi.attempt_id
      AND eq.question_id = gi.question_id
    LIMIT 1
  ) snapshot ON true
  LEFT JOIN public.questions q ON q.id = gi.question_id
  WHERE gi.attempt_id = v_attempt.id
    AND (
      gi.score < 0
      OR gi.score > coalesce(snapshot.points, q.points, 0)
    );

  IF v_invalid_score_count > 0 THEN
    RAISE EXCEPTION 'MANUAL_GRADING_SCORE_OUT_OF_RANGE:%',
      v_invalid_score_count;
  END IF;

  v_final_score := greatest(
    0,
    coalesce(v_attempt.score, 0)
      + coalesce(v_manual_score, 0)
      + coalesce(v_ai_adjustment, 0)
  );

  UPDATE public.attempts
  SET score = v_final_score,
      status = 'FINALIZED',
      finalized_at = clock_timestamp(),
      updated_at = clock_timestamp()
  WHERE id = v_attempt.id
  RETURNING * INTO v_attempt;

  PERFORM private.write_audit(
    'attempt.finalize',
    'attempt',
    v_attempt.id::text,
    p_reason,
    NULL,
    jsonb_build_object(
      'score', v_attempt.score,
      'status', v_attempt.status,
      'automatic_base_score', coalesce(v_attempt.score, 0)
    ),
    NULL
  );

  RETURN v_attempt;
END;
$function$;

REVOKE ALL ON FUNCTION public.finalize_attempt_manual(uuid, numeric, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finalize_attempt_manual(uuid, numeric, text)
  TO authenticated, service_role;

-- One reusable result set for organizer preview and public publication.
-- It follows the exact Stage 1 rule: latest finalized non-preview attempt per
-- canonical participant, with competition ranking for ties (1, 2, 2, 4).
CREATE OR REPLACE FUNCTION private.canonical_competition_results(
  p_competition_id uuid
)
RETURNS TABLE (
  rank_position bigint,
  canonical_participant_id uuid,
  full_name text,
  participant_type text,
  participant_code text,
  class_name text,
  grade text,
  school_name text,
  score numeric,
  finalized_at timestamptz
)
LANGUAGE sql
STABLE
SET search_path TO ''
AS $function$
  WITH latest_finalized AS (
    SELECT DISTINCT ON (a.canonical_participant_id)
      a.canonical_participant_id,
      a.score,
      a.finalized_at,
      a.created_at,
      a.id
    FROM public.attempts a
    WHERE a.competition_id = p_competition_id
      AND a.status::text = 'FINALIZED'
      AND a.is_preview = false
      AND a.canonical_participant_id IS NOT NULL
    ORDER BY
      a.canonical_participant_id,
      a.finalized_at DESC NULLS LAST,
      a.created_at DESC,
      a.id DESC
  ),
  ranked AS (
    SELECT
      lf.canonical_participant_id,
      lf.score,
      lf.finalized_at,
      rank() OVER (ORDER BY lf.score DESC NULLS LAST) AS rank_position
    FROM latest_finalized lf
  )
  SELECT
    r.rank_position,
    p.id,
    p.full_name,
    p.participant_type,
    p.participant_code,
    p.class_name,
    p.grade,
    s.name,
    r.score,
    r.finalized_at
  FROM ranked r
  JOIN public.participants p
    ON p.id = r.canonical_participant_id
   AND p.competition_id = p_competition_id
  LEFT JOIN public.schools s ON s.id = p.school_id;
$function$;

REVOKE ALL ON FUNCTION private.canonical_competition_results(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_organizer_competition_result_overview(
  p_competition_id uuid,
  p_limit integer DEFAULT 500,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_comp public.competitions%rowtype;
  v_results jsonb;
  v_participant_count integer;
  v_result_count integer;
  v_pending_attempt_count integer;
  v_manual_pending_count integer;
  v_expired_attempt_count integer;
  v_legacy_active_count integer;
  v_missing_canonical_count integer;
  v_limit integer := greatest(1, least(coalesce(p_limit, 500), 1000));
  v_offset integer := greatest(0, coalesce(p_offset, 0));
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTHORIZATION_REQUIRED';
  END IF;

  SELECT * INTO v_comp
  FROM public.competitions
  WHERE id = p_competition_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'COMPETITION_NOT_FOUND';
  END IF;

  IF NOT (
    private.current_user_is_admin()
    OR (
      v_comp.organizer_id IS NOT NULL
      AND private.current_user_can_edit_competition(v_comp.organizer_id)
    )
  ) THEN
    RAISE EXCEPTION 'ACCESS_DENIED';
  END IF;

  SELECT count(*)::integer
  INTO v_participant_count
  FROM public.participants p
  WHERE p.competition_id = v_comp.id;

  SELECT count(*)::integer
  INTO v_result_count
  FROM private.canonical_competition_results(v_comp.id);

  SELECT coalesce(jsonb_agg(row_data ORDER BY rank_position, full_name), '[]'::jsonb)
  INTO v_results
  FROM (
    SELECT
      r.rank_position,
      r.full_name,
      jsonb_build_object(
        'rank', r.rank_position,
        'full_name', r.full_name,
        'participant_type', r.participant_type,
        'participant_code', r.participant_code,
        'class_name', r.class_name,
        'grade', r.grade,
        'school_name', r.school_name,
        'score', r.score,
        'finalized_at', r.finalized_at
      ) AS row_data
    FROM private.canonical_competition_results(v_comp.id) r
    ORDER BY r.rank_position, r.full_name
    LIMIT v_limit OFFSET v_offset
  ) page;

  SELECT
    count(*) FILTER (
      WHERE a.status::text IN ('NOT_STARTED', 'IN_PROGRESS', 'SUBMITTED', 'GRADING')
    )::integer,
    count(*) FILTER (WHERE a.status::text = 'EXPIRED')::integer,
    count(*) FILTER (
      WHERE a.status::text = 'IN_PROGRESS'
        AND NOT EXISTS (
          SELECT 1
          FROM public.exam_attempt_runtime runtime
          WHERE runtime.attempt_id = a.id
        )
    )::integer,
    count(*) FILTER (
      WHERE a.status::text = 'FINALIZED'
        AND a.canonical_participant_id IS NULL
    )::integer
  INTO
    v_pending_attempt_count,
    v_expired_attempt_count,
    v_legacy_active_count,
    v_missing_canonical_count
  FROM public.attempts a
  WHERE a.competition_id = v_comp.id
    AND a.is_preview = false;

  SELECT count(*)::integer
  INTO v_manual_pending_count
  FROM public.grading_items gi
  JOIN public.attempts a ON a.id = gi.attempt_id
  WHERE a.competition_id = v_comp.id
    AND a.is_preview = false
    AND a.status::text IN ('SUBMITTED', 'GRADING')
    AND gi.grader_id IS NULL
    AND gi.automatic_score IS NULL;

  RETURN jsonb_build_object(
    'competition', jsonb_build_object(
      'id', v_comp.id,
      'slug', v_comp.slug,
      'title', v_comp.title,
      'category', v_comp.category,
      'status', v_comp.status,
      'visibility', v_comp.visibility,
      'announcement_at', v_comp.announcement_at,
      'poster_url', v_comp.poster_url
    ),
    'readiness', jsonb_build_object(
      'participant_count', v_participant_count,
      'result_count', v_result_count,
      'pending_attempt_count', v_pending_attempt_count,
      'manual_pending_count', v_manual_pending_count,
      'expired_attempt_count', v_expired_attempt_count,
      'legacy_active_count', v_legacy_active_count,
      'missing_canonical_count', v_missing_canonical_count,
      'can_publish',
        v_comp.status::text = 'GRADING'
        AND v_result_count > 0
        AND v_pending_attempt_count = 0
        AND v_manual_pending_count = 0
        AND v_missing_canonical_count = 0
    ),
    'results', v_results,
    'result_limit', v_limit,
    'result_offset', v_offset
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_organizer_competition_result_overview(uuid, integer, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_organizer_competition_result_overview(uuid, integer, integer)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.publish_competition_results(
  p_competition_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_comp public.competitions%rowtype;
  v_attempt_id uuid;
  v_pending_count integer;
  v_missing_canonical_count integer;
  v_manual_pending_count integer;
  v_result_count integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'AUTHORIZATION_REQUIRED';
  END IF;

  SELECT * INTO v_comp
  FROM public.competitions
  WHERE id = p_competition_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'COMPETITION_NOT_FOUND';
  END IF;

  IF NOT (
    private.current_user_is_admin()
    OR (
      v_comp.organizer_id IS NOT NULL
      AND private.current_user_can_edit_competition(v_comp.organizer_id)
    )
  ) THEN
    RAISE EXCEPTION 'ACCESS_DENIED';
  END IF;

  IF v_comp.status::text IN ('RESULT_PUBLISHED', 'ARCHIVED') THEN
    RETURN jsonb_build_object(
      'competition_id', v_comp.id,
      'status', v_comp.status,
      'published', true,
      'already_published', true
    );
  END IF;

  IF v_comp.status::text <> 'GRADING' THEN
    RAISE EXCEPTION 'COMPETITION_NOT_IN_GRADING';
  END IF;

  -- Reconcile sessions whose server-issued global deadline has passed. The
  -- timeout resolver records each skipped question and invokes the existing
  -- authoritative completion/scoring routine. Sessions without a linear
  -- runtime are intentionally not auto-finalized.
  FOR v_attempt_id IN
    SELECT a.id
    FROM public.attempts a
    JOIN public.exam_attempt_runtime runtime
      ON runtime.attempt_id = a.id
    WHERE a.competition_id = v_comp.id
      AND a.is_preview = false
      AND a.status::text = 'IN_PROGRESS'
      AND runtime.phase <> 'COMPLETED'
      AND runtime.global_deadline <= clock_timestamp()
    ORDER BY a.created_at, a.id
  LOOP
    PERFORM private.resolve_linear_exam_timeouts(
      v_attempt_id,
      clock_timestamp()
    );
  END LOOP;

  SELECT count(*)::integer
  INTO v_pending_count
  FROM public.attempts a
  WHERE a.competition_id = v_comp.id
    AND a.is_preview = false
    AND a.status::text IN ('NOT_STARTED', 'IN_PROGRESS', 'SUBMITTED', 'GRADING');

  IF v_pending_count > 0 THEN
    RAISE EXCEPTION 'RESULTS_NOT_READY:PENDING_ATTEMPTS:%', v_pending_count;
  END IF;

  SELECT count(*)::integer
  INTO v_manual_pending_count
  FROM public.grading_items gi
  JOIN public.attempts a ON a.id = gi.attempt_id
  WHERE a.competition_id = v_comp.id
    AND a.is_preview = false
    AND gi.grader_id IS NULL
    AND gi.automatic_score IS NULL;

  IF v_manual_pending_count > 0 THEN
    RAISE EXCEPTION 'RESULTS_NOT_READY:MANUAL_GRADING:%',
      v_manual_pending_count;
  END IF;

  SELECT count(*)::integer
  INTO v_missing_canonical_count
  FROM public.attempts a
  WHERE a.competition_id = v_comp.id
    AND a.is_preview = false
    AND a.status::text = 'FINALIZED'
    AND a.canonical_participant_id IS NULL;

  IF v_missing_canonical_count > 0 THEN
    RAISE EXCEPTION 'RESULTS_NOT_READY:MISSING_CANONICAL_IDENTITY:%',
      v_missing_canonical_count;
  END IF;

  SELECT count(*)::integer
  INTO v_result_count
  FROM private.canonical_competition_results(v_comp.id);

  IF v_result_count = 0 THEN
    RAISE EXCEPTION 'RESULTS_NOT_READY:NO_FINALIZED_OFFICIAL_ATTEMPTS';
  END IF;

  PERFORM public.transition_competition(
    v_comp.id,
    'RESULT_PUBLISHED'::public.competition_status,
    'Official competition results published after readiness validation'
  );

  RETURN jsonb_build_object(
    'competition_id', v_comp.id,
    'status', 'RESULT_PUBLISHED',
    'published', true,
    'already_published', false,
    'result_count', v_result_count,
    'published_at', clock_timestamp()
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.publish_competition_results(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_competition_results(uuid)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_public_competition_results(
  p_slug text,
  p_limit integer DEFAULT 500,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_comp public.competitions%rowtype;
  v_results jsonb;
  v_result_count integer;
  v_limit integer := greatest(1, least(coalesce(p_limit, 500), 1000));
  v_offset integer := greatest(0, coalesce(p_offset, 0));
  v_published_at timestamptz;
BEGIN
  SELECT * INTO v_comp
  FROM public.competitions
  WHERE slug = trim(coalesce(p_slug, ''))
    AND visibility = 'PUBLIC'
    AND status::text IN ('RESULT_PUBLISHED', 'ARCHIVED');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'COMPETITION_RESULTS_NOT_FOUND';
  END IF;

  SELECT count(*)::integer
  INTO v_result_count
  FROM private.canonical_competition_results(v_comp.id);

  SELECT coalesce(jsonb_agg(row_data ORDER BY rank_position, full_name), '[]'::jsonb)
  INTO v_results
  FROM (
    SELECT
      r.rank_position,
      r.full_name,
      jsonb_build_object(
        'rank', r.rank_position,
        'full_name', r.full_name,
        'participant_type', r.participant_type,
        'participant_code', r.participant_code,
        'class_name', r.class_name,
        'grade', r.grade,
        'school_name', r.school_name,
        'score', r.score,
        'finalized_at', r.finalized_at
      ) AS row_data
    FROM private.canonical_competition_results(v_comp.id) r
    ORDER BY r.rank_position, r.full_name
    LIMIT v_limit OFFSET v_offset
  ) page;

  SELECT max(h.created_at)
  INTO v_published_at
  FROM public.competition_status_history h
  WHERE h.competition_id = v_comp.id
    AND h.to_status::text = 'RESULT_PUBLISHED';

  RETURN jsonb_build_object(
    'competition', jsonb_build_object(
      'id', v_comp.id,
      'slug', v_comp.slug,
      'title', v_comp.title,
      'category', v_comp.category,
      'status', v_comp.status,
      'poster_url', v_comp.poster_url,
      'announcement_at', v_comp.announcement_at,
      'published_at', v_published_at
    ),
    'result_count', v_result_count,
    'results', v_results,
    'result_limit', v_limit,
    'result_offset', v_offset
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_public_competition_results(text, integer, integer)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_competition_results(text, integer, integer)
  TO anon, authenticated, service_role;
