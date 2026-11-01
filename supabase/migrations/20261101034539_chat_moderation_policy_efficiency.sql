-- Consolidate chat moderation RLS checks and remove a referral index
-- that is no longer needed after qualification became event-driven.
BEGIN;

DROP POLICY IF EXISTS chat_user_moderation_self_read
  ON public.chat_user_moderation;
DROP POLICY IF EXISTS chat_user_moderation_admin_select
  ON public.chat_user_moderation;
DROP POLICY IF EXISTS chat_user_moderation_admin_write
  ON public.chat_user_moderation;

-- A single SELECT policy serves both administrators and the record owner.
-- (SELECT auth.uid()) is evaluated as an initplan rather than per row.
CREATE POLICY chat_user_moderation_read
  ON public.chat_user_moderation
  FOR SELECT
  TO authenticated
  USING (
    public.is_active_admin((SELECT auth.uid()))
    OR user_id = (SELECT auth.uid())
  );

-- Keep administrators' original write permissions, but do not let a FOR ALL
-- policy overlap SELECT and trigger repeated permissive-policy evaluation.
CREATE POLICY chat_user_moderation_admin_insert
  ON public.chat_user_moderation
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_active_admin((SELECT auth.uid())));

CREATE POLICY chat_user_moderation_admin_update
  ON public.chat_user_moderation
  FOR UPDATE
  TO authenticated
  USING (public.is_active_admin((SELECT auth.uid())))
  WITH CHECK (public.is_active_admin((SELECT auth.uid())));

CREATE POLICY chat_user_moderation_admin_delete
  ON public.chat_user_moderation
  FOR DELETE
  TO authenticated
  USING (public.is_active_admin((SELECT auth.uid())));

-- Qualification no longer scans follows when email confirmation is delayed:
-- the server activity trigger already stores the trusted first event on the
-- referral row. Remove the now-unneeded index and cover the remaining FK.
DROP INDEX IF EXISTS public.idx_follows_follower_created;

CREATE INDEX IF NOT EXISTS idx_chat_user_moderation_blocked_by
  ON public.chat_user_moderation (blocked_by);

COMMIT;
