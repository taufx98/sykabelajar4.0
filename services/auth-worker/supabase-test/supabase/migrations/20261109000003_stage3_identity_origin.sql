-- Idempotent staging alignment: a fresh local fixture already adds the
-- identity_origin column, while the existing hosted staging project receives
-- this same additive contract after its older fixture baseline.
DO $identity_origin$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'private'
      AND table_name = 'app_users'
      AND column_name = 'identity_origin'
  ) THEN
    ALTER TABLE private.app_users
      ADD COLUMN identity_origin text NOT NULL DEFAULT 'better_auth';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'private.app_users'::regclass
      AND conname = 'app_users_identity_origin_check'
  ) THEN
    ALTER TABLE private.app_users
      ADD CONSTRAINT app_users_identity_origin_check
      CHECK (identity_origin IN ('better_auth', 'legacy_reference'));
  END IF;
END;
$identity_origin$;

COMMENT ON COLUMN private.app_users.identity_origin IS
  'Identity lineage guard: Better Auth identities may authenticate; legacy_reference rows preserve old FK relationships only.';
