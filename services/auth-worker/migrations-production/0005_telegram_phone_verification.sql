-- Short-lived, one-use Telegram OIDC challenges for server-verified phone ownership.
-- Phone numbers and Telegram tokens are never stored in D1.
CREATE TABLE IF NOT EXISTS auth_phone_verification_challenges (
  state_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  nonce TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS auth_phone_verification_challenges_user_id_uidx
  ON auth_phone_verification_challenges(user_id);
CREATE INDEX IF NOT EXISTS auth_phone_verification_challenges_expires_idx
  ON auth_phone_verification_challenges(expires_at);
