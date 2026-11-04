# D1 migrations

Migration 0000_auth_worker_internal_config.sql creates the private Worker bootstrap-state table used to make first-party OAuth client registration idempotent.

Migration 0001_better_auth.sql is exported by the isolated local Worker through Better Auth's supported getMigrations() API. The generator endpoint is protected by a random bearer secret and requires ALLOW_SCHEMA_BOOTSTRAP=true. It must never be enabled on a shared or production environment.

The generated output must include core Better Auth tables, JWKS storage, OAuth Provider tables, and the database-backed rate-limit table. Do not hand-write a partial Better Auth schema.

Review the generated SQL and verify it against disposable local D1. The PR validation workflow commits the generated SQL and matching npm lockfile back to the same branch after every full passing run. Never generate schema against a remote or production D1 database. Do not apply migrations to production.
