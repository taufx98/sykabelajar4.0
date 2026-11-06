# Better Auth migration — live readiness and rollback record

Status date: 6 November 2026  
Scope: SYKABELAJAR 4.0, production Supabase project `mvdczyitbkxkldjughor`, isolated Better Auth branch `security/auth-poc-stage-1`.

This is a verified status record, not authorization to deploy or migrate production. The isolated staging Worker deployment succeeded on 6 November 2026 (run [#42190609080](https://github.com/taufx98/sykabelajar4.0/actions/runs/42190609080)); its hosted smoke test verified `/healthz`, OIDC discovery, exact issuer, endpoint hostnames, PKCE S256, and a public ES256 P-256 JWKS key. The Worker is live at `auth.sykabelajar.my.id` and bound to the dedicated D1. No production DDL/DML, production auth-provider configuration, account deletion, production DNS/route change, production Worker deployment, or real email sending was performed

## Executive status

| Stage | Completed locally | Still blocking completion |
|---|---|---|
| 1. Cloudflare foundation | Dedicated remote D1 has all 17 Better Auth tables; Worker deployment [#42190609080](https://github.com/taufx98/sykabelajar4.0/actions/runs/42190609080) succeeded and hosted `/healthz` confirms D1 connectivity. Custom auth hostname is live. | Configure/test ZeptoMail Agent from Admin settings (no real email sent yet); optional Google OAuth credentials/callback remain untested. See [staging deploy runbook](AUTH-CLOUDFLARE-STAGING-WORKER-DEPLOY-RUNBOOK.md) |
| 2. OIDC and JWT | Authorization Code + PKCE S256, RFC 9207 issuer response, ES256, discovery/JWKS, UUID `sub`, PostgreSQL `role=authenticated`, five-minute access token/no refresh token and negative security tests pass locally. Hosted smoke test [#42190609080](https://github.com/taufx98/sykabelajar4.0/actions/runs/42190609080) verified discovery issuer `https://auth.sykabelajar.my.id/api/auth`, PKCE S256 and public ES256 P-256 JWKS. | Supabase Custom OIDC acceptance, `auth.uid()`, Data API/Storage/Realtime/Edge Function and two-user IDOR tests remain blocked by no isolated Free Supabase project; no production issuer registration. See [Stage 2 acceptance runbook](AUTH-STAGE-2-OIDC-ACCEPTANCE-RUNBOOK.md) |
| 3. Supabase identity | Live metadata inventory, exact 69-FK catalog comparison, identity/referral/verification design and 73/73 local pgTAP fixture tests | Complete schema-only baseline not exported; `private.app_users` absent; no executable production identity/FK/trigger/RPC migration; organizer phone-verification replacement not available |
| 4. Frontend | ZeptoMail Admin settings panel is implemented and frontend CI passes | Main app still uses Supabase Auth; Better Auth client/token adapter and global session integration not started |
| 5. Backend | Four dependent Edge Functions and ten auth-dependent database functions inventoried; RLS/business-role architecture documented | No Edge Function/RPC/trigger migration; SECURITY DEFINER authorization and issuer review remains open |
| 6. Reset and full testing | Cleanup rules and synthetic provisioning tests prepared | No demo identity has been confirmed or deleted; no admin bootstrap; full feature/IDOR/Realtime test matrix and rollback rehearsal not run |
| 7. Production | No production cutover attempted | Worker/domain/OIDC/monitoring/cutover/sign-up restriction remain unconfigured |

## Stage 1 — Cloudflare and ZeptoMail

### What was verified

Historical read-only Cloudflare snapshots below are superseded by the latest recheck and guarded deployment attempt recorded in the 6 November update at the end of this document.

- This section records an earlier 5 November permission snapshot. It was superseded by the 6 November token recheck: D1 listing now succeeds; the dedicated database has been created and migrated; `wrangler.toml` now contains its real isolated UUID. The current missing permission is the initial Worker creation/Custom Domain path, not D1 Read.

### Required permission correction

Update the existing Cloudflare API token in the Cloudflare Dashboard, then replace the GitHub Actions secret `CLOUDFLARE_API_TOKEN` without pasting the token into chat. Use resource-scoped permissions for the single account and zone:

- **Preflight/read-only D1 inspection:** Account — D1: Read.
- **Create/migrate the dedicated auth D1:** Account — D1: Edit (or the UI's current D1 write equivalent).
- **Deploy/update the auth Worker:** Account — Workers Scripts: Edit (or Write in the UI's current permission naming). To create a brand-new Worker script, Cloudflare's Workers authorization guide says product-level Admin may be required; avoid broad account Admin by creating the empty script once in the dashboard, then use Editor for automated updates where possible.
- **Custom hostname/route:** Zone — Workers Routes: Edit/Write for `sykabelajar.my.id`; Zone — Zone: Read; Zone — DNS: Edit/Write only if the deployment flow must create/manage the hostname's DNS record.
- Keep `CLOUDFLARE_ACCOUNT_ID` scoped to the same account.

Do not grant Super Administrator or unrelated account-wide permissions. Cloudflare's permission names can appear as Edit or Write depending on the current UI/API generation; select the matching resource-level scope, not an all-account role. After updating the secret, rerun the read-only preflight. Only then create one dedicated D1 database, bind its returned UUID, apply migrations 0000–0003, provision Worker secrets, deploy the isolated auth Worker, and attach `auth.sykabelajar.my.id`. Do not use the production frontend or existing production Worker as the auth origin.

Official permission references: [API token permissions](https://developers.cloudflare.com/fundamentals/api/reference/permissions/) and [Workers roles and permissions](https://developers.cloudflare.com/workers/authorization/).

### ZeptoMail

The ZeptoMail implementation is local-code complete and passes Worker CI. The admin interface is under Admin → Pengaturan → Email Transaksional · ZeptoMail.

The guarded deployment workflow will generate a stable `AUTH_EMAIL_ENCRYPTION_KEY` for this staging Worker and set the Supabase publishable-key/session-verification bridge variables (never a service-role key). Once it is deployed, add the verified ZeptoMail Agent and Send Mail Token through the admin panel. Keep the token server-side and encrypted in D1. The test button sends only to the signed-in admin's own email and can consume existing ZeptoMail credits. Do not purchase credits or enable auto top-up as part of this migration.

## Stage 2 — Supabase Custom OIDC blocker

The local OIDC/JWT implementation has passed Auth Worker CI [#42179192864](https://github.com/taufx98/sykabelajar4.0/actions/runs/42179192864), including the RFC 9207 authorization-response issuer check, UUID-subject format assertion, local Worker/D1 integration and frontend checks. Hosted acceptance is still not complete: the staging Worker deploy is blocked by Cloudflare authorization and the Supabase account has no available isolated Free project. The exact provider and token contract is recorded in [AUTH-STAGE-2-OIDC-ACCEPTANCE-RUNBOOK.md](AUTH-STAGE-2-OIDC-ACCEPTANCE-RUNBOOK.md).

The production Supabase organization is on the Free plan. The project creation quote returned **US$0/month**, but the create request was rejected with the account's maximum of two active Free projects reached. No project was created, paused, deleted, or upgraded. The organization currently has no development branches.

Do not register the staging issuer against production. Once a genuine isolated Free Supabase project is available, add Custom OIDC there through Dashboard or Management API (the current Supabase docs explicitly state Custom OIDC is unavailable in Supabase CLI). Validate accepted and rejected JWT cases, `auth.uid()`, Data API, Storage, Realtime, Edge Functions and two-user IDOR before proceeding.

Supabase's current third-party auth documentation states the provider must expose HTTPS OIDC discovery, asymmetric signing with a `kid`, and a JWT `role` claim. Supabase currently cannot disable the Auth service entirely; Stage 7 can disable public sign-up, not the Auth service itself.

## Stage 3 — latest production identity catalog

Latest read-only recheck on 5 November 2026 confirmed:

- `private.app_users` does not exist.
- `auth.users` contains 10 rows. These have not been classified as demo/test identities and none were deleted.
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

The current 10 rows in `auth.users` are a count only; no identifying data was exported or inspected in this audit. Before deletion, classify each identity as disposable demo/test or required, produce a dry-run of dependent rows across the exact 69 FKs, review the plan, preserve official competition/order/payment/business records, and capture an auditable backup. Do not treat every current `auth.users` row as disposable by assumption.

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
