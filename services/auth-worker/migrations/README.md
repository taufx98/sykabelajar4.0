# D1 migrations

Migration 0000_auth_worker_internal_config.sql creates the private Worker bootstrap-state table used to make first-party OAuth client registration idempotent.

Migration 0001_better_auth.sql is exported by the isolated local Worker through Better Auth's supported getMigrations() API. The generator endpoint is protected by a random bearer secret and requires ALLOW_SCHEMA_BOOTSTRAP=true. It must never be enabled on a shared or production environment.

Migration 0002_seed_first_party_oauth_client.sql provisions the one fixed first-party public OIDC client and resource. It has no client secret, only the exact HTTPS SPA callback, and the authorization_code grant with PKCE required. The internal client-bootstrap endpoint only verifies these seed rows; it does not create OAuth clients.

The generated Better Auth output must include core Better Auth tables, JWKS storage, all OAuth Provider tables, and the database-backed rate-limit table. Custom tables from migration 0003 are excluded from the Better Auth schema export. Do not hand-write a partial Better Auth schema.

Review the generated SQL and verify it against disposable local D1. The PR validation workflow applies migrations 0000–0003, runs the full email/session/OAuth/PKCE/JWT integration suite, and commits the generated 0001 SQL and matching npm lockfile only after the entire pipeline passes. The checked-in lockfile is installed with npm ci. Never generate schema against a remote or production D1 database. Do not apply migrations to production.

Migration 0001 remains the immutable initial Better Auth core schema. Registration metadata columns `accountType`, `username`, and `referralCode` are introduced by additive migration 0004, because the original 0001 has already been applied to the remote staging D1. The generator explicitly strips these three extension columns from the regenerated 0001 output so local tests and remote migration history remain consistent. These attributes are registration inputs only; they are not authentication roles or authorization claims.


Migration 0003 creates the encrypted ZeptoMail Agent profile store, the selected active Agent pointer, and an admin test-email rate limit. Send Mail Tokens are encrypted by the Worker with AES-256-GCM using the `AUTH_EMAIL_ENCRYPTION_KEY` Worker secret. This key must be stable across deployments; changing it without re-encrypting saved profiles makes existing tokens unreadable. Never export the ciphertext or key to frontend code.

Only the authenticated active-admin API can create, rotate, activate, test, or remove Agent profiles. The API returns metadata and a tokenConfigured flag only—never a token or ciphertext.

Migration 0005 (`0005_telegram_phone_verification.sql`) creates a short-lived, one-use challenge table for the optional Telegram OIDC **phone-verification step**. It is not a Telegram login provider and must only be started for an already authenticated Better Auth session. The table stores a SHA-256 hash of the random OAuth state, the Better Auth user UUID, nonce, PKCE verifier and timestamps; it does not store a phone number, Telegram access token or ID token. Expired challenges are pruned on challenge creation, the per-user 60-second start cooldown is reserved atomically, and callbacks consume the challenge with one atomic `DELETE ... RETURNING`.

The Worker verifies the Telegram ID token signature against Telegram's JWKS and validates the exact issuer, audience, nonce, expiry and `phone_number_verified=true` claim before projecting only the legacy-compatible SHA-256 hash of the international phone digits to the server-only Supabase RPC. The raw phone number and provider tokens must never be logged, returned to the browser, or persisted in D1/Supabase.

The guarded staging D1 migration workflow is versioned for migrations 0000–0005 and checks the reviewed SHA-256 for both 0004 and 0005, the exact non-production D1 name/UUID, and the expected 18-table schema after apply. As of 7 November 2026, remote staging D1 is verified through 0004 (17 tables); 0005 is committed and locally tested but **has not yet been applied remotely**. Applying it requires the separate exact typed confirmation in the staging workflow. This is not a production migration. Telegram verification remains disabled until BotFather app registration/callback allowlisting and the required Cloudflare Worker configuration have been completed and a real hosted consent/callback test passes.
