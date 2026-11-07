# Dedicated Cloudflare D1 staging migration runbook

Status as of 7 November 2026: **remote staging D1 migrations 0000–0006 are applied; all 18 expected tables, seven Better Auth registration columns, the Telegram challenge table and `auth_email_accounts.provider` are verified.** Telegram migration 0005 was applied by [#42339140591](https://github.com/taufx98/sykabelajar4.0/actions/runs/42339140591), and provider migration 0006 by [#42339767786](https://github.com/taufx98/sykabelajar4.0/actions/runs/42339767786). Both used the exact guarded D1 target and reviewed migration checksums; neither deployed a Worker or modified Supabase.

## Fixed target

The workflow is permanently bound to one non-production D1 database:

- Name: `sykabelajar-auth-poc`
- UUID: `7a4f9008-a1c6-42b6-8a04-abde12699248`
- Wrangler binding: `DB`
- Migrations directory: `services/auth-worker/migrations`

The workflow checks all four values against `wrangler.toml`, checks the remote Cloudflare D1 listing for an exact name/UUID match, and refuses to run on any branch other than `security/auth-poc-stage-1`. It also stops when the checked-in migration set differs from the seven reviewed files 0000–0006.

## Verified execution

The historical successful manual run used branch `security/auth-poc-stage-1` and completed all nine job steps, including exact D1 name/UUID verification, applying migrations 0000–0003, and checking all 17 expected table names. It predates migration 0004 and does not prove the seven new registration/profile columns exist remotely. The earlier `main` run was correctly skipped by the branch guard; it did not change the database.

[Open successful migration run #42159049470](https://github.com/taufx98/sykabelajar4.0/actions/runs/42159049470).

## Run or re-run the migration

1. Open GitHub Actions in `taufx98/sykabelajar4.0`.
2. Select **Auth D1 Staging Schema Migration**.
3. Select branch `security/auth-poc-stage-1`.
4. Choose **Run workflow** and enter the exact confirmation:

   ```text
   APPLY-TO-sykabelajar-auth-poc
   ```

5. Inspect the run. It must pass the exact-target check, show the pending migration list, apply only reviewed pending migrations 0000–0005 and verify all 18 expected table names, including `auth_phone_verification_challenges`.

The current workflow applies only migrations that Wrangler reports as pending from the reviewed set 0000–0005. It verifies all 18 expected tables and confirms that `pragma_table_info('user')` contains all seven registration/profile columns. As of 7 November 2026, the known remote staging state remains migrations 0000–0004 (17 tables), while 0005 is pending. The workflow needs the existing GitHub Actions secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. The token requires Account D1 Read (to verify the target) and Account D1 Edit/Write (to apply migrations). Never paste or commit either secret.

## What gets applied

- `0000_auth_worker_internal_config.sql`: internal first-party OAuth bootstrap state.
- `0001_better_auth.sql`: the reviewed Better Auth/OAuth/JWKS/rate-limit schema generated from the pinned Better Auth package.
- `0002_seed_first_party_oauth_client.sql`: one public OAuth client with no client secret, exact HTTPS callback, Authorization Code grant and PKCE requirement.
- `0003_zeptomail_agent_settings.sql`: encrypted Agent-profile storage, active Agent pointer and test-email rate-limit table. This migration creates no Agent token or email credential.
- `0004_better_auth_registration_attributes.sql`: additive Better Auth registration/profile bootstrap columns `accountType`, `username`, `referralCode`, `birthDate`, `institution`, `grade`, and `subjects`.
- `0005_telegram_phone_verification.sql`: one-use, short-lived Telegram OIDC phone-verification challenge storage. It stores only a hashed state, Better Auth user UUID, nonce, PKCE verifier, and timestamps; it does not store phone numbers or Telegram tokens.

Cloudflare Wrangler captures a D1 backup after applying migrations. In non-interactive CI the Wrangler prompt is skipped; the workflow therefore requires the exact typed confirmation before it reaches the migration command. If one migration fails, Cloudflare documents that the failing migration is rolled back while earlier successful migrations remain applied. A later manual run checks and applies only pending migrations.

## Explicitly outside this workflow

This workflow does not:

- deploy or update a Worker;
- create or update a Worker secret;
- send an email or contact ZeptoMail;
- create a Worker custom domain, DNS record or route;
- register Supabase Custom OIDC;
- read or modify the production Supabase project;
- create, update or delete users or application data.

After migrations 0000–0004 succeed, D1 contains the reviewed Better Auth schema, fixed public OAuth client/resource seed, and seven registration/profile bootstrap columns. Migration 0005 remains pending; do not claim its challenge table exists remotely until the guarded migration run succeeds. The Worker hostname and hosted OIDC core acceptance are already complete on isolated staging. Remaining separate gates include deployment of the newer Telegram-capable Worker, owner BotFather credentials, the staging provisioning secret, real hosted phone-consent/callback acceptance, and real email signup/verification/reset on a verified 100%-free provider path. Do not switch the frontend to this issuer yet.

## References

- Cloudflare D1 Wrangler commands: https://developers.cloudflare.com/d1/wrangler-commands/
- `d1 migrations apply` documents a backup after applying and rollback of an individual failed migration.


## Verified additive migration 0004 — 7 November 2026

- Run: [Auth D1 Staging Schema Migration #42265224273](https://github.com/taufx98/sykabelajar4.0/actions/runs/42265224273) — **success**.
- Only pending file: `0004_better_auth_registration_attributes.sql`.
- The workflow verified the exact D1 name/UUID and the reviewed migration SHA-256 before apply.
- Wrangler reported `0004_better_auth_registration_attributes.sql ✅`.
- Post-apply verification: all 17 expected tables and all seven columns (`accountType`, `username`, `referralCode`, `birthDate`, `institution`, `grade`, `subjects`) were present.
- No Worker deployment, secret update, domain/DNS change, user seed, or production Supabase operation occurred in this migration run.

The one-time push-marker mechanism is constrained to the exact marker path on `security/auth-poc-stage-1`, exact contents, exact D1 name/UUID, and the reviewed migration hash. The manual typed-confirmation path remains available as a fallback.


## Migration 0005 — Telegram phone-verification challenge (applied to staging)

**Remote status as of 7 November 2026:** migrations 0000–0004 are applied to the dedicated non-production D1 and the 17-table schema is verified. Migration 0005 is in the branch and covered by local D1/Worker tests, but the remote apply is still pending. No remote migration or Worker deployment is implied by this documentation update.

Migration 0005 creates `auth_phone_verification_challenges` with:
- a SHA-256 hash of a random OAuth `state` as the primary key;
- the Better Auth UUID, random nonce, PKCE verifier, creation time and expiry time;
- a unique per-user index and an expiry index.

No phone number, Telegram access token or ID token is stored. The Worker deletes expired challenges during challenge creation, uses a single conditional UPSERT to enforce the 60-second per-user cooldown atomically, and consumes a callback challenge with an atomic `DELETE ... RETURNING` so the state cannot be replayed.

The associated Worker flow is only an optional **phone-verification step for an already authenticated Better Auth user**. Telegram is not added to the SYKABELAJAR login provider list. The callback exchanges the authorization code server-side, validates the RS256 ID token using Telegram JWKS (issuer, audience, nonce, time and `phone_number_verified=true`), and sends only the SHA-256 hash of international phone digits plus the verified provider subject to the service-role-only Supabase RPC. The raw phone number and provider tokens are not persisted or logged.

The current guarded workflow:
- accepts only `security/auth-poc-stage-1` and the fixed D1 name/UUID above;
- checks reviewed checksums for migrations 0004, 0005 and 0006;
- expects the exact six migration files 0000–0005;
- verifies 18 tables after apply, including `auth_phone_verification_challenges`;
- does not deploy the Worker, change DNS, create secrets, or touch production Supabase.

**Manual prerequisites before enabling real phone verification:**
1. Register the Telegram login/OIDC app with `@BotFather` and allowlist the exact callback URL `https://auth.sykabelajar.my.id/phone-verification/telegram/callback`.
2. Store the resulting `AUTH_TELEGRAM_CLIENT_ID` and `AUTH_TELEGRAM_CLIENT_SECRET` as Worker secrets; keep them out of GitHub files, browser bundles and chat.
3. Confirm the isolated staging Worker has the required server-only Supabase provisioning configuration. `SUPABASE_PROVISIONING_ENABLED` must remain unset/false until the dedicated staging Supabase issuer/provisioning contract is ready; the production Supabase project must not be used as a test target.
4. Migration 0005 is already applied on staging (run [#42339140591](https://github.com/taufx98/sykabelajar4.0/actions/runs/42339140591)). Do not rerun it. Only perform real hosted Telegram consent/callback acceptance after the owner configures the BotFather app and Worker credentials.
5. Perform a real hosted Telegram consent/callback test on the isolated staging environment, including denied consent, expiry/replay, cooldown, duplicate identity and the existing organizer email/phone/role requirements.

Until those manual prerequisites and hosted acceptance tests are complete, keep Telegram credentials unset and the feature disabled. Do not deploy or enable this phone-verification flow on production, and do not weaken the existing email, active organizer-role or verified-phone checks in `create_organizer`.

## Migration 0006 — transactional email provider selection (applied to staging)

Migration 0006 was applied to the isolated staging D1 by [run #42339767786](https://github.com/taufx98/sykabelajar4.0/actions/runs/42339767786). It is an additive `ALTER TABLE` on the existing `auth_email_accounts` table. It adds `provider TEXT NOT NULL DEFAULT 'zeptomail' CHECK (provider IN ('zeptomail','brevo'))`. Existing Agent rows remain ZeptoMail and retain their ciphertext; the migration does not rewrite accounts, tokens, or user records. No table count changes (still 18 expected D1 tables).

The current migration workflow checks the SHA-256 of 0004, 0005 and 0006, the exact non-production D1 name/UUID, and the exact seven migration files 0000–0006. After apply it verifies all 18 tables, the seven Better Auth user columns, and `auth_email_accounts.provider`. The separate deploy workflow refuses to deploy unless that provider column is present.

This migration is already applied to staging and verified. Do not rerun it or modify its SQL; future changes must use a new migration version and a reviewed checksum. The D1 migration workflow itself never deploys the Worker or touches production.
