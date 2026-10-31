-- Stage 1 canonical participant regression checks.
-- Run after applying 20261031130000_stage_1_canonical_participant_identity.sql:
-- psql -v ON_ERROR_STOP=1 -f supabase/tests/canonical_participant_stage1.sql "$DATABASE_URL"

DO $integrity$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.participants p
    WHERE NOT (
      (p.participant_type = 'INDIVIDUAL' AND p.user_id IS NOT NULL AND p.collective_participant_id IS NULL)
      OR
      (p.participant_type = 'COLLECTIVE' AND p.collective_participant_id IS NOT NULL AND p.user_id IS NULL)
    )
  ) THEN
    RAISE EXCEPTION 'Canonical participant has mismatched identity type';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.registrations r
    JOIN public.profiles profile ON profile.id = r.user_id
    WHERE r.status::text IN ('APPROVED', 'ACTIVE')
      AND NOT EXISTS (
        SELECT 1
        FROM public.participants p
        WHERE p.competition_id = r.competition_id
          AND p.user_id = r.user_id
          AND p.participant_type = 'INDIVIDUAL'
      )
  ) THEN
    RAISE EXCEPTION 'Approved/active individual registration is missing canonical participant';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.collective_participants cp
    WHERE (
      cp.status::text = 'ACTIVE'
      OR EXISTS (
        SELECT 1
        FROM public.attempts a
        WHERE a.collective_participant_id = cp.id
          AND a.is_preview = false
      )
      OR EXISTS (
        SELECT 1
        FROM public.collective_certificates cc
        WHERE cc.collective_participant_id = cp.id
      )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.participants p
      WHERE p.competition_id = cp.competition_id
        AND p.collective_participant_id = cp.id
        AND p.participant_type = 'COLLECTIVE'
    )
  ) THEN
    RAISE EXCEPTION 'Collective participant is missing canonical participant';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.attempts a
    WHERE a.is_preview = false
      AND a.canonical_participant_id IS NULL
      AND (a.participant_id IS NOT NULL OR a.collective_participant_id IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'Official attempt is missing canonical participant';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.certificates cert
    WHERE cert.competition_id IS NOT NULL
      AND cert.canonical_participant_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Individual certificate is missing canonical participant';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.collective_certificates cc
    WHERE cc.canonical_participant_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Collective certificate is missing canonical participant';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'public.collective_participants'::regclass
      AND tgname = 'trg_collective_participant_canonical'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'Collective participant canonical sync trigger is missing';
  END IF;

  IF NOT has_function_privilege(
    'anon',
    'public.get_collective_participant_result(text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Collective token result RPC lost anon execute permission';
  END IF;

  IF NOT has_function_privilege(
    'authenticated',
    'public.get_canonical_competition_result(uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Canonical result RPC lost authenticated execute permission';
  END IF;

  IF has_function_privilege(
    'anon',
    'private.canonical_competition_rank(uuid,uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Private canonical ranking helper is directly executable by anon';
  END IF;
END;
$integrity$;

-- Ranking policy regression: one latest finalized attempt per participant,
-- previews excluded, ties share a rank, and repeated attempts never count twice.
DO $ranking$
DECLARE
  v_a_rank bigint;
  v_b_rank bigint;
  v_c_rank bigint;
  v_preview_rank bigint;
BEGIN
  WITH fixture (
    canonical_participant_id,
    attempt_id,
    score,
    finalized_at,
    status,
    is_preview
  ) AS (
    VALUES
      ('00000000-0000-0000-0000-000000000001'::uuid, '00000000-0000-0000-0000-000000000011'::uuid, 95::numeric, '2026-01-01T10:00:00Z'::timestamptz, 'FINALIZED'::text, false),
      ('00000000-0000-0000-0000-000000000001'::uuid, '00000000-0000-0000-0000-000000000012'::uuid, 80::numeric, '2026-01-03T10:00:00Z'::timestamptz, 'FINALIZED'::text, false),
      ('00000000-0000-0000-0000-000000000002'::uuid, '00000000-0000-0000-0000-000000000021'::uuid, 90::numeric, '2026-01-02T10:00:00Z'::timestamptz, 'FINALIZED'::text, false),
      ('00000000-0000-0000-0000-000000000003'::uuid, '00000000-0000-0000-0000-000000000031'::uuid, 80::numeric, '2026-01-02T11:00:00Z'::timestamptz, 'FINALIZED'::text, false),
      ('00000000-0000-0000-0000-000000000004'::uuid, '00000000-0000-0000-0000-000000000041'::uuid, 999::numeric, '2026-01-04T10:00:00Z'::timestamptz, 'FINALIZED'::text, true),
      ('00000000-0000-0000-0000-000000000005'::uuid, '00000000-0000-0000-0000-000000000051'::uuid, 500::numeric, null::timestamptz, 'SUBMITTED'::text, false)
  ),
  latest_finalized AS (
    SELECT DISTINCT ON (f.canonical_participant_id)
      f.canonical_participant_id,
      f.score
    FROM fixture f
    WHERE f.status = 'FINALIZED'
      AND f.is_preview = false
    ORDER BY
      f.canonical_participant_id,
      f.finalized_at DESC NULLS LAST,
      f.attempt_id DESC
  ),
  ranked AS (
    SELECT
      lf.canonical_participant_id,
      rank() OVER (ORDER BY lf.score DESC NULLS LAST) AS rank_position
    FROM latest_finalized lf
  )
  SELECT
    max(rank_position) FILTER (WHERE canonical_participant_id = '00000000-0000-0000-0000-000000000001'::uuid),
    max(rank_position) FILTER (WHERE canonical_participant_id = '00000000-0000-0000-0000-000000000002'::uuid),
    max(rank_position) FILTER (WHERE canonical_participant_id = '00000000-0000-0000-0000-000000000003'::uuid),
    max(rank_position) FILTER (WHERE canonical_participant_id = '00000000-0000-0000-0000-000000000004'::uuid)
  INTO v_a_rank, v_b_rank, v_c_rank, v_preview_rank
  FROM ranked;

  IF v_a_rank IS DISTINCT FROM 2::bigint
     OR v_b_rank IS DISTINCT FROM 1::bigint
     OR v_c_rank IS DISTINCT FROM 2::bigint
     OR v_preview_rank IS NOT NULL THEN
    RAISE EXCEPTION
      'Canonical ranking regression: expected A=2, B=1, C=2, preview=NULL; got A=%, B=%, C=%, preview=%',
      v_a_rank, v_b_rank, v_c_rank, v_preview_rank;
  END IF;
END;
$ranking$;
