# Free staging and test strategy for Better Auth migration

Date: 5 November 2026

## Non-negotiable cost rule

The migration must stay on free infrastructure while SYKABELAJAR is in its testing phase.

- Do not create paid Supabase branches or upgrade a Supabase organization.
- Do not enable paid Cloudflare services, paid add-ons, paid email delivery, or paid compute for this work.
- Before creating any hosted resource, check its actual quoted cost and the account's Free-plan quota. If the quote is nonzero or the free quota is exhausted, stop; do not confirm or create it.
- Never use the production Supabase project as a test environment.
- Never use production rows, credentials, service-role keys, OAuth client secrets, or real user tokens in fixtures or CI.

## Free transactional email choice

Cloudflare Email Sending is intentionally not used for account verification because arbitrary-recipient outbound sending requires Workers Paid. The Better Auth Worker now uses ZeptoMail's Agent-specific Send Mail Token, encrypted at rest in D1 with AES-256-GCM. Admins can add multiple Agent profiles, rotate a token, and switch the active Agent in the Admin UI without a Worker redeploy. Local CI keeps its mock webhook and never sends a real email. Before real delivery, a verified sender domain, Agent token, stable encryption key, and non-production Worker/D1 configuration are required.

Official references:
- Cloudflare Email Service pricing: https://developers.cloudflare.com/email-service/platform/pricing/
- ZeptoMail email sending API: https://www.zoho.com/zeptomail/help/api/email-sending.html
- ZeptoMail pricing and introductory credit: https://www.zoho.com/zeptomail/pricing.html

## Current account constraint

The Supabase organization connected to this work is on the Free plan and its production project `sykabelajar_db2` is active. A separate project quote returned USD $0/month, but creation was rejected because the owner had reached the limit of two active Free projects. No new project was created, and no existing project was paused, deleted, or upgraded.

The paid Supabase Branch option quoted earlier at USD $0.01344/hour is not approved and must not be created. Current Supabase pricing lists 50,000 Third-Party MAUs included on the Free plan; this migration must keep third-party auth usage within the Free quota and must not opt into paid overages or upgrade the organization.

## Test environment matrix

| Component | Free test method | What it can prove | Current limitation |
|---|---|---|---|
| Better Auth Worker | Wrangler local mode in GitHub Actions or a developer machine | Worker routes, cookies, Origin checks, session lifecycle, OIDC discovery, JWT signing, JWKS, OAuth + PKCE contracts | Does not validate a deployed hostname, external email delivery, or provider callbacks at a real domain |
| Better Auth database | Wrangler/Miniflare local D1 | D1 schema, migrations, indexes, constraints, bootstrap and auth-flow behavior | No remote D1 database has been created |
| Supabase PostgreSQL | Supabase CLI + Docker local stack | PostgreSQL functions, triggers, schema constraints, RLS behavior, pgTAP tests and application JWT claim simulation | Existing repository migrations are not a verified full schema bootstrap; a sanitized baseline or focused fixture is required first |
| Supabase Custom OIDC | A separate Supabase Free project, only after a Free slot is available | Real issuer/JWKS discovery, Supabase JWT acceptance/rejection, `auth.uid()`, Data API, Storage, Realtime and Edge Functions | Supabase CLI does not configure Custom OIDC; hosted acceptance is currently blocked by the Free-project limit |
| CI | GitHub Actions for this public repository | Repeatable local checks without paid Supabase compute | Keep jobs bounded; never deploy from pull-request validation |

## Supabase local testing

Use the CLI against a local Docker-backed stack. Do not link this checkout to production for test execution. The dedicated identity smoke-test project lives under `services/auth-worker/supabase-test/` and has its own minimal fixture; it deliberately does not replay the application's historical migrations.

```bash
# From the repository root
supabase --help
supabase start
supabase status

# Run only after a reviewed local baseline and migration set are available:
supabase db reset --local
supabase test db --local

# Stop local containers when finished
supabase stop
```

