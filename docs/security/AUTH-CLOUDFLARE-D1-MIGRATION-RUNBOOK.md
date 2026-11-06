# Dedicated Cloudflare D1 staging migration runbook

Status: **completed successfully on 6 November 2026**. Manual workflow run [#42159049470](https://github.com/taufx98/sykabelajar4.0/actions/runs/42159049470) applied the reviewed schema to the isolated staging D1 and verified all 17 expected tables. This workflow does not deploy the Auth Worker or configure a hostname.

## Fixed target

The workflow is permanently bound to one non-production D1 database:

- Name: `sykabelajar-auth-poc`
- UUID: `7a4f9008-a1c6-42b6-8a04-abde12699248`
- Wrangler binding: `DB`
- Migrations directory: `services/auth-worker/migrations`

The workflow checks all four values against `wrangler.toml`, checks the remote Cloudflare D1 listing for an exact name/UUID match, and refuses to run on any branch other than `security/auth-poc-stage-1`. It also stops when the checked-in migration set differs from the four files reviewed for this run.

## Verified execution

The successful manual run used branch `security/auth-poc-stage-1` and completed all nine job steps, including exact D1 name/UUID verification, applying migrations 0000–0003, and checking all 17 expected table names. The earlier `main` run was correctly skipped by the branch guard; it did not change the database.

[Open successful migration run #42159049470](https://github.com/taufx98/sykabelajar4.0/actions/runs/42159049470).

## Run or re-run the migration

1. Open GitHub Actions in `taufx98/sykabelajar4.0`.
2. Select **Auth D1 Staging Schema Migration**.
3. Select branch `security/auth-poc-stage-1`.
4. Choose **Run workflow** and enter the exact confirmation:

   ```text
   APPLY-TO-sykabelajar-auth-poc
   ```

5. Inspect the run. It must pass the exact-target check, show the pending migration list, apply the remote D1 migrations and verify all 17 expected table names.

The workflow needs the existing GitHub Actions secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. The token requires Account D1 Read (to verify the target) and Account D1 Edit/Write (to apply migrations). Never paste or commit either secret.

## What gets applied

- `0000_auth_worker_internal_config.sql`: internal first-party OAuth bootstrap state.
- `0001_better_auth.sql`: the reviewed Better Auth/OAuth/JWKS/rate-limit schema generated from the pinned Better Auth package.
- `0002_seed_first_party_oauth_client.sql`: one public OAuth client with no client secret, exact HTTPS callback, Authorization Code grant and PKCE requirement.
- `0003_zeptomail_agent_settings.sql`: encrypted Agent-profile storage, active Agent pointer and test-email rate-limit table. This migration creates no Agent token or email credential.

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

After success, D1 contains the schema and the fixed public OAuth client/resource seed only. The Worker, stable secrets, ZeptoMail Agent token, real email delivery, Google OAuth provider credentials, custom hostname and hosted OIDC acceptance test remain separate Stage 1/2 gates. Do not switch the frontend to this issuer yet.

## References

- Cloudflare D1 Wrangler commands: https://developers.cloudflare.com/d1/wrangler-commands/
- `d1 migrations apply` documents a backup after applying and rollback of an individual failed migration.
