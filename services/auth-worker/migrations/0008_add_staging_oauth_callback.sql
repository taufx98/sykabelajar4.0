-- Add the exact same-site callback for the dedicated migration-branch frontend.
-- Preserve the production callback and reject any unexpected existing redirect list.
-- No account, session, user, role, credential or Supabase row is created or modified.

UPDATE oauthClient
SET redirectUris = '["https://sykabelajar.my.id/auth/oidc/callback","https://staging.sykabelajar.my.id/auth/oidc/callback"]',
    updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE clientId = 'sykabelajar_web_tSXvLgIj2QKRk69g14KgjRD12uQERQnFYm7_kucut1Y'
  AND redirectUris = '["https://sykabelajar.my.id/auth/oidc/callback"]'
  AND EXISTS (
    SELECT 1 FROM oauthClientResource
    WHERE oauthClientResource.clientId = oauthClient.clientId
      AND oauthClientResource.resourceId = 'https://sykabelajar.my.id'
  )
  AND EXISTS (
    SELECT 1 FROM auth_worker_internal_config
    WHERE auth_worker_internal_config.key = 'first_party_oauth_client_id'
      AND auth_worker_internal_config.value = oauthClient.clientId
  );
