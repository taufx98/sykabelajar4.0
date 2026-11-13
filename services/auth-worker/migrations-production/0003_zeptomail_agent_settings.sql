-- Encrypted ZeptoMail Agent profiles for Better Auth transactional email.
-- API tokens are encrypted by the Worker before they reach D1.
CREATE TABLE IF NOT EXISTS auth_email_accounts (
  id TEXT PRIMARY KEY NOT NULL,
  label TEXT NOT NULL,
  sender_address TEXT NOT NULL,
  sender_name TEXT NOT NULL,
  bounce_address TEXT,
  send_mail_token_ciphertext TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS auth_email_accounts_updated_at_idx
  ON auth_email_accounts(updated_at DESC);

CREATE TABLE IF NOT EXISTS auth_email_settings (
  id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
  active_account_id TEXT,
  updated_at TEXT NOT NULL,
  updated_by TEXT,
  FOREIGN KEY (active_account_id)
    REFERENCES auth_email_accounts(id)
    ON DELETE SET NULL
);

INSERT OR IGNORE INTO auth_email_settings (id, active_account_id, updated_at, updated_by)
VALUES (1, NULL, CURRENT_TIMESTAMP, NULL);

CREATE TABLE IF NOT EXISTS auth_email_admin_test_limits (
  user_id TEXT PRIMARY KEY NOT NULL,
  last_sent_at INTEGER NOT NULL
);
