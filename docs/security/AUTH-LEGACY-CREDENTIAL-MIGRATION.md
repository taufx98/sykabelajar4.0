# Legacy Supabase Auth account and password continuity

Status: design gate for the seven-stage Better Auth migration — not implemented and not a production migration.

Date: 4 November 2026

## Why this is required

The current application identity is anchored to `auth.users.id`. Production has 69 application foreign keys referencing that UUID, so the migration must preserve each existing user's UUID as the Better Auth user ID. Generating new UUIDs and trying to remap the application graph would create unnecessary risk across profiles, exam attempts, competitions, orders, chat, referrals, Edu Coin, certificates, and audit history.

There is a separate credential compatibility issue:

- Supabase Auth stores email/password hashes as bcrypt in `auth.users.encrypted_password`.
- Better Auth uses scrypt by default. Its password hasher can be customized, but this is not a transparent hash-format migration.
- Better Auth D1's credential password is stored on its `account` model, not on the `user` model.
- Cloudflare Workers Free currently has a 10 ms CPU limit per HTTP invocation. A synchronous JavaScript bcrypt verifier must not be assumed to fit this budget.

References:
- Supabase password storage: https://supabase.com/docs/guides/auth/password-security
- Better Auth password hashing and custom hash/verify: https://better-auth.com/docs/reference/security
- Better Auth migration guide's bcrypt example: https://better-auth.com/docs/guides/auth0-migration-guide
- Cloudflare Workers limits: https://developers.cloudflare.com/workers/platform/limits/

## Non-negotiable invariants

1. Preserve every existing application user's UUID. The Better Auth `user.id`, Supabase `private.app_users.id`, and JWT `sub` must be identical.
2. Never copy passwords, password hashes, access tokens, refresh tokens, reset tokens, OAuth secrets, or session secrets into `private.app_users`.
3. Never export credential hashes into Git, CI artifacts, chat, or synthetic test fixtures.
4. Do not weaken password hashing cost just to fit a Free CPU limit.
5. Do not put a Supabase service-role key in a browser or in a user-accessible endpoint.
6. Do not silently create a second Better Auth identity when the UUID/email already maps to a legacy account.
7. Preserve existing profiles, application roles, bans/disabled state, verified-email state, and trusted provider identities. Provisioning for existing users must not reset profile fields or reactivate disabled roles.
8. Existing Supabase Auth sessions do not need to be migrated. They must stop authorizing application data after the old issuer is removed from the RLS/JWT trust boundary.

## Options considered

### A. Import bcrypt hashes into Better Auth D1

A migration job could write the existing UUID/email into Better Auth's `user` table and the existing bcrypt hash into the `account.password` field of a `credential` account. Better Auth would then need a custom password verifier that understands Supabase's bcrypt format.

This avoids forcing users to reset passwords, but introduces an unverified runtime cost: bcrypt verification in JavaScript can exceed Cloudflare Workers Free's 10 ms CPU budget. A lower bcrypt cost is not an acceptable workaround because it weakens password security. Do not implement or select this option unless a real Worker staging benchmark proves the exact legacy bcrypt hashes can be verified within the free CPU budget under worst-case conditions.

### B. Just-in-time migration using the existing Supabase Auth password verifier

Candidate for a low-friction migration that avoids running bcrypt in the Worker:

1. A user with no migrated Better Auth credential attempts to sign in.
2. A dedicated server-side migration route sends the submitted email/password to the existing Supabase Auth password grant endpoint over HTTPS using only the project's public anon/publishable API key. It must never use a service-role key for password verification.
3. The Worker treats the Supabase response only as proof that the password was valid. It verifies the returned user UUID and required email-verification state against the legacy identity projection. It must never trust an ID, role, or verification flag supplied by the browser.
4. The Worker discards the Supabase access token and refresh token. Neither token is returned to the browser, written to D1, or logged.
5. The Worker creates the Better Auth user with the exact legacy UUID and creates a `credential` account whose password is newly hashed with Better Auth's native configured hasher (scrypt in the current POC).
6. The operation is idempotent and race-safe. A migration marker is committed atomically with the Better Auth user/account, or the operation uses a safe retry/duplicate-resolution mechanism. Once migrated, an old Supabase password must never be able to overwrite a subsequently changed Better Auth password.
7. The Worker issues only the normal Better Auth session and OIDC token. The browser never receives a Supabase Auth session from this bridge.

Important limitations and required proof:

- This is only a candidate. A prototype must prove that Better Auth 1.7.16 can create a user with a caller-supplied UUID through a supported server-side adapter path, and that user/account/marker writes are idempotent on D1.
- The flow must be protected against timing-based account enumeration, brute force, replay, duplicate concurrent migrations, and fallback after a Better Auth password has changed.
- The bridge is temporary and must have a measurable end condition. It must not become a permanent second login authority.
- Unverified legacy email accounts must complete a trusted verification process before they become eligible for the new session.
- Social-only users require a separate provider-account migration/linking path. Do not auto-link Google accounts based only on matching email. Use the verified provider identity from the legacy `auth.identities` record and prove possession of the same Google account.
- Accounts with no usable email, anonymous accounts, banned/disabled accounts, and identities with duplicate or conflicting provider/email records need an explicit exception path before bulk migration.
- Supabase Auth public sign-in must remain available only for the controlled bridge while it is needed; the frontend must not keep using Supabase Auth as its normal session authority after Stage 4/7.

### C. Require a password reset for legacy password accounts

If option B cannot be made safe and reliable within the free-only environment, import legacy users with their exact UUIDs and verified identity/profile projection but do not import bcrypt hashes. Require users to complete a verified email recovery/password setup before their first Better Auth session.

This has higher user friction and needs communication/support planning, but avoids running bcrypt in Workers Free and avoids a permanent dependency on Supabase Auth sign-in. This is the explicit fallback, not an unannounced behavior change.

## Required prototype and acceptance tests

Before choosing A, B, or C:

- Use synthetic identities and disposable local D1/Supabase fixtures only.
- Verify exact UUID preservation in Better Auth `user.id`, `account.userId`, `account.accountId`, and JWT `sub`.
- Verify that credentials are never returned to the client and no Supabase token is stored or logged.
- Test wrong password, unknown email, unverified email, disabled/banned account, missing/duplicate identity, provider-only user, and concurrent first-login requests.
- Test password change after migration: the previous Supabase password must no longer authenticate the Better Auth account.
- Test retry after each failure point so a partial D1 write cannot lock the user out or create duplicate rows.
- Measure CPU time on a real non-production Workers Free deployment before selecting any bcrypt-in-Worker approach. Do not rely only on local Node/Wrangler timings.
- Preserve all profile/business roles and avoid running the new-user provisioning path over an existing account.
- Verify no legacy-issuer JWT is accepted for application tables after cutover.

## Current decision

**No credential migration strategy has been selected or implemented yet.** The current Worker POC still uses Better Auth's default scrypt behavior and has no legacy Supabase password import or JIT bridge. This must remain an explicit migration gate; it must not be treated as complete merely because the local OIDC and RLS contract tests pass.

The next implementation increment should be a local-only prototype of option B with a mocked Supabase Auth verifier and a fixed synthetic UUID, followed by concurrency, password-change, and failure-retry tests. Do not connect the prototype to production Auth or deploy it to a shared Worker.
