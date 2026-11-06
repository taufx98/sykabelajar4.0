# Isolated Better Auth Worker staging deployment

Status: **blocked by Cloudflare Worker creation/custom-domain permissions**. The staging D1 schema is already migrated and verified. The Worker has not been created or deployed.

## Current verified state — 6 November 2026

- Dedicated D1 database: `sykabelajar-auth-poc`.
- D1 UUID: `7a4f9008-a1c6-42b6-8a04-abde12699248`.
- Remote D1 migration run [#42159049470](https://github.com/taufx98/sykabelajar4.0/actions/runs/42159049470) completed successfully and verified all 17 expected Better Auth/OAuth/ZeptoMail table names.
- The deployment workflow passed Worker typecheck, unit/security tests, local deployment dry-run, exact Supabase project guard, Cloudflare zone/DNS preflight, remote D1 table checks, and empty staging user/session/account checks in [run #42178992387](https://github.com/taufx98/sykabelajar4.0/actions/runs/42178992387).
- The `wrangler deploy` step failed. Its hosted OIDC smoke test was therefore skipped.
- A read-only Cloudflare recheck after the failure is retained as artifact from [preflight #42179241229](https://github.com/taufx98/sykabelajar4.0/actions/runs/42179241229). It found only the existing `sykabelajar4-0` Worker; it did not find `sykabelajar-auth-poc`, `auth.sykabelajar.my.id`, or a matching Worker route. No partial Worker/domain/route deployment was left behind.
- The exact Wrangler error text from the first deployment attempt was not captured. The current evidence points to missing Worker create/edit and/or custom-domain write permission; do not treat that inference as the exact error response.

## Required Cloudflare API token permission

The GitHub Actions token already proves it can read the active `sykabelajar.my.id` zone, list Workers, read Worker domains/routes, and read/write the dedicated D1. The missing operation is creating a new Worker and attaching the custom domain.

Cloudflare currently documents these minimum permissions:

1. **Create the new Worker script:** Cloudflare documents that `wrangler deploy` for a Worker that does not yet exist requires Workers product-level **Admin**. This is the likely missing permission in the first attempt; its exact Wrangler error text was not captured.
2. **Attach `auth.sykabelajar.my.id` as a Custom Domain:** the deployment token needs Workers **Editor** access to the Worker plus Zone `Workers Routes Write` scoped only to the `sykabelajar.my.id` zone.
3. Keep the existing D1 Read/Edit and Zone Read permissions. Do not grant Developer Platform Admin, Super Administrator, DNS-wide edit, or unrelated product permissions.

Official references:
- Cloudflare [Roles and permissions](https://developers.cloudflare.com/workers/authorization/) — new Worker creation requires Workers product Admin; existing Worker deployment uses Editor; Custom Domain/Routes changes also require Zone Workers Routes Write.
- Cloudflare [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/) — Cloudflare creates the DNS record and certificate after a Custom Domain is attached; a pre-existing CNAME on that hostname prevents creation.
- Cloudflare [API token permissions](https://developers.cloudflare.com/fundamentals/api/reference/permissions/) — permissions are resource-scoped by Account, Zone, and User.

### Least-privilege sequence

The account owner can avoid giving CI product-level Admin by creating the empty Worker script `sykabelajar-auth-poc` once through the Cloudflare Dashboard. Then add Workers **Editor** and Zone `Workers Routes Write` to the staging deployment token. Note that Cloudflare currently does not support per-Worker roles for Custom Domains, so Editor may need to be scoped at the Workers product level while the Custom Domain is being attached. After the hostname is attached, later version-only deployments need Editor and do not need Zone Workers Routes Write as long as the route/domain binding is not changed.

Alternatively, the owner can temporarily grant product-level Workers Admin to the CI token for the first creation/deployment, then immediately reduce it to Workers Editor and remove Zone Workers Routes Write after the Custom Domain is successfully attached.

## Update the existing token

1. In Cloudflare Dashboard, open **My Profile → API Tokens** and edit the token currently stored as the GitHub Actions secret `CLOUDFLARE_API_TOKEN`.
2. Add only the Worker and route permissions above, scoped to this account and the `sykabelajar.my.id` zone. Keep the existing D1 permissions. Do not enable DNS Write: the latest preflight found no conflicting record, and Cloudflare Custom Domains manage their required DNS record/certificate.
3. In GitHub, open **Settings → Secrets and variables → Actions** and replace the value of `CLOUDFLARE_API_TOKEN`. Do not paste the token into chat, an issue, or a commit. Keep `CLOUDFLARE_ACCOUNT_ID` unchanged.

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

The `--secrets-file` generated by the workflow uses JSON, which Wrangler officially supports. The first deployment attempt did not retain its exact error log; the manual workflow now uploads a short-lived sanitized deployment diagnostic artifact if the next attempt fails.

The hosted issuer will then be available for Stage 2 acceptance, but the Supabase account still needs an isolated Free project. Never register this issuer in the production Supabase project as a workaround.
