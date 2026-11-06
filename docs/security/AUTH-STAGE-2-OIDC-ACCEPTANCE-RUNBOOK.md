# Stage 2 — OIDC/JWT hosted acceptance runbook

Status: **the non-production issuer is deployed and hosted discovery/JWKS smoke tests pass**. Supabase third-party Custom OIDC acceptance and downstream API/RLS tests remain pending in an isolated Supabase Free project. This runbook does not authorize registering the issuer in production or changing production Supabase.

## Fixed issuer contract

After the staging Worker and hostname have been deployed and verified, the exact issuer is expected to be:

- Issuer: `https://auth.sykabelajar.my.id/api/auth`
- Discovery: `https://auth.sykabelajar.my.id/api/auth/.well-known/openid-configuration`
- JWKS: the exact URL returned by discovery
- OAuth callback: `https://sykabelajar.my.id/auth/oidc/callback`
- Resource audience: `https://sykabelajar.my.id`
- Client: `sykabelajar_web_tSXvLgIj2QKRk69g14KgjRD12uQERQnFYm7_kucut1Y` (public client ID; not a secret)
- Grant: Authorization Code only
- Client authentication: `none` (public SPA client)
- PKCE: mandatory `S256`
- Scopes: `openid profile email`
- Refresh tokens / `offline_access`: intentionally disabled
- Access-token lifetime: at most 300 seconds

Do not use a workers.dev issuer for the final hosted acceptance because Supabase must trust the same stable HTTPS issuer URL used by the application. The auth hostname must resolve to the isolated Worker before this runbook is used.

## Provider discovery and signing-key checks

From a trusted environment, request the discovery URL and confirm:

1. HTTP 200 and a JSON OIDC discovery document.
2. `issuer` equals the fixed issuer above exactly, including `/api/auth`.
3. Authorization endpoint, token endpoint, UserInfo endpoint, and `jwks_uri` are HTTPS and use that same auth host.
4. `code_challenge_methods_supported` includes `S256`.
5. `scopes_supported` includes only the intended identity scopes needed for this integration; do not enable `offline_access`.

Fetch the returned JWKS URI. It must expose a public asymmetric ES256 key with a non-empty `kid` (EC / P-256). Public JWKS must not expose private key material such as `d`. Keep Better Auth's D1-backed private key storage and encryption enabled; never export private keys to CI artifacts or the repository.

## Token acceptance contract

Complete the authorization-code flow from the exact first-party callback and inspect tokens only in a secure test environment. A valid access token must satisfy all of the following:

- Header: `alg=ES256`, with a `kid` present in the issuer's JWKS.
- `iss`: exact issuer URL above.
- `sub`: the Better Auth user UUID.
- `aud`: includes the configured SYKABELAJAR resource audience; verify it explicitly when validating the token for the protected API.
- `role`: `authenticated` (PostgreSQL role only, never a business role).
- `iat` and `exp`: valid; lifetime no longer than 300 seconds.
- The public client receives no refresh token.

The OIDC ID token must validate with the same ES256/JWKS, exact issuer, the public client ID as audience, the same UUID subject, and the original authorization-request nonce.

## Negative security checks

The local suite already verifies these controls; repeat them against the hosted staging issuer before enabling the Supabase provider:

- Authorization request without PKCE is rejected.
- Wrong PKCE verifier is rejected.
- Authorization code replay is rejected.
- `offline_access` is rejected.
- Wrong issuer, wrong audience, modified signature, and expired JWT are rejected.
- UserInfo rejects the token after the underlying Better Auth session is signed out.
- An untrusted browser Origin does not receive credentialed CORS permission.
- A callback URI other than the one exact registered URI is rejected.

Also verify OIDC authorization responses carry the exact `iss` value (RFC 9207) to prevent authorization-server mix-up.

## Supabase hosted acceptance — isolated Free project only

Supabase Custom OIDC must be registered in a dedicated, non-production Supabase Free project. The provider setup is not available through Supabase CLI; use the Supabase Dashboard under Authentication → Sign In / Providers → Third-Party Auth → Custom OIDC, or the documented Management API after an isolated project is available.

