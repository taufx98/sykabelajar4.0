# SYKABELAJAR Auth Worker — isolated proof of concept

This service is deliberately isolated from the production frontend and database. It is not a production deployment.

## New-account and role contract

- Existing Supabase Auth users in this migration are demo/testing accounts. Their password hashes, credentials, OAuth tokens and sessions are not imported into D1. There is no legacy password bridge.
- New users receive a fresh UUID from Better Auth. That exact UUID will be provisioned to `private.app_users.id` and emitted as JWT `sub`.
- The JWT `role` claim is always PostgreSQL `authenticated`. It is never an application role.
- SYKABELAJAR business roles remain in the existing Supabase `public.user_roles` table and `public.app_role` enum. The live catalog currently contains `student`, `teacher`, `organizer_member`, and `admin`; preserve these and future protected additions.
- Public signup may request only `student`, `teacher`, or `organizer`, mapped server-side to `student`, `teacher`, and `organizer_member`. Admin cannot be self-registered and must be granted through a protected, auditable process.
- Provisioning retries must not overwrite existing profile edits or reactivate disabled roles.
- The current isolated Worker POC does not yet perform the production Supabase provisioning call. That integration is a later Stage 3/5 deliverable and must be completed before the new login can serve the application.

See [AUTH-NEW-ACCOUNT-AND-ROLE-CONTRACT.md](../../docs/security/AUTH-NEW-ACCOUNT-AND-ROLE-CONTRACT.md).

## Responsibilities

- Better Auth owns account credentials, Google identity, email verification, password recovery, and server-side sessions.
- Cloudflare D1 stores Better Auth identity/session/OAuth/JWKS/rate-limit records only.
- The OAuth Provider plugin exposes OIDC discovery and ES256-signed JWT access tokens for Supabase.
- The role claim is always PostgreSQL authenticated; it is never a SYKABELAJAR business role.
- JWT access tokens live for five minutes. The offline_access scope is intentionally not enabled.
- Supabase remains the business-data and authorization backend.

## ZeptoMail transactional email and admin account switching

Production transactional email uses ZeptoMail. A Send Mail Token belongs to one Agent, so each Admin profile represents one ZeptoMail Agent and its verified sender identity.

- Official API: `POST https://api.zeptomail.com/v1.1/email`, authenticated with `Authorization: Zoho-enczapikey <send-mail-token>`.
- The Admin UI is available at `/admin/core?tab=settings` under **Pengaturan Email**. Admins can add multiple Agent profiles, rotate a token, choose the active Agent, test delivery, and remove inactive profiles without editing code or redeploying the Worker.
- Send Mail Tokens are encrypted at rest in D1 with AES-256-GCM using the server-only `AUTH_EMAIL_ENCRYPTION_KEY` Worker secret. The admin API never returns a token or ciphertext.
- Admin access is verified against the current Supabase Auth user endpoint and `is_active_admin()` RPC. This is a migration bridge for the existing admin session; replace it with Better Auth admin verification during Stage 4.
- The test action sends one real test email only to the signed-in admin's own email and is limited to one per minute per admin. It can consume ZeptoMail credits and requires an explicit click/confirmation.
- Set `AUTH_EMAIL_PROVIDER=zeptomail`, a stable `AUTH_EMAIL_ENCRYPTION_KEY`, `SUPABASE_URL`, and `SUPABASE_PUBLISHABLE_KEY` on the non-production Worker before enabling the admin API. Do not use a service-role key in the Worker or browser.
- Local CI/dev still uses the authenticated webhook mock. It does not send real email or consume ZeptoMail credits.

ZeptoMail does not have a recurring free monthly plan. Its current pricing page advertises an introductory 10,000-email credit valid for one month for eligible new accounts; after that, one purchased credit covers 10,000 emails and is valid for six months. This implementation does not buy credits or enable auto top-up: it can use only credits already available in the user's ZeptoMail account. If the balance is empty, delivery remains unavailable until the account owner decides whether to purchase more.


## D1 Free-tier quota resilience

D1 is the single Better Auth credential/session store; Supabase is the application data and authorization backend. Do not treat Supabase Auth as an automatic replacement database for Better Auth.

