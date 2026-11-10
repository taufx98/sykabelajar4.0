# First Admin bootstrap — isolated Better Auth staging only

Status: **prepared, not executed**. Project target: Supabase Free staging project `ydamszdfsxqisanazdkb`; issuer: `https://auth.sykabelajar.my.id/api/auth`.

This is an owner-operated, one-time database procedure. It intentionally creates no HTTP endpoint and does not allow public registration to request the `admin` role. Never use the SQL file against production.

## Order of operations

1. A first-admin bootstrap requires a real Better Auth account and a real session whose `user.emailVerified` value is exactly `true`. Google, Facebook and X are optional social-login integrations; none is mandatory for the Better Auth architecture. A password account can satisfy this only after a genuine email-verification flow has been configured and completed. Transactional email delivery is currently deferred by owner instruction, so do not treat password sign-up as a verified hosted-session test until a delivery method is deliberately enabled.
2. Do not add Google/Facebook/X credentials as a prerequisite. Keep social providers disabled until the owner explicitly chooses one. Never forge `emailVerified=true`, remove the verification guard, or seed a synthetic verified browser session. This runbook can continue when a real verified Better Auth session exists through an approved verification method.
3. In Cloudflare Pages project `sykabelajar`, open Settings → Variables and Secrets and select the **Preview** environment (not Production). The latest read-only inspection found the existing shared `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` are present, and `VITE_SUPABASE_ANON_KEY` is stored as `secret_text`. Preserve all existing Preview variables. In particular, do not delete, edit, recreate, copy, or change the type of `VITE_SUPABASE_ANON_KEY`; its current secret value is intentionally masked by the API. Use **Add variable** to add only these four Better Auth staging-only variables:
   - `VITE_BETTER_AUTH_SUPABASE_URL=https://ydamszdfsxqisanazdkb.supabase.co`
   - `VITE_BETTER_AUTH_SUPABASE_PUBLISHABLE_KEY` = the public publishable key from the isolated staging Supabase project
   - `VITE_BETTER_AUTH_FRONTEND_ENABLED=true`
   - `VITE_AUTH_WORKER_URL=https://auth.sykabelajar.my.id`

   After saving, run the read-only **Better Auth Pages preview configuration preflight**. It must report the isolated Supabase host, a configured staging publishable key, the enabled preview flag, the stable Worker host, the existing shared Supabase configuration preserved, and `betterAuthPreviewReady=true`. The workflow prints variable names, types and boolean checks only; it does not print values or mutate Pages/DNS. If a value is wrong, edit only the corresponding new Better Auth Preview variable; do not change the existing shared variables. Keep the four additions in Pages Preview, never in committed files.
4. Open `https://staging.sykabelajar.my.id` and sign in using an actually configured Better Auth provider that supplies a genuine verified email. Confirm the session's `emailVerified` claim is `true`; do not bypass this check. At the current checkpoint no social provider is configured and transactional email is deferred, so this step is deliberately blocked until an approved verification method exists.
5. In that same authenticated staging browser, open `https://auth.sykabelajar.my.id/api/auth/get-session`. Confirm the returned object identifies the intended owner account, has a UUID `user.id`, and has `user.emailVerified: true`. Copy only that UUID into the SQL template below. Never copy a session cookie, access token, or client secret into chat or SQL.
6. Open Supabase SQL Editor for the **staging** project `ydamszdfsxqisanazdkb` and confirm the editor executes as `postgres`. Review `AUTH-STAGING-FIRST-ADMIN-BOOTSTRAP.sql`, replace the all-zero UUID sentinel with the UUID from step 4, and execute it once. The SQL transaction serializes attempts, refuses to run outside the `postgres` owner context, rejects legacy-reference and shadow `auth.users` IDs, requires zero pre-existing admin rows, provisions the minimal application profile through the reviewed RPC, and creates one active admin role. If any assertion fails, the transaction rolls back.
7. Sign out and sign in again on the staging preview. Open Admin → Settings → Metode Login. The API should return settings only after both the Better Auth token contract and active `user_roles.admin` check pass.
8. After confirming the panel works, configure only a social provider that the owner has explicitly chosen. Provider credentials are write-only and encrypted with the existing `AUTH_PROVIDER_ENCRYPTION_KEY`. Do not enable a provider that cannot return a trustworthy verified email unless an approved SYKABELAJAR email-verification delivery path exists.

## Existing checks

A read-only query before this runbook was prepared found zero rows in staging `private.app_users`, `public.profiles`, and `public.user_roles`, including zero admin rows. The live project has the identity-root provisioning RPC owned by `postgres`, and the staging role enum includes `admin`. Local pgTAP regression tests now cover owner-only bootstrap, the one-time guard, and denial of authenticated role writes.

## Stop conditions

Stop without changing anything when the verified session response is missing, `emailVerified` is not exactly true, the UUID is not from the same Better Auth session, a legacy `auth.users` row/tombstone exists, any admin row already exists, the SQL Editor is not `postgres`, or the project ref is not the isolated staging ref above. Never run this procedure in production. Do not make `SUPABASE_PROVISIONING_ENABLED=true` as a shortcut; ongoing identity provisioning requires its own explicit review of the separate service-role secret and lifecycle acceptance.


## Identity lineage guard

The staging schema contains `private.app_users.identity_origin` with only `better_auth` and `legacy_reference` values. The provisioning RPC writes `better_auth` for a new identity and locks/rechecks the row on every retry. A UUID-only `legacy_reference` tombstone cannot be upgraded into a login identity, profile or business role. The SQL bootstrap intentionally rejects these rows before assigning admin.

The migration and fixture contract has passed [Supabase Local Auth Claims CI #561](https://github.com/taufx98/sykabelajar4.0/actions/runs/42663635674). A live staging transaction also tested the RPC and legacy-reference rejection, then rolled back all synthetic rows; the staging identity tables remained empty.


## Hosted staging acceptance updates — 10 November 2026

The staging-only Supabase project now has two additive alignment migrations beyond the original first-admin preparation:

- better_auth_phone_status_rpc: adds the server-only public phone-verification status wrapper expected by the Worker. Only service_role may execute it; no client role can call it.
- better_auth_profile_hydration: adds the minimal profile fields confirmed by .github/profile-runtime-contract.md, grants authenticated SELECT only, and limits reads to auth.uid() with the exact Better Auth issuer. Anonymous profile reads remain denied.

A live rollback-only SQL test successfully used two synthetic Better Auth UUIDs and confirmed that user A can read A's profile and business role but cannot read user B's profile or role. The transaction was rolled back. No real user, session, profile, role or admin was created.

Separate Worker provisioning prerequisite: the Cloudflare Worker currently has no SUPABASE_SERVICE_ROLE_KEY secret binding. Keep SUPABASE_PROVISIONING_ENABLED=false. Do not place a Supabase service-role key in Pages variables, repository files, Actions logs or chat. Only add it as a Worker secret for sykabelajar-auth-poc after verifying it is the Free staging project's key and reviewing the Worker RPC scope; then separately review and deploy the enabling flag. This secret is intentionally not replaced by the publishable key.

The read-only Cloudflare preflight reports secret binding names and types only. The Supabase provisioning secret binding is still absent, so keep `SUPABASE_PROVISIONING_ENABLED=false`. A social provider is optional and should be configured only if the owner chooses it; it is not a prerequisite for the core Better Auth implementation.
