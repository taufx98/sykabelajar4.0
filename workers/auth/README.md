# SYKABELAJAR Better Auth Worker — isolated proof of concept

This directory contains a **non-production** Cloudflare Worker proof-of-concept for Better Auth + D1.

## Current scope

- Better Auth is instantiated per request and uses a D1-backed Drizzle adapter.
- Better Auth user IDs are UUIDs.
- Browser cookies are configured as Secure, HttpOnly, SameSite=Lax, host-only cookies. Cross-subdomain cookie sharing is not enabled.
- Google OAuth is configured to require a verified Google email.
- Implicit Google/email account linking is disabled. Linking a Google identity to an existing account must be an explicit authenticated flow.
- The Better Auth OAuth Provider and JWT plugins are configured for an ES256, resource-bound, five-minute Supabase access JWT with `role=authenticated`.
- The OAuth Provider's dynamic client registration is disabled.
- Foreign browser origins are rejected; credentialed CORS is restricted to the configured first-party app origin.
- No Supabase service-role secret exists in this Worker.

## Explicitly incomplete

This is not ready for login cutover or deployment.

- The first-party public OAuth client and its exact redirect URI still need to be provisioned in D1 and tested using Authorization Code + PKCE (S256).
- The generated Better Auth schema and D1 migration must be reviewed and committed from CI's generated artifact.
- A full end-to-end test must verify OIDC discovery fields, ES256 JWKS, token `iss`, `aud`, `sub`, `role`, key rotation, token expiry, logout/revocation, and Supabase acceptance in an isolated project.
- Email/password login is intentionally disabled in this POC until an email delivery provider is selected and verification/reset flows are implemented.
- Google credentials are not configured. No Google OAuth callback has been registered.
- Frontend auth adapter, Supabase Custom OIDC configuration, identity anchor, FK migrations, SQL/Edge Function changes, and RLS issuer policies are not included here.

## Local setup

1. Install Node.js 24.
2. Run `npm install`.
3. Copy `.dev.vars.example` to `.dev.vars` and replace the local placeholder values.
4. Generate the Better Auth schema and D1 migration:
   ```bash
   npm run generate:auth-schema
   npm run generate:d1-migration
   ```
5. Apply migrations to the **local** D1 database:
   ```bash
   npx wrangler d1 migrations apply sykabelajar-auth-local --local
   ```
6. Run locally with `npx wrangler dev`.
7. Run `npm test`, `node --test test/generated-schema.test.mjs`, and `npm run build:worker`.

Do not run a remote D1 migration or `wrangler deploy` from this POC branch. The configured D1 ID is a local placeholder, there are no production routes, and CI only performs a dry-run bundle.

## Required Worker bindings/secrets for a future staging environment

- `DB`: D1 database binding.
- `AUTH_SECRET`: random secret of at least 32 characters, kept as a Cloudflare Worker secret.
- `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`: kept as Worker secrets; never exposed via Vite variables.
- `AUTH_BASE_URL`, `APP_ORIGIN`, and `SUPABASE_JWT_AUDIENCE`: exact non-secret values that must match the deployed host, CORS/trusted origin, and Supabase Custom OIDC resource configuration.

The Google callback URI after the base-path decision is expected to be:
`https://auth.sykabelajar.my.id/api/auth/callback/google`.
Verify the actual emitted callback URL from Better Auth before registering it in Google Cloud Console.

## Security invariants

- Never enable wildcard CORS with credentials.
- Never share the auth cookie with `.sykabelajar.my.id`; the browser sends the host-only cookie to the auth origin when using `credentials: include`.
- Never store Better Auth cookies, Supabase JWTs, or OAuth refresh tokens in localStorage.
- Do not enable implicit account linking.
- Do not put business roles in the PostgreSQL `role` JWT claim.
- Do not add a public bootstrap endpoint for OAuth client provisioning.
- Do not deploy or apply remote migrations until the staging proof-of-concept is signed off.
