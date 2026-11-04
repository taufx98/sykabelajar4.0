-- Fix anonymous NULL semantics and enforce the full public-profile boundary.
-- A SECURITY DEFINER function bypasses table RLS, so it must enforce both
-- profile visibility and the per-profile connection-list setting itself.

CREATE OR REPLACE FUNCTION public.get_profile_connections(
  p_profile_id uuid,
  p_mode text
)
RETURNS TABLE(
  id uuid,
  username text,
  full_name text,
  avatar_url text,
  verification_type text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_profile_is_public boolean;
  v_allow boolean;
BEGIN
  IF p_profile_id IS NULL
     OR p_mode IS NULL
     OR p_mode NOT IN ('following', 'followers') THEN
    RETURN;
  END IF;

  SELECT
    coalesce(profile.is_public, false),
    CASE
      WHEN p_mode = 'following' THEN coalesce(settings.show_following_popup, true)
      ELSE coalesce(settings.show_social_popup, true)
    END
  INTO v_profile_is_public, v_allow
  FROM public.profiles AS profile
  LEFT JOIN public.profile_ui_settings AS settings
    ON settings.user_id = profile.id
  WHERE profile.id = p_profile_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_uid IS DISTINCT FROM p_profile_id
     AND NOT v_profile_is_public THEN
    RETURN;
  END IF;

  IF v_uid IS DISTINCT FROM p_profile_id
     AND NOT coalesce(v_allow, true) THEN
    RETURN;
  END IF;

  IF p_mode = 'following' THEN
    RETURN QUERY
    SELECT p.id, p.username, p.full_name, p.avatar_url, p.verification_type
    FROM public.follows AS f
    JOIN public.profiles AS p ON p.id = f.following_id
    WHERE f.follower_id = p_profile_id
      AND f.status IN ('approved', 'auto')
    ORDER BY p.username;
  ELSE
    RETURN QUERY
    SELECT p.id, p.username, p.full_name, p.avatar_url, p.verification_type
    FROM public.follows AS f
    JOIN public.profiles AS p ON p.id = f.follower_id
    WHERE f.following_id = p_profile_id
      AND f.status IN ('approved', 'auto')
    ORDER BY p.username;
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_profile_connections(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_profile_connections(uuid, text) FROM anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_profile_connections(uuid, text) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.get_profile_connections(uuid, text) IS
  'Returns connection lists only when the target profile is public and its corresponding connection visibility setting permits it; owners can always view their own lists.';
