# Isolated Better Auth Worker staging deployment

Status: **initial staging Worker and hosted issuer are live, but the final Stage 1 update is not yet deployed**. Remote D1 currently has migrations 0000–0003; additive migration 0004 for registration metadata is pending. After that migration is verified, redeploy the Worker to activate the exact Pages preview Origin and verify CORS. Real ZeptoMail delivery and (only if required for launch) Google OAuth callback verification remain pending. Historical permission/deployment notes below are marked where superseded.

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

### Step 1 — apply the additive D1 registration migration

1. Open [Auth D1 Staging Schema Migration](https://github.com/taufx98/sykabelajar4.0/actions/workflows/auth-cloudflare-d1-migrate.yml).
2. Choose **Run workflow** on `security/auth-poc-stage-1`.
3. Enter the exact confirmation:

   ```text
   APPLY-TO-sykabelajar-auth-poc
   ```

4. Verify the run applies only the reviewed migrations 0000–0004 to D1 `sykabelajar-auth-poc` (UUID `7a4f9008-a1c6-42b6-8a04-abde12699248`) and confirms 17 base tables plus all seven registration/profile bootstrap columns: `accountType`, `username`, `referralCode`, `birthDate`, `institution`, `grade`, and `subjects`. This workflow does not deploy a Worker or touch Supabase.

### Step 2 — redeploy the Worker with the exact preview Origin

1. Open [Auth Worker Staging Deploy](https://github.com/taufx98/sykabelajar4.0/actions/workflows/auth-worker-staging-deploy.yml).
2. Choose **Run workflow** on `security/auth-poc-stage-1`.
3. Enter the exact confirmation:

   ```text
   DEPLOY-STAGING-WORKER-sykabelajar-auth-poc
   ```

4. Verify the workflow checks all 17 remote tables and all seven registration/profile bootstrap columns, confirms zero staging users/sessions/accounts/verifications, deploys the isolated Worker, then tests:
   - hosted `/healthz`, exact OIDC issuer, discovery, PKCE S256 and public ES256 P-256 JWKS;
   - exact preview CORS allow for `https://security-auth-poc-stage-1.sykabelajar4.pages.dev`;
   - CORS denial for an unrelated origin such as `https://attacker.example`.

The deployment workflow is manual-only and includes a sanitized diagnostic artifact on failure. It:
- is locked to the dedicated Worker name and D1 UUID;
- has `workers_dev=false`, exposing the service only through `auth.sykabelajar.my.id`;
- requires all seven additive registration/profile bootstrap columns before deployment and refuses if staging D1 contains user/session/account/verification rows;
- preserves the already provisioned `BETTER_AUTH_SECRET`, `AUTH_EMAIL_ENCRYPTION_KEY`, and `OAUTH_CLIENT_BOOTSTRAP_TOKEN`; it does not list, recreate, rotate, or delete Worker secrets and does not pass a replacement secrets file;
- passes only the existing Supabase URL and publishable key as Worker variables for the temporary admin-email-settings bridge; it never uses a service-role key;
- does not deploy or change the production frontend, production Worker, Supabase schema/data/Auth settings, or production users;
- does not send email or call Google OAuth.

## Remaining Stage 1 gates after a successful Worker redeployment

A healthy Worker and hosted issuer do not by themselves finish the entire Cloudflare foundation stage. The following still need owner-provided provider credentials and real tests:

- Add one ZeptoMail Agent's Send Mail Token through the secured admin settings panel and verify one test email to the signed-in admin's own email. The Worker has the encryption key but no Agent token has been configured. No email has been sent and no credits purchased.
- Add a dedicated test Google OAuth client ID/secret if Google sign-in is required for the initial auth launch; verify the callback and verified-email behavior. No Google credential has been added.
- Confirm `auth.sykabelajar.my.id` health and cookie/origin behavior. Do not point the main frontend at this issuer until Stages 2–5 and rollback gates pass.

The prior first-deployment `--secrets-file` provisioning path is historical. The current routine redeploy does not read or regenerate existing secrets and does not pass a secrets file to Wrangler. The earlier unsupported `--yes` argument has been removed; future deploy failures upload only a short-lived sanitized log.

The hosted issuer will then be available for Stage 2 acceptance, but the Supabase account still needs an isolated Free project. Never register this issuer in the production Supabase project as a workaround.


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

A **new manual deployment is required** before using the preview panel. The currently live Worker version predates this origin addition. Trigger [Auth Worker Staging Deploy](https://github.com/taufx98/sykabelajar4.0/actions/workflows/auth-worker-staging-deploy.yml) on branch `security/auth-poc-stage-1` with confirmation `DEPLOY-STAGING-WORKER-sykabelajar-auth-poc`.

The redeploy path now has a strict preservation rule: it does not query/list Worker secrets, does not generate replacement secrets, and does not pass a new secrets file to Wrangler. The first deployment already provisioned `BETTER_AUTH_SECRET`, `AUTH_EMAIL_ENCRYPTION_KEY`, and `OAUTH_CLIENT_BOOTSTRAP_TOKEN`; a routine code redeploy must preserve these existing values. It still checks the exact Worker/D1/domain configuration, verifies all 17 remote D1 tables, requires zero staged users/sessions/accounts/verifications, and smoke-tests health/discovery/PKCE/JWKS plus exact-origin CORS.

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
