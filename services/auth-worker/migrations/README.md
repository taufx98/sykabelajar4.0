# D1 migrations

Migration 0000_auth_worker_internal_config.sql creates the private Worker bootstrap-state table used to make first-party OAuth client registration idempotent.

Migration 0001_better_auth.sql is exported by the isolated local Worker through Better Auth's supported getMigrations() API. The generator endpoint is protected by a random bearer secret and requires ALLOW_SCHEMA_BOOTSTRAP=true. It must never be enabled on a shared or production environment.

Migration 0002_seed_first_party_oauth_client.sql provisions the one fixed first-party public OIDC client and resource. It has no client secret, only the exact HTTPS SPA callback, and the authorization_code grant with PKCE required. The internal client-bootstrap endpoint only verifies these seed rows; it does not create OAuth clients.

The generated output must include core Better Auth tables, JWKS storage, all OAuth Provider tables, and the database-backed rate-limit table. Do not hand-write a partial Better Auth schema.

Review the generated SQL and verify it against disposable local D1. The PR validation workflow applies migrations 0000–0002, runs the full email/session/OAuth/PKCE/JWT integration suite, and commits the generated 0001 SQL and matching npm lockfile only after the entire pipeline passes. The checked-in lockfile is installed with npm ci. Never generate schema against a remote or production D1 database. Do not apply migrations to production.
