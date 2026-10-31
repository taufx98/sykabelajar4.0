-- Stage 5: teacher achievement reporting over existing canonical participant records.
-- No new participant, roster, or result tables are introduced.
CREATE OR REPLACE FUNCTION public.list_teacher_achievement_report(
  p_competition_id uuid DEFAULT NULL,
  p_search text DEFAULT NULL
)
RETURNS TABLE (
  collective_participant_id uuid,
  canonical_participant_id uuid,
  competition_id uuid,
  competition_title text,
  competition_status text,
  student_name text,
  class_name text,
  grade text,
  participant_code text,
  participant_status text,
  attempt_status text,
  score numeric,
  rank bigint,
  finalized_at timestamptz,
  certificate_status text,
  certificate_serial_number text,
  certificate_url text,
  certificate_issued_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_is_admin boolean := private.current_user_is_admin();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  IF NOT v_is_admin AND NOT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = v_user_id
      AND ur.role = 'teacher'::public.app_role
      AND ur.is_active = true
  ) THEN
    RAISE EXCEPTION 'TEACHER_ROLE_REQUIRED';
  END IF;

  RETURN QUERY
  SELECT
    cp.id,
    p.id,
    cp.competition_id,
    c.title,
    c.status::text,
    cp.full_name,
    cp.class_name,
    cp.grade,
    cp.participant_code,
    cp.status,
    latest_attempt.status::text,
    CASE
      WHEN c.status::text IN ('RESULT_PUBLISHED', 'ARCHIVED')
       AND latest_attempt.status::text = 'FINALIZED'
      THEN latest_attempt.score
      ELSE NULL
    END,
    CASE
      WHEN c.status::text IN ('RESULT_PUBLISHED', 'ARCHIVED')
       AND latest_attempt.status::text = 'FINALIZED'
      THEN private.canonical_competition_rank(cp.competition_id, p.id)
      ELSE NULL
    END,
    latest_attempt.finalized_at,
    CASE
      WHEN c.status::text IN ('RESULT_PUBLISHED', 'ARCHIVED')
      THEN latest_certificate.status
      ELSE NULL
    END,
    CASE
      WHEN c.status::text IN ('RESULT_PUBLISHED', 'ARCHIVED')
      THEN latest_certificate.serial_number
      ELSE NULL
    END,
    CASE
      WHEN c.status::text IN ('RESULT_PUBLISHED', 'ARCHIVED')
      THEN latest_certificate.certificate_url
      ELSE NULL
    END,
    CASE
      WHEN c.status::text IN ('RESULT_PUBLISHED', 'ARCHIVED')
      THEN latest_certificate.issued_at
      ELSE NULL
    END
  FROM public.collective_participants cp
  JOIN public.competitions c
    ON c.id = cp.competition_id
  JOIN public.participants p
    ON p.competition_id = cp.competition_id
   AND p.collective_participant_id = cp.id
   AND p.participant_type = 'COLLECTIVE'
  LEFT JOIN LATERAL (
    SELECT a.status, a.score, a.finalized_at
    FROM public.attempts a
    WHERE a.canonical_participant_id = p.id
      AND a.is_preview = false
    ORDER BY a.created_at DESC, a.attempt_number DESC, a.id DESC
    LIMIT 1
  ) latest_attempt ON true
  LEFT JOIN LATERAL (
    SELECT cc.status, cc.serial_number, cc.certificate_url, cc.issued_at
    FROM public.collective_certificates cc
    WHERE cc.collective_participant_id = cp.id
      AND cc.competition_id = cp.competition_id
    ORDER BY cc.issued_at DESC NULLS LAST, cc.created_at DESC
    LIMIT 1
  ) latest_certificate ON true
  WHERE
    (cp.managed_by_user_id = v_user_id OR v_is_admin)
    AND (p_competition_id IS NULL OR cp.competition_id = p_competition_id)
    AND (
      NULLIF(trim(p_search), '') IS NULL
      OR cp.full_name ILIKE '%' || trim(p_search) || '%'
      OR COALESCE(cp.class_name, '') ILIKE '%' || trim(p_search) || '%'
      OR COALESCE(cp.grade, '') ILIKE '%' || trim(p_search) || '%'
      OR c.title ILIKE '%' || trim(p_search) || '%'
      OR cp.participant_code ILIKE '%' || trim(p_search) || '%'
    )
  ORDER BY
    COALESCE(latest_certificate.issued_at, latest_attempt.finalized_at, cp.created_at) DESC,
    cp.full_name ASC;
END;
$function$;

REVOKE ALL ON FUNCTION public.list_teacher_achievement_report(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_teacher_achievement_report(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.list_teacher_achievement_report(uuid, text) IS
  'Stage 5 teacher achievement report. Reads teacher-owned collective participants through canonical participants and official non-preview attempts; score, rank and certificate fields remain hidden until official result publication.';
