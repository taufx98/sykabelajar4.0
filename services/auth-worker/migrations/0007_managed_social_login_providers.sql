-- Managed Google/Facebook/X OAuth credentials for the staging Admin panel.
-- Client secrets are AES-256-GCM ciphertext only; the encryption key is a
-- separate Cloudflare Worker secret and is never stored in D1.
CREATE TABLE auth_social_provider_settings (
  provider TEXT PRIMARY KEY CHECK (provider IN ('google', 'facebook', 'twitter')),
  client_id TEXT NOT NULL CHECK (length(trim(client_id)) BETWEEN 1 AND 512),
  client_secret_ciphertext TEXT NOT NULL CHECK (length(client_secret_ciphertext) > 0),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE auth_social_provider_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  managed_mode INTEGER NOT NULL DEFAULT 0 CHECK (managed_mode IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_by TEXT
);

INSERT INTO auth_social_provider_meta (id, revision, managed_mode)
VALUES (1, 1, 0);
