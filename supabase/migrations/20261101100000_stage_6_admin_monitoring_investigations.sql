-- Stage 6: read-only admin monitoring and investigation over canonical competition data.
-- No participant, attempt, answer, score, or ranking rows are created or rewritten here.

CREATE OR REPLACE FUNCTION public.admin_get_monitoring_dashboard(
  p_competition_id uuid DEFAULT NULL,
  p_query text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_limit integer DEFAULT 25,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_offset integer := least(greatest(coalesce(p_offset, 0), 0), 100000);
  v_query text := nullif(left(trim(coalesce(p_query, '')), 120), '');
  v_status text := upper(nullif(trim(coalesce(p_status, '')), ''));
  v_summary jsonb;
  v_competitions jsonb;
  v_attempts jsonb;
  v_audit jsonb;
  v_organizers jsonb;
  v_attempt_total bigint := 0;
BEGIN
  IF v_uid IS NULL OR NOT private.current_user_is_admin() THEN
    RAISE EXCEPTION 'ADMIN_REQUIRED';
  END IF;

  SELECT jsonb_build_object(
    'total_competitions', (SELECT count(*) FROM public.competitions),
    'live_competitions', (SELECT count(*) FROM public.competitions WHERE status::text = 'LIVE'),
    'registration_open', (SELECT count(*) FROM public.competitions WHERE status::text = 'REGISTRATION_OPEN'),
    'published_competitions', (SELECT count(*) FROM public.competitions WHERE status::text IN ('RESULT_PUBLISHED', 'ARCHIVED')),
    'canonical_participants', (SELECT count(*) FROM public.participants),
    'official_attempts', (SELECT count(*) FROM public.attempts a WHERE coalesce(a.is_preview, false) = false),
    'in_progress_attempts', (SELECT count(*) FROM public.attempts a WHERE coalesce(a.is_preview, false) = false AND a.status::text = 'IN_PROGRESS'),
    'submitted_attempts', (SELECT count(*) FROM public.attempts a WHERE coalesce(a.is_preview, false) = false AND a.status::text = 'SUBMITTED'),
    'grading_attempts', (SELECT count(*) FROM public.attempts a WHERE coalesce(a.is_preview, false) = false AND a.status::text = 'GRADING'),
    'finalized_attempts', (SELECT count(*) FROM public.attempts a WHERE coalesce(a.is_preview, false) = false AND a.status::text = 'FINALIZED'),
    'expired_attempts', (SELECT count(*) FROM public.attempts a WHERE coalesce(a.is_preview, false) = false AND a.status::text = 'EXPIRED'),
    'open_incidents', (SELECT count(*) FROM public.system_error_events e WHERE e.status IN ('new', 'investigating'))
  ) INTO v_summary;

  SELECT coalesce(jsonb_agg(row_data ORDER BY created_at DESC), '[]'::jsonb)
  INTO v_competitions
  FROM (
    SELECT
      c.created_at,
      jsonb_build_object(
        'id', c.id,
        'title', c.title,
        'status', c.status::text,
        'organizer_id', c.organizer_id,
        'organizer_name', coalesce(nullif(trim(op.full_name), ''), op.username, 'Penyelenggara'),
        'starts_at', c.starts_at,
        'ends_at', c.ends_at,
        'created_at', c.created_at,
        'participant_count', (SELECT count(*) FROM public.participants p WHERE p.competition_id = c.id),
        'registration_count', (SELECT count(*) FROM public.registrations r WHERE r.competition_id = c.id),
        'attempt_count', (SELECT count(*) FROM public.attempts a WHERE a.competition_id = c.id AND coalesce(a.is_preview, false) = false),
        'active_attempt_count', (SELECT count(*) FROM public.attempts a WHERE a.competition_id = c.id AND coalesce(a.is_preview, false) = false AND a.status::text = 'IN_PROGRESS'),
        'pending_review_count', (SELECT count(*) FROM public.attempts a WHERE a.competition_id = c.id AND coalesce(a.is_preview, false) = false AND a.status::text IN ('SUBMITTED', 'GRADING'))
      ) AS row_data
    FROM public.competitions c
    LEFT JOIN public.profiles op ON op.id = c.organizer_id
    ORDER BY c.created_at DESC, c.id
    LIMIT 100
  ) competition_rows;

  SELECT count(*)
  INTO v_attempt_total
  FROM public.attempts a
  JOIN public.competitions c ON c.id = a.competition_id
  LEFT JOIN public.participants p ON p.id = a.canonical_participant_id
  LEFT JOIN public.collective_participants cp ON cp.id = a.collective_participant_id
  LEFT JOIN public.profiles pr ON pr.id = a.participant_id
  WHERE coalesce(a.is_preview, false) = false
    AND (p_competition_id IS NULL OR a.competition_id = p_competition_id)
    AND (v_status IS NULL OR v_status = 'ALL' OR a.status::text = v_status)
    AND (
      v_query IS NULL
      OR coalesce(p.full_name, cp.full_name, pr.full_name, pr.username, '') ILIKE '%' || v_query || '%'
      OR coalesce(p.participant_code, cp.participant_code, '') ILIKE '%' || v_query || '%'
      OR c.title ILIKE '%' || v_query || '%'
    );

  SELECT coalesce(jsonb_agg(row_data ORDER BY created_at DESC), '[]'::jsonb)
  INTO v_attempts
  FROM (
    SELECT
      a.created_at,
      jsonb_build_object(
        'attempt_id', a.id,
        'competition_id', c.id,
        'competition_title', c.title,
        'competition_status', c.status::text,
        'participant_id', a.canonical_participant_id,
        'participant_name', coalesce(p.full_name, cp.full_name, pr.full_name, pr.username, 'Peserta'),
        'participant_code', coalesce(p.participant_code, cp.participant_code),
        'participant_type', coalesce(p.participant_type, CASE WHEN a.collective_participant_id IS NOT NULL THEN 'COLLECTIVE' ELSE 'INDIVIDUAL' END),
        'attempt_status', a.status::text,
        'started_at', a.started_at,
        'submitted_at', a.submitted_at,
        'finalized_at', a.finalized_at,
        'created_at', a.created_at,
        'updated_at', a.updated_at,
        'score', CASE WHEN c.status::text IN ('RESULT_PUBLISHED', 'ARCHIVED') AND a.status::text = 'FINALIZED' THEN a.score ELSE NULL END,
        'current_position', runtime.current_position,
        'question_count', runtime.question_count,
        'runtime_phase', runtime.phase,
        'answered_count', question_stats.answered_count,
        'skipped_count', question_stats.skipped_count,
        'timeout_count', event_stats.timeout_count,
        'event_count', event_stats.event_count,
        'last_event_at', event_stats.last_event_at,
        'requires_review', question_stats.skipped_count >= 3 OR event_stats.timeout_count >= 3,
        'review_reasons', jsonb_strip_nulls(jsonb_build_object(
          'repeated_skips', CASE WHEN question_stats.skipped_count >= 3 THEN 'Tiga atau lebih soal dilewati' END,
          'repeated_timeouts', CASE WHEN event_stats.timeout_count >= 3 THEN 'Tiga atau lebih timeout tercatat' END
        ))
      ) AS row_data
    FROM public.attempts a
    JOIN public.competitions c ON c.id = a.competition_id
    LEFT JOIN public.participants p ON p.id = a.canonical_participant_id
    LEFT JOIN public.collective_participants cp ON cp.id = a.collective_participant_id
    LEFT JOIN public.profiles pr ON pr.id = a.participant_id
    LEFT JOIN public.exam_attempt_runtime runtime ON runtime.attempt_id = a.id
    LEFT JOIN LATERAL (
      SELECT
        count(*) FILTER (WHERE q.state = 'ANSWERED')::integer AS answered_count,
        count(*) FILTER (WHERE q.state = 'SKIPPED')::integer AS skipped_count
      FROM public.exam_attempt_questions q
      WHERE q.attempt_id = a.id
    ) question_stats ON true
    LEFT JOIN LATERAL (
      SELECT
        count(*)::integer AS event_count,
        count(*) FILTER (WHERE e.event_type = 'QUESTION_TIMEOUT')::integer AS timeout_count,
        max(e.occurred_at) AS last_event_at
      FROM public.exam_attempt_events e
      WHERE e.attempt_id = a.id
    ) event_stats ON true
    WHERE coalesce(a.is_preview, false) = false
      AND (p_competition_id IS NULL OR a.competition_id = p_competition_id)
      AND (v_status IS NULL OR v_status = 'ALL' OR a.status::text = v_status)
      AND (
        v_query IS NULL
        OR coalesce(p.full_name, cp.full_name, pr.full_name, pr.username, '') ILIKE '%' || v_query || '%'
        OR coalesce(p.participant_code, cp.participant_code, '') ILIKE '%' || v_query || '%'
        OR c.title ILIKE '%' || v_query || '%'
      )
    ORDER BY a.created_at DESC, a.id
    LIMIT v_limit OFFSET v_offset
  ) attempt_rows;

  SELECT coalesce(jsonb_agg(event_row ORDER BY created_at DESC), '[]'::jsonb)
  INTO v_audit
  FROM (
    SELECT event_row, created_at
    FROM (
    (
      SELECT
        al.created_at,
        jsonb_build_object(
          'id', al.id::text,
          'kind', 'attempt_result',
          'action', al.action,
          'entity_type', al.entity_type,
          'entity_id', al.entity_id,
          'attempt_id', CASE WHEN al.entity_type = 'attempt' THEN al.entity_id ELSE al.after_data->>'attempt_id' END,
          'reason', al.reason,
          'actor_user_id', al.actor_user_id,
          'created_at', al.created_at,
          'before', jsonb_strip_nulls(jsonb_build_object(
            'score', al.before_data->'score',
            'status', al.before_data->'status',
            'finalized_at', al.before_data->'finalized_at'
          )),
          'after', jsonb_strip_nulls(jsonb_build_object(
            'score', al.after_data->'score',
            'status', al.after_data->'status',
            'finalized_at', al.after_data->'finalized_at'
          ))
        ) AS event_row
      FROM public.audit_logs al
      WHERE al.action IN ('attempt.result_snapshot_changed', 'attempt.finalize', 'MANUAL_GRADING')
      ORDER BY al.created_at DESC
      LIMIT 50
    )
    UNION ALL
    (
      SELECT
        h.created_at,
        jsonb_build_object(
          'id', 'competition-status-' || h.id::text,
          'kind', 'competition_publication',
          'action', 'competition.results_published',
          'entity_type', 'competition',
          'entity_id', h.competition_id::text,
          'attempt_id', NULL,
          'reason', h.reason,
          'actor_user_id', h.changed_by,
          'created_at', h.created_at,
          'before', jsonb_build_object('status', h.from_status::text),
          'after', jsonb_build_object('status', h.to_status::text)
        ) AS event_row
      FROM public.competition_status_history h
      WHERE h.to_status::text = 'RESULT_PUBLISHED'
      ORDER BY h.created_at DESC
      LIMIT 50
    )
    ) audit_rows
    ORDER BY created_at DESC
    LIMIT 50
  ) audit_page;

  SELECT coalesce(jsonb_agg(row_data ORDER BY competition_count DESC, organizer_name), '[]'::jsonb)
  INTO v_organizers
  FROM (
    SELECT
      organizer_id,
      organizer_name,
      count(*)::integer AS competition_count,
      coalesce(sum(participant_count), 0)::bigint AS participant_count,
      coalesce(sum(attempt_count), 0)::bigint AS attempt_count,
      jsonb_build_object(
        'organizer_id', organizer_id,
        'organizer_name', organizer_name,
        'competition_count', count(*),
        'participant_count', coalesce(sum(participant_count), 0),
        'attempt_count', coalesce(sum(attempt_count), 0)
      ) AS row_data
    FROM (
      SELECT
        c.id,
        c.organizer_id,
        coalesce(nullif(trim(op.full_name), ''), op.username, 'Penyelenggara') AS organizer_name,
        (SELECT count(*) FROM public.participants p WHERE p.competition_id = c.id) AS participant_count,
        (SELECT count(*) FROM public.attempts a WHERE a.competition_id = c.id AND coalesce(a.is_preview, false) = false) AS attempt_count
      FROM public.competitions c
      LEFT JOIN public.profiles op ON op.id = c.organizer_id
      WHERE c.organizer_id IS NOT NULL
    ) organizer_competitions
    GROUP BY organizer_id, organizer_name
    ORDER BY count(*) DESC, organizer_name
    LIMIT 20
  ) organizer_rows;

  RETURN jsonb_build_object(
    'generated_at', now(),
    'summary', v_summary,
    'competitions', v_competitions,
    'attempts', v_attempts,
    'attempt_total', v_attempt_total,
    'limit', v_limit,
    'offset', v_offset,
    'has_more', (v_offset + jsonb_array_length(coalesce(v_attempts, '[]'::jsonb))) < v_attempt_total,
    'audit_events', v_audit,
    'organizer_performance', v_organizers
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_get_monitoring_dashboard(uuid, text, text, integer, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_get_monitoring_dashboard(uuid, text, text, integer, integer)
  TO authenticated;


CREATE OR REPLACE FUNCTION public.admin_get_attempt_investigation(
  p_attempt_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_attempt public.attempts%rowtype;
  v_comp public.competitions%rowtype;
  v_events jsonb;
  v_audit jsonb;
  v_answered integer := 0;
  v_skipped integer := 0;
  v_timeouts integer := 0;
  v_event_count integer := 0;
  v_result jsonb;
BEGIN
  IF v_uid IS NULL OR NOT private.current_user_is_admin() THEN
    RAISE EXCEPTION 'ADMIN_REQUIRED';
  END IF;
  IF p_attempt_id IS NULL THEN
    RAISE EXCEPTION 'ATTEMPT_ID_REQUIRED';
  END IF;

  SELECT * INTO v_attempt
  FROM public.attempts a
  WHERE a.id = p_attempt_id
    AND coalesce(a.is_preview, false) = false;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ATTEMPT_NOT_FOUND';
  END IF;

  SELECT * INTO v_comp
  FROM public.competitions c
  WHERE c.id = v_attempt.competition_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'COMPETITION_NOT_FOUND';
  END IF;

  SELECT
    count(*) FILTER (WHERE q.state = 'ANSWERED')::integer,
    count(*) FILTER (WHERE q.state = 'SKIPPED')::integer
  INTO v_answered, v_skipped
  FROM public.exam_attempt_questions q
  WHERE q.attempt_id = v_attempt.id;

  SELECT
    count(*)::integer,
    count(*) FILTER (WHERE e.event_type = 'QUESTION_TIMEOUT')::integer
  INTO v_event_count, v_timeouts
  FROM public.exam_attempt_events e
  WHERE e.attempt_id = v_attempt.id;

  SELECT coalesce(jsonb_agg(event_row ORDER BY occurred_at), '[]'::jsonb)
  INTO v_events
  FROM (
    SELECT
      e.occurred_at,
      jsonb_build_object(
        'id', e.id,
        'event_type', e.event_type,
        'actor_kind', e.actor_kind,
        'question_position', e.question_position,
        'occurred_at', e.occurred_at,
        'metadata', jsonb_strip_nulls(jsonb_build_object(
          'phase', e.metadata->'phase',
          'status', e.metadata->'status',
          'question_count', e.metadata->'question_count',
          'duration_seconds', e.metadata->'duration_seconds',
          'allocated_seconds', e.metadata->'allocated_seconds',
          'speed_bonus_awarded', e.metadata->'speed_bonus_awarded',
          'speed_bonus_seconds', e.metadata->'speed_bonus_seconds',
          'borrowed_from_previous_seconds', e.metadata->'borrowed_from_previous_seconds',
          'reason', e.metadata->'reason'
        ))
      ) AS event_row
    FROM public.exam_attempt_events e
    WHERE e.attempt_id = v_attempt.id
    ORDER BY e.occurred_at DESC
    LIMIT 100
  ) recent_events;

  SELECT coalesce(jsonb_agg(event_row ORDER BY created_at DESC), '[]'::jsonb)
  INTO v_audit
  FROM (
    SELECT
      al.created_at,
      jsonb_build_object(
        'id', al.id::text,
        'action', al.action,
        'reason', al.reason,
        'actor_user_id', al.actor_user_id,
        'created_at', al.created_at,
        'before', jsonb_strip_nulls(jsonb_build_object(
          'score', al.before_data->'score',
          'status', al.before_data->'status',
          'finalized_at', al.before_data->'finalized_at'
        )),
        'after', jsonb_strip_nulls(jsonb_build_object(
          'score', al.after_data->'score',
          'status', al.after_data->'status',
          'finalized_at', al.after_data->'finalized_at'
        ))
      ) AS event_row
    FROM public.audit_logs al
    WHERE (al.entity_type = 'attempt' AND al.entity_id = v_attempt.id::text)
       OR (al.action = 'MANUAL_GRADING' AND al.after_data->>'attempt_id' = v_attempt.id::text)
    ORDER BY al.created_at DESC
    LIMIT 50
  ) attempt_audit;

  SELECT jsonb_build_object(
    'attempt_id', v_attempt.id,
    'competition_id', v_comp.id,
    'competition_title', v_comp.title,
    'competition_status', v_comp.status::text,
    'participant_id', v_attempt.canonical_participant_id,
    'participant_name', coalesce(
      (SELECT p.full_name FROM public.participants p WHERE p.id = v_attempt.canonical_participant_id),
      (SELECT cp.full_name FROM public.collective_participants cp WHERE cp.id = v_attempt.collective_participant_id),
      (SELECT pr.full_name FROM public.profiles pr WHERE pr.id = v_attempt.participant_id),
      (SELECT pr.username FROM public.profiles pr WHERE pr.id = v_attempt.participant_id),
      'Peserta'
    ),
    'participant_code', coalesce(
      (SELECT p.participant_code FROM public.participants p WHERE p.id = v_attempt.canonical_participant_id),
      (SELECT cp.participant_code FROM public.collective_participants cp WHERE cp.id = v_attempt.collective_participant_id)
    ),
    'participant_type', coalesce(
      (SELECT p.participant_type FROM public.participants p WHERE p.id = v_attempt.canonical_participant_id),
      CASE WHEN v_attempt.collective_participant_id IS NOT NULL THEN 'COLLECTIVE' ELSE 'INDIVIDUAL' END
    ),
    'attempt_status', v_attempt.status::text,
    'started_at', v_attempt.started_at,
    'submitted_at', v_attempt.submitted_at,
    'finalized_at', v_attempt.finalized_at,
    'created_at', v_attempt.created_at,
    'updated_at', v_attempt.updated_at,
    'score', CASE WHEN v_comp.status::text IN ('RESULT_PUBLISHED', 'ARCHIVED') AND v_attempt.status::text = 'FINALIZED' THEN v_attempt.score ELSE NULL END,
    'runtime_phase', (SELECT runtime.phase FROM public.exam_attempt_runtime runtime WHERE runtime.attempt_id = v_attempt.id),
    'current_position', (SELECT runtime.current_position FROM public.exam_attempt_runtime runtime WHERE runtime.attempt_id = v_attempt.id),
    'question_count', (SELECT runtime.question_count FROM public.exam_attempt_runtime runtime WHERE runtime.attempt_id = v_attempt.id),
    'answered_count', v_answered,
    'skipped_count', v_skipped,
    'timeout_count', v_timeouts,
    'event_count', v_event_count,
    'requires_review', v_skipped >= 3 OR v_timeouts >= 3,
    'review_note', 'Indikator skip/timeout hanya membantu pemeriksaan awal dan bukan bukti kecurangan.',
    'events', coalesce(v_events, '[]'::jsonb),
    'audit_events', coalesce(v_audit, '[]'::jsonb)
  ) INTO v_result;
  RETURN coalesce(v_result, jsonb_build_object(
    'attempt_id', v_attempt.id,
    'competition_id', v_comp.id,
    'competition_title', v_comp.title,
    'competition_status', v_comp.status::text,
    'attempt_status', v_attempt.status::text,
    'participant_name', 'Peserta',
    'events', coalesce(v_events, '[]'::jsonb),
    'audit_events', coalesce(v_audit, '[]'::jsonb)
  ));
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_get_attempt_investigation(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_get_attempt_investigation(uuid)
  TO authenticated;


-- Keep a before/after score snapshot for future official attempt result changes.
-- Preview/simulation attempts are intentionally excluded.
CREATE OR REPLACE FUNCTION private.audit_attempt_result_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF coalesce(NEW.is_preview, false) OR coalesce(OLD.is_preview, false) THEN
    RETURN NEW;
  END IF;

  IF OLD.score IS DISTINCT FROM NEW.score
     OR (
       OLD.status::text IS DISTINCT FROM NEW.status::text
       AND NEW.status::text IN ('FINALIZED', 'EXPIRED')
     ) THEN
    INSERT INTO public.audit_logs(
      actor_user_id, action, entity_type, entity_id, reason, before_data, after_data
    )
    VALUES (
      auth.uid(),
      'attempt.result_snapshot_changed',
      'attempt',
      NEW.id::text,
      'Perubahan status/nilai attempt resmi melalui alur backend.',
      jsonb_build_object(
        'score', OLD.score,
        'status', OLD.status::text,
        'finalized_at', OLD.finalized_at
      ),
      jsonb_build_object(
        'score', NEW.score,
        'status', NEW.status::text,
        'finalized_at', NEW.finalized_at
      )
    );
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.audit_attempt_result_snapshot()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_audit_attempt_result_snapshot ON public.attempts;
CREATE TRIGGER trg_audit_attempt_result_snapshot
AFTER UPDATE OF score, status, finalized_at ON public.attempts
FOR EACH ROW
EXECUTE FUNCTION private.audit_attempt_result_snapshot();
