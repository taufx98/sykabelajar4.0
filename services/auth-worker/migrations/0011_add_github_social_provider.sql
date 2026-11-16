-- Add GitHub as a managed social-login provider without changing existing credentials.
-- Rebuild only the provider allowlist constraint; preserve all existing rows verbatim.
CREATE TABLE auth_social_provider_settings_next (
  provider TEXT PRIMARY KEY CHECK (provider IN ('google', 'github', 'facebook', 'twitter')),
  client_id TEXT NOT NULL CHECK (length(trim(client_id)) BETWEEN 1 AND 512),
  client_secret_ciphertext TEXT NOT NULL CHECK (length(client_secret_ciphertext) > 0),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO auth_social_provider_settings_next
  (provider, client_id, client_secret_ciphertext, enabled, created_by, updated_by, created_at, updated_at)
SELECT
  provider, client_id, client_secret_ciphertext, enabled, created_by, updated_by, created_at, updated_at
FROM auth_social_provider_settings;

DROP TABLE auth_social_provider_settings;
ALTER TABLE auth_social_provider_settings_next RENAME TO auth_social_provider_settings;
