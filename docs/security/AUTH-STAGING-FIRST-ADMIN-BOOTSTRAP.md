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

Stop without changing anything when the verified session response is missing, `emailVerified` is not exactly true, the UUID is not from the same Better Auth session, a legacy `auth.users` row/tombstone exists, any admin row already exists, the SQL Editor is not `postgres`, or the project ref is not the isolated staging ref above. Never run this procedure in production. The isolated Worker currently has `SUPABASE_PROVISIONING_ENABLED=true` after the staging-only secret and RPC scope review; do not toggle this setting as a substitute for the real verified-session requirement. The first-admin bootstrap still requires one genuine verified Better Auth account and remains unexecuted.


## Identity lineage guard

The staging schema contains `private.app_users.identity_origin` with only `better_auth` and `legacy_reference` values. The provisioning RPC writes `better_auth` for a new identity and locks/rechecks the row on every retry. A UUID-only `legacy_reference` tombstone cannot be upgraded into a login identity, profile or business role. The SQL bootstrap intentionally rejects these rows before assigning admin.

The migration and fixture contract has passed [Supabase Local Auth Claims CI #561](https://github.com/taufx98/sykabelajar4.0/actions/runs/42663635674). A live staging transaction also tested the RPC and legacy-reference rejection, then rolled back all synthetic rows; the staging identity tables remained empty.


## Hosted staging acceptance updates — 10 November 2026

The staging-only Supabase project now has two additive alignment migrations beyond the original first-admin preparation:

- better_auth_phone_status_rpc: adds the server-only public phone-verification status wrapper expected by the Worker. Only service_role may execute it; no client role can call it.
- better_auth_profile_hydration: adds the minimal profile fields confirmed by .github/profile-runtime-contract.md, grants authenticated SELECT only, and limits reads to auth.uid() with the exact Better Auth issuer. Anonymous profile reads remain denied.

A live rollback-only SQL test successfully used two synthetic Better Auth UUIDs and confirmed that user A can read A's profile and business role but cannot read user B's profile or role. The transaction was rolled back. No real user, session, profile, role or admin was created.

The staging-only Cloudflare Worker Secret `SUPABASE_PROVISIONING_API_KEY` is now present and verified by name/type through read-only preflight [#42853474928](https://github.com/taufx98/sykabelajar4.0/actions/runs/42853474928), attempt 2. The key value was never read or printed. The guarded Worker deployment [#42949849642](https://github.com/taufx98/sykabelajar4.0/actions/runs/42949849642) then confirmed exactly one server-only binding and deployed with `SUPABASE_PROVISIONING_ENABLED=true` and the hard-pinned staging project URL. The four provisioning/verification/phone wrappers were independently checked as `postgres`-owned SECURITY DEFINER functions with empty `search_path` and EXECUTE limited to `service_role`. This enables future verified Better Auth identity projection only; it did not create an account, session, profile, business role or admin. The six identity-related row counts remain zero.

Transactional email remains deferred and no sender is active; Google/social login remains optional. Do not manufacture a verified account or perform first-admin bootstrap until a genuine Better Auth session reports `emailVerified: true`. The owner-operated bootstrap in this runbook remains prepared, unexecuted and staging-only.


## Temporary staging email-verification bypass and first Admin bootstrap — 11 November 2026

The staging-only Better Auth Worker now supports an Admin-managed runtime policy stored in D1 table `auth_runtime_settings`. The table was applied through guarded migration #42992509775 and defaults to `email_verification_required=1`. Worker version `9c89a8cc-13fe-4209-b883-cd1309b7905e` includes the policy API and hosted smoke checks. The Admin panel is integrated at **Admin → Pengaturan → Verifikasi Email Better Auth** and is hidden outside the Better Auth staging frontend.

### Enable bypass for the current staging build

The owner-authorized staging-only operation is provided by `.github/workflows/auth-runtime-settings-d1-staging.yml`. It is hard-pinned to branch `security/auth-poc-stage-1`, D1 name `sykabelajar-auth-poc`, and the reviewed staging D1 UUID. To activate the temporary bypass, add the exact one-time marker file `.github/auth-ops/SET-STAGING-EMAIL-VERIFICATION-BYPASS-0001` with content:

```text
SET-TEMPORARY-EMAIL-BYPASS-ON-STAGING-ONLY
```

The workflow writes only `email_verification_required=0` to the isolated staging D1 row and verifies that exact value. It does not modify Worker secrets, Production D1, Supabase Production, DNS, Pages Production, or user records. The Worker reads the runtime policy on requests; a redeploy is not required to apply or revert the policy.

To require verification again, add `.github/auth-ops/SET-STAGING-EMAIL-VERIFICATION-REQUIRED-0001` with content `REQUIRE-EMAIL-VERIFICATION-ON-STAGING-ONLY`. The required marker intentionally takes precedence over the retained bypass marker. The re-enable operation writes `email_verification_required=1`; after doing this, accounts whose email is still unverified cannot continue to open a session until a genuine verification flow has been completed.

### Bootstrap the first staging Admin while email is unverified

The current staging inventory showed one Better Auth-provisioned application identity with a `student` role and no active `admin` role. Therefore the panel is correctly protected but cannot yet be managed by that student account. The owner must designate the first staging Admin once:

1. Enable the staging-only bypass marker above.
2. Sign in at `https://staging.sykabelajar.my.id` using the owner-controlled account. Open `https://auth.sykabelajar.my.id/api/auth/get-session` in that same browser and confirm the account is the intended owner identity and `emailVerified=false`. Copy only `user.id` (UUID); never copy cookies or tokens.
3. In the SQL Editor for staging project `ydamszdfsxqisanazdkb`, running as `postgres`, review and execute `docs/security/AUTH-STAGING-FIRST-ADMIN-BOOTSTRAP-UNVERIFIED.sql` after replacing its sentinel UUID with that exact session UUID.
4. Sign out and back in, then open **Admin → Pengaturan**. The runtime policy endpoint still checks the Better Auth token signature, issuer, audience, UUID subject, expiry, trusted origin and active `user_roles.admin` membership. The temporary bypass relaxes only the email-verified claim check; it never grants an Admin role by itself.
5. Once the transactional email provider is configured and the Admin address has been genuinely verified, use the panel to enable verification again. This revokes future unverified session access; it does not mark existing addresses verified.

The unverified bootstrap SQL explicitly keeps `private.app_users.email_verified_at IS NULL`, rejects any shadow `auth.users` row, requires zero pre-existing Admin rows, and does not create a public Admin signup path. It is owner-operated and staging-only. Do not apply it to Production.

### Current limits

The temporary bypass is a staging test convenience, not proof of mailbox ownership. Password reset, verification email sending, and any feature that explicitly needs a verified email remain dependent on a configured sender. Google OAuth and ZeptoMail are not prerequisites for the basic email/password staging test and remain deferred. The bypass has not yet been activated by this checkpoint; the D1 value remains `1` pending the final CI gate and explicit staging marker operation.