The Worker catches Cloudflare's documented D1 daily rows-read/rows-written quota errors and returns a safe 503 with a stable error code and `Retry-After` until 00:00 UTC (07:00 WIB). It does not expose raw provider errors or redirect to Supabase Auth. Already-issued five-minute access JWTs can continue to access Supabase until they expire; minting a new token still requires the Better Auth/D1 session.

Cloudflare's separate Workers Free 100,000 requests/day cap can return Error 1027 before Worker code runs. This cannot be caught by the Worker. Route fail-open bypasses the Worker to its origin and is not a Supabase Auth fallback; do not enable it for this security-critical Worker.

The D1/Supabase quota/failover policy, monitoring bands and future frontend recovery requirements are documented in [AUTH-D1-QUOTA-RESILIENCE.md](../../docs/security/AUTH-D1-QUOTA-RESILIENCE.md). No second login issuer or credential mirror is enabled.

## Important safety boundaries

- The D1 ID in wrangler.toml is intentionally a placeholder. The service cannot be deployed until it is replaced with a dedicated, non-production D1 database ID.
- Do not point this service at the production Supabase database or add the Better Auth issuer to production Third-Party Auth yet.
- Do not add secrets to this directory, source control, Vite variables, or browser code.
- The Google provider is enabled only when both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are configured.
- Google OAuth callback URL for the eventual provider console configuration: https://auth.sykabelajar.my.id/api/auth/callback/google
- Email/password sign-up requires email verification. Production staging requires one active ZeptoMail Agent profile. The authenticated webhook is only the local CI/dev fallback.


- The webhook option receives JSON with from, to, subject, text, and category. It must authenticate the bearer token and must not log verification or reset URLs.
- Google-to-password implicit account linking is disabled. Users must explicitly link accounts after proving control of both methods.
- The first-party OAuth public client is seeded by versioned migration `0002_seed_first_party_oauth_client.sql`: no client secret, exact fixed HTTPS callback, Authorization Code only, and `requirePKCE=1`. The `/_internal/bootstrap-first-party-client` endpoint is read-only; it requires `OAUTH_CLIENT_BOOTSTRAP_TOKEN`, rejects browser Origin headers, and verifies that the migrated client exactly matches the configured callback and audience. There is no public or unauthenticated client-creation endpoint.
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
| OAUTH_CLIENT_BOOTSTRAP_TOKEN | Worker secret | Internal bearer token for read-only verification of the migrated first-party client |
| D1_SCHEMA_BOOTSTRAP_TOKEN | Local-only secret | Enables local schema export during CI only |
| ALLOW_SCHEMA_BOOTSTRAP | Local-only variable | Must never be enabled on a shared or production Worker |
| GOOGLE_CLIENT_ID | Worker secret/variable | Google OAuth client ID |
| GOOGLE_CLIENT_SECRET | Worker secret | Google OAuth client secret |
| AUTH_EMAIL_PROVIDER | Worker variable | `zeptomail` for staging/production; `webhook` for local CI/dev |
| AUTH_EMAIL_ENCRYPTION_KEY | Worker secret | Stable random key (32+ characters) for AES-256-GCM encryption of Agent tokens |
| SUPABASE_URL | Worker variable | Supabase URL for current admin session validation during the migration bridge |
| SUPABASE_PUBLISHABLE_KEY | Worker variable | Publishable key for `auth/v1/user` and `is_active_admin()` checks; never service-role |
| AUTH_EMAIL_WEBHOOK_URL | Local-only variable | Authenticated HTTPS relay used by local mock/fallback |
| AUTH_EMAIL_WEBHOOK_TOKEN | Local-only secret | Bearer credential for the local email webhook |
| AUTH_EMAIL_FROM | Local-only variable | Sender identity passed to the local webhook |

## Development

