-- STAGING ONLY: Better Auth OIDC acceptance fixtures for Supabase Storage and Realtime.
-- This bucket is a temporary auth test fixture. It is not application media storage.
-- Production project ref, Cloudinary assets, application tables and policies are untouched.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM storage.buckets
    WHERE id = 'auth-oidc-acceptance' AND public IS DISTINCT FROM false
  ) THEN
    RAISE EXCEPTION 'AUTH_OIDC_ACCEPTANCE_BUCKET_MUST_REMAIN_PRIVATE';
  END IF;

  INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES (
    'auth-oidc-acceptance',
    'auth-oidc-acceptance',
    false,
    1048576,
    ARRAY['text/plain']::text[]
  )
  ON CONFLICT (id) DO NOTHING;
END
$$;

DROP POLICY IF EXISTS "auth_oidc_acceptance_select_own" ON storage.objects;
CREATE POLICY "auth_oidc_acceptance_select_own"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'auth-oidc-acceptance'
  AND (storage.foldername(name))[1] = (SELECT auth.uid()::text)
);

DROP POLICY IF EXISTS "auth_oidc_acceptance_insert_own" ON storage.objects;
CREATE POLICY "auth_oidc_acceptance_insert_own"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'auth-oidc-acceptance'
  AND (storage.foldername(name))[1] = (SELECT auth.uid()::text)
);

DROP POLICY IF EXISTS "auth_oidc_acceptance_update_own" ON storage.objects;
CREATE POLICY "auth_oidc_acceptance_update_own"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'auth-oidc-acceptance'
  AND (storage.foldername(name))[1] = (SELECT auth.uid()::text)
)
WITH CHECK (
  bucket_id = 'auth-oidc-acceptance'
  AND (storage.foldername(name))[1] = (SELECT auth.uid()::text)
);

DROP POLICY IF EXISTS "auth_oidc_acceptance_delete_own" ON storage.objects;
CREATE POLICY "auth_oidc_acceptance_delete_own"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'auth-oidc-acceptance'
  AND (storage.foldername(name))[1] = (SELECT auth.uid()::text)
);

DROP POLICY IF EXISTS "auth_oidc_acceptance_realtime_read_own" ON realtime.messages;
CREATE POLICY "auth_oidc_acceptance_realtime_read_own"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  extension = 'broadcast'
  AND realtime.topic() = 'auth-oidc-acceptance:' || (SELECT auth.uid()::text)
);

DROP POLICY IF EXISTS "auth_oidc_acceptance_realtime_send_own" ON realtime.messages;
CREATE POLICY "auth_oidc_acceptance_realtime_send_own"
ON realtime.messages
FOR INSERT
TO authenticated
WITH CHECK (
  extension = 'broadcast'
  AND realtime.topic() = 'auth-oidc-acceptance:' || (SELECT auth.uid()::text)
);

COMMENT ON POLICY "auth_oidc_acceptance_select_own" ON storage.objects
IS 'STAGING ONLY: Better Auth JWT acceptance test. Allows private test object reads only under the authenticated user UUID folder.';

COMMENT ON POLICY "auth_oidc_acceptance_realtime_read_own" ON realtime.messages
IS 'STAGING ONLY: Better Auth JWT acceptance test. Allows private Broadcast reads only on the authenticated user UUID topic.';
