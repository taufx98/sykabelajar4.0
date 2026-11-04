# SYKABELAJAR Auth Worker — isolated proof of concept

This service is deliberately isolated from the production frontend and database. It is not a production deployment.

## Responsibilities

- Better Auth owns account credentials, Google identity, email verification, password recovery, and server-side sessions.
- Cloudflare D1 stores Better Auth identity/session/OAuth/JWKS/rate-limit records only.
- The OAuth Provider plugin exposes OIDC discovery and ES256-signed JWT access tokens for Supabase.
- The role claim is always PostgreSQL authenticated; it is never a SYKABELAJAR business role.
- JWT access tokens live for five minutes. The offline_access scope is intentionally not enabled.
- Supabase remains the business-data and authorization backend.

## Important safety boundaries

- The D1 ID in wrangler.toml is intentionally a placeholder. The service cannot be deployed until it is replaced with a dedicated, non-production D1 database ID.
- Do not point this service at the production Supabase database or add the Better Auth issuer to production Third-Party Auth yet.
- Do not add secrets to this directory, source control, Vite variables, or browser code.
- The Google provider is enabled only when both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are configured.
- Google OAuth callback URL for the eventual provider console configuration: https://auth.sykabelajar.my.id/api/auth/callback/google
- Email/password sign-up requires email verification. Configure the outbound email webhook before attempting sign-up or password reset.
- The email webhook receives JSON with from, to, subject, text, and category. It must authenticate the bearer token and must not log verification or reset URLs.
- Google-to-password implicit account linking is disabled. Users must explicitly link accounts after proving control of both methods.
- The first-party OAuth public client is created only through the server-to-server endpoint /_internal/bootstrap-first-party-client. It requires OAUTH_CLIENT_BOOTSTRAP_TOKEN, rejects browser Origin headers, fixes the callback URI from server configuration, and stores the resulting client ID so the client cannot be created repeatedly.
- The D1 schema bootstrap endpoint /_internal/schema-migrate is enabled only when ALLOW_SCHEMA_BOOTSTRAP=true and D1_SCHEMA_BOOTSTRAP_TOKEN are set. CI sets these only in an ephemeral local .dev.vars file. Never set ALLOW_SCHEMA_BOOTSTRAP in a shared or production environment.
- The five-minute access token is not individually revocable at the JWT signature level. Ending a Better Auth session prevents future session-bound issuance, but a token already minted can remain cryptographically valid until its expiry. The short lifetime is intentional.
- The generic JWT plugin /token endpoint is disabled in OAuth Provider mode. Do not re-enable it without revisiting the OAuth/OIDC design.
- Better Auth rate-limit records are stored in D1, not isolate-local memory.

## Environment bindings

| Name | Type | Purpose |
|---|---|---|
| DB | D1 binding | Isolated Better Auth database |
| BETTER_AUTH_SECRET | Worker secret | Better Auth secret, at least 32 random characters |
| BETTER_AUTH_URL | Worker variable | Public auth origin, e.g. https://auth.sykabelajar.my.id |
| APP_ORIGIN | Worker variable | Exact allowed web origin, currently https://sykabelajar.my.id |
| SUPABASE_RESOURCE_AUDIENCE | Worker variable | JWT audience/resource for the application |
| OAUTH_CALLBACK_URL | Worker variable | Exact first-party SPA OAuth callback URI |
| OAUTH_CLIENT_BOOTSTRAP_TOKEN | Worker secret | One-time server-to-server client registration token |
| D1_SCHEMA_BOOTSTRAP_TOKEN | Local-only secret | Enables local schema export during CI only |
| ALLOW_SCHEMA_BOOTSTRAP | Local-only variable | Must never be enabled on a shared or production Worker |
| GOOGLE_CLIENT_ID | Worker secret/variable | Google OAuth client ID |
| GOOGLE_CLIENT_SECRET | Worker secret | Google OAuth client secret |
| AUTH_EMAIL_WEBHOOK_URL | Worker variable | HTTPS endpoint that accepts the documented JSON email payload |
| AUTH_EMAIL_WEBHOOK_TOKEN | Worker secret | Bearer credential for the email webhook |
| AUTH_EMAIL_FROM | Worker variable | Verified sender identity |
| SUPABASE_RESOURCE_AUDIENCE | Worker variable | OAuth resource and JWT audience for Supabase |
| DEV_APP_ORIGIN | Worker variable | Optional exact localhost origin for local development only |

