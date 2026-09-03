-- Snapshot of extensions and pg_cron jobs verified on 2026-09-03.
-- Run after the main schema/data restore in Supabase2.
-- Supabase-managed extensions may already exist; IF NOT EXISTS keeps this idempotent.

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

-- Realtime publication snapshot.
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.ad_banners;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_blocks;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_threads;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.competitions;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.follows;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Recreate only the two verified active source cron jobs.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT jobid
    FROM cron.job
    WHERE command IN (
      'SELECT public.verify_pending_referrals();',
      ' select public.fetch_and_save_supabase_logs; ',
      ' select public.fetch_and_save_supabase_logs(); '
    )
  LOOP
    PERFORM cron.unschedule(r.jobid);
  END LOOP;

  PERFORM cron.schedule('syka-verify-pending-referrals', '0 * * * *', 'SELECT public.verify_pending_referrals();');
  PERFORM cron.schedule('syka-capture-supabase-logs', '0 * * * *', 'SELECT public.fetch_and_save_supabase_logs();');
END $$;
