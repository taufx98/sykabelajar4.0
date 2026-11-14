-- Seed the single trusted first-party public OIDC client.
-- client_id is an identifier, not a credential. The client has no secret and
-- can only use the exact HTTPS SPA callback with Authorization Code + PKCE.
-- Keep this migration versioned with Better Auth 1.7.16's generated schema.

INSERT INTO oauthResource (
  id,
  identifier,
  name,
  accessTokenTtl,
  allowedScopes,
  disabled,
  createdAt,
  updatedAt,
  policyVersion
)
VALUES (
  'e971ad95-3e50-41f4-9277-0bae1ac4ad3d',
  'https://sykabelajar.my.id',
  'SYKABELAJAR Supabase API',
  300,
  '["openid","profile","email"]',
  0,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  1
)
ON CONFLICT(identifier) DO NOTHING;

INSERT INTO oauthClient (
  id,
  clientId,
  clientSecret,
  disabled,
  skipConsent,
  scopes,
  createdAt,
  updatedAt,
  name,
  redirectUris,
  tokenEndpointAuthMethod,
  applicationType,
  grantTypes,
  responseTypes,
  requirePKCE
)
VALUES (
  '41eed215-dda8-47a2-9d54-06d5eaa64426',
  'sykabelajar_web_tSXvLgIj2QKRk69g14KgjRD12uQERQnFYm7_kucut1Y',
  NULL,
  0,
  1,
  '["openid","profile","email"]',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  'SYKABELAJAR Web',
  '["https://sykabelajar.my.id/auth/oidc/callback"]',
  'none',
  'web',
  '["authorization_code"]',
  '["code"]',
  1
)
ON CONFLICT(clientId) DO NOTHING;

INSERT INTO oauthClientResource (
  id,
  clientId,
  resourceId,
  createdAt
)
VALUES (
  '7082daa3-90e7-4134-b96f-6f0ad639185e',
  'sykabelajar_web_tSXvLgIj2QKRk69g14KgjRD12uQERQnFYm7_kucut1Y',
  'https://sykabelajar.my.id',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
ON CONFLICT(clientId, resourceId) DO NOTHING;

INSERT INTO auth_worker_internal_config (key, value, created_at)
VALUES (
  'first_party_oauth_client_id',
  'sykabelajar_web_tSXvLgIj2QKRk69g14KgjRD12uQERQnFYm7_kucut1Y',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
ON CONFLICT(key) DO UPDATE SET
  value = excluded.value,
  created_at = excluded.created_at;
