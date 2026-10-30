-- Chat message deletion is a sender-only, server-enforced 24-hour action.
-- Content is replaced with a tombstone so every participant sees that the message
-- was removed, while conversation ordering and pagination remain intact.

ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

ALTER TABLE public.chat_group_messages
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE OR REPLACE FUNCTION public.delete_chat_message(p_message_id uuid)
RETURNS public.chat_messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_catalog
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_message public.chat_messages;
  v_thread public.chat_threads;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  SELECT m.*
    INTO v_message
    FROM public.chat_messages m
   WHERE m.id = p_message_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MESSAGE_NOT_FOUND';
  END IF;

  IF v_message.sender_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'MESSAGE_OWNER_ONLY';
  END IF;

  IF v_message.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'MESSAGE_ALREADY_DELETED';
  END IF;

  IF v_message.created_at <= now() - interval '24 hours'
     OR v_message.created_at > now() THEN
    RAISE EXCEPTION 'MESSAGE_DELETE_EXPIRED';
  END IF;

  SELECT t.*
    INTO v_thread
    FROM public.chat_threads t
   WHERE t.id = v_message.thread_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'THREAD_NOT_FOUND';
  END IF;

  IF NOT (
    v_thread.user_id = v_uid
    OR v_thread.participant_id = v_uid
    OR (v_thread.thread_type = 'ticket' AND public.is_active_admin(v_uid))
  ) THEN
    RAISE EXCEPTION 'ACCESS_DENIED';
  END IF;

  UPDATE public.chat_messages
     SET body = 'Pesan ini telah dihapus.',
         deleted_at = now()
   WHERE id = p_message_id
   RETURNING * INTO v_message;

  RETURN v_message;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_chat_group_message(p_message_id uuid)
RETURNS public.chat_group_messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_catalog
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_message public.chat_group_messages;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  SELECT m.*
    INTO v_message
    FROM public.chat_group_messages m
   WHERE m.id = p_message_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MESSAGE_NOT_FOUND';
  END IF;

  IF v_message.sender_user_id IS DISTINCT FROM v_uid
     OR v_message.sender_collective_participant_id IS NOT NULL THEN
    RAISE EXCEPTION 'MESSAGE_OWNER_ONLY';
  END IF;

  IF v_message.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'MESSAGE_ALREADY_DELETED';
  END IF;

  IF v_message.created_at <= now() - interval '24 hours'
     OR v_message.created_at > now() THEN
    RAISE EXCEPTION 'MESSAGE_DELETE_EXPIRED';
  END IF;

  IF NOT private.chat_group_user_is_member(v_message.group_id, v_uid) THEN
    RAISE EXCEPTION 'ACCESS_DENIED';
  END IF;

  UPDATE public.chat_group_messages
     SET body = 'Pesan ini telah dihapus.',
         deleted_at = now()
   WHERE id = p_message_id
   RETURNING * INTO v_message;

  UPDATE public.chat_groups
     SET updated_at = now()
   WHERE id = v_message.group_id;

  RETURN v_message;
END;
$function$;

-- SECURITY DEFINER RPCs must not inherit PUBLIC/anon execution.
REVOKE ALL ON FUNCTION public.delete_chat_message(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_chat_message(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.delete_chat_group_message(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_chat_group_message(uuid) TO authenticated;
