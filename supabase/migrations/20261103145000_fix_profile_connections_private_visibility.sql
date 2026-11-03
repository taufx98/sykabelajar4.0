-- Fix anonymous NULL semantics in the profile connections privacy guard.
-- A NULL auth.uid() must be treated as a non-owner when a profile hides connections.

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
  v_allow boolean;
BEGIN
  -- Invalid inputs fail closed; only the two UI-supported modes are accepted.
  IF p_profile_id IS NULL
     OR p_mode IS NULL
     OR p_mode NOT IN ('following', 'followers') THEN
    RETURN;
  END IF;

  IF p_mode = 'following' THEN
    SELECT coalesce(s.show_following_popup, true)
      INTO v_allow
    FROM public.profile_ui_settings AS s
    WHERE s.user_id = p_profile_id;
  ELSE
    SELECT coalesce(s.show_social_popup, true)
      INTO v_allow
    FROM public.profile_ui_settings AS s
    WHERE s.user_id = p_profile_id;
  END IF;

  -- IS DISTINCT FROM is NULL-safe: an anonymous caller is never considered
  -- the owner of a UUID profile merely because auth.uid() is NULL.
  IF v_uid IS DISTINCT FROM p_profile_id
     AND NOT coalesce(v_allow, true) THEN
    RETURN;
  END IF;

  IF p_mode = 'following' THEN
    RETURN QUERY
    SELECT
      p.id,
      p.username,
      p.full_name,
      p.avatar_url,
      p.verification_type
    FROM public.follows AS f
    JOIN public.profiles AS p ON p.id = f.following_id
    WHERE f.follower_id = p_profile_id
      AND f.status IN ('approved', 'auto')
    ORDER BY p.username;
  ELSE
    RETURN QUERY
    SELECT
      p.id,
      p.username,
      p.full_name,
      p.avatar_url,
      p.verification_type
    FROM public.follows AS f
    JOIN public.profiles AS p ON p.id = f.follower_id
    WHERE f.following_id = p_profile_id
      AND f.status IN ('approved', 'auto')
    ORDER BY p.username;
  END IF;
END;
$function$;

-- Preserve the currently intended API callers, but avoid an implicit PUBLIC grant.
REVOKE ALL ON FUNCTION public.get_profile_connections(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_profile_connections(uuid, text) FROM anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_profile_connections(uuid, text) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.get_profile_connections(uuid, text) IS
  'Returns public profile connections only when the profile visibility setting permits it; anonymous callers are treated as non-owners.';
