# Isolated Better Auth Worker staging deployment

Status as of 7 November 2026: **Remote D1 migrations 0000–0006 are applied; all 18 expected tables and the email provider column are verified; the Telegram-capable, provider-aware Worker is live on staging.** Migration 0005 was applied by [#42339140591](https://github.com/taufx98/sykabelajar4.0/actions/runs/42339140591), migration 0006 by [#42339767786](https://github.com/taufx98/sykabelajar4.0/actions/runs/42339767786), and latest Worker deployment [#42339805803](https://github.com/taufx98/sykabelajar4.0/actions/runs/42339805803) passed exact configuration, D1/schema/empty-state and hosted health/discovery/PKCE/JWKS/CORS checks. Real email awaits Brevo Free sender-domain/API Key setup; Telegram awaits BotFather credentials and hosted consent/callback acceptance.

## Current verified state — 6 November 2026

- Dedicated D1 database: `sykabelajar-auth-poc`.
- D1 UUID: `7a4f9008-a1c6-42b6-8a04-abde12699248`.
- Remote D1 migration run [#42159049470](https://github.com/taufx98/sykabelajar4.0/actions/runs/42159049470) completed successfully and verified all 17 expected Better Auth/OAuth/ZeptoMail table names.
- The deployment workflow passed Worker typecheck, unit/security tests, local deployment dry-run, exact Supabase project guard, Cloudflare zone/DNS preflight, remote D1 table checks, and empty staging user/session/account checks in [run #42178992387](https://github.com/taufx98/sykabelajar4.0/actions/runs/42178992387).
- A later user-triggered deployment attempt [#42181766748](https://github.com/taufx98/sykabelajar4.0/actions/runs/42181766748) passed all preflight, 17-table, and empty-identity-state checks but failed before contacting Cloudflare because Wrangler 4.156.2 rejected the unsupported `wrangler deploy --yes` argument (`Unknown argument: yes`). The diagnostic step was also skipped because its `if` condition used malformed nested expression interpolation.
- Latest read-only resource snapshot [#42182078460](https://github.com/taufx98/sykabelajar4.0/actions/runs/42182078460) confirms the dedicated D1 and Worker script `sykabelajar-auth-poc` now exist; `auth.sykabelajar.my.id` Custom Domain and any matching Worker route are still absent. No new deployment occurred during that check.
- The deployment workflow is now fixed: removed `--yes`, changed diagnostic upload to `if: ${{ failure() }}`, and pinned the runner/action runtimes. CI [#42182078655](https://github.com/taufx98/sykabelajar4.0/actions/runs/42182078655) passed both Worker/OIDC and frontend jobs. The workflow is ready for another manual staging dispatch.

## Historical initial Cloudflare permission guidance — superseded

The GitHub Actions token already proves it can read the active `sykabelajar.my.id` zone, list Workers, read Worker domains/routes, and read/write the dedicated D1. The initial Worker creation hurdle has now been cleared: the latest preflight sees `sykabelajar-auth-poc`. The remaining action is to upload the actual Worker bundle and attach its Custom Domain. The most recent failure was a local Wrangler CLI argument error, not evidence of an outstanding permission failure.

Cloudflare currently documents these minimum permissions:

1. **Worker script creation:** already cleared; the latest read-only preflight can list `sykabelajar-auth-poc`.
2. **Attach `auth.sykabelajar.my.id` as a Custom Domain:** the deployment token still needs Workers **Editor** access to the Worker plus Zone `Workers Routes Write` scoped only to the `sykabelajar.my.id` zone. The next manual run will verify this permission by performing the actual deployment; no extra permission change is required unless Cloudflare returns an authorization error.
3. Keep the existing D1 Read/Edit and Zone Read permissions. Do not grant Super Administrator, DNS-wide edit, or unrelated product permissions.

Official references:
- Cloudflare [Roles and permissions](https://developers.cloudflare.com/workers/authorization/) — new Worker creation requires Workers product Admin; existing Worker deployment uses Editor; Custom Domain/Routes changes also require Zone Workers Routes Write.
- Cloudflare [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/) — Cloudflare creates the DNS record and certificate after a Custom Domain is attached; a pre-existing CNAME on that hostname prevents creation.
- Cloudflare [API token permissions](https://developers.cloudflare.com/fundamentals/api/reference/permissions/) — permissions are resource-scoped by Account, Zone, and User.

### Least-privilege sequence

The account owner can avoid giving CI product-level Admin by creating the empty Worker script `sykabelajar-auth-poc` once through the Cloudflare Dashboard. Then add Workers **Editor** and Zone `Workers Routes Write` to the staging deployment token. Note that Cloudflare currently does not support per-Worker roles for Custom Domains, so Editor may need to be scoped at the Workers product level while the Custom Domain is being attached. After the hostname is attached, later version-only deployments need Editor and do not need Zone Workers Routes Write as long as the route/domain binding is not changed.

Alternatively, the owner can temporarily grant product-level Workers Admin to the CI token for the first creation/deployment, then immediately reduce it to Workers Editor and remove Zone Workers Routes Write after the Custom Domain is successfully attached.

## Update the existing token

This section belongs to the initial Worker creation period and is superseded by the successful hosted Worker/domain check. Current Cloudflare Worker Scripts, Custom Domain and Route inventory list APIs may still return HTTP 503 to this token, but the live hosted health/discovery/JWKS checks and D1/zone read checks pass. Do not expand token scope merely to satisfy optional inventory endpoints. Do not rotate credentials unnecessarily.

## Run the guarded staging deployment

Both operations are manual-only. Pushes and pull-request updates do not deploy a Worker or migrate remote D1.

### Step 1 — apply reviewed D1 migrations through Telegram challenge 0005

1. Open [Auth D1 Staging Schema Migration](https://github.com/taufx98/sykabelajar4.0/actions/workflows/auth-cloudflare-d1-migrate.yml).
2. Choose **Run workflow** on `security/auth-poc-stage-1`.
3. Enter the exact confirmation:

   ```text
   APPLY-TO-sykabelajar-auth-poc
   ```

4. Migrations 0000–0006 are already applied to this isolated D1. Guarded runs applied only pending migrations 0005 and 0006 and verified all 18 tables, seven registration/profile columns, and the provider column. Do not rerun or alter already-applied SQL; future changes must increment the migration version. This workflow does not deploy a Worker or touch production Supabase.

### Step 2 — redeploy the Worker with the exact preview Origin

1. Open [Auth Worker Staging Deploy](https://github.com/taufx98/sykabelajar4.0/actions/workflows/auth-worker-staging-deploy.yml).
2. Choose **Run workflow** on `security/auth-poc-stage-1`.
3. Enter the exact confirmation:

   ```text
   DEPLOY-STAGING-WORKER-sykabelajar-auth-poc
   ```

4. Verify the workflow checks all 18 remote tables (including `auth_phone_verification_challenges`), all seven registration/profile bootstrap columns, zero staging users/sessions/accounts/verifications and zero pending phone challenges, then deploys the isolated Worker and tests:
   - hosted `/healthz`, exact OIDC issuer, discovery, PKCE S256 and public ES256 P-256 JWKS;
   - exact preview CORS allow for `https://security-auth-poc-stage-1.sykabelajar4.pages.dev`;
   - CORS denial for an unrelated origin such as `https://attacker.example`.

The deployment workflow is manual-only and includes a sanitized diagnostic artifact on failure. Its guarded push marker has been versioned to `.github/auth-ops/DEPLOY-STAGING-WORKER-0005`; no marker file is committed by this change, so this update cannot trigger a deployment. It:
- is locked to the dedicated Worker name and D1 UUID;
- has `workers_dev=false`, exposing the service only through `auth.sykabelajar.my.id`;
- requires all seven additive registration/profile bootstrap columns and all 18 reviewed tables (including the Telegram challenge table); it also refuses if staging D1 contains user/session/account/verification/phone-challenge rows;
- preserves the already provisioned `BETTER_AUTH_SECRET`, `AUTH_EMAIL_ENCRYPTION_KEY`, and `OAUTH_CLIENT_BOOTSTRAP_TOKEN`; it does not list, recreate, rotate, or delete Worker secrets and does not pass a replacement secrets file;
- keeps `SUPABASE_URL` pinned to the current production Supabase project solely for the temporary legacy Admin-session bridge, and does not pass a service-role key;
- sets a separate non-secret `SUPABASE_PROVISIONING_URL` in `wrangler.toml`, hard-pinned to the isolated Free staging project `https://ydamszdfsxqisanazdkb.supabase.co`; the provisioning module rejects any other project origin and never falls back to `SUPABASE_URL`;
- leaves `SUPABASE_PROVISIONING_ENABLED` unset and `SUPABASE_SERVICE_ROLE_KEY` absent by default; Better Auth provisioning and Telegram phone projection therefore remain disabled until the owner completes the isolated staging secret/configuration gate;
- does not deploy or change the production frontend, production Worker, Supabase schema/data/Auth settings, or production users;
- does not send email or call Google OAuth.

## Remaining Stage 1 gates after a successful Worker redeployment

A healthy Worker and hosted issuer do not by themselves finish the entire Cloudflare foundation stage. The following still need owner-provided provider credentials and real tests:

- Add one ZeptoMail Agent's Send Mail Token through the secured admin settings panel and verify one test email to the signed-in admin's own email. The Worker has the encryption key but no Agent token has been configured. No email has been sent and no credits purchased.
- Add a dedicated test Google OAuth client ID/secret if Google sign-in is required for the initial auth launch; verify the callback and verified-email behavior. No Google credential has been added.
- Confirm `auth.sykabelajar.my.id` health and cookie/origin behavior. Do not point the main frontend at this issuer until Stages 2–5 and rollback gates pass.

The prior first-deployment `--secrets-file` provisioning path is historical. The current routine redeploy does not read or regenerate existing secrets and does not pass a secrets file to Wrangler. The earlier unsupported `--yes` argument has been removed; future deploy failures upload only a short-lived sanitized log.

Stage 2 hosted OIDC/Data API/two-user RLS acceptance is already complete on the isolated Free project `sykabelajar-auth-staging` (`ydamszdfsxqisanazdkb`). Storage, Realtime and Edge Functions were not covered by that fixture. Never register the staging issuer in the production Supabase project as a workaround.


## Verified deployment checkpoint — 6 November 2026

The manual deployment run [#42190609080](https://github.com/taufx98/sykabelajar4.0/actions/runs/42190609080) completed successfully. The job passed typecheck, security tests, dry-run, configuration preflight, remote 17-table verification, zero staging users/sessions/accounts/verifications, Worker deploy, and hosted smoke test.

Verified deployed Worker version: `bd1feee3-4142-412e-9d05-e8eaa97de971`.

Hosted smoke checks confirmed:
- `GET https://auth.sykabelajar.my.id/healthz` returned `ok` and proved the dedicated D1 binding is reachable.
- OIDC discovery returned exact issuer `https://auth.sykabelajar.my.id/api/auth`.
- authorization, token, UserInfo and JWKS endpoint hostnames use `auth.sykabelajar.my.id`.
- discovery advertises PKCE `S256`.
- JWKS contains a public EC P-256 ES256 key with a non-empty `kid` and no private `d` parameter.

The deployment workflow reported `emailAgentConfigured=false` and `googleOAuthCredentialsConfigured=false`; no real email was sent and no OAuth login was performed. No staging user or session was seeded. The remaining Stage 1 tasks are to configure a ZeptoMail Agent Send Mail Token through the secured Admin UI and test delivery to the signed-in admin, plus optional Google OAuth callback testing if Google login is in launch scope.

This successful isolated staging deployment did not modify the production website, production Worker, production DNS, Supabase production schema/data/Auth settings, or user accounts. Do not interpret this as permission to switch the frontend to the staging issuer.


## Preview-origin update and safe redeploy — 6 November 2026

## Preview-origin update and safe redeploy — 6 November 2026

The staging Admin preview has a single exact temporary origin in `wrangler.toml`:

`https://security-auth-poc-stage-1.sykabelajar4.pages.dev`

The staging CORS and Better Auth trusted-origin lists accept this exact HTTPS origin in addition to the production app origin. Automated Worker tests verify the exact hostname and reject a nested/attacker hostname. The guarded deploy workflow's hosted smoke test now verifies that this preview receives an exact `Access-Control-Allow-Origin` response while `https://attacker.example` receives none.

The Telegram-capable, provider-aware Worker is already deployed on staging. Deployment [#42339805803](https://github.com/taufx98/sykabelajar4.0/actions/runs/42339805803) verified 18 D1 tables, seven registration columns, email provider column, empty user/session/account/verification/challenge state, hosted health, discovery, PKCE S256, ES256 JWKS and CORS. Do not rerun the deployment marker. Future code deployments must use the guarded workflow after review.

The redeploy path has a strict preservation rule: it does not query/list Worker secrets, generate replacements, or pass a replacement secrets file to Wrangler. The first deployment already provisioned `BETTER_AUTH_SECRET`, `AUTH_EMAIL_ENCRYPTION_KEY`, and `OAUTH_CLIENT_BOOTSTRAP_TOKEN`; routine deployments preserve these. The new deploy gate also checks all 18 D1 tables and zero staged users/sessions/accounts/verifications/phone challenges. It smoke-tests health/discovery/PKCE/JWKS and exact-origin CORS. It does not enable provisioning or Telegram credentials.

The Cloudflare API token currently returns HTTP 503 for Worker Scripts, Custom Domain and Routes list endpoints, while the zone and D1 reads work. Do not grant broad Account Admin only to satisfy these optional list calls. The read-only preflight now directly checks hosted health, exact issuer, PKCE and JWKS as the essential evidence; inventory API limitations are warnings.

The Cloudflare Pages check for the latest branch commit `0344a20077c5feb6bfc42a60633cc0a6cd74c689` failed and the underlying Pages build log is not available through the connected GitHub repository interface. The last known Pages branch preview success is an older commit `064225dd07fbce066f848fec63676cf60fe91a84`. Do not assume the latest preview contains the current panel until Cloudflare Pages reports a successful build.


## Latest Pages preview build — 6 November 2026

Cloudflare Pages check for latest branch commit `bc8915cd3eb9f68c68ea8da20257b8feaeec2e3e` completed successfully. Use the branch preview at [https://security-auth-poc-stage-1.sykabelajar4.pages.dev](https://security-auth-poc-stage-1.sykabelajar4.pages.dev), then open `/admin/core?tab=settings` to reach the ZeptoMail Agent panel.

The preview build success does not itself enable CORS: deploy the current `wrangler.toml` to the existing staging Worker with the manual-only workflow and verify the exact-origin smoke test before attempting to save or test a ZeptoMail Agent.


## Admin ZeptoMail panel — current identity bridge and post-cutover requirement

## Admin ZeptoMail panel — current identity bridge and post-cutover requirement

The Stage 1 Admin panel currently gets the administrator's access token from the existing Supabase Auth session. The Worker validates that token through the configured Supabase project's `/auth/v1/user` endpoint and calls the existing `is_active_admin()` RPC in the caller's authorization context before allowing account settings changes. It does not use the service-role key. Only after the active-admin check does it store encrypted Agent configuration in the isolated auth D1.

This is a **temporary pre-cutover admin bridge** to configure ZeptoMail while the existing production login remains on Supabase Auth. It is not the final Better Auth login architecture. During Stage 4/5, migrate this panel to obtain the Better Auth resource access token and update the Worker-side admin verifier to validate the Better Auth issuer/audience/UUID through the accepted Custom OIDC path, then re-check the application admin role using the same verified identity. Preserve the active-admin check, token encryption, no-token-in-GET behavior, and admin-only test-mail recipient. Do not remove Supabase Auth or treat the ZeptoMail panel as cutover-ready merely because it works with the legacy session.

The panel has not yet completed a real admin browser session, Agent save/activation, or test email send. No Agent Send Mail Token is stored in this repository or sent to chat.


## Verified Stage 1 refresh — 7 November 2026

- Remote D1 additive migration 0004 succeeded and its seven columns were verified before deployment.
- Guarded Worker redeploy: [#42265308348](https://github.com/taufx98/sykabelajar4.0/actions/runs/42265308348) — **success**.
- Deployed Worker version: `ab04efd9-5750-48c0-8dbe-56c2a6d1118a`.
- Hosted `/healthz`: OK.
- Discovery issuer: `https://auth.sykabelajar.my.id/api/auth`.
- Public JWKS: ES256 / P-256 / non-empty `kid`; no private key material.
- PKCE S256 remains advertised.
- Exact Pages preview Origin is allowed with credentials; `https://attacker.example` is not granted CORS permission.
- All 17 D1 tables and seven custom user columns were checked before deployment. Staging still has zero users, sessions, accounts, or verification rows; the fixed public OAuth client is the only seeded client.
- The deploy preserved existing Worker secrets and made no DNS, route, domain or production-site change.

ZeptoMail remains unconfigured (`emailAgentConfigured=false`). No real email, registration, authorization-code exchange, session, or Supabase Custom OIDC acceptance has yet been completed. Configure an Agent Send Mail Token via the admin email settings panel; never store it in Git or send it in chat.


## Historical Telegram/provisioning deployment gate — 7 November 2026 (superseded by final staging checkpoint)

The deployed Worker and the tested branch source are not yet the same revision:

- Last verified deployed Worker run: [#42328371754](https://github.com/taufx98/sykabelajar4.0/actions/runs/42328371754), source SHA `42323e092e85250f4485e2de611207310a481b34`.
- Later Auth Worker CI passed on source SHA `ec291a6b70d1418146275b982ec542cfff416184`, including the Telegram route and security tests, but used a Worker dry-run only.
- At this historical checkpoint, remote D1 remained at migrations 0000–0004. This was superseded by successful applications of 0005/0006 and the provider-aware Worker deployment.
- The current deploy workflow has been changed to require 18 tables and zero challenge rows. The one-time marker name is now `.github/auth-ops/DEPLOY-STAGING-WORKER-0005`; the marker file itself is not present.

**Critical destination split, now enforced in source:** the legacy Admin bridge keeps `SUPABASE_URL` bound to production while the provisioning module uses only `SUPABASE_PROVISIONING_URL`, pinned to `https://ydamszdfsxqisanazdkb.supabase.co`. The code rejects the production project origin and will not fall back to the legacy URL. `SUPABASE_PROVISIONING_ENABLED` remains unset, and no `SUPABASE_SERVICE_ROLE_KEY` is installed as part of this change.

The deploy gate has since been completed by run #42339805803; this historical instruction is superseded. Do not set the provisioning flag or Telegram secrets until the owner has registered the OIDC app, allowlisted the exact callback, and completed the isolated hosted consent/callback test.

## Current managed email provider rollout — 7 November 2026

The branch now includes a provider-aware transactional email path. The Worker uses `AUTH_EMAIL_PROVIDER=managed` and reads one explicitly activated account from encrypted D1. Existing ZeptoMail accounts remain unchanged; migration 0006 adds `provider` with default `zeptomail`, while new Admin accounts can choose Brevo or ZeptoMail. Brevo API Keys and ZeptoMail Send Mail Tokens are encrypted with the existing stable `AUTH_EMAIL_ENCRYPTION_KEY`; GET never returns credentials, and the test action sends only to the authenticated admin's own address.

For the free-only launch, create a Brevo Free account, verify the `sykabelajar.my.id` sender domain, create an API Key v3, and enter it through the staging Admin preview. Brevo's official Free plan includes transactional email, is not time-limited, and permits 300 sends/day; once reached, up to 1,000 transactional messages may queue for retry and messages beyond that queue are not delivered. No paid upgrade is part of this plan. See [Brevo Free plan limits](https://help.brevo.com/hc/en-us/articles/208580669-FAQs-What-are-the-limits-of-the-Free-plan).

Staging Admin preview: [security-auth-poc-stage-1.sykabelajar4.pages.dev](https://security-auth-poc-stage-1.sykabelajar4.pages.dev) → `/admin/core?tab=settings` → **Email Transaksional**. This is still the temporary Admin bridge using the existing Supabase Auth administrator session. It is not the final Better Auth Admin authentication flow; preserve this bridge until Stage 4/5 is migrated and independently accepted. Do not send the Brevo API Key in chat or commit it to Git.

After the owner saves and activates the verified Brevo account, use the one-per-minute test action to send only to the signed-in admin's own email. Only after that succeeds should the hosted password signup, email verification and password reset flow be accepted as operational. The source CI does not send real email.

## Verified provider-aware Worker deployment — 7 November 2026

- Worker deployment [#42339805803](https://github.com/taufx98/sykabelajar4.0/actions/runs/42339805803) succeeded after running `npm run typecheck`, all Worker security/integration tests, `npm run build`, exact staging config checks, remote D1 table/column checks and hosted smoke tests.
- The deployed Worker config uses `AUTH_EMAIL_PROVIDER=managed`. Its email dispatcher selects the D1 active account and decrypts credentials only in the Worker. Existing ZeptoMail records remain compatible because migration 0006 defaults their provider to `zeptomail`.
- The new Admin selector offers Brevo Free and ZeptoMail. For the free-only launch, use Brevo Free (300 email sends/day); no paid provider fallback is configured. Real email remains intentionally blocked until a verified sender and Brevo API Key are saved/activated through the staging Admin panel.
- The Telegram OIDC phone route is deployed but disabled while BotFather credentials are unset. It is not a login provider.
- The deploy did not rotate secrets, enable Supabase provisioning, install a service-role key, or change production domains/data/auth. The staging Admin bridge still uses the existing Supabase Auth session; do not remove it until Stage 4/5 is complete.

## Optional Google, Facebook and X social login providers

The current source supports optional Google, Facebook and Twitter/X sign-in. A provider is omitted from discovery/login configuration unless both its client ID and client secret are installed as Cloudflare Worker secrets. Partial credential pairs fail Worker initialization; no social provider credential is written in `wrangler.toml`, Pages environment variables, Git, or chat.

Configure each provider only when the owner has created the relevant developer app and accepted its scopes:

- Google: callback `https://auth.sykabelajar.my.id/api/auth/callback/google`; secrets `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.
- Facebook: callback `https://auth.sykabelajar.my.id/api/auth/callback/facebook`; secrets `FACEBOOK_CLIENT_ID`, `FACEBOOK_CLIENT_SECRET`; request `email` and `public_profile` only.
- Twitter/X: callback `https://auth.sykabelajar.my.id/api/auth/callback/twitter`; secrets `TWITTER_CLIENT_ID`, `TWITTER_CLIENT_SECRET`; the Better Auth 1.7.16 built-in provider requests `users.email` and uses only `confirmed_email` as a verification signal.

After the owner enters the credentials through Cloudflare Worker secrets, run the guarded staging deployment and verify the corresponding OAuth callback with a synthetic staging account. No provider is enabled from a client-side variable. Every session is gated by local `emailVerified` state. Facebook's provider metadata is not treated as verified; all new Facebook sign-ins must complete SYKABELAJAR's own email challenge. Automatic implicit account linking is disabled for all providers.

Instagram is intentionally not included for ordinary personal accounts: Meta's current Instagram Login API is for professional Business/Creator accounts and the Basic Display API for personal accounts was shut down on 4 December 2024. An Instagram Business/Creator connection is a separate product decision and must not be represented as general consumer Instagram login.
