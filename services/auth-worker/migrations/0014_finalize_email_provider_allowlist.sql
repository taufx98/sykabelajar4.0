-- Finalize the approved managed transactional-email provider allowlist.
-- Rebuild only the provider routing table. Preserve every existing row and
-- encrypted credential byte-for-byte; Better Auth identities and sessions
-- are outside this migration.
DROP INDEX IF EXISTS auth_email_provider_accounts_route_idx;

ALTER TABLE auth_email_provider_accounts
  RENAME TO auth_email_provider_accounts_before_allowlist;

CREATE TABLE auth_email_provider_accounts (
  id TEXT PRIMARY KEY NOT NULL,
  label TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('sendpulse','brevo','mailjet','mailtrap','resend','custom_http')),
  sender_address TEXT NOT NULL,
  sender_name TEXT NOT NULL,
  endpoint_url TEXT,
  auth_mode TEXT,
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
  updated_by TEXT NOT NULL,
  CHECK (
    (provider = 'custom_http' AND endpoint_url IS NOT NULL AND auth_mode IN ('none','bearer','api_key','basic')) OR
    (provider <> 'custom_http' AND endpoint_url IS NULL AND auth_mode IS NULL)
  )
);

INSERT INTO auth_email_provider_accounts (
  id,label,provider,sender_address,sender_name,endpoint_url,auth_mode,credentials_ciphertext,
  enabled,priority,quota_hour_limit,quota_day_limit,quota_month_limit,
  hour_bucket,hour_used,day_bucket,day_used,month_bucket,month_used,
  cooldown_until,last_error_code,last_error_at,last_success_at,created_at,updated_at,created_by,updated_by
)
SELECT
  id,label,provider,sender_address,sender_name,endpoint_url,auth_mode,credentials_ciphertext,
  enabled,priority,quota_hour_limit,quota_day_limit,quota_month_limit,
  hour_bucket,hour_used,day_bucket,day_used,month_bucket,month_used,
  cooldown_until,last_error_code,last_error_at,last_success_at,created_at,updated_at,created_by,updated_by
FROM auth_email_provider_accounts_before_allowlist;

DROP TABLE auth_email_provider_accounts_before_allowlist;

CREATE INDEX IF NOT EXISTS auth_email_provider_accounts_route_idx
  ON auth_email_provider_accounts(enabled, priority, created_at);