Register only the fixed issuer URL. Then run this acceptance matrix:

| Area | Positive case | Negative case |
|---|---|---|
| Provider/JWKS | Supabase fetches OIDC discovery and validates ES256 key by `kid` | Unknown key ID, wrong signature, or wrong issuer rejected |
| JWT claims | Valid token has UUID `sub`, `role=authenticated`, correct `aud`, unexpired `exp` | Wrong audience, expired token, altered `sub`, or missing role rejected |
| Postgres identity | `auth.uid()` equals the Better Auth UUID | A second UUID cannot read or mutate the first user's private rows |
| Data API | Allowed RLS-protected operations work using the external JWT | Anonymous/forged/cross-user access denied |
| Storage | Existing intended RLS behavior works with external JWT | Cross-user object access denied |
| Realtime | Authorized channels receive only allowed events | User B cannot subscribe/read user A's private events |
| Edge Functions | Each function validates the external identity and intended business role | Invalid issuer or unauthorized business role rejected |

Use at least two synthetic Better Auth accounts with distinct UUIDs. Do not use production user records, production service-role keys, real tokens, or real payment/competition records. Keep business roles in the existing application role model; never put `admin`, `guru`, or `penyelenggara` in the Postgres `role` claim.

## Current blockers and safe continuation

- Stage 1's dedicated D1, Worker, custom auth hostname, hosted discovery/PKCE/JWKS smoke test and current branch Pages preview are complete. A redeploy of the live Worker with the newly allowlisted exact branch-preview Origin and the corresponding CORS smoke test are still pending. Real ZeptoMail Agent delivery and interactive session/email callback tests are also pending; Google OAuth is optional if not in launch scope.
- The connected Supabase account has reached its two-active-Free-project limit. Its visible project list contains only the production project, and no separate staging project or development branch is available through the connection. Do not pause/delete the production project or register this issuer in production to work around that limit.
- Until both blockers are cleared, hosted Custom OIDC acceptance is pending. Local CI success is not evidence that Supabase has accepted the issuer.
- Production Supabase schema, OIDC settings, users, application data, and frontend login remain unchanged.

## Latest local verification

The Auth Worker CI run [#42177805558](https://github.com/taufx98/sykabelajar4.0/actions/runs/42177805558) passed after adding explicit tests for the RFC 9207 authorization-response `iss` parameter and UUID-shaped JWT subject. Both Worker/OIDC and frontend checks succeeded. This is local Worker/D1 verification, not hosted Supabase acceptance.

## Official references

- Supabase Custom OIDC requirements: https://supabase.com/docs/guides/auth/third-party/custom-oidc
- Better Auth OAuth Provider: https://better-auth.com/docs/plugins/oauth-provider
- Better Auth tokens, scopes, resources and PKCE: https://better-auth.com/docs/plugins/oauth-provider/tokens
- Better Auth JWT plugin and ES256/JWKS: https://better-auth.com/docs/plugins/jwt


## Verified staging issuer — 6 November 2026

Deployment [#42190609080](https://github.com/taufx98/sykabelajar4.0/actions/runs/42190609080) now verifies the hosted issuer and public signing key. The issuer is `https://auth.sykabelajar.my.id/api/auth`; hosted discovery, hostname consistency, PKCE S256 advertisement and public ES256 P-256 JWKS all passed.

This does **not** yet prove a complete hosted authorization-code exchange, minted access/ID-token claims, token renewal/session behavior, or Supabase acceptance. No staging user/session has been seeded.

The connected Supabase project inventory exposes only the production project `mvdczyitbkxkldjughor`. Do not register the staging issuer there. Stage 2 remains blocked until an isolated Supabase Free project is available and the complete acceptance matrix above passes. Supabase documents Custom OIDC registration through Dashboard or Management API, not CLI: https://supabase.com/docs/guides/auth/third-party/custom-oidc.
