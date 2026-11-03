# D1 migrations

Migration 0000_auth_worker_internal_config.sql creates the private Worker bootstrap-state table used to make first-party OAuth client registration idempotent.

Generate the full Better Auth schema from the exact configuration using the Better Auth CLI config at src/auth.cli.ts. This config uses Wrangler getPlatformProxy with persist=false so the D1 binding is disposable and local-only.

The generated output must include the core Better Auth tables, JWKS storage, OAuth Provider tables, and the rate-limit table. Do not hand-write a partial Better Auth schema.

Review the generated SQL, commit the SQL file here, and verify it by applying it to a disposable local D1 database. Never run schema generation against a remote or production D1 database. Do not apply migrations to production.
