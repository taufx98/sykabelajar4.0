# Free staging and test strategy for Better Auth migration

Date: 4 November 2026

## Non-negotiable cost rule

The migration must stay on free infrastructure while SYKABELAJAR is in its testing phase.

- Do not create paid Supabase branches or upgrade a Supabase organization.
- Do not enable paid Cloudflare services, paid add-ons, paid email delivery, or paid compute for this work.
- Before creating any hosted resource, check its actual quoted cost and the account's Free-plan quota. If the quote is nonzero or the free quota is exhausted, stop; do not confirm or create it.
- Never use the production Supabase project as a test environment.
- Never use production rows, credentials, service-role keys, OAuth client secrets, or real user tokens in fixtures or CI.

## Current account constraint

The Supabase account connected to this work currently lists the production project `sykabelajar_db2`. A separate Free project was considered because it would be useful for Custom OIDC acceptance. The project creation quote for the listed organization was USD $0/month, but Supabase rejected creation because the owner had reached the limit of two active Free projects. No new project was created, and no existing project was paused, deleted, or upgraded.

The paid Supabase Branch option quoted earlier at USD $0.01344/hour is not approved and must not be created.

## Test environment matrix

| Component | Free test method | What it can prove | Current limitation |
|---|---|---|---|
| Better Auth Worker | Wrangler local mode in GitHub Actions or a developer machine | Worker routes, cookies, Origin checks, session lifecycle, OIDC discovery, JWT signing, JWKS, OAuth + PKCE contracts | Does not validate a deployed hostname, external email delivery, or provider callbacks at a real domain |
| Better Auth database | Wrangler/Miniflare local D1 | D1 schema, migrations, indexes, constraints, bootstrap and auth-flow behavior | No remote D1 database has been created |
| Supabase PostgreSQL | Supabase CLI + Docker local stack | PostgreSQL functions, triggers, schema constraints, RLS behavior, pgTAP tests and application JWT claim simulation | Existing repository migrations are not a verified full schema bootstrap; a sanitized baseline or focused fixture is required first |
| Supabase Custom OIDC | A separate Supabase Free project, only after a Free slot is available | Real issuer/JWKS discovery, Supabase JWT acceptance/rejection, `auth.uid()`, Data API, Storage, Realtime and Edge Functions | Supabase CLI does not configure Custom OIDC; hosted acceptance is currently blocked by the Free-project limit |
| CI | GitHub Actions for this public repository | Repeatable local checks without paid Supabase compute | Keep jobs bounded; never deploy from pull-request validation |

## Supabase local testing

Use the CLI against a local Docker-backed stack. Do not link this checkout to production for test execution.

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

Always use explicit `--local` on database reset and test commands. Do not run `db reset --linked`, `db push --linked`, or a command with a production connection string during staging work.

### Existing migration-history warning

The current `supabase/migrations` folder contains incremental feature migrations. It is not yet proven to recreate the entire application database from an empty local Supabase instance. The early files include repeated date-only prefixes (for example, several `20260828_*` and `20260829_*` files), and the early feature migrations refer to existing objects such as `organizers` and `auth.users`.

Do not rename the historical migration files or run a full blank replay just to make the CLI pass. Before Stage 3 integration testing, prepare a reviewed, sanitized schema-only baseline or a purpose-built fixture for the specific identity objects and dependent tables under test. Keep production row data out of that baseline. Validate the fixture and its assumptions before using it to approve any production migration.

### Focused database test approach

For each Stage 3 SQL change:

1. Define the exact existing tables, columns, constraints, triggers, grants, RLS policies and dependent functions required by that change.
2. Build a disposable local fixture with synthetic UUIDs and synthetic records only.
3. Apply the proposed migration to the fixture using a local PostgreSQL/Supabase instance.
4. Test both positive and negative cases with two distinct user UUIDs, including owner access, cross-user denial, anonymous denial, role separation, retry/idempotency and rollback behavior as applicable.
5. Run the existing app contract tests and type/build checks.
6. Do not mark hosted OIDC acceptance complete until it has been tested in a separate Supabase Free project.

This focused fixture is a useful safety gate, but it is not a substitute for full application regression against a complete schema baseline.

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
