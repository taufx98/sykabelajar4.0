# Better Auth migration — live readiness and rollback record

Status date: 6 November 2026  
Scope: SYKABELAJAR 4.0, production Supabase project `mvdczyitbkxkldjughor`, isolated Better Auth branch `security/auth-poc-stage-1`.

This is a verified status record, not authorization to deploy or migrate production. The isolated staging Worker deployment succeeded on 6 November 2026 (run [#42190609080](https://github.com/taufx98/sykabelajar4.0/actions/runs/42190609080)); its hosted smoke test verified `/healthz`, OIDC discovery, exact issuer, endpoint hostnames, PKCE S256, and a public ES256 P-256 JWKS key. The Worker is live at `auth.sykabelajar.my.id` and bound to the dedicated D1. No production DDL/DML, production auth-provider configuration, account deletion, production DNS/route change, production Worker deployment, or real email sending was performed

## Executive status

| Stage | Completed locally | Still blocking completion |
|---|---|---|
| 1. Cloudflare foundation | Dedicated remote D1 has all 17 Better Auth tables; Worker deployment [#42190609080](https://github.com/taufx98/sykabelajar4.0/actions/runs/42190609080) succeeded, hosted health/discovery/JWKS pass, and latest Pages branch preview is green at [the staging preview](https://security-auth-poc-stage-1.sykabelajar4.pages.dev). | Deploy the latest exact preview Origin allowlist to the Worker and pass CORS allow/deny smoke test; configure/test ZeptoMail Agent from Admin settings (no real email sent yet); optional Google OAuth and interactive session/email callbacks remain untested. See [staging deploy runbook](AUTH-CLOUDFLARE-STAGING-WORKER-DEPLOY-RUNBOOK.md) |
| 2. OIDC and JWT | Authorization Code + PKCE S256, RFC 9207 issuer response, ES256, discovery/JWKS, UUID `sub`, PostgreSQL `role=authenticated`, five-minute access token/no refresh token and negative security tests pass locally. Hosted smoke test [#42190609080](https://github.com/taufx98/sykabelajar4.0/actions/runs/42190609080) verified discovery issuer `https://auth.sykabelajar.my.id/api/auth`, PKCE S256 and public ES256 P-256 JWKS. | Supabase Custom OIDC acceptance, `auth.uid()`, Data API/Storage/Realtime/Edge Function and two-user IDOR tests remain blocked by no isolated Free Supabase project; no production issuer registration. See [Stage 2 acceptance runbook](AUTH-STAGE-2-OIDC-ACCEPTANCE-RUNBOOK.md) |
| 3. Supabase identity | Live metadata inventory, exact 69-FK catalog comparison, identity/referral/verification design and 83/83 local pgTAP fixture tests | Complete schema-only baseline not exported; `private.app_users` absent; no executable production identity/FK/trigger/RPC migration; organizer phone-verification replacement not available |
| 4. Frontend | ZeptoMail Admin settings panel and read-only frontend auth dependency inventory are in branch; frontend CI passes | Main app still uses Supabase Auth. 41 direct auth callsites across 22 frontend files remain to be migrated. Core session/event integration, token broker, email/password/phone verification and profile/role hydration are not started. See [AUTH-FRONTEND-MIGRATION-INVENTORY.md](AUTH-FRONTEND-MIGRATION-INVENTORY.md). |
| 5. Backend | Full live audit now covers nine identity/ownership-sensitive user-facing Edge Function implementations (six Cloudinary + three payment), plus the Midtrans delegate; four call `auth.getUser()`, four call `/auth/v1/user`. Pinned Better Auth JWT adapter, opt-in provisioning hooks and local Cloudinary ownership guards/tests are in the branch. | No endpoint has switched to Better Auth JWT verification. The deployed `cloudinary-delete-asset` v9 only checks that a Bearer token exists and lacks owner UUID binding; a source-only replacement now performs UUID ownership checks but has not been deployed. Database functions/triggers and RLS policies remain unchanged. Two-user hosted IDOR tests and Custom OIDC acceptance remain blocked until isolated hosted Supabase and Stage 3 identity projection are ready. See [Edge Function migration matrix](AUTH-EDGE-FUNCTION-MIGRATION-MATRIX.md). |
| 6. Reset and full testing | Cleanup rules and synthetic provisioning tests prepared | No demo identity has been confirmed or deleted; no admin bootstrap; full feature/IDOR/Realtime test matrix and rollback rehearsal not run |
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