## Development

1. Install dependencies with npm install.
2. Copy .dev.vars.example to .dev.vars. Use test-only values; never commit this file.
3. Apply migration 0000 to a disposable local D1 database.
4. Start the Worker locally. Only in local development, set ALLOW_SCHEMA_BOOTSTRAP=true and a random D1_SCHEMA_BOOTSTRAP_TOKEN.
5. Run npm run auth:schema:generate. The script calls the protected Worker endpoint; Better Auth's getMigrations() runs against the request-scoped D1 binding and the Worker exports the resulting DDL from sqlite_master.
6. Review migrations/0001_better_auth.sql. Confirm core tables, JWKS, OAuth Provider, and database rate-limit tables are present. The custom bootstrap-state table is migration 0000.
7. Run npm run check and verify /healthz, /api/auth/.well-known/openid-configuration, and the JWKS URL advertised by discovery.

Do not set the schema bootstrap flag or apply generated migrations to production. The generated migration must be reviewed and tested against a disposable D1 database first.

## OAuth/OIDC integration test requirements

A complete PoC test must verify:

- OIDC discovery issuer exactly matches the issuer that will be configured in Supabase.
- Discovery jwks_uri returns a usable ES256 public key set with kid.
- Authorization Code + PKCE S256 works for the registered first-party public client.
- Access token contains UUID sub, expected iss, expected resource aud, role=authenticated, exp no more than five minutes in the future, and the Better Auth session identifier.
- Missing, modified, expired, wrong-issuer, wrong-audience, and wrong-signature tokens are rejected.
- Google sign-in rejects unverified email identities.
- Same-email Google sign-in does not implicitly attach to an existing password account.
- Session revoke/logout prevents further refresh or authorization; an already issued JWT is never accepted beyond its five-minute lifetime.
- CORS preflight succeeds only for exact allowlisted origins and never uses Access-Control-Allow-Origin: * with credentials.
- The two-user Supabase IDOR matrix is tested before any frontend migration.

## Not yet implemented in this stage

- D1 cloud resource creation and staging deployment.
- Email vendor selection/webhook deployment.
- Supabase Custom OIDC configuration and live token acceptance test.
- Supabase schema/FK changes, account provisioning, Edge Function migration, or frontend auth replacement.
- Cloudflare custom-domain deployment.

These are explicit gates, not implied successes.

## Current Stage 1 checkpoint — 4 November 2026

The local Worker boots and reaches D1. CI run #100 passed the dependency audit (zero reported vulnerabilities), TypeScript, nine contract tests, local D1 bootstrap, Better Auth schema generation, OIDC discovery/JWKS ES256 smoke test, and Wrangler dry-run bundle. The generated Better Auth migration contains 13 expected auth/OAuth tables and 31 DDL statements; it excludes Cloudflare's `_cf_METADATA`, Wrangler's `d1_migrations`, and the Worker's private bootstrap table. The artifact was also replayed in SQLite with foreign-key enforcement; `PRAGMA foreign_key_check` returned no violations. The package set is aligned to Better Auth 1.7.16, OAuth Provider 1.7.16, core 1.7.16, and better-call 1.4.5.

The next CI layer has now been added but is not yet verified: a local mock mail webhook tests sign-up verification, password reset, session lookup/logout, public OAuth client registration, mandatory PKCE S256, code exchange, ES256 signature/JWKS validation, the `sub` UUID and `role=authenticated` claim, five-minute expiry, audience enforcement, modified-signature rejection, and session-bound UserInfo rejection after logout. The first-party OAuth client is explicitly registered with `require_pkce: true`; public clients are required to use PKCE regardless.

Remaining gates before this PoC is considered complete:

- Complete the expanded CI integration suite and commit the generated `package-lock.json` and reviewed `0001_better_auth.sql` to this PR.
- Test Google OAuth with isolated Google client credentials and callback URI.
- Verify Supabase Custom OIDC in a dedicated non-production project; the production Supabase project is intentionally untouched.
- Run two-user Supabase IDOR tests before beginning frontend migration.
