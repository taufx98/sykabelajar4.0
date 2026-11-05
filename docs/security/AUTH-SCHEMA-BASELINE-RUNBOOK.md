# Auth migration schema-only baseline runbook

Status: local preparation only. This runbook does not authorize a production migration.

## Purpose

The repository's historical `supabase/migrations` directory is incremental and is not a proven clean bootstrap for the current production database. A full schema-only export is therefore the next input required before attempting a complete local application baseline.

The existing `scripts/supabase-full-migrate.sh` is **not** suitable for this task: it also exports `data.sql`, role definitions, migration history, and includes a restore path. Do not use that full migration helper for auth testing.

## Safe exporter

Use `scripts/auth-migration/export-schema-baseline.sh`. It requires the existing Supabase CLI 3.0.0 and local Docker, creates a temporary output directory outside the repository, then:

1. Links the existing project in local CLI metadata only.
2. Runs the default `supabase db dump` schema export to create `schema.sql`. Supabase documents that the default dump does not contain data or custom roles.
3. Runs the read-only `supabase db diff --linked --schema auth,storage` comparison and saves custom managed-schema DDL separately, so custom triggers on `auth.users` and Storage policies are not silently missed.
4. Records the PostgreSQL version and extension versions for local compatibility checks.
5. Rejects an unexpected `COPY ... FROM stdin` data block, writes checksums, and does not perform a restore or deploy.

Official references:
- Supabase CLI `db dump`: https://supabase.com/docs/reference/cli/supabase-db-dump
- Supabase CLI `db diff`: https://supabase.com/docs/reference/cli/supabase-db-diff
- Supabase CLI backup/restore notes: https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore

## Running it on a trusted local machine

Use the production project's existing direct connection string (`db.<project-ref>.supabase.co`) or its session-pooler connection string (username `postgres.<project-ref>`) locally; do not send it in chat or commit it to Git. The exporter now checks that the URL host/user matches `SUPABASE_PROJECT_REF` before any export, preventing a schema dump from one project being combined with an Auth/Storage diff from another. You can enter it without placing the value in shell history:

```bash
export SUPABASE_PROJECT_REF='mvdczyitbkxkldjughor'
read -r -s -p 'Supabase database connection string: ' SUPABASE_DB_URL
printf '\n'
export SUPABASE_DB_URL
supabase login
bash scripts/auth-migration/export-schema-baseline.sh
unset SUPABASE_DB_URL
```

The script may ask the Supabase CLI to authenticate/link the existing project. It uses no new Supabase project, branch, paid service, or Cloudflare deployment. The database export and diff are read-only; the only files written are local temporary schema/metadata artifacts.

## Output and handling

The script prints the temporary output directory. It contains:

- `schema.sql` — application schema dump only; no application rows or custom role dump.
- `auth-storage-custom.sql` — DDL diff for customizations in Supabase-managed Auth/Storage schemas.
- `extensions.txt` and `postgres-version.txt` — local compatibility metadata.
- `manifest.txt` and `SHA256SUMS` — provenance and integrity metadata.

Keep the output directory outside the Git repository. The helper's static Bash/safety contract and FK-plan dry run passed in [CI run #41860723261](https://github.com/taufx98/sykabelajar4.0/actions/runs/41860723261), which also passed all 71 local pgTAP assertions. The actual export command has **not** been executed by CI. Review the artifacts before using them for local tests; SQL function bodies can still contain application logic and should be treated as internal source code. Do not paste database URLs, passwords, service-role keys, user rows, or data dumps into chat.

## Local baseline strategy

Do not run `supabase db reset` against the entire historical migration directory just to force a clean start. Instead, start a disposable local Supabase stack and apply the reviewed schema-only artifact to it in a separate local fixture/database. Confirm prerequisites first: extension versions, custom roles/grants, custom Auth/Storage DDL, and any objects supplied by Supabase's local managed services. The local stack's built-in `auth` schema is platform infrastructure; the Better Auth identity fixture must still create no shadow application accounts in `auth.users`.

After a clean local baseline can be rebuilt reproducibly, add the actual identity-root migration behind a separate test-only migration branch and run the complete 69-FK orphan/integrity checks plus full RLS/function regression. Do not apply the resulting migration to production in this phase.

## Safety boundary

This script does not create or modify remote schema, users, rows, migrations, triggers, RLS policies, Edge Functions, projects, branches, or Cloudflare resources. It does not export `data.sql`, passwords, access tokens, or custom role definitions. The actual production migration remains blocked until the local baseline and hosted isolated Custom OIDC validation are both complete.