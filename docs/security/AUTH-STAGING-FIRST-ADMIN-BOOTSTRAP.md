# First Admin bootstrap — isolated Better Auth staging only

Status: **prepared, not executed**. Project target: Supabase Free staging project `ydamszdfsxqisanazdkb`; issuer: `https://auth.sykabelajar.my.id/api/auth`.

This is an owner-operated, one-time database procedure. It intentionally creates no HTTP endpoint and does not allow public registration to request the `admin` role. Never use the SQL file against production.

## Order of operations

1. Configure a Google OAuth application in Google's own developer console. Its authorized redirect URI must be exactly:
   `https://auth.sykabelajar.my.id/api/auth/callback/google`.
2. Install the Google client ID and secret as **Cloudflare Worker secrets** for the staging Worker `sykabelajar-auth-poc` only. The Worker currently supports the legacy environment pair `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` as a bootstrap path before the managed Admin provider panel can be used. Do not commit them, put them in Pages environment variables, or send them in chat.
3. Open the branch preview on the same-site staging domain and enable the Better Auth preview flag only for the staging build. Sign in with the Google account controlled by the project owner. Google must return a verified email. Do not bypass Better Auth's `emailVerified` check.
4. In that same authenticated staging browser, open `https://auth.sykabelajar.my.id/api/auth/get-session`. Confirm the returned object identifies the intended owner account, has a UUID `user.id`, and has `user.emailVerified: true`. Copy only that UUID into the SQL template below. Never copy a session cookie, access token, or client secret into chat or SQL.
5. Open Supabase SQL Editor for the **staging** project `ydamszdfsxqisanazdkb` and confirm the editor executes as `postgres`. Review `AUTH-STAGING-FIRST-ADMIN-BOOTSTRAP.sql`, replace the all-zero UUID sentinel with the UUID from step 4, and execute it once. The SQL transaction serializes attempts, refuses to run outside the `postgres` owner context, rejects legacy-reference and shadow `auth.users` IDs, requires zero pre-existing admin rows, provisions the minimal application profile through the reviewed RPC, and creates one active admin role. If any assertion fails, the transaction rolls back.
6. Sign out and sign in again on the staging preview. Open Admin → Settings → Metode Login. The API should return settings only after both the Better Auth token contract and active `user_roles.admin` check pass.
7. After confirming the panel works, save the Google provider credentials through the panel if you want D1-managed configuration. The secret is write-only and encrypted with the existing `AUTH_PROVIDER_ENCRYPTION_KEY`. Do not enable Facebook until the actual SYKABELAJAR email verification delivery path exists.

## Existing checks

A read-only query before this runbook was prepared found zero rows in staging `private.app_users`, `public.profiles`, and `public.user_roles`, including zero admin rows. The live project has the identity-root provisioning RPC owned by `postgres`, and the staging role enum includes `admin`. Local pgTAP regression tests now cover owner-only bootstrap, the one-time guard, and denial of authenticated role writes.

## Stop conditions

Stop without changing anything when the verified session response is missing, `emailVerified` is not exactly true, the UUID is not from the same Better Auth session, a legacy `auth.users` row/tombstone exists, any admin row already exists, the SQL Editor is not `postgres`, or the project ref is not the isolated staging ref above. Never run this procedure in production. Do not make `SUPABASE_PROVISIONING_ENABLED=true` as a shortcut; ongoing identity provisioning requires its own explicit review of the separate service-role secret and lifecycle acceptance.
