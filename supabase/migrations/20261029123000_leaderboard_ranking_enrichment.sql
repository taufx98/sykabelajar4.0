-- Read-only public ranking extensions for the existing leaderboard.
-- The existing global XP and Edu Coin RPCs remain unchanged.
CREATE OR REPLACE FUNCTION public.get_public_leaderboard_enriched(
  p_period text DEFAULT 'all',
  p_limit integer DEFAULT 100
)
RETURNS TABLE (
  user_id uuid,
  username text,
  display_name text,
  institution text,
  avatar_url text,
  grade text,
  xp bigint,
  rank integer,
  rank_change text,
  point_change bigint,
  average_score numeric,
  competitions_count bigint,
  school_id uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_catalog'
AS $function$
WITH period_settings AS (
  SELECT
    CASE lower(trim(coalesce(p_period, 'all')))
      WHEN 'weekly' THEN 'weekly'
      WHEN 'monthly' THEN 'monthly'
      ELSE 'all'
    END AS period_key,
    CASE lower(trim(coalesce(p_period, 'all')))
      WHEN 'weekly' THEN date_trunc('week', now() AT TIME ZONE 'Asia/Jakarta') AT TIME ZONE 'Asia/Jakarta'
      WHEN 'monthly' THEN date_trunc('month', now() AT TIME ZONE 'Asia/Jakarta') AT TIME ZONE 'Asia/Jakarta'
      ELSE NULL::timestamptz
    END AS period_start
),
public_profiles AS (
  SELECT
    pr.id,
    coalesce(pr.username, '') AS username,
    coalesce(pr.full_name, pr.username, 'Pengguna') AS display_name,
    pr.institution,
    pr.avatar_url,
    pr.grade,
    pr.school_id,
    coalesce(nullif(trim(sc.name), ''), nullif(trim(pr.institution), '')) AS school_name,
    coalesce(pr.total_xp, 0)::bigint AS total_xp,
    pr.edu_coin,
    pr.created_at
  FROM public.profiles pr
  LEFT JOIN public.schools sc ON sc.id = pr.school_id
  LEFT JOIN public.user_roles ur
    ON ur.user_id = pr.id
   AND ur.role::text = 'admin'
   AND ur.is_active = true
  WHERE ur.user_id IS NULL
    AND pr.status::text = 'ACTIVE'
    AND coalesce(pr.is_public, true) = true
),
period_xp AS (
  SELECT l.user_id, sum(l.amount)::numeric AS earned_xp
  FROM public.xp_ledger l
  CROSS JOIN period_settings ps
  WHERE ps.period_key <> 'all'
    AND l.created_at >= ps.period_start
  GROUP BY l.user_id
),
competition_counts AS (
  SELECT r.user_id, count(DISTINCT r.competition_id)::bigint AS competitions_count
  FROM public.registrations r
  WHERE r.status::text IN ('APPROVED', 'ACTIVE')
  GROUP BY r.user_id
),
score_averages AS (
  SELECT a.participant_id AS user_id, avg(a.score)::numeric AS average_score
  FROM public.attempts a
  WHERE a.is_preview = false
    AND a.status::text = 'FINALIZED'
    AND a.participant_id IS NOT NULL
  GROUP BY a.participant_id
),
scored AS (
  SELECT
    pp.*,
    CASE
      WHEN ps.period_key = 'all' THEN pp.total_xp
      ELSE greatest(0, round(coalesce(px.earned_xp, 0)))::bigint
    END AS period_xp,
    coalesce(sa.average_score, NULL::numeric) AS average_score,
    coalesce(cc.competitions_count, 0)::bigint AS competitions_count
  FROM public_profiles pp
  CROSS JOIN period_settings ps
  LEFT JOIN period_xp px ON px.user_id = pp.id
  LEFT JOIN score_averages sa ON sa.user_id = pp.id
  LEFT JOIN competition_counts cc ON cc.user_id = pp.id
),
ranked AS (
  SELECT
    s.*,
    row_number() OVER (ORDER BY s.period_xp DESC, s.created_at ASC, s.id) AS position
  FROM scored s
)
SELECT
  r.id AS user_id,
  r.username,
  r.display_name,
  r.institution,
  r.avatar_url,
  r.grade,
  r.period_xp AS xp,
  r.position::integer AS rank,
  'same'::text AS rank_change,
  0::bigint AS point_change,
  r.average_score,
  r.competitions_count,
  r.school_id
FROM ranked r
WHERE r.position <= greatest(1, least(coalesce(p_limit, 100), 1000))
  AND (lower(trim(coalesce(p_period, 'all'))) NOT IN ('weekly', 'monthly') OR r.period_xp > 0)
ORDER BY r.position;
$function$;

CREATE OR REPLACE FUNCTION public.get_public_school_leaderboard(
  p_period text DEFAULT 'all',
  p_limit integer DEFAULT 100
)
RETURNS TABLE (
  school_key text,
  school_id uuid,
  school_name text,
  student_count integer,
  levels text,
  average_score numeric,
  competitions_count bigint,
  xp bigint,
  rank integer,
  top_students jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_catalog'
AS $function$
WITH period_settings AS (
  SELECT
    CASE lower(trim(coalesce(p_period, 'all')))
      WHEN 'weekly' THEN 'weekly'
      WHEN 'monthly' THEN 'monthly'
      ELSE 'all'
    END AS period_key,
    CASE lower(trim(coalesce(p_period, 'all')))
      WHEN 'weekly' THEN date_trunc('week', now() AT TIME ZONE 'Asia/Jakarta') AT TIME ZONE 'Asia/Jakarta'
      WHEN 'monthly' THEN date_trunc('month', now() AT TIME ZONE 'Asia/Jakarta') AT TIME ZONE 'Asia/Jakarta'
      ELSE NULL::timestamptz
    END AS period_start
),
public_profiles AS (
  SELECT
    pr.id,
    coalesce(pr.username, '') AS username,
    coalesce(pr.full_name, pr.username, 'Pengguna') AS display_name,
    pr.institution,
    pr.avatar_url,
    pr.grade,
    pr.school_id,
    coalesce(nullif(trim(sc.name), ''), nullif(trim(pr.institution), '')) AS school_name,
    coalesce(pr.total_xp, 0)::bigint AS total_xp,
    pr.created_at
  FROM public.profiles pr
  LEFT JOIN public.schools sc ON sc.id = pr.school_id
  LEFT JOIN public.user_roles ur
    ON ur.user_id = pr.id
   AND ur.role::text = 'admin'
   AND ur.is_active = true
  WHERE ur.user_id IS NULL
    AND pr.status::text = 'ACTIVE'
    AND coalesce(pr.is_public, true) = true
),
period_xp AS (
  SELECT l.user_id, sum(l.amount)::numeric AS earned_xp
  FROM public.xp_ledger l
  CROSS JOIN period_settings ps
  WHERE ps.period_key <> 'all'
    AND l.created_at >= ps.period_start
  GROUP BY l.user_id
),
competition_counts AS (
  SELECT r.user_id, count(DISTINCT r.competition_id)::bigint AS competitions_count
  FROM public.registrations r
  WHERE r.status::text IN ('APPROVED', 'ACTIVE')
  GROUP BY r.user_id
),
score_averages AS (
  SELECT a.participant_id AS user_id, avg(a.score)::numeric AS average_score
  FROM public.attempts a
  WHERE a.is_preview = false
    AND a.status::text = 'FINALIZED'
    AND a.participant_id IS NOT NULL
  GROUP BY a.participant_id
),
scored AS (
  SELECT
    pp.*,
    CASE
      WHEN ps.period_key = 'all' THEN pp.total_xp
      ELSE greatest(0, round(coalesce(px.earned_xp, 0)))::bigint
    END AS period_xp,
    sa.average_score,
    coalesce(cc.competitions_count, 0)::bigint AS competitions_count,
    coalesce('id:' || pp.school_id::text, 'name:' || lower(trim(pp.school_name))) AS school_key
  FROM public_profiles pp
  CROSS JOIN period_settings ps
  LEFT JOIN period_xp px ON px.user_id = pp.id
  LEFT JOIN score_averages sa ON sa.user_id = pp.id
  LEFT JOIN competition_counts cc ON cc.user_id = pp.id
  WHERE pp.school_name IS NOT NULL
),
school_members AS (
  SELECT * FROM scored
),
school_summary AS (
  SELECT
    sm.school_key,
    (array_agg(sm.school_id) FILTER (WHERE sm.school_id IS NOT NULL))[1] AS school_id,
    min(sm.school_name) AS school_name,
    count(*)::integer AS student_count,
    avg(sm.average_score)::numeric AS average_score,
    sum(sm.competitions_count)::bigint AS competitions_count,
    sum(sm.period_xp)::bigint AS xp
  FROM school_members sm
  GROUP BY sm.school_key
),
school_levels AS (
  SELECT labels.school_key, string_agg(labels.level_label, ' · ' ORDER BY labels.level_label) AS levels
  FROM (
    SELECT DISTINCT
      sm.school_key,
      CASE
        WHEN lower(trim(coalesce(sm.grade, ''))) LIKE 'sd%' THEN 'SD'
        WHEN lower(trim(coalesce(sm.grade, ''))) LIKE 'smp%' THEN 'SMP'
        WHEN lower(trim(coalesce(sm.grade, ''))) LIKE 'sma%'
          OR lower(trim(coalesce(sm.grade, ''))) LIKE 'smk%'
          OR lower(trim(coalesce(sm.grade, ''))) = 'alumni' THEN 'SMA/SMK'
        ELSE NULL
      END AS level_label
    FROM school_members sm
  ) labels
  WHERE labels.level_label IS NOT NULL
  GROUP BY labels.school_key
),
ranked_schools AS (
  SELECT
    ss.*,
    coalesce(sl.levels, 'Beragam jenjang') AS levels,
    row_number() OVER (ORDER BY ss.xp DESC, ss.school_name ASC, ss.school_key ASC) AS position
  FROM school_summary ss
  LEFT JOIN school_levels sl ON sl.school_key = ss.school_key
)
SELECT
  rs.school_key,
  rs.school_id,
  rs.school_name,
  rs.student_count,
  rs.levels,
  rs.average_score,
  rs.competitions_count,
  rs.xp,
  rs.position::integer AS rank,
  coalesce((
    SELECT jsonb_agg(
      jsonb_build_object(
        'user_id', top_student.id,
        'username', top_student.username,
        'display_name', top_student.display_name,
        'avatar_url', top_student.avatar_url,
        'grade', top_student.grade,
        'xp', top_student.period_xp,
        'average_score', top_student.average_score,
        'competitions_count', top_student.competitions_count
      )
      ORDER BY top_student.period_xp DESC, top_student.display_name ASC
    )
    FROM (
      SELECT sm.*
      FROM school_members sm
      WHERE sm.school_key = rs.school_key
      ORDER BY sm.period_xp DESC, sm.display_name ASC
      LIMIT 5
    ) top_student
  ), '[]'::jsonb) AS top_students
FROM ranked_schools rs
WHERE rs.position <= greatest(1, least(coalesce(p_limit, 100), 1000))
  AND (lower(trim(coalesce(p_period, 'all'))) NOT IN ('weekly', 'monthly') OR rs.xp > 0)
ORDER BY rs.position;
$function$;

REVOKE ALL ON FUNCTION public.get_public_leaderboard_enriched(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_leaderboard_enriched(text, integer) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.get_public_school_leaderboard(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_school_leaderboard(text, integer) TO anon, authenticated;
