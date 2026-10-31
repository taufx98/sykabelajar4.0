-- Stage 5: teacher-facing achievement and progress reports.
-- Reuse teacher rosters, collective enrolments, canonical participants,
-- official attempts, published certificates, and public awards. No parallel
-- student/participant records are created by this read-only reporting API.

CREATE OR REPLACE FUNCTION public.get_teacher_achievement_report(
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_search text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 100));
  v_offset integer := greatest(0, least(coalesce(p_offset, 0), 50000));
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_report jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'AUTHORIZATION_REQUIRED';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = v_uid
      AND ur.is_active = true
      AND (
        ur.role::text = 'teacher'
        OR ur.role::text = 'admin'
      )
  ) THEN
    RAISE EXCEPTION 'TEACHER_ROLE_REQUIRED';
  END IF;

  IF v_search IS NOT NULL AND char_length(v_search) > 120 THEN
    RAISE EXCEPTION 'SEARCH_TOO_LONG';
  END IF;

  WITH owned_students AS MATERIALIZED (
    SELECT
      rs.id AS student_id,
      rs.full_name,
      rs.class_name,
      rs.grade,
      rs.photo_url,
      rs.is_active,
      tr.id AS roster_id,
      tr.name AS roster_name
    FROM public.teacher_rosters tr
    JOIN public.roster_students rs
      ON rs.roster_id = tr.id
    WHERE tr.teacher_user_id = v_uid
      AND (
        v_search IS NULL
        OR rs.full_name ILIKE '%' || v_search || '%'
        OR coalesce(rs.class_name, '') ILIKE '%' || v_search || '%'
        OR coalesce(rs.grade, '') ILIKE '%' || v_search || '%'
        OR tr.name ILIKE '%' || v_search || '%'
      )
  ),
  scoped_participants AS MATERIALIZED (
    SELECT
      cp.id AS collective_participant_id,
      cp.roster_student_id,
      cp.competition_id,
      p.id AS canonical_participant_id,
      coalesce(p.user_id, cp.user_id) AS linked_user_id,
      c.title AS competition_title,
      c.slug AS competition_slug,
      c.status::text AS competition_status,
      c.starts_at
    FROM public.collective_participants cp
    JOIN owned_students os
      ON os.student_id = cp.roster_student_id
    JOIN public.competitions c
      ON c.id = cp.competition_id
    LEFT JOIN public.participants p
      ON p.collective_participant_id = cp.id
     AND p.competition_id = cp.competition_id
     AND p.participant_type = 'COLLECTIVE'
    WHERE cp.managed_by_user_id = v_uid
  ),
  competition_scope AS (
    SELECT DISTINCT competition_id
    FROM scoped_participants
  ),
  latest_finalized AS (
    SELECT DISTINCT ON (a.canonical_participant_id)
      a.canonical_participant_id,
      a.competition_id,
      a.score,
      a.finalized_at
    FROM public.attempts a
    JOIN competition_scope cs
      ON cs.competition_id = a.competition_id
    WHERE a.status::text = 'FINALIZED'
      AND a.is_preview = false
      AND a.canonical_participant_id IS NOT NULL
    ORDER BY
      a.canonical_participant_id,
      a.finalized_at DESC NULLS LAST,
      a.created_at DESC,
      a.id DESC
  ),
  ranked_results AS (
    SELECT
      lf.canonical_participant_id,
      lf.competition_id,
      lf.score,
      lf.finalized_at,
      rank() OVER (
        PARTITION BY lf.competition_id
        ORDER BY lf.score DESC NULLS LAST
      ) AS rank_position
    FROM latest_finalized lf
  ),
  latest_attempts AS (
    SELECT DISTINCT ON (a.canonical_participant_id)
      a.canonical_participant_id,
      a.status::text AS attempt_status
    FROM public.attempts a
    JOIN (
      SELECT DISTINCT canonical_participant_id
      FROM scoped_participants
      WHERE canonical_participant_id IS NOT NULL
    ) scoped_ids
      ON scoped_ids.canonical_participant_id = a.canonical_participant_id
    WHERE a.is_preview = false
    ORDER BY
      a.canonical_participant_id,
      a.created_at DESC,
      a.attempt_number DESC,
      a.id DESC
  ),
  certificate_sets AS (
    SELECT
      sp.roster_student_id,
      sp.competition_id,
      jsonb_agg(
        jsonb_build_object(
          'certificate_id', pc.certificate_id,
          'certificate_type', pc.certificate_type,
          'serial_number', pc.serial_number,
          'certificate_url', pc.certificate_url,
          'issued_at', pc.issued_at
        )
        ORDER BY pc.issued_at DESC NULLS LAST, pc.certificate_id
      ) AS certificates
    FROM scoped_participants sp
    JOIN public.participant_certificates pc
      ON pc.participant_id = sp.canonical_participant_id
     AND pc.competition_id = sp.competition_id
    WHERE pc.status = 'PUBLISHED'
      AND sp.competition_status IN ('RESULT_PUBLISHED', 'ARCHIVED')
    GROUP BY sp.roster_student_id, sp.competition_id
  ),
  student_competitions AS (
    SELECT
      sp.roster_student_id,
      sp.competition_id,
      sp.competition_title,
      sp.competition_slug,
      sp.competition_status,
      coalesce(la.attempt_status, 'NOT_STARTED') AS attempt_status,
      (
        sp.competition_status IN ('RESULT_PUBLISHED', 'ARCHIVED')
        AND rr.canonical_participant_id IS NOT NULL
      ) AS result_published,
      CASE
        WHEN sp.competition_status IN ('RESULT_PUBLISHED', 'ARCHIVED')
        THEN rr.score
        ELSE NULL::numeric
      END AS score,
      CASE
        WHEN sp.competition_status IN ('RESULT_PUBLISHED', 'ARCHIVED')
        THEN rr.rank_position
        ELSE NULL::bigint
      END AS rank_position,
      coalesce(cs.certificates, '[]'::jsonb) AS certificates,
      coalesce(jsonb_array_length(cs.certificates), 0) AS certificate_count,
      sp.starts_at
    FROM scoped_participants sp
    LEFT JOIN latest_attempts la
      ON la.canonical_participant_id = sp.canonical_participant_id
    LEFT JOIN ranked_results rr
      ON rr.canonical_participant_id = sp.canonical_participant_id
     AND rr.competition_id = sp.competition_id
    LEFT JOIN certificate_sets cs
      ON cs.roster_student_id = sp.roster_student_id
     AND cs.competition_id = sp.competition_id
  ),
  student_history AS (
    SELECT
      sc.roster_student_id,
      count(*)::integer AS total_competitions,
      count(*) FILTER (WHERE sc.result_published)::integer AS published_results,
      coalesce(sum(sc.certificate_count), 0)::integer AS certificates_issued,
      max(sc.score) AS best_score,
      min(sc.rank_position) AS best_rank,
      round(avg(sc.score) FILTER (WHERE sc.result_published), 2) AS average_score,
      jsonb_agg(
        jsonb_build_object(
          'competition_id', sc.competition_id,
          'competition_title', sc.competition_title,
          'competition_slug', sc.competition_slug,
          'competition_status', sc.competition_status,
          'attempt_status', sc.attempt_status,
          'result_published', sc.result_published,
          'score', sc.score,
          'rank', sc.rank_position,
          'certificates', sc.certificates
        )
        ORDER BY sc.starts_at DESC NULLS LAST, sc.competition_title
      ) AS competitions
    FROM student_competitions sc
    GROUP BY sc.roster_student_id
  ),
  linked_student_competitions AS (
    SELECT DISTINCT
      roster_student_id,
      competition_id,
      linked_user_id
    FROM scoped_participants
    WHERE linked_user_id IS NOT NULL
  ),
  public_award_rows AS (
    SELECT
      lsc.roster_student_id,
      a.id AS award_id,
      a.title,
      a.rank_code,
      a.points,
      a.competition_id,
      c.title AS competition_title,
      a.issued_at
    FROM linked_student_competitions lsc
    JOIN public.awards a
      ON a.user_id = lsc.linked_user_id
     AND a.competition_id = lsc.competition_id
     AND a.visibility = 'PUBLIC'
    LEFT JOIN public.competitions c
      ON c.id = a.competition_id
  ),
  student_awards AS (
    SELECT
      par.roster_student_id,
      count(*)::integer AS public_awards,
      jsonb_agg(
        jsonb_build_object(
          'award_id', par.award_id,
          'title', par.title,
          'rank_code', par.rank_code,
          'points', par.points,
          'competition_id', par.competition_id,
          'competition_title', par.competition_title,
          'issued_at', par.issued_at
        )
        ORDER BY par.issued_at DESC, par.award_id
      ) AS awards
    FROM public_award_rows par
    GROUP BY par.roster_student_id
  ),
  report_rows AS (
    SELECT
      os.student_id,
      os.full_name,
      os.class_name,
      os.grade,
      os.photo_url,
      os.is_active,
      os.roster_name,
      coalesce(sh.total_competitions, 0)::integer AS total_competitions,
      coalesce(sh.published_results, 0)::integer AS published_results,
      coalesce(sh.certificates_issued, 0)::integer AS certificates_issued,
      coalesce(sa.public_awards, 0)::integer AS public_awards,
      sh.best_score,
      sh.best_rank,
      sh.average_score,
      coalesce(sh.competitions, '[]'::jsonb) AS competitions,
      coalesce(sa.awards, '[]'::jsonb) AS awards
    FROM owned_students os
    LEFT JOIN student_history sh
      ON sh.roster_student_id = os.student_id
    LEFT JOIN student_awards sa
      ON sa.roster_student_id = os.student_id
  )
  SELECT jsonb_build_object(
    'summary', (
      SELECT jsonb_build_object(
        'students_total', count(*)::integer,
        'active_students', count(*) FILTER (WHERE rr.is_active)::integer,
        'competition_entries', coalesce(sum(rr.total_competitions), 0)::integer,
        'published_results', coalesce(sum(rr.published_results), 0)::integer,
        'certificates_issued', coalesce(sum(rr.certificates_issued), 0)::integer,
        'public_awards', coalesce(sum(rr.public_awards), 0)::integer,
        'average_score',
          CASE
            WHEN coalesce(sum(rr.published_results), 0) > 0
            THEN round(
              sum(coalesce(rr.average_score, 0) * rr.published_results)
              / sum(rr.published_results),
              2
            )
            ELSE NULL
          END
      )
      FROM report_rows rr
    ),
    'students', (
      SELECT coalesce(jsonb_agg(page.student_data), '[]'::jsonb)
      FROM (
        SELECT
          jsonb_build_object(
            'student_id', rr.student_id,
            'full_name', rr.full_name,
            'class_name', rr.class_name,
            'grade', rr.grade,
            'photo_url', rr.photo_url,
            'is_active', rr.is_active,
            'roster_name', rr.roster_name,
            'total_competitions', rr.total_competitions,
            'published_results', rr.published_results,
            'certificates_issued', rr.certificates_issued,
            'public_awards', rr.public_awards,
            'best_score', rr.best_score,
            'best_rank', rr.best_rank,
            'average_score', rr.average_score,
            'competitions', rr.competitions,
            'awards', rr.awards
          ) AS student_data,
          rr.full_name,
          rr.student_id
        FROM report_rows rr
        ORDER BY rr.full_name, rr.student_id
        LIMIT v_limit OFFSET v_offset
      ) page
    ),
    'total_students', (
      SELECT count(*)::integer
      FROM report_rows
    ),
    'limit', v_limit,
    'offset', v_offset,
    'generated_at', now()
  )
  INTO v_report;

  RETURN v_report;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_teacher_achievement_report(integer, integer, text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_teacher_achievement_report(integer, integer, text)
  TO authenticated;
