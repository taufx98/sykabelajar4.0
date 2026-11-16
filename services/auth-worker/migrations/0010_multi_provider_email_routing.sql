-- Multi-provider transactional email routing for Better Auth.
-- Credentials are encrypted by the Worker before being written to D1.
-- This migration leaves the legacy ZeptoMail/Brevo tables untouched.
CREATE TABLE IF NOT EXISTS auth_email_provider_accounts (
  id TEXT PRIMARY KEY NOT NULL,
  label TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('sendpulse','brevo','mailjet','mailtrap','resend')),
  sender_address TEXT NOT NULL,
  sender_name TEXT NOT NULL,
  credentials_ciphertext TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  priority INTEGER NOT NULL DEFAULT 100 CHECK (priority >= 0),
  quota_hour_limit INTEGER NOT NULL DEFAULT 0 CHECK (quota_hour_limit >= 0),
  quota_day_limit INTEGER NOT NULL DEFAULT 0 CHECK (quota_day_limit >= 0),
  quota_month_limit INTEGER NOT NULL DEFAULT 0 CHECK (quota_month_limit >= 0),
  hour_bucket TEXT NOT NULL DEFAULT '',
  hour_used INTEGER NOT NULL DEFAULT 0 CHECK (hour_used >= 0),
  day_bucket TEXT NOT NULL DEFAULT '',
  day_used INTEGER NOT NULL DEFAULT 0 CHECK (day_used >= 0),
  month_bucket TEXT NOT NULL DEFAULT '',
  month_used INTEGER NOT NULL DEFAULT 0 CHECK (month_used >= 0),
  cooldown_until TEXT,
  last_error_code TEXT,
  last_error_at TEXT,
  last_success_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS auth_email_provider_accounts_route_idx
  ON auth_email_provider_accounts(enabled, priority, created_at);

CREATE TABLE IF NOT EXISTS auth_email_provider_settings (
  id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
  auto_failover_enabled INTEGER NOT NULL DEFAULT 1 CHECK (auto_failover_enabled IN (0,1)),
  updated_at TEXT NOT NULL,
  updated_by TEXT
);

INSERT OR IGNORE INTO auth_email_provider_settings (id, auto_failover_enabled, updated_at, updated_by)
VALUES (1, 1, CURRENT_TIMESTAMP, NULL);
