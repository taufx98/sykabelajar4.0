# First Admin bootstrap — isolated Better Auth staging only

Status: **prepared, not executed**. Project target: Supabase Free staging project `ydamszdfsxqisanazdkb`; issuer: `https://auth.sykabelajar.my.id/api/auth`.

This is an owner-operated, one-time database procedure. It intentionally creates no HTTP endpoint and does not allow public registration to request the `admin` role. Never use the SQL file against production.

## Order of operations

1. Configure a Google OAuth application in Google's own developer console. Its authorized redirect URI must be exactly:
   `https://auth.sykabelajar.my.id/api/auth/callback/google`.
2. Install the Google client ID and secret as **Cloudflare Worker secrets** for the staging Worker `sykabelajar-auth-poc` only. The Worker currently supports the legacy environment pair `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` as a bootstrap path before the managed Admin provider panel can be used. In Cloudflare Dashboard open Workers & Pages → `sykabelajar-auth-poc` → Settings → Variables and Secrets, add both names as Secret values in the same edit, then deploy once. Do not add either value under Wrangler `vars`, Pages variables, GitHub source files, or chat.

   The CLI alternative is to create a temporary local `.env` file containing both entries and submit both together from `services/auth-worker`:
   ```bash
   npx wrangler secret bulk ./staging-google-secrets.env --name sykabelajar-auth-poc
   ```
   The file must contain only `GOOGLE_CLIENT_ID=...` and `GOOGLE_CLIENT_SECRET=...`; keep it out of Git, restrict its local permissions, and remove it immediately after the command. Do not run `wrangler secret put` for only one half of the pair: Cloudflare deploys a new Worker version immediately after each `secret put`, and the application deliberately rejects a partial provider pair. Cloudflare documents the bulk and secret commands in [Wrangler secret commands](https://developers.cloudflare.com/workers/wrangler/commands/workers/) and [Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/).
3. In Cloudflare Pages project `sykabelajar`, edit **Preview** environment variables only (not Production). Preserve the existing shared variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. Add/set these staging-only variables:
   - `VITE_BETTER_AUTH_SUPABASE_URL=https://ydamszdfsxqisanazdkb.supabase.co`
   - `VITE_BETTER_AUTH_SUPABASE_PUBLISHABLE_KEY` = the public publishable key from the isolated staging Supabase project
   - `VITE_BETTER_AUTH_FRONTEND_ENABLED=true`
   - `VITE_AUTH_WORKER_URL=https://auth.sykabelajar.my.id`

   Then run the read-only **Better Auth Pages preview configuration preflight**. It must report the isolated Supabase host, a configured staging publishable key, the enabled preview flag, the stable Worker host, the existing shared Supabase configuration preserved, and `betterAuthPreviewReady=true`. The workflow prints variable names and boolean checks only; it does not mutate Pages or DNS. Keep these values in the Pages Preview configuration, never in committed files.
4. Open `https://staging.sykabelajar.my.id` and sign in with the Google account controlled by the project owner. Google must return a verified email. Do not bypass Better Auth's `emailVerified` check.
5. In that same authenticated staging browser, open `https://auth.sykabelajar.my.id/api/auth/get-session`. Confirm the returned object identifies the intended owner account, has a UUID `user.id`, and has `user.emailVerified: true`. Copy only that UUID into the SQL template below. Never copy a session cookie, access token, or client secret into chat or SQL.
6. Open Supabase SQL Editor for the **staging** project `ydamszdfsxqisanazdkb` and confirm the editor executes as `postgres`. Review `AUTH-STAGING-FIRST-ADMIN-BOOTSTRAP.sql`, replace the all-zero UUID sentinel with the UUID from step 4, and execute it once. The SQL transaction serializes attempts, refuses to run outside the `postgres` owner context, rejects legacy-reference and shadow `auth.users` IDs, requires zero pre-existing admin rows, provisions the minimal application profile through the reviewed RPC, and creates one active admin role. If any assertion fails, the transaction rolls back.
7. Sign out and sign in again on the staging preview. Open Admin → Settings → Metode Login. The API should return settings only after both the Better Auth token contract and active `user_roles.admin` check pass.
8. After confirming the panel works, save the Google provider credentials through the panel if you want D1-managed configuration. The secret is write-only and encrypted with the existing `AUTH_PROVIDER_ENCRYPTION_KEY`. Do not enable Facebook until the actual SYKABELAJAR email verification delivery path exists.

## Existing checks

A read-only query before this runbook was prepared found zero rows in staging `private.app_users`, `public.profiles`, and `public.user_roles`, including zero admin rows. The live project has the identity-root provisioning RPC owned by `postgres`, and the staging role enum includes `admin`. Local pgTAP regression tests now cover owner-only bootstrap, the one-time guard, and denial of authenticated role writes.

## Stop conditions

Stop without changing anything when the verified session response is missing, `emailVerified` is not exactly true, the UUID is not from the same Better Auth session, a legacy `auth.users` row/tombstone exists, any admin row already exists, the SQL Editor is not `postgres`, or the project ref is not the isolated staging ref above. Never run this procedure in production. Do not make `SUPABASE_PROVISIONING_ENABLED=true` as a shortcut; ongoing identity provisioning requires its own explicit review of the separate service-role secret and lifecycle acceptance.


## Identity lineage guard

The staging schema contains `private.app_users.identity_origin` with only `better_auth` and `legacy_reference` values. The provisioning RPC writes `better_auth` for a new identity and locks/rechecks the row on every retry. A UUID-only `legacy_reference` tombstone cannot be upgraded into a login identity, profile or business role. The SQL bootstrap intentionally rejects these rows before assigning admin.

The migration and fixture contract has passed [Supabase Local Auth Claims CI #561](https://github.com/taufx98/sykabelajar4.0/actions/runs/42663635674). A live staging transaction also tested the RPC and legacy-reference rejection, then rolled back all synthetic rows; the staging identity tables remained empty.
