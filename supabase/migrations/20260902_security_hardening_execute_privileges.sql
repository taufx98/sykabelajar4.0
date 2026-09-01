-- SykaBelajar 4.0 Phase 03B
-- Security hardening only. No business data changes.

DO $$
DECLARE
  r record;
  allow_public constant text[] := ARRAY[
    'get_platform_stats',
    'get_public_coin_leaderboard',
    'get_public_coin_leaderboard_v2',
    'get_public_competitions',
    'get_public_leaderboard',
    'get_public_leaderboard_v2',
    'get_public_profile_by_username'
  ];
BEGIN
  FOR r IN
    SELECT n.nspname AS schema_name,
           p.proname AS function_name,
           pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef = true
  LOOP
    IF NOT (r.function_name = ANY(allow_public)) THEN
      EXECUTE format(
        'REVOKE EXECUTE ON FUNCTION %I.%I(%s) FROM PUBLIC, anon',
        r.schema_name, r.function_name, r.args
      );
    END IF;
  END LOOP;

  FOREACH r.function_name IN ARRAY allow_public LOOP
    FOR r IN
      SELECT n.nspname AS schema_name,
             p.proname AS function_name,
             pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.prosecdef = true
        AND p.proname = r.function_name
    LOOP
      EXECUTE format(
        'GRANT EXECUTE ON FUNCTION %I.%I(%s) TO anon',
        r.schema_name, r.function_name, r.args
      );
      EXECUTE format(
        'GRANT EXECUTE ON FUNCTION %I.%I(%s) TO authenticated',
        r.schema_name, r.function_name, r.args
      );
    END LOOP;
  END LOOP;
END $$;

-- Standardize function search_path for previously flagged functions.
ALTER FUNCTION public.guard_competition_sensitive_update() SET search_path = public, private;
ALTER FUNCTION public.get_essay_similarity(text,text) SET search_path = public, private;
ALTER FUNCTION public.normalize_similarity_text(text) SET search_path = public, private;
ALTER FUNCTION public.calculate_essay_similarity(text,text) SET search_path = public, private;
ALTER FUNCTION public.set_updated_at() SET search_path = public, private;
ALTER FUNCTION public.calculate_text_similarity(text,text) SET search_path = public, private;
ALTER FUNCTION public.touch_daily_task_updated_at() SET search_path = public, private;
ALTER FUNCTION public.touch_job_runs_updated_at() SET search_path = public, private;
ALTER FUNCTION public.can_change_display_name(uuid) SET search_path = public, private;
ALTER FUNCTION public.get_display_name_cooldown(uuid) SET search_path = public, private;
ALTER FUNCTION public.get_name_change_cooldown(uuid) SET search_path = public, private;
ALTER FUNCTION public.admin_adjust_user_currency(uuid,text,bigint,text) SET search_path = public, private;
ALTER FUNCTION public.get_user_currency_logs(uuid,integer) SET search_path = public, private;
ALTER FUNCTION public.get_all_currency_logs(integer) SET search_path = public, private;
ALTER FUNCTION public.admin_bulk_adjust_currency(uuid[],text,bigint,text) SET search_path = public, private;