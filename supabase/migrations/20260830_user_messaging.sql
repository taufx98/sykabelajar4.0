-- ============================================================
-- User-to-User & User-to-Admin Messaging System
-- ============================================================

-- 1. Add participant_id to chat_threads (the other user in a DM)
ALTER TABLE chat_threads ADD COLUMN IF NOT EXISTS participant_id uuid REFERENCES auth.users(id);

-- Index for fast DM lookups
CREATE INDEX IF NOT EXISTS idx_chat_threads_participant ON chat_threads(participant_id);
CREATE INDEX IF NOT EXISTS idx_chat_threads_user_participant ON chat_threads(user_id, participant_id);

-- 2. RPC: Get or create a DM thread between two users
CREATE OR REPLACE FUNCTION get_or_create_dm_thread(
  p_other_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_my_id uuid := auth.uid();
  v_thread jsonb;
  v_thread_id uuid;
BEGIN
  IF v_my_id = p_other_user_id THEN
    RAISE EXCEPTION 'Cannot start chat with yourself.';
  END IF;

  -- Check if a thread already exists between these two users (in either direction)
  SELECT to_jsonb(ct.*) INTO v_thread
  FROM chat_threads ct
  WHERE ct.status = 'open'
    AND (
      (ct.user_id = v_my_id AND ct.participant_id = p_other_user_id)
      OR (ct.user_id = p_other_user_id AND ct.participant_id = v_my_id)
    )
  LIMIT 1;

  IF v_thread IS NOT NULL THEN
    RETURN v_thread;
  END IF;

  -- Create new thread
  INSERT INTO chat_threads (user_id, participant_id, status)
  VALUES (v_my_id, p_other_user_id, 'open')
  RETURNING to_jsonb(chat_threads.*) INTO v_thread;

  RETURN v_thread;
END;
$$;

-- 3. RPC: Load threads for current user (includes DMs and admin threads)
CREATE OR REPLACE FUNCTION load_my_threads()
RETURNS TABLE (
  id uuid,
  user_id uuid,
  participant_id uuid,
  status text,
  rating int,
  closed_at timestamptz,
  created_at timestamptz,
  other_user_name text,
  other_username text,
  other_avatar_url text,
  last_message text,
  last_message_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  WITH threads AS (
    SELECT t.*
    FROM chat_threads t
    WHERE t.user_id = auth.uid()
       OR t.participant_id = auth.uid()
  ),
  last_msgs AS (
    SELECT DISTINCT ON (cm.thread_id)
      cm.thread_id, cm.body AS last_message, cm.created_at AS last_message_at
    FROM chat_messages cm
    WHERE cm.thread_id IN (SELECT id FROM threads)
    ORDER BY cm.thread_id, cm.created_at DESC
  )
  SELECT
    t.id, t.user_id, t.participant_id, t.status, t.rating, t.closed_at, t.created_at,
    COALESCE(p.full_name, p.username, 'User') AS other_user_name,
    COALESCE(p.username, '') AS other_username,
    p.avatar_url AS other_avatar_url,
    lm.last_message,
    lm.last_message_at
  FROM threads t
  LEFT JOIN profiles p ON p.id = CASE
    WHEN t.participant_id = auth.uid() THEN t.user_id
    ELSE t.participant_id
  END
  LEFT JOIN last_msgs lm ON lm.thread_id = t.id
  ORDER BY COALESCE(lm.last_message_at, t.created_at) DESC;
$$;
