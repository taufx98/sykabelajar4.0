-- Admin-controlled email-verification policy for the Production Better Auth Worker.
-- The only seeded policy is the secure default: verification remains required.
-- No user, session, credential, or application data is created by this migration.
CREATE TABLE IF NOT EXISTS auth_runtime_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  email_verification_required INTEGER NOT NULL DEFAULT 1 CHECK (email_verification_required IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_by TEXT NOT NULL DEFAULT 'system'
);
INSERT OR IGNORE INTO auth_runtime_settings (id, email_verification_required, updated_by)
VALUES (1, 1, 'system');
