# Auth migration schema-only baseline runbook

Status: automated schema-only export and disposable restore succeeded in GitHub Actions [#42367689543](https://github.com/taufx98/sykabelajar4.0/actions/runs/42367689543) on 7 November 2026. The production schema dump and Auth/Storage custom DDL diff were restored into an ephemeral local Supabase stack; structural checks passed and confirmed that zero `auth.users` and zero `public.profiles` rows were imported. An exact row-by-row FK comparison and adversarial contract tests have since been added; [run #42370809198](https://github.com/taufx98/sykabelajar4.0/actions/runs/42370809198) is validating that additional gate. The workflow uploads no schema artifact, commits no dump, and performs no production DDL/DML. This runbook does not authorize a production migration.

## Purpose

The repository's historical `supabase/migrations` directory is incremental and is not a proven clean bootstrap for the current production database. A full schema-only export is therefore the next input required before attempting a complete local application baseline.

The existing `scripts/supabase-full-migrate.sh` is **not** suitable for this task: it also exports `data.sql`, role definitions, migration history, and includes a restore path. Do not use that full migration helper for auth testing.

## Automated path — preferred; no owner CLI required

The branch now contains [Auth Production Schema Baseline](../../.github/workflows/auth-schema-baseline.yml). It runs on a push to the PoC branch or via the Actions workflow-dispatch button. Once the single database secret exists, the job:

1. Uses Supabase CLI **3.0.0** in v3 remote mode. It does not call `supabase login`, `supabase link`, a project picker, or any production write command.
2. Uses the existing production project's **shared session pooler** URI because GitHub-hosted runners are IPv4-only. The expected connection is port **5432**, username `postgres.mvdczyitbkxkldjughor`, and a host ending in `.pooler.supabase.com`.
3. Exports only schema and custom Auth/Storage DDL, plus password-free compatibility metadata. It never requests application rows or custom role definitions.
4. Restores the files into a fresh, disposable local Supabase stack inside that GitHub runner and checks the expected production shape: 69 FKs across 62 source tables, 3 Auth triggers, 4 profile triggers, 36 profile columns, 109 `auth.uid()` policies, and all ten Auth-dependent application functions.
5. Confirms that zero `auth.users` and zero `public.profiles` rows were imported. The runner removes the temporary SQL and local project after the check. There is no schema artifact upload and no SQL file is committed to the public repository.

**Owner action status:** the repository secret `SUPABASE_DB_URL` is now configured and the automated export/restore has succeeded. No terminal or local Supabase CLI action is required from the owner for this baseline workflow. Keep the URI private; do not send it in chat, an issue, a commit, or a workflow log.

The early workflow attempts on 7 November were safely stopped by secret-format preflight while the URI was being corrected. After correction, run [#42367689543](https://github.com/taufx98/sykabelajar4.0/actions/runs/42367689543) completed the export, isolated restore and structural verification. The secret's value is never printed or included in artifacts.

## Safe exporter

Use `scripts/auth-migration/export-schema-baseline.sh`. It requires Supabase CLI 3.0.0, Node.js (for a connection-target guard), local Docker and `psql`, creates a temporary output directory outside the repository, then:

1. Connects with the explicit remote database URI using Supabase CLI v3's `--remote=<uri>` flag; no project linking or CLI login is required.
2. Runs the default `supabase db dump` schema export to create `schema.sql`. Supabase documents that the default dump does not contain data or custom roles.
3. Runs the read-only `supabase db diff --use-migra --schema auth,storage --remote=<uri>` comparison and saves custom managed-schema DDL separately, so custom triggers on `auth.users` and Storage policies are not silently missed.
4. Records the PostgreSQL version and extension versions for local compatibility checks.
5. Rejects an unexpected `COPY ... FROM stdin` data block, writes checksums, and does not perform a restore or deploy.

Official references:
- Supabase CLI `db dump`: https://supabase.com/docs/reference/cli/supabase-db-dump
- Supabase CLI `db diff`: https://supabase.com/docs/reference/cli/supabase-db-diff
- Supabase CLI backup/restore notes: https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore

## Running it on a trusted local machine

Start from the latest PoC branch so the exporter includes the project-identity guard:

```bash
git fetch origin
git switch security/auth-poc-stage-1
git pull --ff-only origin security/auth-poc-stage-1

supabase --version
node --version
docker info
psql --version
```

The Supabase CLI must report version `3.0.0`; Docker must be running, and Node.js plus a PostgreSQL 17 `psql` client must be installed. The exporter does not require `supabase login` or `supabase link`; it uses the explicit v3 `--remote=<uri>` flag. If the local branch is not present yet, check it out from `origin/security/auth-poc-stage-1` before pulling.

Use the production project's existing direct connection string (`db.<project-ref>.supabase.co`) or its session-pooler connection string (username `postgres.<project-ref>`) locally; do not send it in chat or commit it to Git. The exporter now checks that the URL host/user matches `SUPABASE_PROJECT_REF` before any export, preventing a schema dump from one project being combined with an Auth/Storage diff from another. Use either the direct connection URI (`db.mvdczyitbkxkldjughor.supabase.co`) or the session-pooler URI whose username contains `postgres.mvdczyitbkxkldjughor`. The exporter validates that the host/username matches the project ref before it runs. You can enter the URI without placing its value in shell history:

```bash
export SUPABASE_PROJECT_REF='mvdczyitbkxkldjughor'
read -r -s -p 'Supabase database connection string: ' SUPABASE_DB_URL
printf '\n'
export SUPABASE_DB_URL
bash scripts/auth-migration/export-schema-baseline.sh
unset SUPABASE_DB_URL
```

The local fallback uses an explicit remote URI with CLI v3; it does not require CLI login or project linking. It uses no new Supabase project, branch, paid service, or Cloudflare deployment. The database export and diff are read-only; the only files written are local temporary schema/metadata artifacts.

## Output and handling

The script prints the temporary output directory. It contains:

- `schema.sql` — application schema dump only; no application rows or custom role dump.
- `auth-storage-custom.sql` — DDL diff for customizations in Supabase-managed Auth/Storage schemas.
- `extensions.txt` and `postgres-version.txt` — PostgreSQL/extension compatibility metadata.
- `role-metadata.txt` — password-free platform role attributes and per-schema default ACLs; compare these against the disposable local stack rather than importing role DDL.
- `manifest.txt` and `SHA256SUMS` — provenance and integrity metadata for every export file.

Keep the output directory outside the Git repository. The helper's static Bash/safety contract and FK-plan dry run passed in earlier CI. The actual production schema-only export and disposable restore have now been executed successfully by [run #42367689543](https://github.com/taufx98/sykabelajar4.0/actions/runs/42367689543); the schema files were removed from the runner after verification. Review the artifacts before using them for local tests; SQL function bodies can still contain application logic and should be treated as internal source code. Do not paste database URLs, passwords, service-role keys, user rows, or data dumps into chat.

## Local baseline strategy

Do not run `supabase db reset` against the entire historical migration directory just to force a clean start. Instead, start a disposable local Supabase stack and apply the reviewed schema-only artifact to it in a separate local fixture/database. Confirm prerequisites first: extension versions, custom roles/grants, custom Auth/Storage DDL, and any objects supplied by Supabase's local managed services. The local stack's built-in `auth` schema is platform infrastructure; the Better Auth identity fixture must still create no shadow application accounts in `auth.users`.

After a clean local baseline can be rebuilt reproducibly, add the actual identity-root migration behind a separate test-only migration branch and run the complete 69-FK orphan/integrity checks plus full RLS/function regression. Do not apply the resulting migration to production in this phase.

## Safety boundary

This script does not create or modify remote schema, users, rows, migrations, triggers, RLS policies, Edge Functions, projects, branches, or Cloudflare resources. It does not export `data.sql`, passwords, access tokens, or custom role definitions. The actual production migration remains blocked until the local baseline and hosted isolated Custom OIDC validation are both complete.
## Re-capture the live 69-FK catalog and generate a review-only plan

The committed `scripts/auth-migration/live-auth-users-fk-catalog.json` is a read-only snapshot, not an eternal source of truth. Immediately before any production migration review, recapture the current production catalog from the same validated project connection used for the schema-only baseline:

```bash
export SUPABASE_PROJECT_REF='mvdczyitbkxkldjughor'
read -r -s -p 'Supabase database connection string: ' SUPABASE_DB_URL
printf '\n'
export SUPABASE_DB_URL
mkdir -p /tmp/sykabelajar-auth-stage3-review
bash scripts/auth-migration/export-live-auth-users-fk-plan.sh /tmp/sykabelajar-auth-stage3-review
unset SUPABASE_DB_URL
```

The helper accepts either the direct `db.<project-ref>.supabase.co` connection or the matching session-pooler username `postgres.<project-ref>`. It uses a private temporary `.pgpass` file, validates the exact production project ref, runs a `BEGIN READ ONLY` catalog query, rejects drift from the audited 69 FKs / 62 source tables, writes the catalog plus SHA-256 under the absolute output directory, and invokes the existing generator to create three SQL files under `fk-plan/`. It exports no application rows and does not execute any generated SQL.

Expected local output:

- `live-auth-users-fk-catalog.json` and `.sha256` — the fresh catalog snapshot.
- `fk-plan/01-preflight-expand.sql` — full 69-FK preflight plus per-source-table bounded expand transactions.
- `fk-plan/02-validate.sql` — per-source-table validation transactions with exact semantic/reconciliation guards.
- `fk-plan/03-cutover.sql` — the single global atomic cutover transaction; never split into a partially migrated FK graph.

The helper stops if count, source-table shape, target, columns, or constraint-validation semantics differ from the reviewed snapshot. Investigate drift manually; never lower the expected count or bypass guards to make a plan generate. Output stays outside the Git repository and is mode 0600. The script does not execute even the preflight SQL.

## Production compatibility metadata inventory — 7 November 2026 (read-only)

A catalog-only query against the production project recorded PostgreSQL **17.6** and these installed extensions: `pg_cron 1.6.4`, `pg_stat_statements 1.11`, `pgcrypto 1.3`, `plpgsql 1.0`, `supabase_vault 0.3.1`, and `uuid-ossp 1.1`. The local disposable restore should use a compatible PostgreSQL 17 stack and compare each extension before replaying any custom Auth/Storage DDL.

The inspected non-`pg_` roles were Supabase platform roles only (`anon`, `authenticated`, `authenticator`, `dashboard_user`, `pgbouncer`, `postgres`, `service_role`, `supabase_admin`, `supabase_auth_admin`, `supabase_etl_admin`, `supabase_privileged_role`, `supabase_read_only_user`, `supabase_realtime_admin`, `supabase_replication_admin`, and `supabase_storage_admin`). No application-specific role was found in that query. Password hashes and role DDL were not selected.

Default ACL metadata exists across `auth`, `cron`, `extensions`, `graphql`, `graphql_public`, `public`, `realtime`, and `storage`. In particular, the `public` schema has default ACL entries for `anon`, `authenticated`, and `service_role` on relations, sequences and functions. These grants must be reconciled with the target local Supabase stack before using the restore for RLS/function regression; do not blindly replay platform-owned default privileges. The exporter captures the role/default-ACL catalog to `role-metadata.txt` for exact comparison.

These are schema/security metadata only. No production role, ACL, extension, database object, user, or application row was changed.
