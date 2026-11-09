-- Keep the isolated staging identity fixture aligned with the Stage 3
-- identity-root draft. UUID-only legacy tombstones are not login identities.
ALTER TABLE private.app_users
  ADD COLUMN identity_origin text NOT NULL DEFAULT 'better_auth'
  CHECK (identity_origin IN ('better_auth', 'legacy_reference'));

COMMENT ON COLUMN private.app_users.identity_origin IS
  'Fixture-only identity lineage guard: Better Auth identities may authenticate; legacy_reference rows preserve old FK relationships only.';