1. Install the exact dependency tree with `npm ci`.
2. Copy `.dev.vars.example` to `.dev.vars`. Use test-only values; never commit this file.
3. Start the Worker locally. Only in local development, set `ALLOW_SCHEMA_BOOTSTRAP=true` and a random `D1_SCHEMA_BOOTSTRAP_TOKEN`.
4. Run `npm run auth:schema:generate`. The protected Worker endpoint invokes Better Auth's `getMigrations()` against the request-scoped D1 binding and exports the resulting DDL from `sqlite_master`.
5. Review the generated `migrations/0001_better_auth.sql` and confirm core tables, JWKS, all OAuth Provider models, and database rate-limit storage are present.
6. Apply all versioned migrations to disposable local D1 with `npx wrangler d1 migrations apply sykabelajar-auth-poc --local`. This applies the private bootstrap table, generated Better Auth schema, and fixed first-party OAuth client/resource seed.
7. Keep the local Worker running while running the email/session/OAuth integration test. Then run `npm run check` and verify `/healthz`, OIDC discovery, and the advertised JWKS URL.

Do not set the schema bootstrap flag or apply generated migrations to production. The generated migration must be reviewed and tested against a disposable D1 database first.

## OAuth/OIDC integration test requirements

A complete PoC test must verify:

- OIDC discovery issuer exactly matches the issuer that will be configured in Supabase.
- Discovery jwks_uri returns a usable ES256 public key set with kid.
- Authorization Code + PKCE S256 works for the migration-seeded first-party public client, and an authorization request without PKCE is rejected.
- Access token contains the Better Auth UUID `sub`, expected `iss`, resource `aud`, `role=authenticated`, and `exp` no more than five minutes after `iat`. The OIDC ID token is separately signed with ES256, uses the first-party client ID as its audience, and carries the exact authorization-request `nonce`.
- Missing-PKCE requests and wrong-audience, wrong-issuer, expired, and modified-signature access tokens are rejected.
- Google sign-in rejects unverified email identities.
- Same-email Google sign-in does not implicitly attach to an existing password account.
- Session revoke/logout blocks further session-bound refresh and UserInfo access. A JWT already issued for Supabase Data API access remains cryptographically valid until its five-minute expiry, so logout does not imply instant revocation at Supabase.
- CORS preflight succeeds only for exact allowlisted origins and never uses Access-Control-Allow-Origin: * with credentials.
- The two-user Supabase IDOR matrix is tested before any frontend migration.

## Not yet implemented in this stage

- D1 cloud resource creation and staging deployment.
- Production email vendor/webhook configuration and deliverability test (the CI flow uses a local mock webhook).
- Google OAuth runtime test using isolated Google credentials.
- Supabase Custom OIDC configuration and live token acceptance test in a non-production project.
- Supabase schema/FK changes, account provisioning, Edge Function migration, or frontend auth replacement.
- Cloudflare custom-domain deployment and two-user Supabase IDOR matrix.

These are explicit gates, not implied successes.

## Current Stage 1 checkpoint — 4 November 2026

CI run #127 completed successfully on commit `e1b8489` using the committed lockfile with `npm ci`. The audit reported zero vulnerabilities. TypeScript, nine security/schema contract tests, local D1 migrations, OIDC discovery/JWKS ES256, the full email/session/OAuth integration suite, and the Wrangler dry-run bundle all passed.

The generated `0001_better_auth.sql` contains 13 Better Auth/OAuth tables and 31 DDL statements, excluding Cloudflare, Wrangler, and private Worker tables. The reviewed schema and exact `package-lock.json` are committed to this PR. Migration `0002_seed_first_party_oauth_client.sql` provisions one public client/resource with no client secret, exact HTTPS callback, Authorization Code grant only, and mandatory PKCE. The internal bootstrap endpoint only verifies the migrated rows.

The local integration suite now covers:
- Email/password sign-up, verification, login, password reset, session lookup, and logout using a local mock email webhook.
- The real `/request-password-reset` rate-limit rule (three requests per hour); further attempts are rejected with HTTP 429.
- OAuth Authorization Code + PKCE S256, including exact `invalid_request` rejection when PKCE is omitted, `invalid_grant` rejection for a wrong verifier, and `invalid_grant` rejection when an authorization code is replayed.
- CORS preflight accepts only the exact app origin; an untrusted origin receives HTTP 403 and no CORS permission. The internal OAuth bootstrap rejects requests that carry a browser Origin header.
- Cookie flags `HttpOnly`, `Secure`, `SameSite=Lax` and absence of a Domain attribute (host-only) are checked on the actual session cookie.
- Requests for `offline_access` are rejected and the successful token response does not contain a `refresh_token`.
- ES256 access-token verification through JWKS, UUID `sub`, resource `aud`, `role=authenticated`, and a maximum five-minute lifetime.
- OIDC ID-token ES256 signature, client-ID audience, and exact nonce validation.
- Rejection of wrong issuer, wrong audience, expired access token, and modified signature.
- Valid UserInfo before logout and UserInfo rejection after the Better Auth session has been revoked.

