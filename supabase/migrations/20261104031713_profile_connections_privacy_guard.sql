-- Harden public profile connections against direct RPC calls.
-- SECURITY DEFINER bypasses table RLS, so the function must enforce profile
-- visibility and per-profile connection visibility itself.

CREATE OR REPLACE FUNCTION public.get_profile_connections(
  p_profile_id uuid,
  p_mode text
)
RETURNS TABLE (
  id uuid,
  username text,
  full_name text,
  avatar_url text,
  verification_type text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_profile_is_public boolean;
  v_show_connections boolean;
BEGIN
  IF p_profile_id IS NULL THEN
    RETURN;
  END IF;

  IF p_mode IS NULL OR p_mode NOT IN ('following', 'followers') THEN
    RAISE EXCEPTION 'INVALID_CONNECTION_MODE';
  END IF;

  SELECT
    profile.is_public,
    CASE
      WHEN p_mode = 'following' THEN COALESCE(settings.show_following_popup, true)
      ELSE COALESCE(settings.show_social_popup, true)
    END
  INTO v_profile_is_public, v_show_connections
  FROM public.profiles AS profile
  LEFT JOIN public.profile_ui_settings AS settings
    ON settings.user_id = profile.id
  WHERE profile.id = p_profile_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Match the public profile read policy: a non-owner cannot inspect a private profile.
  -- COALESCE is required because auth.uid() is NULL for anonymous requests.
  IF NOT COALESCE(v_uid = p_profile_id, false)
     AND NOT COALESCE(v_profile_is_public, false) THEN
    RETURN;
  END IF;

  -- A disabled popup is private to its owner, including for anonymous visitors.
  IF NOT COALESCE(v_uid = p_profile_id, false)
     AND NOT COALESCE(v_show_connections, true) THEN
    RETURN;
  END IF;

  IF p_mode = 'following' THEN
    RETURN QUERY
    SELECT target.id, target.username, target.full_name, target.avatar_url, target.verification_type
    FROM public.follows AS f
    JOIN public.profiles AS target ON target.id = f.following_id
    WHERE f.follower_id = p_profile_id
      AND f.status IN ('approved', 'auto')
    ORDER BY target.username;
  ELSE
    RETURN QUERY
    SELECT follower.id, follower.username, follower.full_name, follower.avatar_url, follower.verification_type
    FROM public.follows AS f
    JOIN public.profiles AS follower ON follower.id = f.follower_id
    WHERE f.following_id = p_profile_id
      AND f.status IN ('approved', 'auto')
    ORDER BY follower.username;
  END IF;
END;
$function$;
