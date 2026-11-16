-- Add provider identity to encrypted transactional email accounts.
-- Existing Agent rows remain ZeptoMail; no credential or account data is rewritten.
ALTER TABLE auth_email_accounts
  ADD COLUMN provider TEXT NOT NULL DEFAULT 'zeptomail'
  CHECK (provider IN ('zeptomail', 'brevo'));