This establishes a passing **local proof of concept**, not production readiness. A Supabase Data API JWT that was issued before logout can remain cryptographically valid until its five-minute expiry; the application must not treat session logout as instant revocation at Supabase.

Remaining Stage 1 gates:
- Resolve the Cloudflare Worker creation and Custom Domain permission gate in [AUTH-CLOUDFLARE-STAGING-WORKER-DEPLOY-RUNBOOK.md](../../docs/security/AUTH-CLOUDFLARE-STAGING-WORKER-DEPLOY-RUNBOOK.md). The dedicated remote D1 already exists and is migrated; the initial guarded Worker deploy passed all pre-deploy checks but failed at `wrangler deploy` because the current token does not yet have the verified create/domain permission set.
- Run the manual-only staging Worker deployment and verify the hosted health endpoint, stable issuer, session cookie behavior, OIDC discovery, and public ES256 JWKS.
- Enter a verified ZeptoMail Agent Send Mail Token through the secured Admin UI and verify delivery to the signed-in admin's own email. No Agent token has yet been entered and no real email or paid credit has been used.
- Test Google OAuth with isolated credentials if Google sign-in is required for initial launch, including verified-email enforcement and explicit account-linking behavior.

PR #177 remains a draft. No successful Cloudflare Worker deployment, Supabase schema/configuration change, frontend auth replacement, production account change, or production DNS/route change has been performed. The failed staging deployment left no partial Worker, custom domain, or route according to read-only preflight [#42179241229](https://github.com/taufx98/sykabelajar4.0/actions/runs/42179241229).


## Latest validation checkpoint — 5 November 2026

The latest ZeptoMail implementation validation is green on commit `e01d865c94f4d326bfbb38db58ee003b52ed548b`:

- [Auth Worker + Admin Frontend CI #42035044756](https://github.com/taufx98/sykabelajar4.0/actions/runs/42035044756): dependency audit, strict Worker TypeScript, 28 Worker security/email tests, local D1 migrations including ZeptoMail tables, unauthenticated admin-endpoint rejection, email/session/OAuth integration, OIDC discovery/JWKS, Worker dry-run bundle, and separate frontend lint/typecheck/build all passed. No deploy step exists.
- [Supabase Local Auth Claims CI #42012012070](https://github.com/taufx98/sykabelajar4.0/actions/runs/42012012070): all **73/73 pgTAP assertions** passed (8 JWT/RLS + 12 FK rehome + 53 provisioning/referral). The test set includes the trusted Google verified-email projection and the isolated username-collision rollback case.

These older runs validate local disposable resources only. The later dedicated remote D1 and manual schema migration are verified in [#42159049470](https://github.com/taufx98/sykabelajar4.0/actions/runs/42159049470). Auth Worker CI [#42179192864](https://github.com/taufx98/sykabelajar4.0/actions/runs/42179192864) passes on the current branch. The guarded Worker deploy attempt [#42178992387](https://github.com/taufx98/sykabelajar4.0/actions/runs/42178992387) failed at the deployment step; post-failure preflight [#42179241229](https://github.com/taufx98/sykabelajar4.0/actions/runs/42179241229) confirmed no partial Worker/domain/route was created. Stage 1 remains in progress; no production auth, Supabase schema, or user-account change has been made.

## Email adapter validation — 5 November 2026

The Worker now supports ZeptoMail Agent profiles, AES-GCM encryption, and server-side account switching. The latest branch CI checkpoint [#42035044756](https://github.com/taufx98/sykabelajar4.0/actions/runs/42035044756) passes the ZeptoMail migration, Agent/token tests, admin endpoint access checks, and frontend build.

Real ZeptoMail delivery still requires a non-production Worker, D1 migration 0003, a stable encryption secret, Supabase publishable-key/session verification settings, and an Agent profile entered by an active admin. No email has been sent and no credits have been purchased.
