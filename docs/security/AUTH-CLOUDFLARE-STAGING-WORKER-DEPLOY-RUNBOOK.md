# Isolated Better Auth Worker staging deployment

Status: **staging deployment is successful and the hosted issuer is live**. The remaining Stage 1 gates are real ZeptoMail delivery and (only if required for launch) Google OAuth callback verification. Historical permission and failed-deployment notes below are retained as history and are superseded by the verified deployment checkpoint at the end of this document.

## Current verified state — 6 November 2026

- Dedicated D1 database: `sykabelajar-auth-poc`.
- D1 UUID: `7a4f9008-a1c6-42b6-8a04-abde12699248`.
- Remote D1 migration run [#42159049470](https://github.com/taufx98/sykabelajar4.0/actions/runs/42159049470) completed successfully and verified all 17 expected Better Auth/OAuth/ZeptoMail table names.
- The deployment workflow passed Worker typecheck, unit/security tests, local deployment dry-run, exact Supabase project guard, Cloudflare zone/DNS preflight, remote D1 table checks, and empty staging user/session/account checks in [run #42178992387](https://github.com/taufx98/sykabelajar4.0/actions/runs/42178992387).
- A later user-triggered deployment attempt [#42181766748](https://github.com/taufx98/sykabelajar4.0/actions/runs/42181766748) passed all preflight, 17-table, and empty-identity-state checks but failed before contacting Cloudflare because Wrangler 4.156.2 rejected the unsupported `wrangler deploy --yes` argument (`Unknown argument: yes`). The diagnostic step was also skipped because its `if` condition used malformed nested expression interpolation.
- Latest read-only resource snapshot [#42182078460](https://github.com/taufx98/sykabelajar4.0/actions/runs/42182078460) confirms the dedicated D1 and Worker script `sykabelajar-auth-poc` now exist; `auth.sykabelajar.my.id` Custom Domain and any matching Worker route are still absent. No new deployment occurred during that check.
- The deployment workflow is now fixed: removed `--yes`, changed diagnostic upload to `if: ${{ failure() }}`, and pinned the runner/action runtimes. CI [#42182078655](https://github.com/taufx98/sykabelajar4.0/actions/runs/42182078655) passed both Worker/OIDC and frontend jobs. The workflow is ready for another manual staging dispatch.

## Required Cloudflare API token permission

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

Token update is not required again unless the next run returns a Cloudflare authorization error. The script-creation permission has already been cleared and the latest read-only preflight can see the target Worker. Do not rotate credentials unnecessarily.

## Run the guarded staging deployment

The workflow is manual-only now; pushes and PR updates cannot deploy it automatically.

1. Open [Auth Worker Staging Deploy](https://github.com/taufx98/sykabelajar4.0/actions/workflows/auth-worker-staging-deploy.yml).
2. Choose **Run workflow**.
3. Set branch to `security/auth-poc-stage-1`.
4. Enter the exact confirmation:

   ```text
   DEPLOY-STAGING-WORKER-sykabelajar-auth-poc
   ```

5. Inspect the run. It must pass the exact D1/hostname/DNS preflight, verify all 17 remote tables and empty auth user/session/account state, deploy the Worker, and verify health, exact issuer, discovery metadata, PKCE S256 advertisement, and public ES256 JWKS.

The workflow has been changed to manual dispatch only after the first failed deployment, and includes a sanitized deployment log artifact on failure. It:
- is locked to the dedicated Worker name and D1 UUID;
- has `workers_dev=false`, exposing the service only through `auth.sykabelajar.my.id`;
- refuses to proceed if the auth hostname has a conflicting DNS record or Worker route;
- creates missing `BETTER_AUTH_SECRET`, `AUTH_EMAIL_ENCRYPTION_KEY`, and `OAUTH_CLIENT_BOOTSTRAP_TOKEN` values inside the CI runner and adds them as Worker secrets;
- preserves existing secret values on later deployments; it never rotates them automatically;
- passes only the existing Supabase URL and publishable key as Worker variables for the temporary admin-email-settings bridge; it never uses a service-role key;
- does not deploy or change the production frontend, production Worker, Supabase schema/data/Auth settings, or production users;
- does not send email or call Google OAuth.

## Remaining Stage 1 gates after a successful Worker deployment

A healthy Worker and hosted issuer do not by themselves finish the entire Cloudflare foundation stage. The following still need owner-provided provider credentials and real tests:

- Add one ZeptoMail Agent's Send Mail Token through the secured admin settings panel and verify one test email to the signed-in admin's own email. The Worker has the encryption key but no Agent token has been configured. No email has been sent and no credits purchased.
- Add a dedicated test Google OAuth client ID/secret if Google sign-in is required for the initial auth launch; verify the callback and verified-email behavior. No Google credential has been added.
- Confirm `auth.sykabelajar.my.id` health and cookie/origin behavior. Do not point the main frontend at this issuer until Stages 2–5 and rollback gates pass.

The `--secrets-file` generated by the workflow uses JSON. The prior deploy error was confirmed as `Unknown argument: yes`; that unsupported CLI argument has been removed. The failure diagnostic condition has also been corrected, and the workflow now uploads a short-lived sanitized deploy log if a future attempt fails.

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
