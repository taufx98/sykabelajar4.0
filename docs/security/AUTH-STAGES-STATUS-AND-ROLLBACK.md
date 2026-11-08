# Better Auth migration — live readiness and rollback record

Status date: 8 November 2026  
Scope: SYKABELAJAR 4.0, production Supabase project `mvdczyitbkxkldjughor`, isolated Better Auth branch `security/auth-poc-stage-1`.

This is a verified status record, not authorization to deploy or migrate production. The isolated staging Worker deployment succeeded on 6 November 2026 (run [#42190609080](https://github.com/taufx98/sykabelajar4.0/actions/runs/42190609080)); its hosted smoke test verified `/healthz`, OIDC discovery, exact issuer, endpoint hostnames, PKCE S256, and a public ES256 P-256 JWKS key. The Worker is live at `auth.sykabelajar.my.id` and bound to the dedicated D1. No production DDL/DML, production auth-provider configuration, account deletion, production DNS/route change, production Worker deployment, or real email sending was performed

## Executive status

| Stage | Completed locally | Still blocking completion |
|---|---|---|
| 1. Cloudflare foundation | Remote D1 migrations 0000–0006 are applied; 18 tables, seven Better Auth registration columns, Telegram challenge and email provider column are verified. Provider-aware and Telegram-capable staging Worker deployed by [#42339805803](https://github.com/taufx98/sykabelajar4.0/actions/runs/42339805803); hosted health/discovery/PKCE S256/ES256 JWKS/CORS passed. | Owner still needs to register a BotFather OIDC app and store Telegram client credentials before testing the phone-verification route. Brevo Free sender domain/API Key must be configured through staging Admin, activated and tested to the signed-in admin; real email signup/verification/reset still awaits that owner action. No paid credits/auto top-up. |
| 2. OIDC and JWT | Hosted Custom OIDC/Data API/two-user RLS acceptance passed. Storage owner/issuer RLS and Realtime private-topic semantics passed rollback-only synthetic SQL tests. Read-only Edge probe is deployed on isolated staging; static contract and Deno typecheck added to CI. | Full Storage API upload/download, actual Realtime WebSocket channel acceptance and positive Edge Function invocation with real Better Auth token remain open. Email sender setup and a verified staging user session are needed for these runtime checks. Production untouched. |
| 3. Supabase identity | The full Stage 3 identity-root and issuer draft passed production-schema acceptance on disposable PostgreSQL 17.6 restore [#42436535106](https://github.com/taufx98/sykabelajar4.0/actions/runs/42436535106): export/restore, 69/69 FK parity, function/trigger/profile/RLS/ACL parity, identity provisioning, referral/email/phone/organizer, representative RLS, 69-FK dry-run expansion/validation/cutover, and trusted-issuer policy tests. Staging remains at zero identity rows; service_role direct app_users/helper access has been revoked, while public server-only wrappers were verified. | Production `private.app_users` is still absent and all 69 application FKs still reference `auth.users`; three legacy Auth triggers remain. No production DDL/DML was applied. The remaining Stage 3 action is the approved production migration window: identity-root/backfill + legacy bridge, the three-phase 69-FK cutover, and the two-issuer restrictive guard. This is a schema/security change and requires explicit owner approval after a final read-only preflight and rollback review. Real Telegram hosted consent remains blocked on BotFather app registration and owner-managed secrets. |
| 4. Frontend | Disabled Better Auth HTTP transport, shared identity-only session event bus, provider-aware resource token accessor, and new provider-neutral identity reader are in place. Nine UUID-only read paths now use the event-bus snapshot; Supabase Auth is used only as bootstrap fallback before the initial snapshot. The source inventory is now **25 direct \`supabase.auth\` callsites across 11 files**. Signed Cloudinary profile uploads use the central token accessor, with Supabase Auth as the default provider. [Auth Worker CI #42450864251](https://github.com/taufx98/sykabelajar4.0/actions/runs/42450864251) passed lint/typecheck/build; [Supabase Local Auth Claims CI #42450685688](https://github.com/taufx98/sykabelajar4.0/actions/runs/42450685688) passed identity-reader and inventory tests. | Main app still uses Supabase Auth for sign-in/session management. Better Auth transport remains disabled. Do not activate its token flag until AppContext/session coordinator, canonical user/role hydration and Supabase SDK-wide \`accessToken\` injection move together. The remaining 25 direct calls include login/signup/logout, AppContext source, email/phone verification, admin token bridges and password changes; each needs operation-specific migration. Email/recovery/password/phone UX and complete post-cutover IDOR/RLS/Realtime tests remain open. No production frontend or login path was switched. |
| 5. Backend | Full live audit now covers nine identity/ownership-sensitive user-facing Edge Function implementations (six Cloudinary + three payment), plus the Midtrans delegate; four call `auth.getUser()`, four call `/auth/v1/user`. Pinned Better Auth JWT adapter, opt-in provisioning hooks and local Cloudinary ownership guards/tests are in the branch. | No endpoint has switched to Better Auth JWT verification. The deployed `cloudinary-delete-asset` v9 only checks that a Bearer token exists and lacks owner UUID binding; a source-only replacement now performs UUID ownership checks but has not been deployed. Database functions/triggers and RLS policies remain unchanged. Stage 2 hosted OIDC and two-user RLS acceptance are complete on isolated staging. Remaining endpoint/Edge Function cutover depends on Stage 3 identity migration and Stage 4 Better Auth resource-token client. See [Edge Function migration matrix](AUTH-EDGE-FUNCTION-MIGRATION-MATRIX.md). |
| 6. Reset and full testing | Cleanup rules and synthetic provisioning tests prepared; hosted Stage 2 OIDC/Data API/two-user RLS acceptance completed on the existing isolated Free project | No demo identity has been confirmed or deleted; no admin bootstrap; production-shaped IDOR/full feature/Realtime regression and rollback rehearsal remain outstanding |
| 7. Production | No production cutover attempted | Worker/domain/OIDC/monitoring/cutover/sign-up restriction remain unconfigured |

## Stage 1 — Cloudflare and ZeptoMail

### What was verified

Historical read-only Cloudflare snapshots below are superseded by the latest recheck and guarded deployment attempt recorded in the 6 November update at the end of this document.

- This section records an earlier 5 November permission snapshot. It was superseded by the 6 November token recheck: D1 listing now succeeds; the dedicated database has been created and migrated; `wrangler.toml` now contains its real isolated UUID. The current missing permission is the initial Worker creation/Custom Domain path, not D1 Read.

### Historical initial provisioning permission guidance — superseded

The permission list below was written before the first successful deployment and is retained only as historical context. It is **not** an instruction to recreate the D1, Worker, route or hostname.

The dedicated D1 and remote schema migrations were completed, and the first Worker script plus custom domain were successfully deployed by [run #42190609080](https://github.com/taufx98/sykabelajar4.0/actions/runs/42190609080). The current staging Worker is live at `auth.sykabelajar.my.id`. The same run verified the health endpoint, exact OIDC issuer, PKCE S256 and public ES256 JWKS.

The current Cloudflare token can read the zone and D1. Cloudflare inventory-list APIs for Worker Scripts, Custom Domains and Routes have returned HTTP 503, but these list API failures do not negate the successful hosted Worker health/discovery/JWKS checks. The updated preflight uses the live hostname as evidence and reports the inventory-list limitations as warnings. Do not grant broad Account Admin solely to make those list APIs readable.

The next Worker operation is a routine code redeploy for the exact Pages preview CORS allowlist, not initial provisioning. The manual-only workflow checks the pinned Worker/D1/domain and all 17 remote tables, does not recreate the D1, does not enumerate secrets, and does not pass a replacement secrets file to Wrangler. It preserves the already provisioned `BETTER_AUTH_SECRET`, `AUTH_EMAIL_ENCRYPTION_KEY`, and `OAUTH_CLIENT_BOOTSTRAP_TOKEN`. Its post-deploy smoke test verifies the approved preview Origin and rejects an unrelated Origin. See [the current staging deployment runbook](AUTH-CLOUDFLARE-STAGING-WORKER-DEPLOY-RUNBOOK.md).

Do not rotate the Cloudflare API token or grant unrelated permissions unless a new deploy log demonstrates a specific missing permission. Never use the production Worker, production DNS, or production Supabase as a staging substitute.

Official permission references remain useful if a specific future permission error occurs: [API token permissions](https://developers.cloudflare.com/fundamentals/api/reference/permissions/) and [Workers roles and permissions](https://developers.cloudflare.com/workers/authorization/).

### ZeptoMail

The ZeptoMail implementation is local-code complete and passes Worker CI. The admin interface is under Admin → Pengaturan → Email Transaksional · ZeptoMail.

The first successful Worker deployment already provisioned `BETTER_AUTH_SECRET`, `AUTH_EMAIL_ENCRYPTION_KEY`, and `OAUTH_CLIENT_BOOTSTRAP_TOKEN`. Routine code redeployment must preserve those secret values; the current manual workflow deliberately does not list or rotate them. The latest Pages branch preview is available at [security-auth-poc-stage-1.sykabelajar4.pages.dev](https://security-auth-poc-stage-1.sykabelajar4.pages.dev). After the exact preview-origin CORS change is deployed and smoke-tested, add the verified ZeptoMail Agent and Send Mail Token through Admin → Pengaturan → Email Transaksional · ZeptoMail. Keep the token server-side and encrypted in D1. The test button sends only to the signed-in admin's own email and can consume existing ZeptoMail credits. Do not purchase credits or enable auto top-up as part of this migration.

## Stage 2 — Supabase Custom OIDC blocker

The local OIDC/JWT implementation has passed the current Auth Worker CI [#42195372638](https://github.com/taufx98/sykabelajar4.0/actions/runs/42195372638), including typecheck, all 40 Worker tests, local D1/Auth/OAuth integration, dry-run bundle and frontend lint/typecheck/build. Hosted issuer health/discovery/PKCE/JWKS also passed [#42195372541](https://github.com/taufx98/sykabelajar4.0/actions/runs/42195372541). Supabase Custom OIDC acceptance remains blocked because the connected account has no isolated hosted Free project available. The exact provider and token contract is recorded in [AUTH-STAGE-2-OIDC-ACCEPTANCE-RUNBOOK.md](AUTH-STAGE-2-OIDC-ACCEPTANCE-RUNBOOK.md).

The production Supabase organization is on the Free plan. The project creation quote returned **US$0/month**, but the create request was rejected with the account's maximum of two active Free projects reached. No project was created, paused, deleted, or upgraded. The organization currently has no development branches.

Do not register the staging issuer against production. Once a genuine isolated Free Supabase project is available, add Custom OIDC there through Dashboard or Management API (the current Supabase docs explicitly state Custom OIDC is unavailable in Supabase CLI). Validate accepted and rejected JWT cases, `auth.uid()`, Data API, Storage, Realtime, Edge Functions and two-user IDOR before proceeding.

Supabase's current third-party auth documentation states the provider must expose HTTPS OIDC discovery, asymmetric signing with a `kid`, and a JWT `role` claim. Supabase currently cannot disable the Auth service entirely; Stage 7 can disable public sign-up, not the Auth service itself.

## Stage 3 — latest production identity catalog

Latest read-only recheck on 5 November 2026 confirmed:

- `private.app_users` does not exist.
- The 6 November read-only recheck counted 11 rows in `auth.users`. Their identities have not been classified as demo/test, no identity values were selected, and none were deleted.
- 69 application foreign keys still reference `auth.users(id)`: 65 in `public`, 4 in `private`. There are 10 additional internal FKs within the `auth` schema, which are not part of the application FK rehome.
- The latest catalog comparison against `scripts/auth-migration/live-auth-users-fk-catalog.json` is exactly **69/69**: zero missing, zero additional, zero semantic changes. All are single-column UUID, MATCH SIMPLE, validated, non-deferrable, ON UPDATE NO ACTION; the 18 SET NULL source columns remain nullable. Existing delete actions remain 42 CASCADE, 18 SET NULL, 8 NO ACTION, 1 RESTRICT.
- Three non-internal triggers remain attached to `auth.users`.
- Ten application functions still depend on `auth.users`, `raw_user_meta_data`, `email_confirmed_at`, or `phone_confirmed_at`: `private.apply_referral_qualification`, `private.capture_signup_referral`, `private.process_referral_email_confirmation`, `public.create_organizer`, `public.get_my_referrals`, `public.get_my_referrals_v2`, `public.get_my_verified_referrals`, `public.handle_new_auth_user`, `public.register_for_competition`, and `public.verify_pending_referrals`.
- 109 policies reference `auth.uid()`. Do not globally replace these before the identity issuer and UUID semantics are tested.

No identity table, FK, trigger, RPC, policy, issuer restriction, or application data was changed in production.

## Stage 5 — Security Advisor review gate

The Supabase Security Advisor read-only snapshot on 5 November reported:

| Finding | Count / level | Treatment |
|---|---:|---|
| RLS enabled but no policies | 23 / INFO | Review whether each table is intentionally private or accidentally exposed; do not add blanket policies |
| SECURITY DEFINER callable by `anon` | 46 / WARN | Review each function body, grants and intended anonymous use; do not revoke all grants blindly |
| SECURITY DEFINER callable by `authenticated` | 202 / WARN | Confirm explicit ownership/business-role/issuer checks for every privileged operation |
| Leaked-password protection disabled | 1 / WARN | Review plan availability and cost before enabling; do not upgrade or purchase a feature |

These advisor counts are review indicators, not proof that every listed function is exploitable. In particular, an exposed SECURITY DEFINER function may have explicit server-side checks. Stage 5 must review the checks and grants per function and preserve legitimate public exam, participant, payment and webhook flows.

Four Edge Functions still call `supabase.auth.getUser()`: `get-cloudinary-signature`, `payment-gateway-create`, `payment-gateway-reconcile`, and `payment-gateway-admin`. Do not replace verified `getUser()` with raw JWT decoding.

## Stage 6 — demo reset and bootstrap rules

The current 11 rows in `auth.users` are a count only; no identifying data was exported or inspected in this audit. Before deletion, classify each identity as disposable demo/test or required, produce a dry-run of dependent rows across the exact 69 FKs, review the plan, preserve official competition/order/payment/business records, and capture an auditable backup. Do not treat every current `auth.users` row as disposable by assumption.

The first admin must be provisioned through a server-only, auditable bootstrap with a fixed, explicitly approved identity. Public registration must never be able to create `admin`.

## Stage 3 FK-only rollback boundary

Before any full Stage 3 rollback, first stop new Better Auth provisioning/sign-up by disabling the Worker-side `SUPABASE_PROVISIONING_ENABLED` flag and returning the frontend to the legacy login path. Keep the Worker, D1 database and signing keys intact for audit; do not delete credentials or sessions. If the Better Auth Custom OIDC integration was ever added to the production Supabase project, remove that exact third-party issuer integration through Dashboard/Management API before removing the SQL issuer policies. This provider setting is outside SQL migration control. Only then consider the FK-only reverse and full rollback draft, and only if the no-Better-Auth-only-identity guard passes.

The reverse FK generator at [generate-app-users-fk-rollback-plan.mjs](../../scripts/auth-migration/generate-app-users-fk-rollback-plan.mjs) is a **review-only FK reversal**, not a full Stage 3 rollback. It emits bounded reverse expansion and validation batches and one atomic FK cutover. Its preflight and atomic cutover both refuse to proceed if any `private.app_users.id` is absent from `auth.users`; this is the explicit guard against Better Auth-only identities. It never creates shadow Auth users or copies passwords, credentials or sessions.

This limited reversal is only viable before the first Better Auth-only identity is provisioned. After a Better Auth-only account exists, the canonical identity root and Better Auth-compatible token/session adapter must remain in place. An application rollback may revert unrelated bundle code, but must not point that account back to legacy Supabase Auth or rehome its app FKs to `auth.users`. The generator does not restore Stage 3 functions, triggers or issuer policies; those require their own reviewed rollback procedure. No generated SQL is applied to production.

## Stage 7 — production rollback rule

A Better Auth account and a Supabase Auth account are not interchangeable. The approved architecture does not migrate old password hashes or create shadow `auth.users` accounts. Therefore a rollback cannot simply change the frontend back to Supabase Auth for every user:

- Keep existing Supabase Auth users and schema intact during the cutover window.
- Keep Better Auth, D1, the issuer, and its keys intact during any app rollback; do not delete or reset Better Auth accounts, sessions, or D1.
- If the application bundle is rolled back, it must still use the Better Auth-compatible session/token adapter for Better Auth-only accounts. A legacy Supabase Auth-only bundle cannot authenticate these users.
- Reverting a new Better Auth-only user to Supabase Auth requires a separately designed secure re-enrollment/re-provisioning process; do not copy password hashes or pretend the identity exists in both systems.
- If Custom OIDC/JWKS verification or D1 becomes unavailable, fail closed for protected data access. Do not silently send requests as `anon` and do not fall back to a different issuer.
- Disable Supabase Auth public sign-up only after the new login path and rollback runbook are fully rehearsed. Supabase Auth itself cannot currently be turned off.
- Keep the legacy database rows and a reviewed schema backup until the rollback window expires and cleanup is separately approved.

Rollback trigger thresholds, operational owners, recovery communication, and rehearsal evidence must be approved before a production cutover. This document records the architecture rules; it does not claim rollback has been rehearsed.

## Validation links

- [Auth Worker + Admin Frontend CI #42035308215](https://github.com/taufx98/sykabelajar4.0/actions/runs/42035308215) — Worker audit/typecheck/tests, D1 migrations, local auth/OAuth, Worker dry-run, frontend lint/typecheck/build.
- [Cloudflare read-only preflight #42043789820](https://github.com/taufx98/sykabelajar4.0/actions/runs/42043789820) — zone/scripts/domains/routes readable; D1 API permission missing; no auth resources found.
- [Supabase local claims CI #42012012070](https://github.com/taufx98/sykabelajar4.0/actions/runs/42012012070) — 73/73 pgTAP assertions using synthetic local fixtures only.

PR #177 remains Draft and has not been merged. Its current base branch is behind/diverged and GitHub reports `mergeable_state=dirty`; do not merge until the branch/base relationship is reconciled and all stage gates are satisfied.


## Latest verified update — 5 November 2026 (supersedes earlier Cloudflare blocker)

- Cloudflare API token rotation is verified. Read-only preflight #42057926397 passed: D1 list, Zone, Worker scripts, custom-domain and route reads succeeded. The earlier D1 10000 Authentication error in #42043789820 is superseded.
- Guarded bootstrap #42057812352 proved D1 Write and created the empty, dedicated staging database sykabelajar-auth-poc in APAC. UUID: 7a4f9008-a1c6-42b6-8a04-abde12699248. No existing database was changed.
- services/auth-worker/wrangler.toml now binds to that D1 UUID on security/auth-poc-stage-1. It has not been deployed. No Worker script, production Worker, custom domain, route, DNS record, or Worker secret was created/changed.
- Auth Worker + Frontend CI #42057926474 passed after the binding update: dependency audit, typecheck, security tests, local D1 migration/OIDC/JWKS flow, Worker bundle dry-run, frontend lint/typecheck/build. No deployment occurred.
- Cloudflare Workers Free D1 quotas include 10 databases, 500 MB per database, 5 GB total storage, 5 million rows read/day and 100,000 rows written/day. The bootstrap checks the database count before creation. See https://developers.cloudflare.com/d1/platform/limits/ and https://developers.cloudflare.com/d1/platform/pricing/.
- Supabase remains blocked: organization sykabelajar is Free. The connected project listing exposes sykabelajar_db2, but a fresh US$0/month staging project creation attempt was rejected because the owner has reached the two-active-Free-project limit. No project was created, paused, deleted or upgraded. The other counted active project could not be identified through the connected listing; locate it in the Supabase Dashboard before any action.
- PR #177 remains Draft and unmerged. Production Supabase schema/data/auth settings and production Worker/domain remain untouched.


## Cloudflare token recheck — 6 November 2026

- A fresh read-only preflight [#42131595738](https://github.com/taufx98/sykabelajar4.0/actions/runs/42131595738) was triggered on 6 November 2026 after the latest secret update; it completed successfully.
- D1 API is readable and returns the dedicated `sykabelajar-auth-poc` database. Zone `sykabelajar.my.id` is readable and active; Worker script list, custom-domain list, and Worker routes are readable. No Cloudflare API errors were returned.
- The account currently lists only `sykabelajar-auth-poc` as a D1 database in this account-scoped query. The auth Worker script is not deployed (only `sykabelajar4-0` is listed); `auth.sykabelajar.my.id` custom domain and route are absent.
- This recheck proves current D1/Zone/Worker read permissions. D1 Write was independently proven by successful empty-database creation in [#42057812352](https://github.com/taufx98/sykabelajar4.0/actions/runs/42057812352). Worker Scripts Write and Zone Workers Routes Write have not been exercised because no deployment or route creation was attempted.
- No successful Worker deployment, DNS change, custom-domain assignment or route creation occurred. The later failed staging attempt left no partial Worker/domain/route per read-only preflight #42179241229. Remote staging D1 migration succeeded separately in #42159049470; no production configuration or Supabase production change occurred.


## Supabase quota and schema exporter recheck — 6 November 2026

- The Supabase connector was queried again: it lists one organization, `sykabelajar` (Free), and one project, `sykabelajar_db2` (`ACTIVE_HEALTHY`). A fresh project quote remains **US$0/month**, but Supabase rejected creation because account `taufxacc11-sudo` has already reached the two-active-Free-project limit across organizations where the account is Owner/Admin. No project was created, paused, deleted or upgraded.
- The second project consuming the quota is not visible via the connected `list_projects`/`list_organizations` results. Supabase's billing rule counts projects across all organizations in which the user is Owner/Admin; paused projects do not count. The owner must inspect the Supabase Dashboard across every organization and identify the non-production project before considering a pause. Do not pause `sykabelajar_db2`.
- The schema-only exporter now rejects a connection string that does not match `SUPABASE_PROJECT_REF`, accepting only the direct host `db.<project-ref>.supabase.co` or session-pooler host with user `postgres.<project-ref>`. This prevents producing a default schema dump from one project and an Auth/Storage diff from another. Bash syntax, static contract, FK-plan generator and all local Supabase assertions passed in [CI #42132183039](https://github.com/taufx98/sykabelajar4.0/actions/runs/42132183039). These remain local/synthetic tests; the actual production schema-only export has not been run.
- The actual schema-only export has not been run because it must execute on the database owner's trusted local machine. No connection string was requested, exposed, or copied to GitHub. The helper still performs no remote schema/data mutation, restore, or deployment.


## 6 November 2026 — guarded remote D1 migration preparation (historical)

- Added manual-only workflow `.github/workflows/auth-cloudflare-d1-migrate.yml` and runbook [AUTH-CLOUDFLARE-D1-MIGRATION-RUNBOOK.md](AUTH-CLOUDFLARE-D1-MIGRATION-RUNBOOK.md).
- The workflow is restricted to branch `security/auth-poc-stage-1`, requires the exact typed confirmation `APPLY-TO-sykabelajar-auth-poc`, checks the repository's Worker/D1 name and UUID, confirms the same name/UUID through the Cloudflare API, and refuses to run if the migration directory differs from the four reviewed SQL migrations.
- It applies only D1 migrations 0000–0003 to the dedicated remote D1, then checks for all 17 expected Better Auth/OAuth/ZeptoMail tables. It does not deploy a Worker, set secrets, configure DNS/custom domains/routes, register Supabase OIDC, or access the production Supabase project.
- At the time this historical note was written, the workflow had not yet been dispatched. This was superseded by successful manual run [#42159049470](https://github.com/taufx98/sykabelajar4.0/actions/runs/42159049470), which applied migrations 0000–0003 and verified all 17 expected tables.
- The workflow's four safety-contract tests and the complete Auth Worker CI passed in [#42136109104](https://github.com/taufx98/sykabelajar4.0/actions/runs/42136109104). The separate Cloudflare read-only preflight [#42136109088](https://github.com/taufx98/sykabelajar4.0/actions/runs/42136109088) also passed. Both CI jobs completed successfully; those earlier runs did not deploy the Worker or migrate remote D1.

## Stage 1/2 update — 6 November 2026

- Dedicated remote D1 migration run [#42159049470](https://github.com/taufx98/sykabelajar4.0/actions/runs/42159049470) completed successfully on `security/auth-poc-stage-1`: exact Cloudflare D1 name/UUID verified, four reviewed migrations applied, and all 17 expected Better Auth/OAuth/ZeptoMail table names verified.
- Auth Worker CI [#42177805558](https://github.com/taufx98/sykabelajar4.0/actions/runs/42177805558) completed successfully on the new OIDC assertions: OIDC authorization-response `iss` must equal discovery issuer (RFC 9207), and JWT `sub` must be a UUID matching the user identity. Both Worker/OIDC and frontend jobs passed.
- No Worker was deployed, no Cloudflare secret/domain/DNS changed, and no Supabase production configuration or data was modified. Stage 2 remains pending hosted acceptance in an isolated Supabase Free project.
- Supabase Local Auth Claims CI [#42132183039](https://github.com/taufx98/sykabelajar4.0/actions/runs/42132183039) still passes 73/73 local pgTAP assertions. The production schema-only export remains pending on the database owner's trusted local machine, and the separate Supabase Free staging project remains blocked by the account's active-project cap.


## Current Cloudflare staging deploy blocker — 6 November 2026

- The deployment workflow was changed to **manual-dispatch only** on branch `security/auth-poc-stage-1`; no push or PR update can trigger a Worker deployment. Exact confirmation is `DEPLOY-STAGING-WORKER-sykabelajar-auth-poc`.
- Guarded deploy attempt [#42181766748](https://github.com/taufx98/sykabelajar4.0/actions/runs/42181766748) passed typecheck, unit/security tests, local dry-run, exact staging config, zone/DNS preflight, all 17 remote D1 table checks, empty user/session/account checks, and temporary secret preparation. It then failed before calling Cloudflare because Wrangler 4.156.2 returned `Unknown argument: yes` for `wrangler deploy --yes`; hosted OIDC checks were skipped.
- The workflow fix removes the unsupported argument, changes the diagnostic upload to the valid `if: ${{ failure() }}` condition, updates `actions/checkout` and `actions/setup-node` to Node 24-compatible v7, and pins the runner to Ubuntu 24.04. Six new static contract tests guard these choices.
- Current Auth Worker and frontend CI [#42182078655](https://github.com/taufx98/sykabelajar4.0/actions/runs/42182078655) passed both jobs. Latest read-only resource snapshot [#42182078460](https://github.com/taufx98/sykabelajar4.0/actions/runs/42182078460) confirms the staging Worker script and D1 exist; the Custom Domain and route are absent. There was no deployment during this preflight run.
- The latest workflow is manual-only. Re-run [Auth Worker Staging Deploy](https://github.com/taufx98/sykabelajar4.0/actions/workflows/auth-worker-staging-deploy.yml) on `security/auth-poc-stage-1` and enter `DEPLOY-STAGING-WORKER-sykabelajar-auth-poc`. No additional Cloudflare token rotation is needed unless the actual Custom Domain deployment returns an authorization error.


## Live catalog recheck — 6 November 2026 (latest; read-only)

A fresh read-only query against production project `mvdczyitbkxkldjughor` confirms: `private.app_users` does not exist; 69 application foreign keys still reference `auth.users(id)`; 3 non-internal triggers remain on `auth.users`; 109 policies reference `auth.uid()`; and `auth.users` contains 11 rows (count only; no identity values were selected). Eight public/private SQL functions directly reference `auth.users` in their function definitions. The broader set of auth-model-dependent functions is tracked in the dependency inventory; the direct-reference count is not a replacement for that broader review.

The only Supabase project visible through the connected account is the production project `sykabelajar_db2`. No isolated Free staging project is available in this connection. The production project was queried read-only only; no DDL, DML, Auth provider configuration, account reset, or data export occurred. Do not register the staging OIDC issuer in production.

The staging deployment is independently verified by successful run [#42190609080](https://github.com/taufx98/sykabelajar4.0/actions/runs/42190609080): Worker version `bd1feee3-4142-412e-9d05-e8eaa97de971`, live D1 health, exact discovery issuer, PKCE S256, and public ES256 P-256 JWKS. Real ZeptoMail delivery and Google OAuth remain unconfigured; no staging user/session was seeded.



## 6 November 2026 — fresh Supabase advisor and deployed Edge Function audit

A fresh read-only Security Advisor snapshot at 09:13 UTC reports 23 RLS-enabled tables without policies (INFO), 46 SECURITY DEFINER functions callable by anon and 202 callable by authenticated (WARN), and leaked-password protection disabled (WARN). The performance advisor reports 41 unindexed foreign keys, 13 auth RLS init-plan findings, 86 unused indexes and 26 multiple permissive policy findings. These are review signals; do not blanket revoke grants, add blanket RLS policies, or delete indexes without reviewing actual callers and intended access.

The live project lists 15 active Edge Functions. The four relevant deployed functions still calling `supabase.auth.getUser()` are `get-cloudinary-signature` v11, `payment-gateway-create` v5, `payment-gateway-reconcile` v1 and `payment-gateway-admin` v5. A source-level audit confirmed that `midtrans-create-payment` is a compatibility delegator and that `payment-webhook` / `payment-gateway-webhook` authenticate signed provider callbacks separately. No Edge Function code was deployed or modified during this audit.

For Stage 5, the current Supabase Edge Function guidance recommends `@supabase/server` `withSupabase({ auth: 'user' })` for user JWT verification, keeping `verify_jwt = true`, and using verified `userClaims` / `jwtClaims` instead of assuming every external Better Auth subject has a matching `auth.users` record. Privileged admin-client work still needs explicit owner/business-role checks. See https://supabase.com/docs/guides/functions/auth. Validate this on the isolated Custom OIDC project before changing any production function.


## Exact FK revalidation — 6 November 2026

The committed 69-entry application FK snapshot was compared against a fresh read-only production catalog query on 6 November. **69/69 matched exactly**, with zero added/removed constraint or differences to source/target columns, constraint names, ON DELETE/UPDATE actions, MATCH, validation, deferrability or initial deferral. Distribution remains 42 CASCADE, 18 SET NULL, 8 NO ACTION, 1 RESTRICT. The query read schema metadata only. This confirms the snapshot used by the review-only FK plan generator is current; it does not authorize running generated SQL or changing production.


## Supabase staging availability recheck — 6 November 2026

The connected Supabase account lists one organization, `sykabelajar`, on the Free plan. The project listing exposes only the production project `sykabelajar_db2`; its development branch listing is empty. This connection therefore offers no isolated hosted Supabase database for Custom OIDC acceptance. The prior $0/month project-creation attempt was rejected by Supabase because the account was at the two-active-Free-project limit. No project, branch, plan, or production configuration was changed during this recheck.

Do not create a paid branch, pause/delete the production project, or register the Better Auth staging issuer in production as a workaround. Stages 2–3 remain blocked on obtaining an isolated no-cost hosted Supabase test target and the trusted schema-only baseline export.


## CI, hosted preflight and branch preview checkpoint — 6 November 2026

Worker + frontend CI [#42195372638](https://github.com/taufx98/sykabelajar4.0/actions/runs/42195372638) passed on commit `0344a20077c5feb6bfc42a60633cc0a6cd74c689`: dependency audit, Worker TypeScript, all 40 Worker tests, local D1/Auth/OAuth integration, Worker dry-run bundle, and frontend lint/typecheck/build.

Read-only Cloudflare preflight [#42195372541](https://github.com/taufx98/sykabelajar4.0/actions/runs/42195372541) passed. It verified Zone Read and dedicated D1 Read, and independently probed the live auth origin: health OK, exact issuer `https://auth.sykabelajar.my.id/api/auth`, PKCE S256 advertised, public ES256 P-256 JWKS. The current Cloudflare token receives HTTP 503 from list endpoints for Worker Scripts, Custom Domains and Routes. Because direct hosted health/discovery/JWKS and D1 checks pass, the preflight now treats these listing endpoints as warnings; it does not request broad Account Admin and it does not infer missing resources from an unreadable list.

For the staging Admin panel, Wrangler config now adds exactly one temporary `DEV_APP_ORIGIN`: `https://security-auth-poc-stage-1.sykabelajar4.pages.dev`. Unit tests cover exact-origin CORS and reject an attacker origin. The staging deploy workflow's post-deploy smoke test also checks those two cases. **The currently deployed Worker predates this new origin value**; it must be updated via the manual-only Auth Worker Staging Deploy workflow before browser access from the preview can work. The redeploy workflow was changed to preserve the already provisioned Worker secrets: it no longer lists or rotates them and calls Wrangler without a replacement secrets file.

Cloudflare Pages branch preview for latest commit `0344a20077c5feb6bfc42a60633cc0a6cd74c689` failed. The GitHub check exposes only the generic failure and dashboard log link; the actual Pages build log isn't accessible through the connected repository read interface. An older commit `064225dd07fbce066f848fec63676cf60fe91a84` had a successful Branch Preview, but it predates the exact-hostname Worker URL fallback. Do not state the current preview UI is deployed until a successful current Pages check is observed.

These checks performed no production Supabase schema/data/Auth changes, no production Worker/DNS changes, no real ZeptoMail send, no account cleanup and no login cutover. PR #177 stays Draft/unmerged.


## Latest Cloudflare Pages preview recovery — 6 November 2026

The latest Cloudflare Pages check on commit `bc8915cd3eb9f68c68ea8da20257b8feaeec2e3e` completed **success**. Branch Preview URL: [https://security-auth-poc-stage-1.sykabelajar4.pages.dev](https://security-auth-poc-stage-1.sykabelajar4.pages.dev). The ZeptoMail UI is located at `/admin/core?tab=settings`.

This supersedes the earlier Pages build-failed status for commit `0344a20077c5feb6bfc42a60633cc0a6cd74c689`. The Worker has not yet been redeployed with the exact preview `DEV_APP_ORIGIN`; hosted CORS validation is pending. Thus preview build is green, but the ZeptoMail panel-to-Worker browser connection is not yet verified.


## Full table/RLS and organizer access-code check — 6 November 2026

Read-only verbose table metadata reports 125 application tables: 120 in `public`, five in `private`. RLS is enabled on 124; the sole RLS-disabled table is `private.organizer_access_codes`. A separate privilege query found no `USAGE` or `CREATE` privilege on the `private` schema for `anon` or `authenticated`, and no direct SELECT/INSERT grant on the access-code table. Four `SECURITY DEFINER` functions access it: `admin_create_organizer`, `create_organizer`, `join_organizer`, and `rotate_organizer_access_code`. All four deny execution to `anon`, are executable by `authenticated`, and have operation-specific admin/organizer/caller checks. Three pin `search_path` to `public,private`; the rotation function pins it to empty. No RLS or grant change was made. Stage 5 must review these function guards with the Better Auth UUID identity, preserving access-code hash-only storage and the current organizer role/business checks. The `create_organizer` phone/email-verification dependency remains a blocker; do not weaken it as a shortcut.


## Anonymous SECURITY DEFINER RPC review — 6 November 2026

A new first-pass triage of all 46 anon-callable SECURITY DEFINER functions is recorded in [AUTH-ANON-SECURITY-DEFINER-RPC-REVIEW.md](AUTH-ANON-SECURITY-DEFINER-RPC-REVIEW.md). Four are admin-only but currently have an anon-callable ACL; ten are signed-in/owner/public-profile projections; 15 are intentional guest participant/portal APIs secured by a separate hashed bearer token; and 17 are public read/telemetry APIs. The actual signatures, intended callers and required tests are listed in the review. No grants were changed.

Confirmed prerequisite: production `get_profile_connections` has an anonymous NULL-semantics bypass and lacks a private-profile visibility check; `get_public_profile_social` also needs private-profile protection. PR #174 prepares the null-safe/visibility fix but remains Draft and requires isolated PostgreSQL validation. Do not say production is fixed yet.

A second data-minimisation item: public competition results currently return and render `participant_code`; the collective portal also uses this as a second step after portal-token authentication. Evaluate masking/removal with product tests before altering this public contract. This check made no code or production data change.

Of the 23 RLS-enabled/no-policy tables, 20 have no direct anon/authenticated SELECT/INSERT grants; three do have such table grants but remain default-deny to those roles because RLS has no policies. Treat advisor findings as review signals, not proof of public exposure.


## Stage 5 verified Edge JWT adapter scaffold — 6 November 2026

The branch now has a non-deployed shared adapter `supabase/functions/_shared/better-auth-user.ts` pinned to `@supabase/server@1.9.2`. It uses Supabase's `createSupabaseContext(..., { auth: 'user' })` for cryptographic verification, then enforces the exact configured Better Auth issuer/audience, UUID `sub`, matching `userClaims.id`, Postgres `role=authenticated`, and a maximum 300-second token lifetime. Missing issuer/audience environment configuration fails closed.

The claim helper has 7 pure Node tests; the complete static suite checks the adapter import/auth mode, the explicit `verify_jwt=true` boundary on four user-facing endpoints plus the legacy Midtrans delegate, and the webhook `verify_jwt=false` plus provider signature checks. `payment-gateway-reconcile` is now explicitly configured with `verify_jwt=true`, rather than relying on an implicit platform default. The helper is a scaffold only: none of the four production user-facing Edge Function source implementations has been switched from `auth.getUser()`, and no Edge Function/config deployment has occurred. See [AUTH-EDGE-FUNCTION-MIGRATION-MATRIX.md](AUTH-EDGE-FUNCTION-MIGRATION-MATRIX.md).

CI is being extended to run this contract in both Auth Worker CI and Supabase Local Auth Claims CI. Hosted Custom OIDC/IDOR acceptance remains blocked by lack of an isolated hosted Supabase Free project; this scaffold does not remove that blocker.


## Latest CI verification — 6 November 2026 (typed adapter and frontend inventory)

- Auth Worker CI [#42214172430](https://github.com/taufx98/sykabelajar4.0/actions/runs/42214172430) passed: dependency audit, Worker typecheck, 40 Worker tests, D1/OAuth/Auth integration, dry-run bundle, frontend lint, frontend typecheck and frontend build.
- Supabase Local Auth Claims CI [#42214172513](https://github.com/taufx98/sykabelajar4.0/actions/runs/42214172513) passed: 12/12 Edge JWT and webhook contract tests, Deno typecheck of `better-auth-user.ts` with pinned `@supabase/server@1.9.2`, schema-only export and FK-plan contract checks, and 73/73 local pgTAP tests.
- Stage 4 frontend inventory now records 41 `supabase.auth` callsites across 22 frontend files and has a CI contract test to detect unreviewed changes. No app auth callsite has been switched; the 25-minute idle logout, guest mode, user/role hydration, organizer phone OTP, password update, Cloudinary upload, order ownership, admin diagnostics and auth-change cache invalidation remain to be migrated deliberately.
- Stage 5 helper is now type-checked but is not called by the four existing user-facing Edge Functions. A separate source-only change tightens `get-cloudinary-signature`: the caller can receive signatures only for their profile avatar/cover namespace or an organizer row owned by their UUID. This still uses the legacy Supabase Auth token and is not deployed. Provider webhooks remain separately signature-authenticated.
- Pages branch preview is green on the latest documentation/CI commit: [security-auth-poc-stage-1.sykabelajar4.pages.dev](https://security-auth-poc-stage-1.sykabelajar4.pages.dev). Latest staging Worker still needs the manual redeploy that activates this exact preview Origin; ZeptoMail Agent token and actual mail delivery are pending.
- No production Supabase schema/data/Auth, Edge Function, secret, user account, production Worker or main-site login changes were made.


## Deno type-check and verified-session admin bridge — 6 November 2026

## Deno type-check and verified-session admin bridge — 6 November 2026

The pinned Supabase Edge adapter was type-checked successfully with Deno 2.9.8 and `@supabase/server@1.9.2` in Supabase Local Auth Claims CI [#42214172513](https://github.com/taufx98/sykabelajar4.0/actions/runs/42214172513). The same run passed all 12 Edge JWT/webhook contract tests and 73/73 local pgTAP tests. The type-check caught and corrected the missing explicit `Request` parameter type before turning green.

Stage 1 ZeptoMail Admin UI is a pre-cutover bridge: it currently reads the existing Supabase Auth session and the Worker verifies that access token via the current Supabase `/auth/v1/user` endpoint, then calls `is_active_admin()` under the same caller token. It stores only encrypted Agent Send Mail Tokens in the isolated D1 and the test operation sends only to the verified admin's email. This bridge has not been browser-tested with a live admin session and has not sent real mail. Stage 4/5 must replace this bridge with a verified Better Auth access token and the accepted Supabase Custom OIDC identity path before production cutover.


## Latest verified checkpoint — 6 November 2026 (Cloudinary ownership hardening + opt-in provisioning)

## Latest verified checkpoint — 6 November 2026 (Cloudinary ownership hardening + opt-in provisioning)

Auth Worker + frontend CI [#42247015051](https://github.com/taufx98/sykabelajar4.0/actions/runs/42247015051) completed **success** on `4c00fa315d0e8329d054b4d2d12feeea225ab4b2`. It passed the Worker TypeScript/build checks, 56 Worker unit tests, 12 Better Auth JWT claim tests, 15 Cloudinary ownership/source-contract tests, two frontend auth-inventory checks, the clean local D1 migration chain (0000–0004), fixed OAuth client seed validation, sign-up/email-verification/session/PKCE/ES256 integration, Worker dry-run, and frontend lint/typecheck/build.

Supabase Local Auth Claims CI [#42247014985](https://github.com/taufx98/sykabelajar4.0/actions/runs/42247014985) completed **success** on the same commit. Deno type-check passed for the shared Better Auth verified-context adapter, `get-cloudinary-signature`, and the branch replacement for `cloudinary-delete-asset`. The isolated Supabase fixture passed **83/83 pgTAP assertions**.

The registration integration now deliberately submits `accountType=admin` first and expects HTTP 400 with no verification email, then retries with a valid teacher account and verifies that `accountType`, `username`, and `referralCode` survive the Better Auth session. This proves the pre-insert validator rejects unsupported business roles before a D1 row is created.

The complete 15-function production Edge Function inventory is recorded in [AUTH-EDGE-FUNCTION-MIGRATION-MATRIX.md](AUTH-EDGE-FUNCTION-MIGRATION-MATRIX.md). A branch-only replacement for the live `cloudinary-delete-asset` ownership gap now resolves the verified legacy caller UUID and restricts deletes to the exact UUID-owned avatar/cover asset IDs. The new and legacy Cloudinary ownership tests pass. **No Edge Function has been deployed**; production Cloudinary delete v9 remains unchanged until an isolated A/B hosted test and a controlled deployment review pass.

The newest code is still branch-only. This CI did not apply migration 0004 to remote D1, redeploy the live Worker, configure ZeptoMail, register Supabase Custom OIDC, or modify production Supabase. PR #177 remains Draft and unmerged.


## Latest CI checkpoint — 6 November 2026 (Cloudinary delete hardening + registration validation)

## Latest CI checkpoint — 6 November 2026 (Cloudinary delete hardening + registration validation)

The latest source-code commit tested was `6e1fcc0b3f4a1db80a6425ead63522e6a611d211`:
- [Auth Worker + frontend CI #42247915763](https://github.com/taufx98/sykabelajar4.0/actions/runs/42247915763) — success. Worker checks passed: 56 unit/security tests; 12 OIDC/JWT claim tests; 15 Cloudinary ownership/delete source tests; two frontend inventory tests; local D1 migrations 0000–0004; seeded OAuth client checks; sign-up/email-verification/session/PKCE/ES256 integration; Worker dry-run; frontend lint, typecheck and production build.
- [Supabase Local Auth Claims CI #42247915859](https://github.com/taufx98/sykabelajar4.0/actions/runs/42247915859) — success. Deno type-check passed for the Better Auth verified-context adapter, `get-cloudinary-signature`, and the branch `cloudinary-delete-asset` replacement. Local synthetic Supabase fixture passed 83/83 pgTAP assertions.

This is still branch/local CI evidence. It does not mean that remote Cloudflare D1 migration 0004 has been applied, the Worker redeployed with the preview CORS origin, ZeptoMail configured, any production Edge Function deployed, Supabase Custom OIDC accepted, or a production identity/FK/RLS migration executed. PR #177 remains Draft and unmerged.


## Supabase Free staging-slot recovery — verified 6 November 2026

## Supabase Free staging-slot recovery — verified 6 November 2026

The connected Supabase inventory still exposes one Free organization (`sykabelajar`) and one active project (`sykabelajar_db2`), but a prior staging-project create attempt was rejected at the Free project quota. Do not use a paid Development Branch or upgrade the production organization.

Current official Supabase billing guidance says the Free plan includes two active projects **across all organizations where the user is Owner or Administrator**; paused projects do not count. The two projects may be distributed across two Free organizations, or both placed in one Free organization. If an organization has another Owner/Admin who has already consumed their Free quota, that can block project creation for the organization; Supabase's FAQ says to create a separate Free Plan organization or change the affected member's team role. Official references: https://supabase.com/docs/guides/platform/billing-on-supabase and https://supabase.com/docs/guides/platform/billing-faq.

**No-cost recovery path to try before abandoning hosted acceptance:**
1. In the Supabase Dashboard, inspect the organization dropdown and all organizations/projects owned/administered by this account; identify any paused Free project (it does not consume the active-project quota) and any other Owner/Admin member whose quota may be blocking creation.
2. If the quota is available outside the current organization, create a separate organization and explicitly keep it on the **Free ($0)** plan. Do not select Pro, add-ons, compute upgrades, or a paid branch. The dashboard's new-organization entry is https://supabase.com/dashboard/new.
3. Once the new Free organization appears in the connected Supabase project inventory, use that organization ID to create one isolated APAC staging project, but only after the tool quotes $0. If the quote is nonzero or the quota still rejects creation, stop; do not confirm any paid cost.
4. Keep production `mvdczyitbkxkldjughor` untouched and never register the staging issuer there.

The connected Supabase tools in this session expose list/get/create-project actions but no create-organization or team-role update action. Thus I cannot create the new Free organization or change team membership from this connection. This is a dashboard prerequisite, not permission to use a paid project. Hosted Custom OIDC and two-user IDOR acceptance remain blocked until an isolated Free project exists.


## PR/base-branch integration gate — 6 November 2026

PR [#177](https://github.com/taufx98/sykabelajar4.0/pull/177) remains **open, Draft, and unmerged**. The PR's base is `security/auth-migration-phase-0`, and GitHub reports `mergeable_state=dirty`. A comparison against `main` reports the migration branch as diverged, 522 commits ahead and six behind.

Green CI proves the branch's tested source works in isolation; it does not make a dirty/diverged PR safe to merge. Do not force-merge, change the base blindly, or overwrite files from `main`. Before any merge, perform a reviewed three-way base reconciliation, resolve conflicts by preserving newer production app changes, then rerun full Worker/Supabase/frontend CI and the production impact review. No merge was attempted.


## Latest profile-bootstrap and seven-column deployment-gate checkpoint — 6 November 2026

The latest branch source remains isolated and unmerged. The Stage 3 signup projection now carries the existing registration form's full profile payload into PostgreSQL: `birthDate → profiles.birth_date`, `institution → profiles.institution`, `grade → profiles.grade`, `subjects → profiles.subjects`, along with `username`, `accountType`, and optional `referralCode`. The private/public provisioning RPC fixture preserves positional compatibility by appending optional profile arguments after the existing arguments. The SQL fixture proves all four fields are projected through the public PostgREST wrapper as `service_role`; the run passed 88/88 pgTAP assertions.

The Worker validates the profile bootstrap values before the D1 user row is inserted. Profile/referral bootstrap fields are marked non-returned by Better Auth and are cleared from D1 only after the Postgres projection succeeds. If the Postgres call or D1 cleanup fails, session creation fails closed and the registration payload remains available for retry. `accountType` and `username` remain in D1 as stable mapping metadata; business role authorization remains in `public.user_roles`, not Better Auth user metadata or JWT role claims.

The immutable Better Auth baseline generator now strips all seven custom fields from regenerated `0001_better_auth.sql`; additive migration `0004_better_auth_registration_attributes.sql` is the single source of those columns. The migration, staging deploy, and local Worker CI workflows now each require all seven columns: `accountType`, `username`, `referralCode`, `birthDate`, `institution`, `grade`, and `subjects`. Static workflow-contract tests lock this seven-column gate.

Verified CI:
- [Auth Worker CI #42258287868](https://github.com/taufx98/sykabelajar4.0/actions/runs/42258287868) — **success** on commit `c659a2ffe6674a974b542246acdd0347e9c3d09f`; Worker audit/typecheck/build, 60 Worker tests, 12 JWT tests, 15 Cloudinary ownership tests, two frontend inventory tests, signup/email-verification/session/OIDC integration, and frontend lint/typecheck/build all passed.
- [Supabase Local Auth Claims CI #42257123937](https://github.com/taufx98/sykabelajar4.0/actions/runs/42257123937) — **success**; local disposable Supabase and Deno type-check passed, with 88/88 pgTAP assertions.
- [Cloudflare staging read-only preflight #42258255042](https://github.com/taufx98/sykabelajar4.0/actions/runs/42258255042) — **success**. It does not deploy or migrate remote resources.

**Still not done:** remote D1 migration 0004, staging Worker redeployment with the seven-column/preview-origin gate, live CORS smoke, real ZeptoMail delivery, isolated hosted Supabase Custom OIDC, hosted two-user IDOR tests, production schema export, and the production identity/FK/RLS migration. No production database, Edge Function, secret, Cloudinary asset, or application login flow was changed. PR #177 remains Draft and unmerged; its base-branch state is still dirty, so no merge was attempted.


## Read-only production identity revalidation — 7 November 2026

A fresh read-only check was performed against the connected Supabase production project on 7 November 2026. No SQL DDL/DML, migration, Auth setting, Edge Function, secret, or user record was changed.

- The connected Supabase inventory exposes one Free organization (`sykabelajar`) and one active project (`sykabelajar_db2`, production ref `mvdczyitbkxkldjughor`). No separate staging project is available through this connection. The organization is on the Free plan.
- `private.app_users` is still absent.
- Exactly 69 application foreign keys in `public`/`private` still reference `auth.users`: 42 `CASCADE`, 18 `SET NULL`, 8 `NO ACTION`, and 1 `RESTRICT`.
- Three non-internal triggers remain attached to `auth.users`.
- There are 109 RLS policies across all schemas whose expressions reference `auth.uid()` (108 in `public`, one in `private`).
- `auth.users` contains 11 rows; only the aggregate count was queried, not account identities or credential fields.
- The project still has 15 active Edge Functions. Production `cloudinary-delete-asset` remains deployed at version 9; the stronger owner-check replacement in the migration branch is not deployed. Do not claim that production endpoint is hardened until the replacement passes isolated two-user tests and a controlled deployment review.
- The applied production migration list includes `20261105053729_retire_chat_system`; the chat-retirement change is separate from Better Auth and does not authorize any identity migration.

The Stage 3 migration remains blocked by the private owner-local schema-only export/baseline, a separate isolated Supabase test project, reviewed executable migration plan, and trusted organizer phone-verification preservation. Stages 4–7 remain gated by those prerequisites and hosted two-user acceptance. Production identity tables, foreign keys, triggers, RLS, RPCs, Edge Functions and users remain unchanged.


## Supabase staging and OIDC fixture — 7 November 2026

The previously recorded absence of a separate Supabase staging project is superseded. A separate Free project was created successfully at US$0/month:

- `sykabelajar-auth-staging` / `ydamszdfsxqisanazdkb` / APAC `ap-southeast-1`
- Status at creation: `ACTIVE_HEALTHY`
- Production project `mvdczyitbkxkldjughor` was not modified.

The isolated project's `public.auth_oidc_acceptance_rows` fixture uses synthetic UUIDs only, FORCE RLS, five policies (four ownership policies plus a restrictive exact-issuer guard), and two fixture records. SQL acceptance checks executed in a transaction and rolled back successfully: owner-specific read, permitted own insert/update, forged cross-user insert/update denial, second-user isolation, and denial for an untrusted `iss`. The two fixture rows remain seeded; the attempted test mutations did not persist.

This is a Postgres RLS contract test—not hosted OIDC cryptographic acceptance. The provider issuer has not yet been registered on the staging project's Third-Party Auth settings, and no Better Auth user token has been accepted by the hosted Supabase Auth/Data API. The Supabase connector available in this session can provision projects and run SQL but does not expose the third-party auth configuration write API. Production Custom OIDC remains untouched.

The Stage 2 runbook now records this corrected blocker and exact project details. Stages 3–7 remain gated by schema-only production baseline export, hosted token acceptance, identity/FK/provisioning design validation, frontend/backend migration, regression and rollback. No production data, identity rows, FK, trigger, RLS, Auth configuration, Edge Function, or login route was changed.


## Stage 1 refresh — 7 November 2026

The previous staging checkpoint is superseded by the following verified deployment sequence:

- Remote D1 migration 0004 applied successfully in [run #42265224273](https://github.com/taufx98/sykabelajar4.0/actions/runs/42265224273). All 17 expected tables and seven registration/profile columns were verified.
- Staging Worker deployed successfully in [run #42265308348](https://github.com/taufx98/sykabelajar4.0/actions/runs/42265308348). Current deployed version: `ab04efd9-5750-48c0-8dbe-56c2a6d1118a`.
- Hosted health, exact issuer, PKCE S256, ES256 P-256 public JWKS and CORS allow/deny checks passed.
- The staging D1 still has no user, session, account or verification rows. No production Supabase/Cloudflare resources were mutated.
- Both remote operations were run by exact one-time marker commits on the staging branch. The prior successful 0000–0003 migration and initial Worker deployment were not repeated.

## Stage 2 pre-acceptance checkpoint — 7 November 2026 (superseded by the hosted acceptance below)

- Free Supabase staging project `sykabelajar-auth-staging` (`ydamszdfsxqisanazdkb`, APAC) is healthy and quoted at US$0/month.
- Hosted synthetic RLS fixture exists with two synthetic owner UUIDs, FORCE RLS, four owner policies plus a restrictive exact-issuer policy. Transactional SQL acceptance checks passed; only the two fixture rows remain.
- Local Supabase CI #42264325438 is successful with the corresponding issuer/RLS fixture test.
- The provider-registration blocker recorded at this checkpoint was later cleared by the isolated Free-project registration and successful hosted token acceptance documented in **Stage 2 hosted acceptance and clean staging restore** below. Production issuer registration remains prohibited.
- **Still pending:** real ZeptoMail Agent setup and end-to-end verified registration. The staging Worker reports `emailAgentConfigured=false`.

Stage 3 production changes remain blocked by the owner-local schema-only application baseline, a complete dry-run/reviewed migration plan, and production-shaped regression. The Telegram phone-verification design and synthetic tests now exist, but its remote D1 migration and real hosted consent/callback acceptance remain pending. Stages 4–7 remain gated by Stage 3 identity provisioning and regression. Production schema/auth/users/Edge Functions/login have not been changed.



## Stage 2 hosted acceptance and clean staging restore — 7 November 2026

**Stage 2 core hosted acceptance: passed.** The issuer was registered only in the isolated Free staging project and the live Better Auth token was accepted by its Supabase Data API.

- Custom OIDC registration [#42324487931](https://github.com/taufx98/sykabelajar4.0/actions/runs/42324487931) succeeded. Exactly one issuer was registered on `sykabelajar-auth-staging` (`ydamszdfsxqisanazdkb`), integration ID `ecb9da1f-ba63-445a-9585-bb9385099b13`.
- Hosted token and two-user RLS acceptance [#42328168345](https://github.com/taufx98/sykabelajar4.0/actions/runs/42328168345) succeeded. It verified Authorization Code + PKCE S256, ES256/JWKS, RFC 9207 `iss`, access-token claims, ID-token audience/nonce, Data API acceptance, `auth.uid()` UUID identity, two-user row isolation, cross-user insert rejection, modified-signature rejection, and session-bound UserInfo denial after logout.
- Synthetic Better Auth identities/sessions were deleted. Remote D1 cleanup verified zero test users, sessions, and accounts. Temporary `OIDC_ACCEPTANCE_TEST_TOKEN` was removed and its absence verified.
- Temporary acceptance route, test utilities, test scripts, and workflow were removed from the source branch.
- Clean staging Worker redeployment [#42328371754](https://github.com/taufx98/sykabelajar4.0/actions/runs/42328371754) succeeded. Version: `49495d57-d039-4a0e-9767-5963225f398b`. Health, stable issuer, PKCE S256, public ES256 JWKS, exact preview CORS, 17 remote D1 tables, and empty staging identity tables were verified.

**Not covered by this acceptance:** normal hosted email/password registration, email verification, and password reset remain pending because ZeptoMail setup was intentionally deferred. Storage has no staging buckets; Realtime has no staging authorization policy/channel fixture; the staging project has no Edge Functions. Do not report those services as tested. Any later Edge Function work must remain limited to the login identity integration under Stage 5 and must not spill into Cloudinary/payment endpoints.

Production Supabase issuer settings, auth users, schema, RLS, Edge Functions, secrets, and application login flow remain unchanged. PR #177 remains Draft and unmerged.


## Stage 3 production catalog revalidation — 7 November 2026

A further read-only scan was performed through the connected Supabase database interface. This is a catalog revalidation only; it is not the missing full schema-only `pg_dump` baseline.

- Production PostgreSQL is 17.6. `private.app_users` remains absent. The `auth.users` table has 11 rows (count only; no user data was selected).
- The application FK count remains 69, the `auth.uid()` RLS policy count remains 109, and the three non-internal triggers on `auth.users` remain present.
- Ten application functions remain in the Auth dependency inventory. Eight function definitions directly query `auth.users`; two additional functions consume the Auth row through trigger `NEW`/`OLD` context.
- No views were found that reference `auth.users` or `auth.uid()`.
- Production table metadata confirms that the synthetic fixture is narrower than the live schema: `profiles` has existing backend guard/normalization triggers, `referral_program_settings` has additional event/milestone/promo fields, and the referral/ledger uniqueness constraints must be preserved.
- `public.create_organizer` still depends on verified email and verified phone fields from the legacy Auth identity. No trusted Free-only Better Auth phone verification path has been accepted; this remains a hard compatibility blocker.
- Supabase's read-only inventory also surfaced a critical RLS-disabled advisory for `private.organizer_access_codes`. No policy or access change was made as part of this auth migration work. At the time of this catalog-only scan, no trusted phone-verification path had yet been selected; the subsequent Telegram OIDC candidate and test evidence are recorded in the final Stage 3 phone-verification progress section.

The dependency inventory now records the exact function-level migration treatment and fixture coverage gaps in [AUTH-IDENTITY-DEPENDENCY-INVENTORY.md](AUTH-IDENTITY-DEPENDENCY-INVENTORY.md).

**Stage 3 remains not ready for executable migration.** The complete schema-only baseline and disposable restore passed in run #42367689543. The exact 69-FK comparison rerun is recorded in run #42370809198. Expanded production-shaped regression coverage for the ten function dependencies, three Auth triggers, profile triggers, referral/organizer behavior and RLS policies is still required. The trusted phone-verification candidate is now implemented and synthetically tested, but BotFather setup, secrets, remote migration 0005 and real hosted consent/callback acceptance remain pending. No production schema, data, identity, FK, trigger, RLS, function, secret, issuer setting, or login path was changed.


## Stage 3 RLS identity coverage — 7 November 2026

A read-only policy scan classified the 109 policies that reference `auth.uid()`:

- 109 policies across 61 tables: 108 in `public` and 1 in `private`.
- 90 `USING` expressions and 42 `WITH CHECK` expressions reference `auth.uid()` (the categories overlap).
- Command totals: 55 SELECT, 19 INSERT, 12 UPDATE, 12 DELETE, and 11 ALL.
- No policy in this set directly references `auth.users`.

This defines a more precise later regression surface. The Stage 2 two-user fixture proves the base JWT/`auth.uid()` mapping, not all production policies. The updated counts and required treatment are recorded in [AUTH-IDENTITY-DEPENDENCY-INVENTORY.md](AUTH-IDENTITY-DEPENDENCY-INVENTORY.md). No policy or grant was modified.


## Supabase Stage 3 lab capacity check — 7 November 2026

A request to create a separate Free project named `sykabelajar-auth-stage3-lab` was evaluated at the quoted cost of **US$0/month**. Supabase rejected creation because the account has reached its limit of **two active Free projects** in the organization:

- Production: `sykabelajar_db2` / `mvdczyitbkxkldjughor`
- Isolated OIDC staging: `sykabelajar-auth-staging` / `ydamszdfsxqisanazdkb`

No project was created, paused, deleted, or upgraded. The existing OIDC staging project remains healthy and contains only its two-row synthetic OIDC acceptance fixture in the application schemas inspected. Do not pause it merely to create another lab: it holds the Stage 2 hosted acceptance configuration. Reuse it only for explicitly isolated auth test objects after checking for name collisions; never place a production schema restore or application data in it.

The failed project creation attempt does not change any of the seven migration stages or their acceptance criteria. No paid Supabase Development Branch was created.


## Stage 3 hosted synthetic validation — 7 November 2026

The existing isolated Supabase Free OIDC staging project `ydamszdfsxqisanazdkb` was reused for Stage 3-only test objects after a collision check. No third project was created; the second active-Free-project quota remained unchanged. The original OIDC fixture and its two synthetic rows were preserved.

Hosted pgTAP verification completed successfully:
- **12/12** identity FK rehome assertions.
- **68/68** identity provisioning/referral assertions.
- Tests used `extensions.finish(true)`; no assertion failure was reported.
- The test scripts rolled back their transactional test changes. Post-test catalog verification showed four fixture FKs still on the legacy synthetic parent, zero replacement FKs, zero synthetic `app_users` rows, and the original two OIDC rows intact.
- Five test-only tables that initially lacked RLS were hardened immediately: RLS enabled and forced, with direct client-role grants revoked. A subsequent inventory confirmed RLS enabled on all fixture tables.

The hosted fixture is synthetic and deliberately smaller than the production application schema. It strengthens confidence in PostgreSQL FK action preservation, server-only provisioning, role mapping, email verification, and referral reward idempotency; it does **not** prove production schema compatibility or complete trigger/function behavior.

### Current Stage 3 blockers remain

1. Owner-local full schema-only `pg_dump` baseline and successful disposable local restore are still missing. The connected catalog/query interface cannot replace that baseline.
2. Exact production regression coverage is still required for all ten Auth-dependent functions, the three `auth.users` triggers, production profile triggers/constraints, referral-related competition registration/qualification, and the 109 `auth.uid()` policies.
3. The trusted phone-verification path required by production `create_organizer` remains unresolved. Do not weaken or bypass the existing verified-phone rule.
4. The 69-FK production plan still needs its bounded-lock/resume runbook reviewed against the complete schema and actual workload. The current generator groups each phase in one transaction; no generated SQL has been applied to production.

A read-only catalog-size snapshot of the 62 referencing tables showed the largest relation at approximately 352 KB on 7 November 2026. This is only a point-in-time relation-size measurement, not a guarantee of scan time or current/future row counts. Re-measure before maintenance.

**Production boundary:** no production identity schema, FK, trigger, RPC/function, policy, user, secret, issuer setting, or login flow was modified. Stages 4–7 remain gated. PR #177 remains Draft and unmerged.


## Exact production trigger/function contract audit — 7 November 2026

Read-only catalog queries re-fetched the exact definitions of the ten functions depending on Supabase Auth, all three non-internal `auth.users` triggers, all four profile triggers, referral activity triggers, key table columns and function ACLs.

New details now recorded in [AUTH-IDENTITY-DEPENDENCY-INVENTORY.md](AUTH-IDENTITY-DEPENDENCY-INVENTORY.md):
- Legacy signup referral trigger reads `raw_user_meta_data.referral_id` as a UUID; competition registration accepts either referral code or UUID. The new Better Auth path resolves referral codes on the server and requires an explicit compatibility decision for UUID callers.
- Production referral activity is connected to check-ins, comments, follows, and daily-task completion; the qualification and verification functions still mention/scans chat-message activity. The auth migration must not silently rewrite this product behavior.
- Production `profiles` has 36 columns and four triggers. The reduced fixture cannot verify all profile field/default/trigger behavior. Better Auth retry semantics deliberately avoid legacy profile overwrite and admin-disabled role reactivation.
- `get_my_verified_referrals()` currently grants `EXECUTE` to `anon`; this is an ACL review item, not an automatic production change.
- The trusted phone-verification and SHA-256 identity-claim contract for organizer creation remains mandatory.

All evidence is from PostgreSQL catalogs/definitions only, without selecting user rows, emails, UUIDs or secrets. No production data/schema/trigger/function/grant/policy/auth configuration was changed.


A current source/production recheck further confirms `ReferralProgramPanel.tsx` is the active frontend consumer of `get_my_referrals_v2()`, but it does not use `last_login_at`. No active frontend consumer for `get_my_verified_referrals()` was found, despite its live anonymous EXECUTE grant. A read-only production query of `cron.job` found no current scheduler job invoking `verify_pending_referrals()`. These are now explicit API/ACL and scheduler compatibility checks for Stage 3; no grants or cron jobs were changed.


## Stage 3 staging fixture final security inventory — 7 November 2026

A final read-only inventory in `sykabelajar-auth-staging` confirmed RLS is enabled on **all 15** application/fixture tables in the inspected `public` and `private` schemas. The Stage 2 OIDC fixture still has its two synthetic rows; the Stage 3 `private.app_users` table has zero rows. The four FK-action child fixtures still reference the four-row synthetic legacy parent; the transactional rehome test left no replacement constraint behind on those four child tables. The separate provisioning fixtures have their expected schema FK relationships to the empty synthetic app identity table.

Supabase Security Advisor reports 14 `RLS enabled, no policy` informational findings. This is intentional fail-closed behavior for the isolated test tables: RLS is enabled and direct `PUBLIC`/`anon`/`authenticated` table grants are revoked; no client access policy was intended for these fixtures.

Performance Advisor still reports six unindexed FKs in the small synthetic fixture and one initialization-plan warning on the pre-existing Stage 2 OIDC issuer policy. No production performance finding was modified. Indexes were briefly trialed and then removed from the synthetic tables because the advisor marked all six as unused; no index change was made to production. The Stage 2 policy warning is retained for a separate issuer-policy performance review and does not change the accepted issuer restriction.

No production schema/data/auth change was made.


## Stage 3 phone-verification progress — 7 November 2026

A free verified-phone candidate has been implemented using Telegram's official OIDC `phone` scope. It is separate from SYKABELAJAR social login. Worker code validates RS256 signature, issuer, audience, nonce, expiry/freshness, and `phone_number_verified=true`; D1 challenges are one-use, short-lived, atomically rate-limited, and expired rows are deleted on demand. Only a digits-only SHA-256 hash and trusted Telegram subject reach the service-role-only Supabase RPC.

Hosted synthetic pgTAP organizer/phone compatibility passed **26/26 assertions**. The test preserves the existing verified-email and active `organizer_member` gates, rejects forged client verification, prevents duplicate Telegram-subject linking, and preserves the global FREE organizer identity claim.

Still required before this phone gate is operationally closed:
1. Owner-created BotFather OIDC app with the exact callback `https://auth.sykabelajar.my.id/phone-verification/telegram/callback`.
2. Add `AUTH_TELEGRAM_CLIENT_ID` and `AUTH_TELEGRAM_CLIENT_SECRET` to the Worker as encrypted Cloudflare secrets; do not put them in repo, Pages variables or chat.
3. Apply D1 migration 0005 to the dedicated staging D1 through the hash-guarded workflow, then run real hosted user-consent/callback acceptance tests before any enablement.
4. Keep production `create_organizer()` and identity tables unchanged until the full schema-only production baseline and disposable restore are complete.

The UI guidance note (shadcn/ui Skills) is recorded for the later Admin panel; no UI implementation or Stage 4 work has started.

## Authoritative current checkpoint — 7 November 2026 (supersedes older snapshots above)

- The remote dedicated D1 is verified through migrations 0000–0004: 17 expected tables and the seven Better Auth registration/profile columns. Migration 0005 is present in the branch and passes the clean local migration chain; remote application remains pending. The current guarded migration workflow recognizes 0000–0005, checks reviewed migration hashes and verifies 18 tables after an apply. No remote 0005 migration was triggered as part of this checkpoint.
- Auth Worker CI [#42334387328](https://github.com/taufx98/sykabelajar4.0/actions/runs/42334387328) passed the Worker typecheck, dependency audit, 78 Worker tests, D1 migrations 0000–0005 on local D1, OAuth/PKCE/ES256 integration, and Worker deployment dry-run. Its frontend job passed lint, typecheck and build without deploying.
- Supabase Local Auth Claims CI [#42334724181](https://github.com/taufx98/sykabelajar4.0/actions/runs/42334724181) passed the local Supabase contract suite: 127 pgTAP assertions across five files, including the 26 phone/organizer assertions. This is synthetic fixture evidence, not a production schema restore.
- The phone-verification Worker flow is an opt-in Telegram OIDC phone-consent flow for already-authenticated Better Auth users, not a Telegram login option. Atomic per-user cooldown, one-use callback state and expired-challenge cleanup are covered by Worker tests. It remains disabled pending owner BotFather app/callback setup, Cloudflare secrets, remote D1 migration 0005 and real hosted consent/callback acceptance.
- PR #177 remains Draft and unmerged. Production Supabase schema, users, auth settings, RLS, triggers, RPCs, Edge Functions and production login remain unchanged. Stages 4–7 remain gated in the approved order.

## Latest integration hardening — 7 November 2026

- A destination collision was found during review: the existing staging Admin-email bridge intentionally receives the production `SUPABASE_URL`, while the Better Auth provisioning module had also read that same variable. This would have sent future Better Auth provisioning/phone RPC writes to production if the opt-in flag were enabled.
- Fixed on the branch: provisioning reads only `SUPABASE_PROVISIONING_URL`, and the module allows exactly `https://ydamszdfsxqisanazdkb.supabase.co`. It rejects the production project, malformed URLs and missing staging destination, and never falls back to the legacy `SUPABASE_URL`. The Admin bridge still uses production `SUPABASE_URL` and its existing caller-context admin check.
- The `wrangler.toml` staging value is non-secret and pinned to the isolated Free project. `SUPABASE_PROVISIONING_ENABLED` remains unset and `SUPABASE_SERVICE_ROLE_KEY` has not been installed or sent to the Worker. Telegram Client ID/Secret are also not configured.
- Tests explicitly prove the production Admin URL remains present while provisioning targets only staging; missing staging URL fails before any network request and production URL is rejected. Auth Worker CI [#42337457422](https://github.com/taufx98/sykabelajar4.0/actions/runs/42337457422) succeeded on source commit `9a4f8a666eb50cdadc27eb0e8c4cb674c52add28`: **79/79 primary Worker tests**, 12 adapter tests, 15 Cloudinary ownership tests, two workflow/OIDC tests, local D1 migrations 0000–0005, OIDC/JWKS integration, Worker dry-run, and frontend lint/typecheck/build.
- The Worker deployment workflow now requires exactly 18 expected remote D1 tables including `auth_phone_verification_challenges`, verifies there are zero pending phone challenges, checks the exact staging provisioning URL, and uses marker name `.github/auth-ops/DEPLOY-STAGING-WORKER-0005`. No marker file was committed, so this update cannot trigger a deploy.
- Current deployed Worker run remains [#42328371754](https://github.com/taufx98/sykabelajar4.0/actions/runs/42328371754) from earlier source SHA `42323e092e85250f4485e2de611207310a481b34`; the newer Telegram code was tested via dry-run only and is **not live yet**. Remote D1 0005 has not been applied. The updated deployment gate is not run.
- Read-only inspection of isolated Supabase Free staging project `ydamszdfsxqisanazdkb` confirmed `private.app_users` has zero rows, all 20 public/private base tables have RLS enabled, and the three provisioning/email/phone RPC wrappers are present. Each is SECURITY DEFINER with empty `search_path`; only `service_role` can execute them. Synthetic staging fixture rows remain in other fixture tables; no staging data was deleted or changed.
- No production schema/data/Auth settings, production users, DNS, custom domains, Worker secrets, remote D1 schema, or Worker deployment were changed. PR #177 remains Draft and unmerged.

## Authoritative checkpoint — 7 November 2026 (after staging 0005 deployment and Brevo integration)

- **Current code branch/PR:** `security/auth-poc-stage-1`, PR #177 remains Draft and unmerged. The branch contains the Telegram OIDC phone verification route plus managed Brevo/ZeptoMail email support; this work is still staging-only.
- **D1 remote staging:** migrations 0000–0005 are applied to the dedicated database `sykabelajar-auth-poc` (`7a4f9008-a1c6-42b6-8a04-abde12699248`). Run [#42339140591](https://github.com/taufx98/sykabelajar4.0/actions/runs/42339140591) applied the pending Telegram challenge migration and verified 18 tables. Migration 0006 (`provider` column on encrypted email accounts, default `zeptomail`) is additive and still pending remote apply.
- **Worker staging:** latest confirmed deployment [#42339181655](https://github.com/taufx98/sykabelajar4.0/actions/runs/42339181655) is the Telegram-capable Worker at version `16b984e0-0168-42ec-af1b-aa9e91aadb54`. It passed 18-table/empty identity-state verification, health, discovery, PKCE S256, ES256/JWKS and CORS. Provider-aware email source and migration 0006 are not yet deployed.
- **Latest source CI:** [Auth Worker CI #42339610625](https://github.com/taufx98/sykabelajar4.0/actions/runs/42339610625) passed on commit `a795e6b0baf61cf7cc4399829a7f318e1f69a4ce`, including TypeScript, dependency/security tests, local D1 migration 0006, OIDC/JWKS and Worker dry-run; Cloudflare preflight [#42339610579](https://github.com/taufx98/sykabelajar4.0/actions/runs/42339610579) passed. No production deployment occurred.
- **Email decision:** new provider-aware managed sender defaults to Brevo Free in Admin, while old ZeptoMail rows remain ZeptoMail after migration 0006. Brevo Free is limited to 300 sends/day; daily quota and retry queue behavior are not bypassed. No credential has been received, committed, or installed. The owner must verify sender domain, enter Brevo API Key through the staging Admin panel, activate it and test only to their signed-in admin address.
- **Telegram:** phone verification is for an existing Better Auth session, not a login provider. The Worker route is deployed but remains disabled because BotFather OIDC credentials are absent. No phone verification was performed on a real account.
- **Stage 2:** hosted OIDC/Data API/two-user RLS acceptance is complete on isolated Supabase Free staging; Storage, Realtime and Edge Function acceptance remain uncovered. These need their own staging fixtures and a valid Better Auth access token after email signup/verification is configured.
- **Stage 3:** no production baseline or restore has been exported; production `private.app_users` is absent, 69 application FKs still reference `auth.users`, three Auth triggers remain, and 109 policies still use `auth.uid()`. No production FK, trigger, role, RLS, RPC, user or Auth configuration was changed. The owner-local database connection URI remains required for the complete schema-only baseline export; do not paste it into chat.
- **Stages 4–7:** frontend cutover, backend endpoint cutover, demo reset/admin bootstrap, and production cutover remain not started. Do not skip order or switch production login until Stage 3/4/5/6 gates and rollback rehearsal pass.
- **Production safety:** no production Supabase DDL/DML, production authentication setting, user deletion, domain/DNS change, production Worker deployment or traffic switch was performed.

## Social provider and Stage 3 preparation update — 7 November 2026

- Optional provider configuration in the Worker now includes Google, Facebook and Twitter/X. All are disabled unless both provider credentials are present as Cloudflare Worker secrets. A partial credential pair fails initialization. Instagram is intentionally not wired as ordinary consumer sign-in because Meta's current API support is professional-account scoped; do not create a fake generic provider.
- Every new Better Auth session is now blocked until the local Better Auth user row has `emailVerified=true`. Facebook is not trusted for a provider-level verified-email assertion; its address must pass the SYKABELAJAR email challenge. X must return `confirmed_email` and no placeholder email is accepted. Implicit same-email account linking remains disabled.
- Auth Worker CI [#42341602394](https://github.com/taufx98/sykabelajar4.0/actions/runs/42341602394) passed strict TypeScript, all Worker security tests, D1 local migrations 0000–0006, OIDC/JWKS, Worker dry-run and frontend build for the social provider/session gate code. Read-only staging preflight [#42341602480](https://github.com/taufx98/sykabelajar4.0/actions/runs/42341602480) passed.
- Stage 3 gained a local-only `export-live-auth-users-fk-plan.sh` helper. It is hard-bound to project ref `mvdczyitbkxkldjughor`, runs a `BEGIN READ ONLY` pg_catalog query using a mode-0600 temporary `.pgpass`, preserves requested TLS verification mode, rejects FK count/source-table drift (69 / 62), writes catalog/hash outside the repo, and invokes the review-only generator. CI now runs `bash -n` and static contract checks; the helper has not been run against production because the owner-local DB connection URI is not available to this environment.
- The 69-FK plan is per-source-table bounded for expand/validate and one global atomic cutover, with semantic/resume guards. Generated SQL remains review-only and must be compared against a fresh live catalog and a restored schema-only baseline. No SQL was executed against production.
- No production frontend/backend auth cutover, user reset, admin bootstrap, Supabase Auth signup disable, or production DDL/DML was performed.

## Stage 4 disabled frontend transport checkpoint — 7 November 2026

A disabled staging transport module was added at `src/services/betterAuthApi.client.ts` and its contract test is part of the Supabase local auth CI. It uses the custom Worker `/api/auth` routes, includes cookies, requests no-store responses, validates the UUID/email-verified session and gets the short-lived Supabase audience token without persisting it. Self-service registration is restricted to student/teacher/organizer. The module is not imported anywhere in the live app and its explicit enable flag defaults off. `AppContext`, `auth.service.ts`, all 41 Supabase Auth callsites, guest state, session subscription, 25-minute idle logout and production route are unchanged. This does not complete Stage 4 or authorize cutover.

## Stage 5 shared Edge identity adapter checkpoint — 7 November 2026

The branch now contains a common `requireApplicationUser()` resolver with an explicit allowlist for `AUTH_IDENTITY_MODE=supabase|better-auth`. `supabase` remains the default and uses the existing Supabase Auth verification path with a five-second timeout; `better-auth` is opt-in and uses the pinned `@supabase/server@1.9.2` verifier plus exact issuer/audience/UUID/PostgreSQL role/token-lifetime checks. Both provide the caller-scoped Supabase client and verified UUID. The resolver never creates a service-role client.

Seven branch Edge handlers now use it: `get-cloudinary-signature`, `cloudinary-delete-asset`, `cloudinary-profile-upload`, `cloudinary-delete-profile`, `payment-gateway-admin`, `payment-gateway-create`, and `payment-gateway-reconcile`. Payment-admin continues to call `is_active_admin()` with the caller's context before privileged settings access. Checkout/reconciliation continue to bind orders to the verified UUID. The frontend-called Cloudinary delete-profile route is now also covered. Provider webhooks and the Midtrans compatibility delegate have not been modified.

Validation passed: [Auth Worker CI #42354115154](https://github.com/taufx98/sykabelajar4.0/actions/runs/42354115154) (Worker/security/Cloudinary/payment contracts, frontend lint/typecheck/build) and [Supabase Local CI #42354068011](https://github.com/taufx98/sykabelajar4.0/actions/runs/42354068011) (Deno Edge checks, staging anonymous probe, FK dry-run generator, disposable local two-user UUID/RLS fixture). Older deployed `cloudinary-profile-upload-v2` and `cloudinary-delete-asset-v2` aliases remain unchanged; the current frontend source search found no callers, but they are not removed.

This is source-only. No Supabase Edge Function was deployed and no Better Auth mode flag was enabled. Branch `supabase/config.toml` uses `verify_jwt=false` only for the seven handlers (plus the Midtrans delegate) that call the shared fail-closed identity resolver; the legacy v2 aliases retain `true` and webhooks remain provider-signature authenticated. The handler—not the Supabase gateway—therefore performs the Supabase/Better Auth JWT verification for those migrated routes. No production secrets, SQL functions/triggers/RLS/FKs, login paths, payment settings or Cloudinary assets were touched. Keep PR #177 Draft/unmerged. Positive hosted Better Auth-token A/B tests for each endpoint, schema-compatible staging endpoint deployment, full SQL function/trigger migration, and production baseline/restore remain open.


## Authoritative reconciliation — 7 November 2026 (after hosted staging and CI recheck)

This checkpoint supersedes earlier pending statements above where later runs or live read-only checks now prove completion.

### Stage 1 — Cloudflare staging

- Dedicated D1 `sykabelajar-auth-poc` has migrations **0000–0006** applied and all **18 expected tables** verified by [D1 migration run #42339767786](https://github.com/taufx98/sykabelajar4.0/actions/runs/42339767786).
- The isolated Worker is deployed at `https://auth.sykabelajar.my.id` by [Worker staging deploy #42339805803](https://github.com/taufx98/sykabelajar4.0/actions/runs/42339805803). Hosted health, OIDC discovery, PKCE S256, ES256/P-256 JWKS and CORS checks passed.
- The staging D1 has no Better Auth users, sessions, accounts, verification records, or phone challenges. Email dispatch is deployed in managed mode but has no active Brevo/ZeptoMail sender account; real signup/reset email delivery is untested and remains fail-closed. Google, Facebook and Twitter/X credentials remain absent, so those sign-in providers remain disabled.
- Telegram phone verification is a separate opt-in phone-consent step for an already-authenticated Better Auth account, not a social-login provider. Migration 0005 and the Worker route are deployed, but the route remains disabled: BotFather OIDC app/callback registration, Worker Client ID/Secret, the isolated staging provisioning secret/enablement, and a real consent/callback test are still required.

### Stage 2 — OIDC/JWT and Supabase surface acceptance

- Hosted Custom OIDC core acceptance passed on the isolated Free project `sykabelajar-auth-staging` in [run #42328168345](https://github.com/taufx98/sykabelajar4.0/actions/runs/42328168345). The project remains separate from production.
- Data API/JWT subject and two-user ownership checks passed. Storage policy semantics and Realtime topic policy semantics passed rollback-only fixtures.
- **Still open:** a real Better Auth token has not yet completed a positive invocation of the staging Edge acceptance probe; real Storage API upload/download and a Realtime WebSocket join/broadcast have not been accepted with that token. SQL policy fixtures are not substitutes for those hosted protocol-level tests.

### Stage 3 — Supabase identity foundation

A fresh read-only production catalog check on 7 November returned PostgreSQL **17.6**, `private.app_users` **absent**, `auth.users` count **11** (count only), **69** application FKs across **62** source tables to `auth.users(id)`, **3** non-internal `auth.users` triggers, and **109** policies across **61** tables that use `auth.uid()`. Eight function bodies directly reference `auth.users`; the complete dependency inventory remains ten functions when the two trigger functions consuming `NEW/OLD` are included. No identity values, emails, credentials, or application rows were selected.

- Hosted synthetic tests passed **80/80** FK/provisioning/referral assertions and **26/26** phone/organizer assertions. They run against a deliberately reduced schema and roll back their test mutations; they do not establish a full production-schema restore.
- Read-only staging recheck confirms `private.app_users` has **0 rows** and the Better Auth phone-verification wrapper is executable by `service_role`, not `anon`. The staging fixture is isolated from the live production identity tables.
- **Still blocking completion:** the owner's production schema-only export has not been produced; a disposable full-schema restore has not been proven; and production-shaped regression is still needed for all ten Auth-dependent functions, three Auth triggers, four `profiles` triggers and its 36-column shape, referral activity/competition registration behavior, all 69 FK relationships, and the 109 `auth.uid()` policies.
- Continue to use `scripts/auth-migration/export-schema-baseline.sh` from the owner's trusted machine. Keep the database URI private. The dump and custom Auth/Storage diff must remain outside Git until reviewed; restore only into a disposable local PostgreSQL/Supabase environment. The FK generator remains review-only and no generated SQL may be executed against production in this preparation stage.

### Stages 4–7

- **Stage 4:** disabled Better Auth frontend transport exists, but is not imported into the app. All **41** direct `supabase.auth` callsites, `AppContext`, `auth.service.ts`, session subscription, guest state and idle logout remain on the current Supabase Auth path. No session coordinator or callsite migration is complete.
- **Stage 5:** the shared fail-closed `requireApplicationUser()` resolver and seven source handlers are present on the branch. `AUTH_IDENTITY_MODE=supabase` remains the default; `better-auth` is opt-in only. No application Edge Function has been deployed from this branch and no Better Auth mode flag has been enabled. Positive hosted Better Auth-token/IDOR tests for every affected handler and a deployment review remain required.
- **Stage 6:** demo-account classification/reset, admin bootstrap and end-to-end regression have not started.
- **Stage 7:** production cutover, monitoring and rollback rehearsal have not started.

### Current CI and PR safety

- [Auth Worker CI #42354587388](https://github.com/taufx98/sykabelajar4.0/actions/runs/42354587388) and [Supabase Local Auth Claims CI #42354587327](https://github.com/taufx98/sykabelajar4.0/actions/runs/42354587327) both passed. They tested code at `345e641d50b39a81722302e79f66839d4e5460d2`; the three commits between that SHA and the then-current PR head `d434e3a` changed documentation only.
- PR #177 remains **open, Draft and unmerged**. GitHub still reports it as non-mergeable/dirty against `security/auth-migration-phase-0`. Do not force-merge or cut over; base reconciliation and all seven acceptance gates remain mandatory.
- No production Supabase schema/data/Auth setting, production Worker/DNS, frontend login, Edge Function deployment, payment configuration or Cloudinary asset was changed by this checkpoint.


### Automated Stage 3 baseline execution checkpoint — 7 November 2026

- Added [Auth Production Schema Baseline](../../.github/workflows/auth-schema-baseline.yml) so export and restore can run on GitHub-hosted infrastructure; the user does not need to run Supabase CLI locally.
- The exporter uses Supabase CLI 3.0.0 explicit remote mode. Its `psql` metadata checks use a temporary mode-0600 `.pgpass` file and do not pass the URI to `psql` as an argument. The Supabase CLI itself necessarily receives the remote URI via its `--remote=<uri>` option; the URI is supplied only from a GitHub Actions secret in the ephemeral runner, shell tracing is disabled, and no output artifact or schema file is uploaded/committed.
- [Supabase Local Auth Claims CI #42362719147](https://github.com/taufx98/sykabelajar4.0/actions/runs/42362719147) passed all steps, including updated exporter contract checks, Edge/Deno type checks, live-FK plan dry run, and disposable local UUID/two-user RLS tests.
- The latest baseline workflow attempts [#42363608649](https://github.com/taufx98/sykabelajar4.0/actions/runs/42363608649), [#42363732195](https://github.com/taufx98/sykabelajar4.0/actions/runs/42363732195), and [#42363773685](https://github.com/taufx98/sykabelajar4.0/actions/runs/42363773685) all stopped at the secret-format preflight: `SUPABASE_DB_URL` exists, but its value is not a raw PostgreSQL URI. No production database connection was opened; export/restore steps were skipped. The value remained masked.
- **Only remaining owner action for the full baseline:** edit the existing repository secret `SUPABASE_DB_URL` and set its value to the entire raw Session pooler URI copied from Supabase Connect (port 5432, username `postgres.mvdczyitbkxkldjughor`, exact host ending `.pooler.supabase.com`). Store only the URI, not a database password by itself, not `SUPABASE_DB_URL=...`, and not a command wrapper. Do not share the URI/password in chat. Once corrected, workflow execution and verification can continue without terminal/CLI work.

Stage 3 is therefore still open. The production database remains read-only/unchanged by this migration activity: no production schema/data/Auth/role/ACL changes have been applied.


## Superseding Stage 3 production-baseline checkpoint — 7 November 2026

This checkpoint supersedes earlier entries in this document that said the production schema-only baseline/export was still missing or required owner-local CLI work.

- Auth Production Schema Baseline run #42367689543 completed successfully. GitHub Actions used the repository secret for a read-only production schema export, captured the custom Auth/Storage DDL diff, restored both into an empty disposable local Supabase stack, checked the structural inventory, stopped the local stack and removed temporary export files.
- Verified baseline counters: 69 application FKs across 62 source tables; 3 non-internal auth.users triggers; 4 public.profiles triggers; 36 profile columns; 109 auth.uid() RLS policies; 10 Auth-dependent application functions; 0 auth.users rows and 0 public.profiles rows imported.
- A stricter verifier and negative contract tests have been added. The verifier compares every restored FK's name, source/target schema-table-column mapping, ON DELETE, ON UPDATE, validation, match type and deferrability against the reviewed metadata snapshot. The contract tests, repeat export/restore, exact 69/69 FK comparison, stack stop and temporary-file cleanup all passed in run #42370809198.
- The schema dump is not uploaded as an artifact or committed. No production DDL/DML, identity row, role, policy, trigger, function, Auth setting or login route was changed. Production private.app_users remains absent.
- Still open: production-shaped regression of Auth-dependent functions, Auth/profile triggers, referral and organizer paths, and the 109 auth.uid() policies; end-to-end Telegram phone-consent acceptance; review of the resumable/atomic FK migration plan; and rollback rehearsal. Stage 3 is not complete and production must remain unchanged until these gates pass.

## Superseding production-shaped Stage 3 regression checkpoint — 7 November 2026

This section supersedes earlier entries in this document that said the schema-only production export/restore or core production-shaped regression was still missing.

Verified on disposable restore:
- [Run #42378450476](https://github.com/taufx98/sykabelajar4.0/actions/runs/42378450476) completed full export/restore, exact 69/69 FK comparison, 10-function ACL parity, function/trigger/RLS/profile metadata parity, local-only create_organizer ambiguity fix, and core rollback-only behavior regression successfully.
- [Run #42379192223](https://github.com/taufx98/sykabelajar4.0/actions/runs/42379192223) repeated the baseline with a database-provisioned synthetic admin and passed owner/admin/anon checks for role visibility, audit logs, organizer update, public/private profile access and the existing referral/organizer/competition behavior.
- [Run #42379195281](https://github.com/taufx98/sykabelajar4.0/actions/runs/42379195281) passed local Edge/Auth/Cloudinary checks, FK plan dry-run, and two-user JWT ownership RLS.
- The create_organizer forward migration exists in source but is applied only to the disposable restore during this workflow. Its two SQL name qualifications do not alter the business rules. Production has not received the migration.
- All test identities, order/referral/organizer/competition fixtures and role assignments were synthetic and rolled back. The local Supabase stack was stopped and temporary exports deleted.

Current expanded test in progress: [Baseline #42379783008](https://github.com/taufx98/sykabelajar4.0/actions/runs/42379783008) adds commerce owner/admin checks (orders, order_items, payment_intents, payment_events, shipments), canonical individual participant/attempt access, and teacher-owned external roster visibility. [Local CI #42379783126](https://github.com/taufx98/sykabelajar4.0/actions/runs/42379783126) passed its code/contract checks and local JWT/RLS setup; do not count the new production-shaped cases as passed until #42379783008 succeeds.

The representative regression still does not prove every one of the 109 RLS policies across 61 tables. Remaining coverage includes answers, collective exams, certificates/certificate assets/awards, organizer active/inactive member and unrelated-organizer isolation, remaining admin-gated application tables, commerce reviews/wishlist/entitlements, and additional public/content policies. See AUTH-RLS-POLICY-TEST-MATRIX.md.

Production boundary remains unchanged. private.app_users has not been created in production; the 69 Auth FKs have not been rehomed; production Auth/profile triggers, functions, RLS, users, issuer, login flow and Edge deployments have not been changed. The generated FK migration plan remains review-only, with no SQL applied to production. No production cutover or account reset has occurred.

Stages 2, 4–7 still retain independent gates. Stage 4 has not migrated the 36 remaining direct frontend Auth callsites. Stage 5 positive hosted Better Auth-token/IDOR tests and deployment remain open. Stage 6 account classification/reset and rollback rehearsal are not started. Stage 7 production cutover/monitoring/rollback is not started.

PR #177 remains Draft, open, unmerged, and dirty against security/auth-migration-phase-0. Do not force-merge, change the base blindly, or cut over until reviewed three-way base reconciliation and all remaining acceptance gates pass.



## Expanded production-shaped RLS regression — 7 November 2026

[Auth Production Schema Baseline #42379783008](https://github.com/taufx98/sykabelajar4.0/actions/runs/42379783008) completed successfully on the production schema-only disposable restore. In addition to the previously passing Auth/referral/organizer/competition/admin checks, it validated:
- Commerce: order owner can read their order, line item, payment intent and shipment; unrelated users cannot read the rows; payment events remain admin-only; admin can read/update the allowed commerce/payment metadata.
- Exams: an individual participant can read their canonical participant record and active attempt; unrelated users cannot read the attempt; admin can read it.
- Teacher rosters: the teacher owner can read the roster and its external roster entry; an unrelated student cannot; admin can read both.
- The fixed synthetic UUIDs passed collision checks, the regression transaction rolled back, local Supabase was stopped, and temporary schema files were removed.
- Matching [Supabase Local Auth Claims CI #42379783126](https://github.com/taufx98/sykabelajar4.0/actions/runs/42379783126) passed.

This raises representative policy-family coverage; it does not establish that all 109 policies across 61 tables are behaviorally proven. Organizer active/inactive member separation and remaining certificates/answers/collective/public-content policies still need explicit cases. Production identity/FK/RLS/issuer/login state remains unchanged.


## Latest Stage 3 validation checkpoint — 8 November 2026

The most recent complete disposable acceptance is [Auth Production Schema Baseline #42398676006](https://github.com/taufx98/sykabelajar4.0/actions/runs/42398676006), which passed all workflow steps. It applies the Stage 3 identity-root and issuer drafts only to a full schema-only production restore, simulates all 69 FK phases, runs identity/referral/email/phone/organizer acceptance and the RLS/issuer regression, then stops the local stack and deletes the temporary schema export. No production statement was executed.

Read-only production recheck on 8 November 2026: `private.app_users` absent; 69 application FKs still target `auth.users(id)`; 3 non-internal `auth.users` triggers remain. Existing Auth records and application data were not changed.

The isolated Free staging project has zero `private.app_users` rows. It now denies `service_role` direct privileges on `private.app_users` and execution of the private Better Auth provisioning/verification helpers; only the public SECURITY DEFINER wrappers remain executable. A rollback-only staging transaction proved those public provisioning, email-verification and phone-verification wrappers continue to work under the reduced access.

The only production Stage 3 blocker is the controlled application window itself: final read-only preflight, approved rollback window, explicit owner approval, then production DDL/FK/issuer work. Do not run the generated plan or apply the draft until that approval is received.


## Continuation checkpoint — 8 November 2026 (code snapshot 82c4986; password-change adapter and integration accepted)

This checkpoint supersedes the older Stage 4 progress counts and any earlier statement that the Stage 3 production-schema baseline/restore had not been completed. It records the state verified during the 8 November continuation. It does not authorize production cutover.

### Latest CI for the password-change code snapshot

- [Auth Worker CI #518](https://github.com/taufx98/sykabelajar4.0/actions/runs/42462936271) passed on code head `82c4986c8530e838880d59b2f51d215fa7d7e480`. It includes Worker security/typecheck, all local D1/OIDC and password-change integration tests, frontend dependency inventory, frontend lint/typecheck/build, and a Worker dry run without deployment.
- [Auth Cloudflare Staging Preflight #163](https://github.com/taufx98/sykabelajar4.0/actions/runs/42462936143) passed on the same code head. This was a read-only resource preflight; it did not deploy the Worker or alter staging resources.
- [Supabase Local Auth Claims CI #344](https://github.com/taufx98/sykabelajar4.0/actions/runs/42459904314) remains the last completed pass for the unchanged Supabase Edge/SQL contract surface.
- PR #177 remains Draft/unmerged and its base relationship remains dirty. Keep Better Auth disabled in production; do not force-merge.

### Stage 1 — isolated Worker, email, and provider activation

- The isolated Cloudflare D1/Worker deployment and migrations 0000–0006 remain the staging baseline; do not point this Worker or D1 binding at production.
- The Worker uses the managed email dispatcher with ZeptoMail support, but the latest recorded staging state has no active Brevo/ZeptoMail sender account. Real signup verification and password-reset delivery therefore remain unaccepted and fail closed. The owner must configure a verified sender and encrypted Agent Send Mail Token through the staging Admin settings, then run the email test only to the signed-in admin account.
- Google/Facebook/X credentials remain optional and absent in the last confirmed staging inventory. Telegram is only a separate phone-consent step; BotFather OIDC registration, callback allowlisting, Worker credentials, and a real hosted consent/callback test remain outstanding. Instagram personal-account login is not wired as an ordinary OAuth provider.

### Stage 2 — OIDC/JWT and Supabase service surfaces

- Hosted Custom OIDC acceptance [#42328168345](https://github.com/taufx98/sykabelajar4.0/actions/runs/42328168345) passed on the isolated Free Supabase project: discovery/PKCE S256, ES256/P-256 JWKS, authorization-code exchange, resource audience and UUID subject, short token lifetime, Data API acceptance, two-user RLS isolation, signature-tamper rejection, and session-bound UserInfo invalidation.
- The read-only staging probe `better-auth-oidc-acceptance` is ACTIVE (version 1) on the isolated project. Its handler verifies the external token with pinned `@supabase/server@1.9.2`, enforces exact issuer/audience/UUID/role/lifetime, and only reads the caller's synthetic fixture row.
- **Still open:** no positive hosted invocation of that Edge probe with a real Better Auth token; no Storage HTTP upload/download with that token; and no Realtime WebSocket private-topic join/broadcast with that token. Previous SQL/RLS fixtures are not substitutes for those protocol-level tests.
- Read-only staging inventory on 8 November found two retained synthetic OIDC fixture rows, zero `private.app_users` rows, zero objects/bucket under the reserved `auth-stage2-proof` acceptance name, and no leftover `better_auth_stage2_*` Storage or Realtime policies. No test bucket or temporary policy was created during this continuation.

### Stage 3 — production identity foundation

- [Auth Production Schema Baseline #42398676006](https://github.com/taufx98/sykabelajar4.0/actions/runs/42398676006) passed the full schema-only export/restore and disposable production-shaped acceptance. It compared the 69 application FKs, triggers, profile shape, ACLs and 109 auth.uid() policies, simulated the identity-root/issuer/FK plan on the disposable restore, and cleaned up the temporary environment.
- The 8 November read-only production recheck still found no production `private.app_users`, all 69 application FKs still referencing `auth.users(id)`, and the three non-internal Auth triggers still present. The isolated staging identity projection remains empty.
- The identity-root/backfill, legacy trigger bridge, 69-FK rehome and restrictive issuer guard are still draft changes only. **Do not execute production DDL/FK/issuer changes without a separately approved maintenance window, explicit owner approval, and final preflight/rollback review.** No production DDL/DML, app data, Auth settings, secrets, issuer, Worker, or login route was changed in this continuation.

### Stage 4 — frontend preparation, not cutover

- The current [frontend migration inventory](AUTH-FRONTEND-MIGRATION-INVENTORY.md) records **17 direct `supabase.auth` callsites across five files** as of 8 November, not the older 36/41 counts above.
- Nine identity-only lookup paths now use the shared provider-neutral identity accessor. AppContext remains the single owner of provider subscription, hydration, guest behavior, cache invalidation, and the 25-minute idle logout contract. The app-owned auth service and session-event bridge remain the only session coordination layer.
- The typed Better Auth HTTP transport and in-memory short-lived resource-token broker are prepared behind an explicit preview-only flag bound to the isolated staging Supabase project. Supabase Auth remains the production/default provider; no production login path was switched.
- `ProfileInterfaceSettingsPage` no longer calls Supabase Auth directly for password changes. It uses provider-neutral `auth.service.updatePassword()`: production/default Supabase mode keeps its previous `updateUser` behavior; the Better Auth preview requires the current password, calls `/change-password` with `revokeOtherSessions=true`, and clears the short-lived cached resource token. The local Worker integration test verifies incorrect current password rejection, successful password change, rejection of the old password, revocation of a second device session, and continued use of the active session/cookie. OAuth accounts without a credential password must use the existing email “Lupa Password” flow; real reset-email delivery remains blocked until the staging sender is configured.
- Remaining direct calls have different responsibilities and must not be replaced mechanically: core credential/session wrappers, organizer email/phone verification, and the legacy private-chat service/Admin Chat Console. The chat callsites are not a feature to migrate; preserve the separate decision to retire private chat rather than carry it into Better Auth. Organizer phone verification remains gated on the trusted Telegram consent/projection path.
- The temporary typed fetch transport remains an explicit staging scaffold; a final SDK/transport decision and full UX regression are still required before cutover.

### Stage 5 — backend preparation, not deployment

- The shared fail-closed `requireApplicationUser()` resolver and seven Cloudinary/payment handler adaptations remain branch-only. `AUTH_IDENTITY_MODE=supabase` remains the default; `better-auth` is opt-in only.
- No production Edge Function was deployed and no production mode flag changed. Hosted positive Better Auth-token and two-user IDOR acceptance for the affected handlers, schema-compatible staging deployment, and a separate endpoint deployment review remain open.

### Stages 6–7 — reset and production

- Account classification/reset, admin bootstrap, full end-to-end regression, production monitoring, cutover, and rollback rehearsal remain not started.
- Preserve PR #177 as Draft/unmerged until Stage 2 service-surface acceptance, controlled Stage 3 production approval, Stage 4/5 acceptance, base reconciliation, and rollback gates are all complete.