Always use explicit `--local` on database reset and test commands. Do not run `db reset --linked`, `db push --linked`, or a command with a production connection string during staging work. The fixture CI uses Supabase CLI 3.0.0, pins that version, and uses `[local_smtp]` (CLI v3 removed `[inbucket]`). The latest GitHub Actions run [#42012012070](https://github.com/taufx98/sykabelajar4.0/actions/runs/42012012070) completed successfully on 5 November 2026 using only a disposable local stack and passed all 73 pgTAP assertions across three test files.

### Existing migration-history warning

The current `supabase/migrations` folder contains incremental feature migrations. It is not yet proven to recreate the entire application database from an empty local Supabase instance. The early files include repeated date-only prefixes (for example, several `20260828_*` and `20260829_*` files), and the early feature migrations refer to existing objects such as `organizers` and `auth.users`.

Do not rename the historical migration files or run a full blank replay just to make the CLI pass. Before Stage 3 integration testing, prepare a reviewed, sanitized schema-only baseline or a purpose-built fixture for the specific identity objects and dependent tables under test. Keep production row data out of that baseline. Validate the fixture and its assumptions before using it to approve any production migration.

### Schema-only baseline export preparation

A dedicated helper and runbook now exist:
- Script: `scripts/auth-migration/export-schema-baseline.sh`
- Runbook: [AUTH-SCHEMA-BASELINE-RUNBOOK.md](AUTH-SCHEMA-BASELINE-RUNBOOK.md)

The helper pins Supabase CLI 3.0.0, exports the default schema-only dump, separately captures custom `auth`/`storage` DDL via `supabase db diff --linked`, and records PostgreSQL/extension versions. It writes to a temporary directory outside the Git repository and refuses a schema dump containing a `COPY ... FROM stdin` data block. It has no data export, role dump, restore, migration apply, or deploy step.

The helper's Bash syntax and static safety contract passed in [Supabase Local Auth Claims CI #42012012070](https://github.com/taufx98/sykabelajar4.0/actions/runs/42012012070), alongside all 73 pgTAP assertions. **The export itself has not been run here** because the database connection string must stay on the owner's trusted local machine. Do not paste it into chat or commit it. The helper uses only existing infrastructure and does not create a project, branch, Worker, D1 database, or paid service.

### Focused database test approach

For each Stage 3 SQL change:

1. Define the exact existing tables, columns, constraints, triggers, grants, RLS policies and dependent functions required by that change.
2. Build a disposable local fixture with synthetic UUIDs and synthetic records only.
3. Apply the proposed migration to the fixture using a local PostgreSQL/Supabase instance.
4. Test both positive and negative cases with two distinct user UUIDs, including owner access, cross-user denial, anonymous denial, role separation, retry/idempotency and rollback behavior as applicable.
5. Run the existing app contract tests and type/build checks.
6. Do not mark hosted OIDC acceptance complete until it has been tested in a separate Supabase Free project.

The latest workflow [Supabase Local Auth Claims CI #42012012070](https://github.com/taufx98/sykabelajar4.0/actions/runs/42012012070) passed **73/73 pgTAP assertions across three files** on 5 November 2026 using the pinned Supabase CLI 3.0.0 and a disposable Docker-backed local stack:

- JWT/RLS (8 assertions): JWT `sub` maps to `auth.uid()`, owner-only read/insert, cross-user read denial, forged-owner insert and ownership-transfer denial.
- Identity FK rehome (12 assertions): UUID backfill before FK swap, all four fixture constraints point to `private.app_users`, and `CASCADE`, `SET NULL`, `NO ACTION`, and `RESTRICT` behavior remains intact.
- Provisioning/referral (53 assertions): provisioning/email-verification RPCs are executable only by `service_role`; registration maps only basic student/teacher/organizer accounts to their allowed business role; admin self-registration is rejected; retry does not overwrite profile edits or reactivate a disabled role; no Better Auth shadow row is created in `auth.users`; identity projection stores no credentials; referral attribution requires a verified referrer; activity stays pending before email verification; trusted verification qualifies only within the 24-hour window; reward ledger and Edu Coin credit remain idempotent; unknown/unverified referral codes do not block signup.

The matching Auth Worker CI run [#41776739761](https://github.com/taufx98/sykabelajar4.0/actions/runs/41776739761) also passed dependency audit, typecheck, security contracts, local Worker/D1, OAuth/PKCE, OIDC/JWKS smoke tests and bundle dry-run without deployment. These are synthetic, focused fixtures only: they do not migrate production tables, verify hosted Supabase Custom OIDC, recreate the full application's schema, validate all 109 production RLS policies, or prove the real Worker-to-Supabase provisioning network path. They are safety gates, not a substitute for full application regression against a complete schema baseline.

## OIDC validation boundary

Local Worker tests can prove that the Better Auth issuer publishes a valid OIDC discovery document and ES256 JWKS, issues the expected claims, and rejects invalid OAuth/PKCE/JWT cases.

The Supabase Custom OIDC setup itself must be verified against a hosted Supabase project because the Custom OIDC provider is not configurable through the Supabase CLI. Use a separate Free project when an account-level Free slot is available. Until then:

- Do not register the test issuer in production.
- Do not claim Supabase has accepted the Better Auth JWT.
- Keep Stage 2 incomplete and Stage 3 production rollout blocked.
- Continue local contract tests and SQL design review only.

## Cloudflare local testing

The current Auth Worker workflow runs Wrangler in local mode and applies D1 migrations to a local D1 database. Keep the D1 database ID in `wrangler.toml` as a non-deployable placeholder until a dedicated remote resource is verified to fit the Cloudflare Free quota.

No remote Worker/D1 deployment is required to continue local code and protocol work. If a future remote test deployment exceeds free quotas or requests a paid feature, stop and retain local testing.

## References

- Supabase local development workflow: https://supabase.com/docs/guides/local-development/cli-workflows
- Supabase database testing: https://supabase.com/docs/guides/local-development/cli/testing-and-linting
- Supabase Custom OIDC requirements and CLI limitation: https://supabase.com/docs/guides/auth/third-party/custom-oidc
- Supabase Free-plan project limits: https://supabase.com/docs/guides/platform/billing-on-supabase


## Cloudflare read-only preflight — 5 November 2026

GitHub Actions run [#42043789820](https://github.com/taufx98/sykabelajar4.0/actions/runs/42043789820) inspected Cloudflare resources without writes or deployment:

- Zone `sykabelajar.my.id` is active and readable.
- Worker script listing is readable; only the existing `sykabelajar4-0` script was returned.
- No `sykabelajar-auth-poc` Worker, D1 database with that name, Worker custom domain `auth.sykabelajar.my.id`, or Worker route was found.
- D1 listing returned Cloudflare error `10000 Authentication error`; the current GitHub token does not have the D1 read permission needed by this endpoint.

Update the token in Cloudflare Dashboard and replace GitHub secret `CLOUDFLARE_API_TOKEN` (never paste the token into chat). Grant only the scopes needed:

- Account `D1 Read` to pass the read-only preflight; Account `D1 Edit` when authorized to create/migrate the dedicated D1.
- Account `Workers Scripts Edit` (called `Write` in some current API/UI permission lists) for Worker deployment/updates. Creating a brand-new Worker may require product-level Workers Admin; to avoid a broad role, create the empty script once in the dashboard and keep automated deployment limited to editing that script.
- Zone `Workers Routes Edit/Write` and `Zone Read` on `sykabelajar.my.id`; use `DNS Edit/Write` only when the deployment flow needs to create/manage the custom hostname's DNS record.

Do not use Super Administrator or an unrelated account-wide role. Cloudflare documents these scopes in [API token permissions](https://developers.cloudflare.com/fundamentals/api/reference/permissions/) and [Workers roles and permissions](https://developers.cloudflare.com/workers/authorization/). Rerun the preflight after rotating the secret. The Worker config still has an all-zero D1 placeholder and is intentionally non-deployable.

No Cloudflare database, Worker, DNS record, custom domain, or secret was created/changed by the preflight.
