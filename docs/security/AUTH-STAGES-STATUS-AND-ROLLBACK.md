## Latest checkpoint — 12 November 2026 (owner Stage 4 acceptance, Stage 2 test panel, live Stage 3/5 audit)

This checkpoint supersedes earlier Stage 2/4/5 readiness notes below where they conflict. It records verified branch/CI state and read-only Production catalog checks; it does not authorize cleanup, PR merge, or Production cutover.

- **Stage 4 owner acceptance:** the owner confirms refresh/session restoration, account switching, and cross-tab logout work on staging without issue. These accepted scenarios are closed; do not ask the owner to repeat them. Session expiry/re-authentication, Realtime re-authentication/renewal, and D1/Worker quota-recovery UX remain separate open checks.
- **Stage 2 acceptance harness:** staging migration `20261112083847_better_auth_stage2_storage_realtime_acceptance` is applied to isolated Free project `ydamszdfsxqisanazdkb`. The bucket `auth-oidc-acceptance` is private; four Storage policies restrict objects to the caller UUID folder; two Realtime Broadcast policies scope private topics to `auth-oidc-acceptance:<UUID>`. The fixture is for authentication testing only; Cloudinary remains the canonical application media store.
- **Stage 2 Admin panel:** `src/components/admin/BetterAuthAcceptancePanel.tsx` is mounted under Admin → Pengaturan and now refuses to render outside the exact hostname `staging.sykabelajar.my.id`. It runs four checks with the currently signed-in Better Auth session: Data API/profile/role and foreign-row isolation; private Storage upload/download/foreign-folder denial with cleanup; private Realtime Broadcast echo/foreign-topic denial; and the read-only staging Edge OIDC probe. It never displays or copies tokens and requires the probe to report `read_only=true` and `production_touched=false`.
- **Stage 2 owner action remains open:** the positive real-session checks have not yet been run. Sign in to the staging Admin account, open `https://staging.sykabelajar.my.id/admin/core?tab=settings`, and click **Jalankan tes** under **Uji Penerimaan Better Auth — Staging**. The temporary Storage object is cleaned and Realtime subscriptions are removed. This is the one owner-browser action CI cannot perform.
- **Latest code validation:** branch head before this documentation update was `b8153cea39fb6e855dfeb5db5fac39b571d9728c`. Auth Worker CI [#43190230041](https://github.com/taufx98/sykabelajar4.0/actions/runs/43190230041) and [#43190241948](https://github.com/taufx98/sykabelajar4.0/actions/runs/43190241948) passed frontend lint/typecheck/build, Worker audit/typecheck/tests, and the new Stage 2 panel contract. Supabase Local Auth Claims CI [#43190241561](https://github.com/taufx98/sykabelajar4.0/actions/runs/43190241561) passed local Supabase migration replay, JWT/RLS checks and function/Edge contracts. Cloudflare Pages check [#131087833298](https://github.com/taufx98/sykabelajar4.0/runs/131087833298) succeeded. These checks validate the harness and build, not the unperformed owner-run positive real-token test.
- **Stage 3 Production identity inventory:** read-only revalidation confirms 69/69 application FKs across 62 tables match the committed snapshot exactly (42 CASCADE, 18 SET NULL, 8 NO ACTION, 1 RESTRICT); 109 `auth.uid()` policies across 61 tables (108 public, one private); 189 SQL functions directly referencing `auth.uid()`; eight function definitions directly referencing `auth.users`; and three non-internal triggers on `auth.users`. Production `private.app_users` is still absent. The eight direct references and all three trigger names/functions are recorded in `AUTH-IDENTITY-DEPENDENCY-INVENTORY.md`; the wider lifecycle inventory still includes adjacent email-verification trigger dependencies.
- **Stage 5 Production security inventory:** the latest Security Advisor reports 23 RLS-enabled tables with no policies, 46 public-schema `SECURITY DEFINER` functions executable by `anon`, 202 executable by `authenticated`, and leaked-password protection disabled. These require per-table/per-function review, not blanket policy creation, EXECUTE revocation, or conversion to `SECURITY INVOKER`; several public/collective portal endpoints deliberately use their own token-based checks. Nine Cloudinary/payment handler changes remain source/CI-verified; the auth-only staging schema lacks the full application business schema/secrets, so per-handler real-token two-user IDOR and payment/business regression are not yet hosted-accepted.
- **Stage 6:** the isolated staging project already has exactly one active Admin role, one Better Auth application identity, one profile and one settings row, with zero shadow `auth.users` rows. Do not rerun the first-admin bootstrap. No demo/test account has been reset; eligible demo identities and dependent test rows have not been positively identified/approved.
- **Stage 7:** Production cutover remains blocked. Production `private.app_users`, FK rehome, auth-trigger/referral/RPC migration, real-token Storage/Realtime/Edge acceptance, Stage 5 hosted IDOR/regression, Stage 6 full business regression and rollback rehearsal are incomplete. No Production SQL, user, Edge Function, secret, DNS, Pages, auth-routing, or schema change was performed.
- PR #177 remains open, Draft and unmerged. The temporary email-verification bypass remains staging-only. Real email delivery and Google OAuth remain deferred by owner instruction.

---

## Latest checkpoint — 12 November 2026 (Stage 2 acceptance harness and Stage 3–7 readiness)

This checkpoint records the owner's Stage 4 acceptance, current read-only Production identity inventory, staging-only Storage/Realtime fixtures, and the staging Admin acceptance panel. It does not authorize account cleanup, PR merge, or Production cutover.

- **Stage 4 owner acceptance:** the owner reports that session restore after refresh, account switching, and cross-tab logout have been tried on staging and work without issue. Treat those owner-tested scenarios as accepted; do not ask the owner to repeat them. This is not a claim that every email callback, expiry, or real-mail path has been exercised.
- **Stage 2 test harness:** migration `20261112083847_better_auth_stage2_storage_realtime_acceptance` is applied to the isolated Free Supabase staging project `ydamszdfsxqisanazdkb`. It creates one private `auth-oidc-acceptance` Storage bucket with four owner-folder policies and two private Realtime Broadcast policies scoped to `auth-oidc-acceptance:<Better Auth UUID>`. The bucket is an authentication test fixture only; Cloudinary remains the canonical application media store.
- **Stage 2 owner-run panel:** `src/components/admin/BetterAuthAcceptancePanel.tsx` is mounted under Admin → Settings. With an active Better Auth staging session it runs four checks without displaying or copying tokens: (1) Better Auth subject, Supabase Data API profile/role and synthetic foreign-row isolation; (2) private Storage upload/download and denial of a foreign UUID folder, followed by cleanup; (3) private Realtime Broadcast join/echo and denial of a foreign UUID topic; and (4) the deployed read-only OIDC Edge acceptance probe. The real-token positive checks have **not yet been run**; the owner needs to click **Jalankan tes** once while logged in as the staging admin.
- **Fixture verification:** read-only staging SQL confirms exactly one private acceptance bucket, zero remaining probe objects, four Storage acceptance policies, two Realtime acceptance policies, and RLS enabled on `realtime.messages`. The hosted fixture is isolated from Production. Supabase local CI now enables the Storage schema so the migration replays in the disposable local stack too.
- **Stage 2 CI/browser verification:** [Auth Worker CI #43186653027](https://github.com/taufx98/sykabelajar4.0/actions/runs/43186653027), [Supabase Local Auth Claims CI #43186653043](https://github.com/taufx98/sykabelajar4.0/actions/runs/43186653043), and [Better Auth staging browser smoke #43186643903](https://github.com/taufx98/sykabelajar4.0/actions/runs/43186643903) all passed on branch head `33ed0b2286ca5a6cbe9541abb0917a4f8da68a8a`. The browser smoke reported 10 passed and 1 skipped; the skipped test is optional Google OAuth because no Google provider secret is configured.
- **Stage 3 live inventory:** a new read-only Production catalog comparison confirms 69/69 application foreign keys across 62 application tables match the committed snapshot exactly, with no added/removed constraints or semantic changes to CASCADE, SET NULL, NO ACTION, RESTRICT, match, validation or deferrability. Ten additional references belong to Supabase's internal `auth` schema and are excluded from the 69 application-FK cutover. The current RLS catalog contains 109 `auth.uid()` policies (108 in `public`, one in `private`), matching the historical dependency inventory. Production `private.app_users` is still absent; the identity-root, FK, trigger and dependent-RPC migrations remain unexecuted.
- **Stage 5:** the shared Better Auth JWT verifier and nine Cloudinary/payment handler migrations remain source- and CI-verified. The auth-only staging project does not have the full business schema/secrets, so these application handlers have not been deployed there or to Production. Real-token two-user IDOR per handler, complete policy/SECURITY DEFINER review and application/payment regression remain open. A fresh read-only Production Security Advisor run reports 23 RLS-enabled tables without policies, 46 `SECURITY DEFINER` functions executable by `anon`, 202 executable by `authenticated`, and leaked-password protection disabled. These findings require per-function/policy review; do not mass-revoke execution or apply blanket RLS changes because some RPCs are intentional public/portal endpoints with their own token/role checks. The Production `private.organizer_access_codes` RLS-disabled design also remains a specific review gate.
- **Stage 6:** read-only staging preflight finds one application identity, one profile, one settings row and exactly one active Admin role. The protected staging admin therefore already exists; do not run the first-admin bootstrap again. No demo/test account was reset or deleted. The identities/dependent rows eligible for cleanup have not been specifically identified, and the full two-user/business regression still depends on Stage 2/5 acceptance.
- **Stage 7:** Production cutover remains blocked. Production `private.app_users` is absent; the 69-FK rehome and auth-trigger/RPC migration are not applied; real-token Storage/Realtime/Edge and Stage 5 hosted security acceptance remain incomplete; demo cleanup and rollback rehearsal are not complete. No Production deployment, DNS/auth-routing change, schema/RLS/RPC/FK/trigger/secret/Edge Function change, account deletion, or PR merge was performed.
- PR #177 remains open, Draft and unmerged. Keep the staging email-verification bypass staging-only; real email delivery and Google OAuth remain deferred as previously approved.

---

## Latest checkpoint — 12 November 2026 (staging login accepted and session-race fix)

- The owner confirms that email/password login on `https://staging.sykabelajar.my.id` now succeeds on the first attempt and reaches the app; the logout button also works. This is real hosted staging acceptance for the basic Better Auth credential/session path, not merely a login-page render test.
- The staging app successfully hydrates the signed-in user's profile and active role from the isolated Supabase project. Read-only staging checks confirm `private.app_users` exists with one row whose `identity_origin='better_auth'`, `public.profiles` has one row, `public.user_roles` has one row, and `auth.users` remains empty. No user UUID or personal account data is recorded here.
- Fixed a same-tab BroadcastChannel echo race in `src/services/betterAuthSessionBridge.mjs`: each page includes a non-sensitive sender ID in its session notification and ignores notifications from itself. Notifications from other tabs still trigger an authoritative Better Auth session read. Regression tests cover both paths.
- Cloudflare Pages deployed the source commit `370add4197fcdee642ea29d52a7ba29b998c03d4` successfully. The latest [Auth Worker CI #43143000486](https://github.com/taufx98/sykabelajar4.0/actions/runs/43143000486) and [Supabase Local Auth Claims CI #43143000467](https://github.com/taufx98/sykabelajar4.0/actions/runs/43143000467) passed, including frontend lint/typecheck/build, Worker tests and isolated JWT/RLS contracts.
- **Important staging-only limitation:** the owner-approved temporary email-verification bypass remains active only in Better Auth staging (`email_verification_required=0`). Therefore this login acceptance does not prove real outbound email delivery, verified-email signup, verification callbacks, or password-reset email delivery. Never carry the bypass into Production; Production email verification remains mandatory.
- Stage 4 still needs complete hosted acceptance for page reload/session restoration, separate-tab account changes, expiry/re-authentication and Realtime session renewal. Stage 2 still needs positive-token Storage, Realtime and Edge acceptance. Stage 3's 69-FK cutover remains a disposable/local simulation only; Production identity tables/FKs and business data were not migrated. Stage 5 handlers remain source/CI-verified, not deployed to the incomplete staging business schema.
- PR #177 remains open, Draft and unmerged. Production Supabase DB2, Production Pages, DNS, secrets, auth routing, users, schema, RLS/RPC/FKs/triggers and Edge Functions remain unchanged. No demo reset, Production merge or Production cutover occurred.

---

## Latest checkpoint — 11 November 2026 (temporary staging bypass and login recovery)

- Owner-approved email-verification bypass is active **only on Better Auth staging** while the seven-stage migration is being completed. The staging D1 runtime policy auth_runtime_settings.email_verification_required is 0. This was confirmed by the hosted provider endpoint; production verification requirements were not changed.
- The staging deploy preflight previously rejected any active session for an unverified staging user, even during the approved temporary bypass. The guard now reads the runtime policy from D1, allows those sessions only when the policy is exactly 0, blocks them when it is 1, and fails closed when the value is absent or invalid. It does not delete or rewrite existing sessions or accounts.
- [Auth Worker Staging Deploy #43021691122](https://github.com/taufx98/sykabelajar4.0/actions/runs/43021691122) successfully uploaded Worker version e733f4c7-c9f0-409e-bb7f-a90aa1a6dce5 from commit 0d79aa701f204920878f57ae37e734a7d760d082. Hosted /healthz, exact OIDC issuer/discovery, PKCE S256, public P-256 ES256 JWKS, allowed staging CORS, rejected hostile-origin CORS, and the public provider response were reached. The provider response exposed emailVerificationRequired=false as expected. The run then failed on a stale smoke-test assertion that still expected true; this was a workflow expectation bug, not a Worker runtime failure.
- The staging deploy workflow and contract test were corrected to expect the owner-approved false policy and to bound every hosted request with an 8-second timeout. The current branch head is e571dd13869f82f0753d84eb3d0f10a1809ecde8. [Auth Worker CI #43022846756](https://github.com/taufx98/sykabelajar4.0/actions/runs/43022846756), [Supabase Local Auth Claims CI #43022846748](https://github.com/taufx98/sykabelajar4.0/actions/runs/43022846748), and [Cloudflare Staging Preflight #43022840112](https://github.com/taufx98/sykabelajar4.0/actions/runs/43022840112) all passed.
- Re-deploy attempts after the workflow-only correction failed at the Cloudflare Worker versions API with error 10021 ("binding DB of type d1 failed to generate"). The D1 table/schema/identity preflight and secret-preservation checks passed first. The commits after 0d79aa701f204920878f57ae37e734a7d760d082 changed only the staging workflow, test contract, and deployment marker; they did not change Worker runtime source. Therefore the last successfully uploaded Worker version still contains the current login-reliability source changes, including D1 identity-projection marker reuse, bounded retry of idempotent provisioning RPCs, and safe post-login session-read retry.
- **Still open:** an end-to-end sign-in with the owner's real staging account has not been performed from this workflow. The earlier browser/user report of login failure is not considered resolved until that actual credential flow is accepted and a session is confirmed. Do not reset the staging identity or D1 data as a workaround. If sign-in still fails, inspect the sanitized Worker diagnostic/error code for the single failing request.
- PR #177 remains open, Draft and unmerged. Production Supabase DB2, production login routing, DNS, schema, users, secrets, RLS/RPC/FKs/triggers, and Edge Functions remain untouched. No Production merge, account reset, or cutover occurred.

---

## Latest checkpoint — 11 November 2026 (first-login retry hardening)

This checkpoint records the owner's report that the first login attempt may show an incorrect ID/password message even though an immediate second attempt with the same credentials succeeds. It supersedes the previous Stage 4 login-reliability checkpoint, but does not claim that the latest Worker deployment has been hosted and health-checked.

- **Remove repeated provisioning work after first success:** a successful Supabase identity/profile projection is recorded under `identity_projection:<UUID>` in the existing private D1 `auth_worker_internal_config` table. Subsequent session creation reuses that marker only if the user's `emailVerified` state still matches. The marker stores no password, email, role, or token. Missing/stale markers still require a trusted Supabase projection before a session is created.
- **Bounded retry for transient provisioning outages:** `invokeRpc()` retries once after a network failure, HTTP 429, or 5xx only for the two transactionally idempotent identity/email-verification RPCs. Permanent 4xx errors fail immediately. Password sign-in, session creation, phone-verification mutations and other non-idempotent auth operations are not replayed.
- **Bounded post-login session confirmation:** after Better Auth accepts the one credential POST, `confirmSessionAfterSignIn()` retries only the safe session GET when the cookie is not yet visible or the Worker read has a transient error. It never resubmits the password and never converts a definitive credential/verification rejection into success.
- **Role freshness and access control remain unchanged:** the frontend continues to read active `user_roles` from Supabase on each login. The D1 projection marker does not cache a user's business role. A student remains denied from `/admin` and redirected to `/home` without being signed out.
- Regression tests in `services/auth-worker/tests/supabase-provisioning.test.mjs` cover successful marker reuse, verification-state transitions, fail-closed marker writes, transient network/5xx retries, permanent 4xx no-retry, and no retry for phone-verification mutations. `scripts/auth-migration/auth-session-confirmation.test.mjs` covers bounded safe-read retries.
- [Auth Worker CI #43015989287](https://github.com/taufx98/sykabelajar4.0/actions/runs/43015989287) passed: frontend lint/typecheck/build, Worker security and integration tests (including D1/OIDC/JWKS), and Worker dry-run bundling.
- [Supabase Local Auth Claims CI #43015989088](https://github.com/taufx98/sykabelajar4.0/actions/runs/43015989088) passed: migrated Edge JWT contracts, staging anonymous-probe rejection, FK-plan validation, and isolated local PostgreSQL JWT/RLS ownership tests.
- The guarded staging-only Worker deployment marker was re-triggered after these changes in commit `b7f01105a8f2bc63278ddc94de89daae7e9617d2`. PR #177 remains open, Draft and unmerged. The available GitHub workflow-run view exposes PR-triggered CI but not the push-triggered staging deployment run, so this checkpoint does **not** assert that the deployed staging Worker has the latest code. Verify the hosted Worker health/deploy result before asking the owner to repeat the login test.
- Supabase Production DB2 `mvdczyitbkxkldjughor`, Production Pages/DNS/auth routing, production users, schema, RLS, RPCs, FKs, triggers, secrets and Edge Functions remain unchanged. No account reset, PR merge or Production cutover was performed.

---

## Latest checkpoint — 11 November 2026 (Stage 4 first-login reliability)

This checkpoint records the owner's follow-up acceptance: five refreshes/navigation cycles remained authenticated; a student opening `/admin` was redirected to `/home` without logout; and a five-minute idle session remained valid. The remaining symptom is an intermittent first password-login attempt that reports an incorrect credential, while a second attempt with the same credential succeeds.

- **Provisioning bottleneck removed from established logins:** `services/auth-worker/src/supabase-provisioning.mjs` now stores a D1-only `identity_projection:<UUID>` marker in the existing `auth_worker_internal_config` table after the Supabase identity/profile projection and any bootstrap cleanup have succeeded. The marker records only whether the user's email is verified. `session.create.before` calls `ensureSupabaseApplicationIdentity`; an existing matching marker avoids repeating the provisioning RPC on every login. Missing markers and email-verification state changes still force the trusted, idempotent Supabase projection before session creation. A failed D1 marker write fails closed.
- **Role freshness is unchanged:** the D1 marker does not cache business roles. Frontend hydration still reads the active `user_roles` from Supabase on every login, so an Admin-to-Student or Student-to-Admin change is not masked by the provisioning optimization. The server-side `/admin` role guard and RLS/JWT contracts are unchanged.
- **Post-login session visibility:** `src/services/authSessionConfirmation.mjs` retries only the safe `/get-session` read for a bounded period after Better Auth accepts the credential POST. The password POST is sent exactly once. Definitive credential and email-verification rejections are not retried or converted into success.
- Regression coverage: `services/auth-worker/tests/supabase-provisioning.test.mjs` covers marker reuse, email-verification transitions, missing markers and fail-closed writes; `scripts/auth-migration/auth-session-confirmation.test.mjs` covers delayed cookies, transient Worker errors, definitive rejection and bounded failure.
- [Auth Worker CI #43014956420](https://github.com/taufx98/sykabelajar4.0/actions/runs/43014956420) passed: frontend lint/typecheck/build, Worker audit/tests, local D1 migrations, OIDC/JWKS smoke and Worker dry-run.
- [Supabase Local Auth Claims CI #43014956436](https://github.com/taufx98/sykabelajar4.0/actions/runs/43014956436) passed: Edge/JWT contracts, local PostgreSQL role/ownership/RLS checks and auth boundary checks.
- Branch head at the time of the staging deploy trigger: `43c7176948c3b2a13385106dfebc25002bac65ec`; PR #177 remains open, Draft and unmerged. The exact guarded staging deploy marker was committed to trigger the Worker-only staging deployment. The GitHub Actions integration available for this session exposes PR-triggered workflow runs but not the push-triggered staging deployment run, so this checkpoint does **not** claim the new Worker version is hosted or health-checked.
- Supabase Production DB2 `mvdczyitbkxkldjughor`, production Pages/DNS/auth routing, production users, schema, RLS, RPCs, FKs, triggers, secrets and Edge Functions remain unchanged. No account reset, PR merge, or Production cutover was performed.

---

## Latest checkpoint — 11 November 2026 (Stage 4 session stability and request recovery)

This checkpoint records the owner-reported staging login/role tests and the follow-up frontend transport/session hardening. It supersedes prior statements about the latest Stage 4 code state, but does not claim a staging deployment or Production cutover.

- Owner-reported staging behavior before the fix: login succeeds; refresh/session persistence is intermittent; the selected Supabase staging business role is reflected in the app; a student is denied access to `/admin`; the frontend occasionally reports `AUTH_REQUEST_FAILED` and feels slow.
- **Resource-token reuse:** `src/services/betterAuthSessionBridge.mjs` no longer invalidates the in-memory Supabase resource JWT on every focus, visibility, or pageshow check. The cache is invalidated only after the authoritative Worker read confirms an identity transition.
- **Worker request efficiency/recovery:** `src/services/betterAuthApi.client.ts` caches the public email-verification policy for 15 seconds, deduplicates concurrent `/get-session` reads, retries only idempotent GETs after network/429/5xx failures, and never auto-replays sign-in, sign-up, sign-out, password or admin mutations.
- **No false logout on transient failures:** `src/store/AppContext.tsx` retries transient session/profile/role reads. A failed Worker/PostgREST read no longer clears the local authenticated identity by default; explicit session rejection or a missing profile/role remains a definitive failure. Protected routes show a retry state when session status is temporarily unavailable instead of silently redirecting to `/login`.
- Role authorization was not weakened: `/admin` remains accessible only to an active admin role. A student must be redirected away from that route, not signed out merely because access is denied.
- Regression contracts cover same-user resource-token reuse, identity-change invalidation, transient Worker errors, safe GET retries, session-read deduplication, and AppContext bootstrap recovery.
- [Auth Worker CI #43008647281](https://github.com/taufx98/sykabelajar4.0/actions/runs/43008647281) passed: frontend lint/typecheck/build, Worker tests, D1 migration checks, OIDC/JWKS smoke and Worker dry-run.
- [Supabase Local Auth Claims CI #43008647248](https://github.com/taufx98/sykabelajar4.0/actions/runs/43008647248) passed: Edge/JWT/RLS contracts, local PostgreSQL ownership/role checks, staging anonymous-probe rejection and auth inventory checks.
- Branch head at this checkpoint: `356307c4335b649d3610421cde7c9e1c459ccb76`; PR #177 remains open, Draft and unmerged. These are source/CI-verified changes only. No new staging deployment was performed in this checkpoint.
- Supabase Production DB2 `mvdczyitbkxkldjughor`, production Pages/DNS/auth routing, users, schema, RLS, RPCs, FKs, triggers, secrets and Edge Functions remain unchanged. No account reset, PR merge or Production cutover was performed.

---

## Latest checkpoint — 11 November 2026 (guarded staging Worker deployment)

This checkpoint supersedes the earlier statement that the Worker-side email-readiness guard was source-only. The updated Worker is now deployed to the isolated staging hostname. It does not authorize PR merge or Production cutover.

- Branch: `security/auth-poc-stage-1`; deployment commit: `0ad597ce02c94b19f6cc741b5f303af11490691f`; PR #177 remains open, Draft and unmerged.
- [Auth Worker Staging Deploy #42982191205](https://github.com/taufx98/sykabelajar4.0/actions/runs/42982191205) completed successfully. Deployed Worker version: `79c86a42-de44-4b6a-874d-89465a9c467d`.
- The guarded deployment verified the fixed Worker/D1/domain and isolated Supabase staging target, all 20 remote D1 tables, all seven Better Auth registration/profile columns, the managed email schema, the exact public OAuth callback allowlist, and the retained D1 identity aggregates. It confirmed one Better Auth user (unverified), one account credential, zero sessions, zero verification records, zero phone challenges, and zero active sessions for unverified users. Existing D1 identity state was preserved; no D1 migration/reset ran.
- The Worker deployment preflight confirmed `SUPABASE_PROVISIONING_ENABLED=true`, the fixed isolated staging provisioning URL, and the required single server-only staging API-key binding by name/type only. Secret values were not read or logged. The dedicated OAuth-provider encryption secret already existed and was preserved without rotation.
- Hosted smoke checks passed: `/healthz`, exact issuer `https://auth.sykabelajar.my.id/api/auth`, discovery, ES256/P-256 public JWKS, PKCE S256, same-site staging CORS allowlist, rejection of an untrusted origin, safe public provider discovery, and unauthenticated/untrusted-origin rejection for both Admin settings APIs.
- The deployed Worker includes the Stage 1 direct `POST /api/auth/sign-up/email` readiness guard added in `services/auth-worker/src/worker.ts`. When managed email verification delivery is unavailable it rejects registration before Better Auth can create another D1 identity. Local Worker integration/security tests and the readiness contract test passed in [Auth Worker CI #42981004924](https://github.com/taufx98/sykabelajar4.0/actions/runs/42981004924). No additional hosted signup was submitted; the existing unverified test identity remains intact.
- Current hosted readiness remains unavailable: `emailAgentConfigured=false`; the actual email verification sender remains deferred by owner instruction. No email provider was configured, no test email was sent, no verification state was fabricated, and no session was created. The verified-session end-to-end lifecycle and positive real-token Supabase Storage/Realtime/Edge acceptance remain open pending a genuinely verified session.
- A read-only post-deploy query of Supabase staging still reports `auth.users=0`, `private.app_users=1`, `public.profiles=1`, and `public.user_roles=1`. No identity/profile/role row was removed or reset.
- Supabase Production DB2, Production Pages, DNS/auth routing, production users, schema, RLS, RPCs, FKs, triggers, secrets, and Edge Functions remain unchanged. No Production operation, PR merge, or cutover occurred.

---

## Latest checkpoint — 11 November 2026 (session race and signup boundary hardening)

This checkpoint records two narrowly scoped authentication fixes on the current branch. It does not claim a new hosted Worker deployment, a verified staging session, PR merge, or Production cutover.

- Branch: `security/auth-poc-stage-1`; latest branch head (documentation checkpoint): `afc4f4811a1225cfcac22b674efa480a699a3c56`; latest code/test commit: `31a8be696b592fbf5f76b4cdaab8d6140e4e8ef2`; PR #177 remains open, Draft and unmerged.
- **Stage 4 cross-tab session reconciliation:** `src/services/betterAuthSessionBridge.mjs` now treats BroadcastChannel/storage messages only as wake-up hints. Sign-in/sign-out transitions are derived from the authoritative Better Auth `/get-session` result and the previous UUID, not from a possibly stale event label. The first read only establishes a baseline; it never emits a synthetic transition. Same-identity `USER_UPDATED` and `PASSWORD_RECOVERY` notifications remain supported.
- Regression coverage in `scripts/auth-migration/better-auth-session-bridge.test.mjs` covers stale sign-out after account switch, stale sign-in after logout, same-identity events, and a notification arriving while initial session discovery is still in flight.
- **Stage 1 registration boundary:** `services/auth-worker/src/worker.ts` now checks `isAuthEmailVerificationConfigured(env)` for direct `POST /api/auth/sign-up/email` requests before invoking Better Auth. If email verification delivery is unavailable, the Worker returns `503 EMAIL_VERIFICATION_DELIVERY_NOT_CONFIGURED` before D1 user creation. This closes the API bypass around the frontend readiness check and prevents more unverified orphan registrations. Existing sign-in, social-provider behavior, and the mandatory verified-email session gate are unchanged.
- `services/auth-worker/tests/email-verification-readiness.test.mjs` now checks that the Worker-level registration guard runs before the Better Auth handler. Existing frontend readiness checks remain.
- [Auth Worker CI #42981004924](https://github.com/taufx98/sykabelajar4.0/actions/runs/42981004924) passed on the current head: dependency audit, Worker typecheck/security contracts, full local Worker + D1 migration + email-verification/OIDC/PKCE/session integration, Worker dry-run bundle, frontend lint/typecheck/build.
- [Supabase Local Auth Claims CI #42981005183](https://github.com/taufx98/sykabelajar4.0/actions/runs/42981005183) passed on the same head: Better Auth Edge JWT contracts, Deno type checks, deployed staging probe anonymous rejection, live FK snapshot/dry-run plan checks, and isolated local PostgreSQL JWT/RLS tests.
- The documentation-only head also passed [Auth Worker CI #42981397083](https://github.com/taufx98/sykabelajar4.0/actions/runs/42981397083) and [Supabase Local Auth Claims CI #42981397149](https://github.com/taufx98/sykabelajar4.0/actions/runs/42981397149).
- The runtime change in `services/auth-worker/src/worker.ts` is **source- and CI-verified but not yet deployed to the hosted staging Worker**. The last confirmed deployed Worker remains version `61b418bd-95cc-4410-ac79-7c25b313f48a` from run #42960910450. The guarded staging deployment workflow is not part of these two CI runs.
- The existing staging identity was not reset. The latest read-only staging inventory remains one `private.app_users` row, one profile, one role, and zero `auth.users` rows. A real verified Better Auth session still does not exist; do not fake email verification or create a session for the unverified account.
- Supabase Production DB2, Production Pages, DNS/auth routing, production users, schema, RLS, RPCs, FKs, triggers, secrets, and Edge Functions remain unchanged. No Production operation or migration was performed.

---

## Latest checkpoint — 11 November 2026 (staging account audit + email-readiness fix)

This checkpoint supersedes all earlier branch, deployment, and browser-test references below. It records the first real Better Auth staging registration, its read-only session audit, the email-readiness UX fix, and the successful staging Worker deployment. It does **not** authorize Production changes or PR merge.

- Latest browser-test commit: `5f61800810fc9c1bff274dfc8e20cfb8e6db2443` on `security/auth-poc-stage-1`; PR #177 remains open, Draft, and unmerged.
- The owner completed a staging email/password registration. Read-only D1 audit [#42959439824](https://github.com/taufx98/sykabelajar4.0/actions/runs/42959439824) and the deployment's protected aggregate check [#42960910450](https://github.com/taufx98/sykabelajar4.0/actions/runs/42960910450) confirm **one Better Auth user, one unverified user, one account credential row, zero sessions, zero verification records, zero phone challenges, and zero active sessions for unverified users**. The user's identity was preserved; no credential, email, token, cookie, or verification value was read by these aggregate checks.
- A fresh read-only Supabase staging query after registration showed one `private.app_users` row with `identity_origin='better_auth'`, one profile and one role row; `auth.users` remains empty. No duplicate Supabase Auth identity was created. The existing test identity was not deleted or reset.
- **The registration succeeded, but a real login session was not created.** The deployed Worker enforces `requireEmailVerification: true` and a `session.create.before` guard requiring `emailVerified === true`. D1 shows no session. The absence of a Supabase `auth.users` row plus zero Better Auth D1 sessions means the earlier apparent login was not an authenticated application session.
- Root cause of the missing on-screen prompt: the Better Auth response carried generic `FORBIDDEN` plus actionable `EMAIL_VERIFICATION_REQUIRED`; the frontend mapper selected the generic code first. `src/services/betterAuthErrorCode.mjs` now prioritizes the small allowlist of email-verification reasons. The Worker integration suite now explicitly proves unverified password sign-in is rejected, no session cookie is issued, and `/get-session` returns null.
- The public Worker provider-discovery response now exposes only `emailVerificationConfigured: boolean` (no sender details or credentials). The staging client checks readiness before sign-up and before requesting a resend. When readiness is false, new staging registration is blocked before creating another orphan identity; the login page explains that email delivery is not active and disables resend. The user's existing identity is retained.
- Hosted readiness is currently **false**: Worker deployment diagnostics reported `emailAgentConfigured=false`; D1 audit found no configured email account and no verification records. External email delivery remains deferred by owner instruction. Do not fabricate verification, create an unverified session, or weaken the gate.
- [Auth Worker Staging Deploy #42960910450](https://github.com/taufx98/sykabelajar4.0/actions/runs/42960910450) succeeded and deployed Worker version `61b418bd-95cc-4410-ac79-7c25b313f48a`. The D1 guard was corrected to preserve existing staging accounts while refusing deployment if an unverified user already owns an active session. It verified the one existing account was preserved, zero sessions, zero verification records, and zero active unverified sessions. Hosted health, exact issuer, public ES256/P-256 JWKS, and PKCE S256 checks passed. No D1 migration or row mutation was run by this deployment.
- [Better Auth staging browser smoke #42961097320](https://github.com/taufx98/sykabelajar4.0/actions/runs/42961097320) passed **6 tests, 1 skipped** against the matching Pages deployment. It verifies login UI, the unverified-login prompt and disabled resend under the actual false readiness state, registration is paused while delivery is unavailable, registration's initial form, password-recovery UI without sending email, and the Worker provider-discovery contract. The only skipped test is optional Google OAuth.
- [Auth Worker CI #42961103807](https://github.com/taufx98/sykabelajar4.0/actions/runs/42961103807) passed on the E2E commit: frontend lint/typecheck/build, Worker security tests, D1/OIDC/JWKS tests, and frontend identity/session contracts.
- [Supabase Local Auth Claims CI #42961103815](https://github.com/taufx98/sykabelajar4.0/actions/runs/42961103815) passed on the same E2E commit, including local JWT/RLS acceptance.
- No real verified staging session exists yet. Real signup/login/session hydration/refresh/logout and positive real-token Supabase acceptance remain blocked only by the intentionally unconfigured email sender. After an email sender is activated through the existing Admin email settings, the existing user can request a fresh verification email; do not delete or recreate the account.
- **Scope boundary remains unchanged:** Supabase Production DB2 remains the application database. Do not copy business schema/data, payment settings, Cloudinary configuration, or application handlers into auth staging.
- Production Supabase `mvdczyitbkxkldjughor`, DB2, Production Pages, DNS, auth routing, user data, schema, RLS, RPCs, FKs, triggers, and Production Edge Functions remain unchanged. No account reset, PR merge, or Production cutover occurred.

---

## Latest checkpoint — 11 November 2026 (browser smoke + CI on current implementation)

This checkpoint supersedes older branch-head and browser-smoke references below. It records read-only staging verification and the latest browser/CI acceptance; it does not authorize Production changes or PR merge.

- Implementation commit tested: `1c60313f9614aae2c4dcfc1ab3e3fa46e1d1aeaf` on `security/auth-poc-stage-1`. The only change in this commit is the staging browser-smoke rerun marker.
- [Better Auth staging browser smoke #42955512598](https://github.com/taufx98/sykabelajar4.0/actions/runs/42955512598) passed against the matching Cloudflare Pages deployment for this exact commit: **4 passed, 1 skipped**. Passing tests cover the staging email/password login page, registration's first email/password step and validation state, opening password recovery without sending email, and the Worker's safe provider-discovery response. The single skipped test is optional Google OAuth because Google credentials are not configured.
- [Auth Worker CI #42955517562](https://github.com/taufx98/sykabelajar4.0/actions/runs/42955517562) passed on the same commit: frontend lint/typecheck/build, Worker typecheck/security contracts, D1/OIDC/JWKS dry-run, Edge auth contracts, and frontend identity/session contracts.
- [Supabase Local Auth Claims CI #42955517600](https://github.com/taufx98/sykabelajar4.0/actions/runs/42955517600) passed on the same commit, including local JWT/RLS and auth-boundary regression tests.
- A fresh read-only query against isolated staging project `ydamszdfsxqisanazdkb` confirmed zero rows in `auth.users`, `private.app_users`, `public.profiles`, `public.user_roles`, `public.organizers`, and `public.organizer_members`.
- The four public Better Auth provisioning/email/phone RPC wrappers remain `SECURITY DEFINER` with empty `search_path`; only `service_role` can execute them. `anon` and `authenticated` cannot execute them. Internal `private` routines are not directly executable by application roles. `public.create_organizer` remains protected: `anon` denied, with the existing trusted-issuer/identity checks.
- Staging Worker configuration remains pinned to the dedicated Worker/D1 and Supabase staging URL, with `SUPABASE_PROVISIONING_ENABLED=true`. The provisioning secret is a server-only Cloudflare Worker binding; its value was not read or printed. No staging account was created.
- **No genuine verified user session has been established.** The browser suite is UI/provider discovery only. Transactional email delivery remains deferred and there is no configured sender; do not fake `emailVerified`, send test mail, or weaken the verified-email gate. Consequently, real signup/login/session hydration/refresh/logout and positive real-token Supabase acceptance remain unverified pending a genuine verified identity. Continue all code, CI, and non-email-dependent acceptance that can be completed.
- **Scope boundary:** Supabase DB2 remains the application database. The staging project is intentionally an auth/identity fixture, not a Production business-schema clone. Copying orders, payment data, Cloudinary configuration, Shop/competition tables, or deploying business Edge Functions to auth staging is not a prerequisite for this login migration. Stage 5 concerns only authentication verification/identity compatibility in existing backend entry points; preserve their business behavior.
- PR #177 remains open, Draft, and unmerged. Production Supabase `mvdczyitbkxkldjughor`, Production Pages, DNS, auth routing, user data, schema, RLS, RPCs, FKs, triggers, and Production Edge Functions remain unchanged. No account reset or Production cutover occurred.

---

## Current Better Auth checkpoint — 11 November 2026 (staging provisioning enabled)

This is the newest verified implementation checkpoint. It supersedes older snapshots below where their secret/provisioning statements conflict. It does **not** authorize Production cutover or PR merge.

- Repository branch: `security/auth-poc-stage-1`; latest verified head before this status-only update: `58f0feff942fd6d74b71206430f27893599bedc3`. PR #177 remains open, Draft and unmerged.
- [Auth Worker Staging Deploy #42949849642](https://github.com/taufx98/sykabelajar4.0/actions/runs/42949849642) completed successfully on 11 November 2026. It ran Worker typecheck, all security tests and deployment dry-run; verified the fixed staging Worker/D1 target, all 20 remote D1 tables, zero pre-existing user/session/account/verification/challenge rows, preserved encryption key, and exactly one server-only staging provisioning secret binding by name/type; then deployed and passed hosted health, exact issuer, CORS, discovery, provider metadata and public ES256/P-256 JWKS checks.
- Deployed Worker version: `01fb38d8-4a0f-4f79-9c84-3fa7376014f7`. The deploy log confirms `SUPABASE_PROVISIONING_ENABLED=true`, `SUPABASE_PROVISIONING_URL=https://ydamszdfsxqisanazdkb.supabase.co`, and the server-only `SUPABASE_PROVISIONING_API_KEY` binding was found as exactly one `secret_text` binding. The key's value was never read or printed. The Worker helper pins this exact staging host and never falls back to the Production Admin bridge URL.
- [Auth Worker CI #42949842815](https://github.com/taufx98/sykabelajar4.0/actions/runs/42949842815) passed frontend lint/typecheck/build, Worker security contracts, Supabase Edge TypeScript contracts, identity/ownership checks, frontend auth/session contracts, local D1 migrations and the OIDC/JWKS dry run.
- [Auth Cloudflare Staging Preflight #42949843010](https://github.com/taufx98/sykabelajar4.0/actions/runs/42949843010) passed read-only Cloudflare resource and secret metadata inspection. The earlier rerun [#42853474928](https://github.com/taufx98/sykabelajar4.0/actions/runs/42853474928), attempt 2, confirmed `BETTER_AUTH_SECRET`, `AUTH_PROVIDER_ENCRYPTION_KEY` and `SUPABASE_PROVISIONING_API_KEY` present; no Google credential pair and no legacy duplicate `SUPABASE_SERVICE_ROLE_KEY`. Secret values were not accessed.
- Live isolated Supabase staging `ydamszdfsxqisanazdkb` checks confirmed all four Better Auth wrappers exist, are owned by `postgres`, are `SECURITY DEFINER` with empty `search_path`, and are executable only by `service_role`; `anon`, `authenticated` and `PUBLIC` cannot execute them. The underlying provisioning RPC restricts new account types to student/teacher/organizer, maps organizer to `organizer_member`, rejects admin, and refuses legacy-reference identities.
- Post-deploy read-only staging counts remain zero for `auth.users`, `private.app_users`, `public.profiles`, `public.user_roles`, `public.organizers` and `public.organizer_members`. No user, session, profile, role or admin was created. No cleanup/reset was performed.
- Staging provisioning is now enabled for future Better Auth identity projections. Real email/password signup and session acceptance are **not** claimed: `AUTH_EMAIL_PROVIDER=managed` has no active sender account (`emailAgentConfigured=false`), so verified-email delivery remains unavailable by owner decision. Do not fake `emailVerified=true`, send a test email, or weaken the verified-email session gate. Google OAuth remains optional and unconfigured.
- Supabase staging intentionally contains only the auth/identity/referral/organizer fixture schema. This is sufficient for auth provisioning and OIDC acceptance; do not copy the full Production business schema into it. The source branch includes Better Auth-compatible identity verification for existing backend handlers that directly depended on Supabase Auth. Those business handlers do not need to be deployed to auth staging or supplied with Cloudinary/payment credentials to complete login migration; deploy compatible handlers only as part of the separately approved Production cutover, retaining existing business configuration and logic.
- Stage 4 browser smoke still proves unauthenticated login/register/recovery rendering and provider discovery only; actual verified session hydration, refresh, cross-tab behavior, expiry/logout, Storage, private Realtime and positive-token Edge acceptance await a genuine verified staging session.
- Production Supabase `mvdczyitbkxkldjughor`, DB2, Production Pages, DNS, auth routing, users, Edge Functions, schema, RLS, RPCs, FKs and triggers remain unchanged. No PR merge, account reset or Production cutover occurred.

---

## Current Better Auth checkpoint — 10 November 2026 (latest CI + staging RPC verification)

This checkpoint supersedes earlier branch-head and CI references below. It records completed Stage 3 disposable acceptance, passing source CI, browser smoke and read-only staging preflight. It does not authorize production cutover.

- Repository branch: `security/auth-poc-stage-1`; latest branch head: `328e4a8fbd9c926428a12b749036b1e6e419b747`. PR #177 remains open, Draft and unmerged.
- [Auth Worker CI #42855314038](https://github.com/taufx98/sykabelajar4.0/actions/runs/42855314038) passed on the latest branch head. It includes frontend lint/typecheck/build, Worker security tests, D1 migration/OIDC/JWKS dry run, Deno type-check for the Better Auth identity adapter and all migrated Supabase Edge handlers, Cloudinary/payment auth-boundary checks and frontend auth/session contracts.
- [Supabase Local Auth Claims CI #42855313496](https://github.com/taufx98/sykabelajar4.0/actions/runs/42855313496) passed on the same head. It includes local Supabase JWT/RLS contracts, Edge JWT/webhook tests, Cloudinary ownership tests, local pgTAP acceptance, staging OIDC anonymous-request rejection, and current auth migration inventory contracts.
- [Auth Production Schema Baseline #42847997448](https://github.com/taufx98/sykabelajar4.0/actions/runs/42847997448) passed fully on a disposable local Supabase stack: schema-only Production export; zero imported `auth.users` and `public.profiles` rows; exact 69-FK/62-table parity; trigger/profile/function/RLS metadata; Better Auth identity-root and 69-FK expansion/validation/atomic cutover simulation; provisioning/referral/email/phone/organizer acceptance; anonymous and trusted-issuer RLS; fail-closed FK rollback and full Stage 3 rollback. Temporary runner schema/export and local Supabase were removed. No hosted database was altered.
- [Better Auth staging browser smoke #42852235334](https://github.com/taufx98/sykabelajar4.0/actions/runs/42852235334) passed in real Chromium: staging `/login` returned HTTP 200, React mounted, email/password inputs and heading were visible, JS/CSS loaded, provider discovery returned the exact issuer contract, and no uncaught browser errors occurred. Google OAuth state-cookie test was skipped because credentials are optional and absent. This did not create a user or prove an authenticated session.
- [Auth Cloudflare Staging Preflight #42853488326](https://github.com/taufx98/sykabelajar4.0/actions/runs/42853488326) passed read-only checks: Cloudflare Worker, D1, `auth.sykabelajar.my.id`, staging Pages domain, parent DNS delegation and MX/TXT parity are healthy. The sanitized secret inventory confirms `BETTER_AUTH_SECRET` and `AUTH_PROVIDER_ENCRYPTION_KEY` exist, but both `SUPABASE_PROVISIONING_API_KEY` and legacy `SUPABASE_SERVICE_ROLE_KEY` are absent. No secret value was read or printed.
- Isolated Supabase staging `ydamszdfsxqisanazdkb` is `ACTIVE_HEALTHY`, PostgreSQL 17.11; it still has 20 identity/referral/organizer fixture tables and one deployed Edge Function, `better-auth-oidc-acceptance`. Production has 125 tables; 112 Production tables are not represented in staging. The nine Cloudinary/payment application handlers remain source-only until staging business schema and per-function secrets/environment exist.
- Latest read-only staging SQL verified zero rows in `auth.users`, `private.app_users`, `public.profiles`, `public.user_roles`, `public.user_settings`, `public.organizers` and `public.organizer_members`. The exposed Better Auth provisioning/email/phone wrapper RPCs are SECURITY DEFINER and executable only by `service_role`; both `anon` and `authenticated` are denied direct execution. `private.app_users` has RLS enabled and no direct DML grants to application roles. `public.create_organizer(text,text)` remains SECURITY DEFINER with empty search path; anon cannot execute it, while authenticated/service_role retain execute and the function applies the Better Auth issuer, origin, verified email/phone and organizer-role guards.
- Stage 4 uses Better Auth Telegram phone verification on the exact staging host; the legacy Supabase Auth SMS OTP remains only for Production compatibility. Real Better Auth sign-up, verified session hydration, refresh, cross-tab switching, Storage, private Realtime and positive-token application Edge acceptance remain pending a genuine verified staging identity.
- `SUPABASE_PROVISIONING_ENABLED=false` remains. The remaining owner prerequisite for hosted identity projection is one staging-only Supabase `sb_secret_*` key stored as Cloudflare Worker Secret `SUPABASE_PROVISIONING_API_KEY`. Do not send it through chat or commit it; do not enable provisioning until scope review. Transactional email delivery remains deferred; Google OAuth remains optional. Never fabricate `emailVerified=true`.
- Production Supabase `mvdczyitbkxkldjughor`, DB2, Production Pages, DNS, users, Edge Functions and authentication routing remain unchanged. No reset, merge or Production cutover occurred.

---

## Current Better Auth checkpoint — 10 November 2026 (browser smoke + secret preflight)

This checkpoint supersedes earlier branch-head and CI references below. It records the completed Stage 3 disposable validation and the latest staging UI/resource checks; it does not authorize Production cutover.

- Repository branch: `security/auth-poc-stage-1`; branch head at this checkpoint: `a15bc3891cd3ace4ad6f5d6f9004ee8d5f8f1e53`. PR #177 remains open, Draft and unmerged.
- [Auth Worker CI #42853772416](https://github.com/taufx98/sykabelajar4.0/actions/runs/42853772416) and [Supabase Local Auth Claims CI #42853772371](https://github.com/taufx98/sykabelajar4.0/actions/runs/42853772371) both passed on this branch head. Cloudflare Pages published the matching staging preview successfully.
- [Auth Production Schema Baseline #42847997448](https://github.com/taufx98/sykabelajar4.0/actions/runs/42847997448) passed fully on a disposable local Supabase stack: schema-only Production export; zero imported `auth.users` and `public.profiles` rows; exact 69-FK/62-table parity; triggers, profile columns, 109 `auth.uid()` policies and ten Auth-dependent functions; Better Auth identity-root and all 69-FK expansion/validation/atomic cutover simulation; provisioning/referral/email/phone/organizer acceptance; anonymous and trusted-issuer RLS; fail-closed FK rollback and complete Stage 3 rollback. Temporary runner schema/export and local Supabase were removed after success. No hosted database was altered.
- [Better Auth staging browser smoke #42852235334](https://github.com/taufx98/sykabelajar4.0/actions/runs/42852235334) passed in real Chromium against `https://staging.sykabelajar.my.id`: `/login` HTTP 200, React mounted, email/password inputs and heading visible, app JS/CSS loaded, provider discovery contract returned HTTP 200 and expected issuer, and no uncaught browser errors. Google OAuth state-cookie test was skipped because Google credentials remain optional/unconfigured. This is page/provider-discovery proof only; it did not create a user or validate an authenticated session.
- [Auth Cloudflare Staging Preflight #42853488326](https://github.com/taufx98/sykabelajar4.0/actions/runs/42853488326) passed read-only resource and secret metadata checks. Worker `sykabelajar-auth-poc`, D1 `sykabelajar-auth-poc`, `auth.sykabelajar.my.id` custom domain and staging Pages domain are present and healthy; parent DNS delegation matches the assigned Cloudflare nameservers, and MX/TXT parity checks passed.
- The sanitized preflight confirmed `BETTER_AUTH_SECRET` and `AUTH_PROVIDER_ENCRYPTION_KEY` exist. Both `SUPABASE_PROVISIONING_API_KEY` and legacy `SUPABASE_SERVICE_ROLE_KEY` are still absent. No secret value was read or printed. `SUPABASE_PROVISIONING_ENABLED=false` therefore remains in place; hosted identity projection must not be enabled until the staging-only `sb_secret_*` key is installed as Worker Secret `SUPABASE_PROVISIONING_API_KEY` and its scope reviewed.
- Isolated Supabase staging project `ydamszdfsxqisanazdkb` is `ACTIVE_HEALTHY`, PostgreSQL 17.11, but still has only 20 identity/referral/organizer fixture tables and one deployed Edge Function, `better-auth-oidc-acceptance`. Production has 125 tables; 112 Production tables are not represented in staging. The nine Cloudinary/payment application handlers must remain source-only until the staging business schema and per-function secrets/environment are installed and reviewed.
- Stage 4 source uses Better Auth Telegram phone verification on the exact staging host; legacy Supabase SMS OTP remains only in the Production compatibility branch. Real Better Auth signup/session hydration, password flows, cross-tab switching, Storage, private Realtime and positive-token Edge acceptance remain gated on a genuine verified staging identity.
- Transactional email delivery remains deferred; Google OAuth is optional. Do not fabricate `emailVerified=true` or weaken the verified-email session gate.
- Production Supabase `mvdczyitbkxkldjughor`, DB2, Production Pages, DNS, users, Edge Functions and auth routing remain unchanged. No account reset, PR merge or Production cutover occurred.
- Separate Production defense-in-depth finding: `private.organizer_access_codes` currently has RLS disabled. A direct privilege check found no `USAGE` on schema `private` and no direct table SELECT grant for `anon` or `authenticated`, so the table is not directly reachable through those Data API roles at this time. Enable RLS and design the intended service/function access policy before granting any application-role access; do not blindly enable RLS without reviewing the dependent functions. Suggested DDL for a separately reviewed change: `ALTER TABLE "private"."organizer_access_codes" ENABLE ROW LEVEL SECURITY;`. This has not been applied.

---

## Current Better Auth checkpoint — 10 November 2026 (Stage 3 baseline passed)

This checkpoint supersedes earlier branch-head and CI references below. It records a successful **disposable local schema baseline and migration simulation**; it does not authorize production cutover.

- Implementation checkpoint covered by the passing Worker/Local Auth CI and full Stage 3 baseline: `780bbb62558642f7a7a63aa2fac730e7afcae687`. Later commits only refreshed this status record and PR description; PR #177 remains open, Draft and unmerged.
- Latest isolated Worker version remains `8dfa4dd7-f693-4e27-ad83-cc6af19702f8`. Hosted health, exact issuer, discovery, PKCE S256 and public ES256/P-256 JWKS checks previously passed. No Worker secret, identity-provisioning flag or hosted user state was changed in this work.
- [Auth Worker CI #42848016831](https://github.com/taufx98/sykabelajar4.0/actions/runs/42848016831) and [Supabase Local Auth Claims CI #42848017032](https://github.com/taufx98/sykabelajar4.0/actions/runs/42848017032) both passed.
- [Auth Production Schema Baseline #42847997448](https://github.com/taufx98/sykabelajar4.0/actions/runs/42847997448) completed successfully. It exported Production schema-only metadata, restored it to a disposable local Supabase stack with zero imported `auth.users` / `public.profiles` rows, reconstructed the audited function ACLs in that local stack, and verified the exact production baseline shape (69 FKs across 62 source tables, 3 Auth triggers, 4 profile triggers, 36 profile columns, 109 `auth.uid()` policies and ten Auth-dependent functions).
- The same disposable run passed the exact 69-FK catalog comparison, Better Auth identity-root draft, expansion/validation/atomic cutover simulation, provisioning/referral/email/phone/organizer behavior, anonymous RLS regression, trusted-issuer RLS acceptance, fail-closed FK rollback and complete Stage 3 rollback. The local Supabase stack and temporary schema export were then stopped and deleted successfully.
- Exporter toolchain now pins Supabase CLI 3.1.0 and `pg-delta`. The read-only Production connection retains `sslmode=require`; only the local shadow-diff process removes inherited `PGSSLMODE`. A verified data-free schema dump is loaded into a temporary local shadow migration so cross-schema Auth trigger dependencies (including `public.handle_new_auth_user()`) are available while the emitted diff remains restricted to `auth,storage`.
- The successful baseline is **not** a migration on a hosted database. It does not mean the isolated Supabase staging project has the full application schema, that provisioning is enabled, or that positive-token Storage/private Realtime/Edge acceptance has completed.
- Production has 125 tables while the isolated staging project has 20; 112 Production tables are not yet represented there. Staging still has only `better-auth-oidc-acceptance` deployed. Do not deploy the nine Cloudinary/payment application handlers before the staging business schema and required per-function secrets are present and reviewed.
- Stage 4 organizer phone verification is provider-aware: Better Auth staging uses the Worker Telegram challenge/status API; the existing Supabase Auth SMS OTP branch remains only for Production compatibility.
- `SUPABASE_PROVISIONING_ENABLED=false` remains set. Cloudflare metadata has not shown a `SUPABASE_PROVISIONING_API_KEY` or legacy `SUPABASE_SERVICE_ROLE_KEY`. The remaining owner action for hosted identity projection is to create one staging-only `sb_secret_*` key and add it as Worker Secret `SUPABASE_PROVISIONING_API_KEY`. Do not transmit the key through chat or enable provisioning until its scope is reviewed.
- Transactional email remains deferred. Do not fabricate `emailVerified=true` or weaken the verified-email session gate. Google OAuth remains optional.
- Production Supabase `mvdczyitbkxkldjughor`, DB2, Production Pages, DNS, live users, existing Edge Functions and Production authentication remain unchanged. No reset, PR merge or Production cutover occurred.


## Historical checkpoint (superseded) — 10 November 2026

This older snapshot is retained for audit history only. Its in-progress baseline statement below was superseded by the successful disposable Stage 3 baseline recorded in the current checkpoint above.

- Repository: `taufx98/sykabelajar4.0`; branch: `security/auth-poc-stage-1`; branch head at this checkpoint: `106393fb1caf688d1e4167204a0f31fae79369b7`. PR #177 is open, Draft, unmerged and mergeable.
- Latest isolated Worker version remains `8dfa4dd7-f693-4e27-ad83-cc6af19702f8`, deployed by [Auth Worker Staging Deploy #42835586318](https://github.com/taufx98/sykabelajar4.0/actions/runs/42835586318). Hosted health, issuer, discovery, PKCE S256 and ES256/P-256 JWKS checks passed; no user/session/admin was seeded.
- [Auth Worker CI #42845884212](https://github.com/taufx98/sykabelajar4.0/actions/runs/42845884212) and [Supabase Local Auth Claims CI #42846448557](https://github.com/taufx98/sykabelajar4.0/actions/runs/42846448557) passed. The local claims suite includes the current anonymous-claim isolation contract.
- Stage 3 regression root cause was test-context leakage: the anonymous fixture left a preceding administrator's plural JWT claims in `request.jwt.claims`. The fixture now resets `request.jwt.claim`, `request.jwt.claims` and `request.jwt.claim.sub`; the contract requires all three.
- The schema-only export pipeline now pins Supabase CLI 3.1.0 and explicitly uses `pg-delta`. Its read-only Production catalog/psql connection retains TLS. The `PGSSLMODE` environment override is removed only for the local shadow diff, so the local non-TLS listener is not mistakenly forced to negotiate SSL.
- [Auth Production Schema Baseline #42846448678](https://github.com/taufx98/sykabelajar4.0/actions/runs/42846448678) is the current disposable full-schema export/restore run. It has passed static contracts and local-stack startup and is currently executing the schema-only export step. It has **not yet passed** restore, 69-FK verification/cutover simulation, provisioning/referral/organizer behavior, anonymous RLS, issuer guard, or rollback acceptance. Earlier failure #42844181638 exposed the anonymous JWT fixture leak; #42845571276 exposed the inherited TLS setting on the local shadow connection. Neither failure modified Production.
- Production has 125 tables while isolated staging has 20 (112 Production tables not yet represented in staging; seven staging-only items are migration/identity fixtures). Staging still has only the `better-auth-oidc-acceptance` Edge Function. Do not deploy the nine Cloudinary/payment application handlers until the business schema and per-function secrets are installed and reviewed.
- Stage 4 organizer phone verification is provider-aware: Better Auth staging uses the Worker Telegram challenge/status API; the existing Supabase Auth SMS OTP path remains only in the Production compatibility branch.
- `SUPABASE_PROVISIONING_ENABLED=false` remains set. Cloudflare metadata still shows no `SUPABASE_PROVISIONING_API_KEY` or legacy `SUPABASE_SERVICE_ROLE_KEY`. The owner prerequisite is one server-only `sb_secret_*` key for the isolated Supabase staging project, added as Cloudflare Worker Secret `SUPABASE_PROVISIONING_API_KEY`. Do not put it in Pages, GitHub source/logs or chat. Do not activate provisioning before key-scope review.
- Transactional email remains deferred; Google OAuth is optional. Do not manufacture `emailVerified=true` or weaken the verified-email session gate.
- Production Supabase `mvdczyitbkxkldjughor`, DB2, Production Pages, DNS, users, Edge Functions, auth routing and live data remain unchanged. No account reset, PR merge, or Production cutover occurred.

---

## Current Better Auth installation checkpoint — 10 November 2026

This is the latest verified state of the seven-stage migration. It supersedes earlier Worker/CI head references below. It does not authorize production cutover.

- Repository branch: `security/auth-poc-stage-1`; commit `696c382666d892509753c0bddefeb79da64489db`. PR #177 remains open, Draft, unmerged and mergeable.
- The latest isolated Cloudflare Worker deployment succeeded: [Auth Worker Staging Deploy #42835586318](https://github.com/taufx98/sykabelajar4.0/actions/runs/42835586318). Active Worker version: `8dfa4dd7-f693-4e27-ad83-cc6af19702f8`.
- Hosted Worker checks passed after deployment: `/healthz`, exact issuer `https://auth.sykabelajar.my.id/api/auth`, discovery metadata, PKCE S256, and public ES256/P-256 JWKS. No user, session, verification token or admin was seeded.
- [Auth Worker CI #42835596940](https://github.com/taufx98/sykabelajar4.0/actions/runs/42835596940) passed, including Worker tests, D1 migration dry run, frontend lint/typecheck/build and OIDC/JWKS checks. [Supabase Local Auth Claims CI #42835597021](https://github.com/taufx98/sykabelajar4.0/actions/runs/42835597021) passed, including local database startup, Better Auth claim contracts and ownership/RLS contracts. The current Cloudflare Pages check for this commit also passed.
- Cloudflare's read-only secret metadata check [#42821295627](https://github.com/taufx98/sykabelajar4.0/actions/runs/42821295627) confirmed `BETTER_AUTH_SECRET` and `AUTH_PROVIDER_ENCRYPTION_KEY` exist. It confirmed neither `SUPABASE_PROVISIONING_API_KEY` nor legacy `SUPABASE_SERVICE_ROLE_KEY` exists. The values of all secrets remained unread. Google OAuth credentials are also absent, but Google is optional and is not a login-core blocker.
- `SUPABASE_PROVISIONING_ENABLED=false` remains deployed. This is intentional: no server-only staging API key exists yet. New Worker code accepts exactly one of `SUPABASE_PROVISIONING_API_KEY` (preferred `sb_secret_*`, sent using `apikey` only) or the backward-compatible `SUPABASE_SERVICE_ROLE_KEY` legacy JWT binding; it rejects multiple bindings and publishable keys.
- The staging Supabase project `ydamszdfsxqisanazdkb` remains isolated and healthy. Current inventory is 20 fixture/identity tables and exactly one active Edge Function, `better-auth-oidc-acceptance`. `private.app_users`, `public.profiles`, `public.user_roles`, `public.user_settings`, and `public.organizers` contain zero application identities. Two rows in `auth_oidc_acceptance_rows`, four `legacy_auth_users` fixture rows and four FK-rehome fixture rows are test fixtures only, not accounts.
- Staging has the Better Auth issuer guard on the fixture profile/role surfaces, profile hydration columns, phone-status RPC, guarded provisioning/email/phone RPCs, and the hardened `create_organizer` issuer/origin checks. The full production-shaped application schema and its complete 69-FK identity cutover are not installed in staging; the identity-root/FK cutover SQL remains a draft pending the schema baseline and final end-of-build acceptance.
- The nine Cloudinary/payment Edge Function migrations and compatibility delegate remain implemented in source, not deployed. The staging project's 20-table fixture schema does not include the full app business tables or Cloudinary/payment runtime secrets, so deploying those handlers now would create endpoints that fail at runtime. Do not deploy them until the isolated staging schema and per-function environment are complete.
- Staging frontend selects the isolated Supabase project only on the exact `staging.sykabelajar.my.id` hostname and routes authentication through the Better Auth client. Production hostnames retain DB2 and the legacy Supabase Auth compatibility path. Production Pages, Production Supabase, DNS and login routing were not changed.
- Transactional email is still deferred. The Worker correctly does not fabricate `emailVerified=true` or bypass the verified-email session gate. Consequently a genuine hosted password signup/session lifecycle remains pending; this is not treated as proof that the system is fully accepted.
- Owner action required to activate identity projection: create a server-only `sb_secret_*` key in the isolated staging Supabase project and add it as a Cloudflare Worker Secret named `SUPABASE_PROVISIONING_API_KEY` on Worker `sykabelajar-auth-poc`. Do not send the value in chat or place it in Pages/GitHub source. Keep the flag disabled until installation and scope review are complete.
- Production Supabase `mvdczyitbkxkldjughor`, DB2, Production Edge Functions, DNS, live users and Production authentication remain untouched. No account reset, PR merge or Production cutover occurred.

---

## Worker installation checkpoint — 10 November 2026

This checkpoint records the latest isolated staging Worker installation. It does not authorize app-auth cutover or any Production mutation.

- Branch: `security/auth-poc-stage-1`; latest commit at this checkpoint: `a62139b8ea1199bcea4d071ee5e82e2b2cef6f26`. PR #177 remains Draft, open, unmerged and mergeable.
- [Auth Worker Staging Deploy #42821319370](https://github.com/taufx98/sykabelajar4.0/actions/runs/42821319370) completed successfully after the provisioning-key binding refactor. Cloudflare deployed Worker version `45e4e36f-21b3-49eb-9894-305935f8050d` to the isolated `sykabelajar-auth-poc` Worker. The prior Worker version `0a136c92-9421-4216-8cc8-68ac27b61106` was superseded.
- Deployment guard verified all 20 remote D1 tables, seven Better Auth user-registration columns, provider-aware email schema, exact redirect allowlist, and zero staging users/sessions/accounts/verification rows/phone challenges before deployment. Existing Worker secrets were preserved; no values were read, rotated, or printed.
- Post-deploy hosted checks passed: `/healthz`, exact issuer `https://auth.sykabelajar.my.id/api/auth`, discovery endpoints, PKCE S256 metadata, and public ES256/P-256 JWKS. The staging origin was accepted and attacker origin rejected.
- Worker deploy output confirms `emailAgentConfigured=false` and `googleOAuthCredentialsConfigured=false`; neither integration is required for deploying the Better Auth/OIDC core. No signup, user, session or role was seeded.
- `SUPABASE_PROVISIONING_ENABLED=false` remains unchanged because no server-only staging Supabase key is installed. Worker source now prefers the `SUPABASE_PROVISIONING_API_KEY` secret binding (`sb_secret_*`, `apikey` only); the legacy `SUPABASE_SERVICE_ROLE_KEY` name remains a backward-compatible JWT binding. Exactly one binding is accepted. The idempotent provisioning hooks are deployed but do not create application identities until the isolated staging secret is installed and provisioning is explicitly enabled.
- Latest [Auth Worker CI #42822143194](https://github.com/taufx98/sykabelajar4.0/actions/runs/42822143194) passed, including frontend lint/typecheck/build, Worker security contracts, D1 migration dry run and OIDC/JWKS smoke checks. [Cloudflare Pages preview #129850364251](https://github.com/taufx98/sykabelajar4.0/runs/129850364251) also passed for the latest source head.
- [Supabase Local Auth Claims CI #42822143187](https://github.com/taufx98/sykabelajar4.0/actions/runs/42822143187) passed, including local Supabase startup, JWT claims and ownership RLS. The temporary port collision was fixed by allocating a collision-resistant local API/database/shadow port block for each workflow run.
- The latest frontend preview also completed successfully for commit `ed8c6e3`: [Cloudflare Pages check #129838360758](https://github.com/taufx98/sykabelajar4.0/runs/129838360758), plus [frontend lint/typecheck/build #42818623316](https://github.com/taufx98/sykabelajar4.0/actions/runs/42818623316).
- The Supabase staging project intentionally contains the 20-row auth/identity fixture schema only; it is not a complete application-schema clone. It has one deployed Edge Function, `better-auth-oidc-acceptance`. Do not deploy all application Edge Functions against this incomplete schema. The full application schema/Edge runtime setup remains a Stage 3/5 build task before end-of-build acceptance.
- Production Supabase, DB2, Pages Production, DNS, user accounts, application Edge Functions and login routing remain untouched.

## Stage 5 authorization hardening and current CI checkpoint — 10 November 2026, 18:42 WIB

This checkpoint supersedes the older PR-head and `create_organizer` findings in the 10 November login-first checkpoint above. It records isolated staging and CI evidence only; it does not authorize production changes.

- PR #177 is still open, Draft, unmerged and mergeable. Branch `security/auth-poc-stage-1`; verified head `a03f17235c1ed3690d3b755c3f1779de561dd39b`.
- Current-head validation passed:
  - [Auth Worker CI #916](https://github.com/taufx98/sykabelajar4.0/actions/runs/42809358257) — Worker security contracts, D1/OIDC/JWKS integration and frontend lint/typecheck/build.
  - [Supabase Local Auth Claims CI #648](https://github.com/taufx98/sykabelajar4.0/actions/runs/42809358352) — 8 pgTAP files, **176 assertions**, including the 37-assertion phone/organizer contract with empty search_path, no anonymous execute, preserved authenticated onboarding permission, rejection of the Supabase Auth issuer, and rejection of `legacy_reference` UUID tombstones.
  - [Cloudflare staging read-only preflight](https://github.com/taufx98/sykabelajar4.0/actions/runs/42809353123) — success; no Worker secret values were read.
- Applied two additive DDL migrations only to isolated Supabase staging `ydamszdfsxqisanazdkb`:
  - `20261110113206_harden_stage3_create_organizer_search_path`
  - `20261110113945_require_better_auth_issuer_for_organizer`
- Post-apply catalog verification for `public.create_organizer(text,text)`: owner remains `postgres`; it remains `SECURITY DEFINER`; `search_path=""`; `anon` cannot execute; `authenticated` and `service_role` retain the intended grants. The function now checks the exact Better Auth issuer `https://auth.sykabelajar.my.id/api/auth` and requires `private.app_users.identity_origin='better_auth'` before the existing organizer-role, verified-email, trusted-phone and one-free-claim checks. It is intentional that authenticated users can call this RPC for organizer onboarding; do not blindly revoke that grant. The remaining Advisor warning is therefore retained for function-by-function review, not hidden or mass-revoked.
- The local Supabase fixture, pgTAP test and Stage 3 identity-root draft are aligned with those two safeguards. The local migration filenames match the version numbers recorded by the hosted staging migration history.
- Read-only staging row counts after the migrations: `auth.users=0`, `private.app_users=0`, `public.profiles=0`, `public.user_roles=0`, `public.user_settings=0`. No synthetic user/admin was created or left behind.
- The top-level roadmap now makes the login-provider boundary explicit: email/password is the core login path; Google OAuth is optional; transactional email is deferred. The real hosted session acceptance is still pending because Better Auth correctly requires genuine email verification and no delivery provider or optional social provider is configured. Do not fabricate `emailVerified` or weaken that security gate.
- `SUPABASE_PROVISIONING_ENABLED=false` remains unchanged; no staging provisioning secret was installed. Positive real-token Storage, Realtime WebSocket and application Edge Function acceptance, real browser session lifecycle, app Edge deployment, and full role/business regression remain open.
- Production Supabase `mvdczyitbkxkldjughor`, DB2, production Pages/login routing, DNS, app Edge Functions and user data were not modified. PR was not merged and production cutover was not attempted.


# Better Auth migration — live readiness and rollback record

Status date: 10 November 2026  
Scope: SYKABELAJAR 4.0, production Supabase project `mvdczyitbkxkldjughor`, isolated Better Auth branch `security/auth-poc-stage-1`.

This is a verified status record, not authorization to deploy or migrate production. The authoritative DNS delegation for `sykabelajar.my.id` is confirmed to Cloudflare by all five `my.id` authoritative servers; the earlier IDWebHost interpretation was incorrect and is superseded. The isolated Better Auth Worker and D1 are deployed and currently healthy at `auth.sykabelajar.my.id`. The latest guarded staging deploy is [Auth Worker Staging Deploy #18](https://github.com/taufx98/sykabelajar4.0/actions/runs/42653879313), Cloudflare Worker version `762291b0-7981-44ae-b3e6-a2bcec8fa874`. Production Supabase Auth/schema/data and the live app's login path remain unchanged.

## Latest code and staging recheck — 10 November 2026, 18:05 WIB

- Branch head: `d68ac1539d7d5752b56beb4d747524744a0f547f`. The source files in this head match the implementation tested on `e704579457b2ff2b23738809073df24773882f3f`; subsequent commits only refreshed the status/runbook and retained that exact source implementation. PR #177 remains Draft, open and unmerged.
- This commit changes only `services/auth-worker/src/supabase-provisioning.mjs` and its focused tests. Modern Supabase `sb_secret_` keys are sent in `apikey` only; no invalid Bearer JWT is generated. Legacy `service_role` JWT compatibility remains. A `sb_publishable_` key is rejected for server provisioning.
- The source implementation passed [Auth Worker CI #42803383616](https://github.com/taufx98/sykabelajar4.0/actions/runs/42803383616) and [Supabase Local Auth Claims CI #42803383180](https://github.com/taufx98/sykabelajar4.0/actions/runs/42803383180). The latest documentation/source-preserving branch head was rechecked by [Auth Worker CI #42805092628](https://github.com/taufx98/sykabelajar4.0/actions/runs/42805092628) and [Supabase Local Auth Claims CI #42805092746](https://github.com/taufx98/sykabelajar4.0/actions/runs/42805092746), both success. The read-only Cloudflare staging preflight [#42803375258](https://github.com/taufx98/sykabelajar4.0/actions/runs/42803375258) also passed.
- Live Supabase tool inspection confirms the isolated staging project is healthy and records 13 fixture/staging migrations through `20261110100159_better_auth_profile_hydration`. The application identity, profile, user-role and user-settings tables each remain empty. One synthetic OIDC acceptance fixture and isolated FK test fixtures remain in place by design.
- The only deployed staging Edge Function is `better-auth-oidc-acceptance` (version 2, `verify_jwt=false` because its handler performs the custom Better Auth token verification itself). No business/application Edge Function was deployed.
- Supabase Security Advisor reports 17 informational RLS-enabled/no-policy fixture tables (closed by RLS default-deny and/or private-schema isolation) and one warning for `public.create_organizer` being callable by authenticated users as SECURITY DEFINER. This warning requires function-body/grant review as part of Stage 5; no policy, grant or function was altered in response to an advisory alone.
- The Worker secret preflight still shows no Supabase provisioning secret binding. `SUPABASE_PROVISIONING_ENABLED=false` remains unchanged. The new key header code is now ready for a secret installed by the owner in the staging Worker only; do not put it in Pages, source, CI logs or chat.
- Email delivery remains intentionally deferred. Google and other social providers are optional, not a required dependency for the code foundation. No social credential, email provider, fake user, session, role or admin was added. Email verification remains fail-closed.
- Read-only production catalog recheck confirms **69 application foreign keys** still point to `auth.users` (65 in `public`, 4 in `private`; 10 additional internal `auth`-schema FKs are outside the app migration count), **3 triggers on `auth.users`**, and **109 policies using `auth.uid()` across 61 tables**. The database has 235 total policies and 343 `SECURITY DEFINER` functions in `public/private`; all 343 have a pinned `search_path` in the catalog query.
- Production Security Advisor currently flags 46 `SECURITY DEFINER` functions callable by `anon`, plus 23 RLS-enabled tables with no policies and the disabled leaked-password-protection Auth setting. Some public exam, competition, participant and certificate RPCs may intentionally be callable anonymously and perform their own access-token checks. These warnings are not a basis for blanket revocation: Stage 5 must review each function's body, grants and business intent before any migration. No grant, function, policy or Auth setting was changed.
- Production project `mvdczyitbkxkldjughor`, production Pages environment, DNS, login routing and user data were not modified.

## Executive status — rechecked 10 November 2026, 18:05 WIB

| Stage | Implemented / verified | Still open |
|---|---|---|
| 1. Cloudflare Worker + D1 + Better Auth | Isolated Worker/D1 deployed; hosted health, OIDC discovery, PKCE S256, ES256/P-256 JWKS, issuer, CORS and Admin API negative-origin checks pass. Pages Preview preflight is green. Login page renders in Chromium. Auth Worker CI and local D1/auth integration pass on the identical Worker source content from `e704579`. | A real authenticated browser session has not been established. Email/password requires a genuinely verified email; transactional email is explicitly deferred. Social OAuth providers are optional and currently unconfigured. |
| 2. OIDC/JWT + Supabase Custom OIDC | Hosted issuer registration, discovery, PKCE, ES256/JWKS, UUID subject, audience, role claim, short token expiry, synthetic Data API and two-user RLS contract checks pass. | Positive hosted Storage HTTP, private Realtime WebSocket and Edge probe calls with a real Better Auth resource token remain untested. |
| 3. Supabase identity foundation | Isolated staging migrations and provisioning RPCs exist; identity-origin guard, profile hydration and caller-scoped profile/role policies are applied. Two-user rollback-only staging test passed and left identity/profile/role/admin tables empty. | Worker provisioning secret is not installed. Keep `SUPABASE_PROVISIONING_ENABLED=false`. No real user projection or first-admin bootstrap has occurred. Production identity schema, FKs, triggers and RLS remain unchanged. |
| 4. Frontend migration | Better Auth client, provider-neutral session bridge, login/register/recovery routes, staging-only DB selection and Admin login-method panel are implemented in the branch. Browser smoke verifies the login page and assets render without uncaught errors. | Real sign-in/session hydration, refresh, cross-tab/account switch, expiry/logout and Realtime re-auth have not passed hosted browser acceptance. |
| 5. Backend Edge/RPC/RLS | Better Auth JWT verifier, identity helper, caller-UUID ownership checks and Cloudinary/payment source integration are implemented and type-/contract-tested. This session added correct `sb_secret_` API-key header handling and tests; Auth Worker CI and Supabase Local Auth Claims CI pass. | App Edge Functions have not been deployed. Real-token two-user IDOR, Storage/Realtime/Edge, Cloudinary/payment acceptance and operation-by-operation review of 109 production RLS policies remain open. |
| 6. Demo reset + full regression | First-admin bootstrap protections, identity-lineage guard, synthetic SQL tests and local pgTAP coverage are prepared. | No demo accounts have been classified/reset; no real staging admin exists; full role and application regression has not been run. No account has been deleted. |
| 7. Production cutover + monitoring + rollback | Cutover/rollback boundaries are documented. | Not started. No Production auth setting, secret, schema, Edge deployment, DNS, account reset or login route was changed. Production cutover requires separate explicit approval. |

Google/Facebook/X OAuth credentials are optional social-login integrations, not prerequisites for the Better Auth core or the email/password login UI. However, the current Worker deliberately requires `user.emailVerified === true` before issuing a session. Because transactional email is deferred and no social provider has been configured, a real verified hosted session cannot yet be created. Do not bypass that security gate or invent a verified state.



## Latest verified staging progress — 10 November 2026, 17:24 WIB

- Latest branch head at this verification: fc4a5e8342d99fda3d21e301ccccb37efc9bde1f. Cloudflare Pages check for this exact commit completed successfully. The read-only Cloudflare preflight #42796051557 is green; it confirmed Pages Preview and staging Worker resources without changing configuration.
- Pages Preview has the four staging-only Better Auth variables. Existing DB2 variables and the masked VITE_SUPABASE_ANON_KEY secret-text variable were preserved; no Production environment or DB2 setting was changed.
- Latest real-browser acceptance #42798309648 passed **2 tests**: /login renders successfully and the Worker provider-discovery endpoint returns the exact issuer with the allowlisted response shape. Google OAuth state/cookie test was conditionally skipped because the Worker currently has no Google credentials. Provider list output was empty.
- Read-only Worker secret metadata from Cloudflare preflight confirms BETTER_AUTH_SECRET and AUTH_PROVIDER_ENCRYPTION_KEY are present. GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and SUPABASE_SERVICE_ROLE_KEY are absent. The workflow reads only secret names/types and never reads or prints secret values.
- Fixed hosted staging mismatch: migration 20261110095016_better_auth_phone_status_rpc adds the server-only phone-verification status wrapper expected by the Worker. Only service_role may execute it; anon and authenticated cannot. Unknown UUID returns false.
- Fixed hosted profile hydration contract: migration 20261110100159_better_auth_profile_hydration adds only the profile columns confirmed by the repository runtime contract and creates profiles_better_auth_select_own. authenticated has SELECT only; anon has no SELECT. The policy requires both id=auth.uid() and the exact Better Auth issuer.
- Live rollback-only staging SQL acceptance provisioned two synthetic identities through the server-only RPC and verified that user A sees only A's profile/role (A profile=1, B profile=0, A role=1, B role=0). The transaction rolled back and no synthetic rows remain. A final read confirmed auth.users=0, private.app_users=0, profiles=0, user_roles=0 and admin roles=0.
- Frontend no longer queries or infers verification from the unverified/nonexistent profiles.status column. User.verified remains unset rather than inventing a verification badge.
- Latest checks on head fc4a5e8 passed: Auth Worker CI #42798316347 and Supabase Local Auth Claims CI #42798316290 (attempt 2). The local Supabase run completed all 8 pgTAP files and **171 tests**, including identity_profile_rls.test.sql; result PASS. Browser smoke #42798309648 completed 2 passed, 1 conditionally skipped.
- Hard blockers requiring owner-controlled account configuration: create Google OAuth client with callback https://auth.sykabelajar.my.id/api/auth/callback/google and install both client values as Worker secrets together; separately add the staging Supabase service-role key only after reviewing the Worker provisioning permissions. Keep SUPABASE_PROVISIONING_ENABLED=false until the binding exists and provisioning lifecycle has been reviewed. Never share credentials, tokens or session cookies in chat.
- ZeptoMail remains fully deferred. No mail sender has been configured and no email has been sent. Do not weaken the Google verified-email rule.
- PR #177 remains Draft, open, mergeable and unmerged. Production Supabase, Production Pages variables, production login routing, app Edge deployments, production DNS and accounts remain unchanged.

## Latest Pages Preview and first-admin readiness — 10 November 2026 (rechecked 15:36 WIB)

- Read-only Pages Preview preflight [#8, attempt 3](https://github.com/taufx98/sykabelajar4.0/actions/runs/42744355355) now confirms all seven checks are `true` and `betterAuthPreviewReady=true`.
- The four Better Auth variables are present in the Pages **Preview** environment: `VITE_BETTER_AUTH_SUPABASE_URL` points to isolated staging project `ydamszdfsxqisanazdkb`; `VITE_BETTER_AUTH_SUPABASE_PUBLISHABLE_KEY` is a valid `sb_publishable_` key and its type is now `plain_text`; `VITE_BETTER_AUTH_FRONTEND_ENABLED=true`; and `VITE_AUTH_WORKER_URL` points to `auth.sykabelajar.my.id`.
- Existing shared DB2 variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` remain present and unchanged. Existing `VITE_SUPABASE_ANON_KEY` remains `secret_text` and was not edited, deleted, copied, or recreated. Preflight did not expose or print any key value.
- Source selection is explicit and tested: only exact hostname `staging.sykabelajar.my.id` selects the isolated Better Auth Supabase project; production, www, localhost, and generic `pages.dev` hosts keep the shared existing Supabase configuration. See `src/lib/supabaseEnvironment.mjs` and `scripts/auth-migration/supabase-environment-selection.test.mjs`.
- The `/login` route is present in `src/App.tsx`, and `src/pages/LoginPage.tsx` contains the email/password form. Vite `import.meta.env` values are embedded at build time, so changing Cloudflare Pages variables alone does not change an already deployed bundle. The staging preview must be redeployed after the variables were saved; a fresh branch commit is being used to trigger that Preview build. This is a staging-only refresh; do not change Pages Production, DNS, DB2, or production Supabase.
- The current head's frontend lint/typecheck/build and Worker security tests passed in [Auth Worker CI #876](https://github.com/taufx98/sykabelajar4.0/actions/runs/42744593882); local Supabase identity/RLS contract passed in [Supabase Local Auth Claims CI #611](https://github.com/taufx98/sykabelajar4.0/actions/runs/42744594066). These are code CI results, not proof of a completed Cloudflare Pages deployment or positive browser login.
- The first-admin SQL/runbook is prepared and its 15-assertion local pgTAP contract passed in [Supabase Local Auth Claims CI #561](https://github.com/taufx98/sykabelajar4.0/actions/runs/42663635674). A separate live staging transaction tested the provisioning guard with synthetic UUIDs and rolled back; current staging identity/profile/role counts remain zero. The first admin SQL has not been run for a real owner identity.
- Google OAuth credentials, real owner sign-in, and a verified Better Auth browser session are still pending. Do not paste credentials or session tokens into chat.


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


## Continuation checkpoint — 8 November 2026 (code snapshot e49d245; password + ZeptoMail Admin default verified)

This checkpoint supersedes the older Stage 4 progress counts and any earlier statement that the Stage 3 production-schema baseline/restore had not been completed. It records the state verified during the 8 November continuation. It does not authorize production cutover.

### Latest CI for the password and ZeptoMail Admin code snapshot

- [Auth Worker CI #520](https://github.com/taufx98/sykabelajar4.0/actions/runs/42463254031) passed on code head `e49d245a30012bda206452f4e5177dfc3686893d`. It includes Worker security/typecheck, local D1/OIDC/password-change integration tests, frontend dependency inventory, email-admin/JWT contracts, Worker dry run, and frontend lint/typecheck/build without deployment.
- [Supabase Local Auth Claims CI #351](https://github.com/taufx98/sykabelajar4.0/actions/runs/42463254033) passed on the same code head. It includes the disabled Better Auth transport contract, Edge JWT/Cloudinary type checks, anonymous staging Edge-probe rejection, schema/identity plan contracts, and isolated local Supabase JWT/RLS acceptance.
- [Auth Cloudflare Staging Preflight #163](https://github.com/taufx98/sykabelajar4.0/actions/runs/42462936143) passed on the preceding runtime code head `82c4986c8530e838880d59b2f51d215fa7d7e480`. It was read-only and did not deploy the Worker or alter staging resources. No runtime Worker/deployment configuration changed after that preflight; the later edits are Admin UI defaults and tests.
- [Auth Worker CI #521](https://github.com/taufx98/sykabelajar4.0/actions/runs/42463485340) also passed after the documentation update on snapshot `ff41cbd4f81924bab795f6e01ffa64145a055c00`; both lint/typecheck/build and Worker security/D1/OIDC dry-run jobs succeeded. No deploy occurred.
- [Auth Cloudflare Staging Preflight #164](https://github.com/taufx98/sykabelajar4.0/actions/runs/42463485313) passed on that same documentation-only snapshot. Its job is explicitly read-only Cloudflare account and staging resource inspection; it did not deploy or modify Worker/D1 resources.
- PR #177 remains Draft/unmerged and its base relationship remains dirty. Keep Better Auth disabled in production; do not force-merge.

### Stage 1 — isolated Worker, email, and provider activation

- The isolated Cloudflare D1/Worker deployment and migrations 0000–0006 remain the staging baseline; do not point this Worker or D1 binding at production.
- The Worker uses the managed email dispatcher with ZeptoMail support. The existing `ZeptoMailSettingsPanel` is already mounted in Admin Core `/admin/core?tab=settings`; the panel now defaults new Agent drafts to ZeptoMail and lists Brevo Free as the fallback. Existing accounts are not silently changed or activated. The latest recorded staging state still has no configured/active Brevo or ZeptoMail sender account, so real signup verification and password-reset delivery remain unaccepted and fail closed. The owner must enter a verified sender address and Agent Send Mail Token directly in the staging Admin panel, save the encrypted credential, activate the Agent, and test only to the signed-in admin account. Do not paste the token into chat.
- Google/Facebook/X credentials remain optional and absent in the last confirmed staging inventory. Telegram is only a separate phone-consent step; BotFather OIDC registration, callback allowlisting, Worker credentials, and a real hosted consent/callback test remain outstanding. Instagram personal-account login is not wired as an ordinary OAuth provider.

### Stage 2 — OIDC/JWT and Supabase service surfaces

- Hosted Custom OIDC acceptance [#42328168345](https://github.com/taufx98/sykabelajar4.0/actions/runs/42328168345) passed on the isolated Free Supabase project: discovery/PKCE S256, ES256/P-256 JWKS, authorization-code exchange, resource audience and UUID subject, short token lifetime, Data API acceptance, two-user RLS isolation, signature-tamper rejection, and session-bound UserInfo invalidation.
- The read-only staging probe `better-auth-oidc-acceptance` is ACTIVE (version 1) on the isolated project. Its handler verifies the external token with pinned `@supabase/server@1.9.2`, enforces exact issuer/audience/UUID/role/lifetime, and only reads the caller's synthetic fixture row.
- **Still open:** no positive hosted invocation of that Edge probe with a real Better Auth token; no Storage HTTP upload/download with that token; and no Realtime WebSocket private-topic join/broadcast with that token. Previous SQL/RLS fixtures are not substitutes for those protocol-level tests.
- Read-only staging inventory on 8 November found two retained synthetic OIDC fixture rows, zero `private.app_users` rows, zero objects/bucket under the reserved `auth-stage2-proof` acceptance name, and no leftover `better_auth_stage2_*` Storage or Realtime policies. No test bucket or temporary policy was created during this continuation.

### Stage 3 — production identity foundation

- [Auth Production Schema Baseline #42398676006](https://github.com/taufx98/sykabelajar4.0/actions/runs/42398676006) passed the full schema-only export/restore and disposable production-shaped acceptance. It compared the 69 application FKs, triggers, profile shape, ACLs and 109 auth.uid() policies, simulated the identity-root/issuer/FK plan on the disposable restore, and cleaned up the temporary environment.
- The 8 November read-only production recheck still found no production `private.app_users`, all 69 application FKs still referencing `auth.users(id)`, and the three non-internal Auth triggers still present. The isolated staging identity projection remains empty.
- The revised fresh-account identity-root draft, UUID-only tombstones, retirement of the three old Auth triggers, 69-FK rehome and Better Auth-only issuer guard remain draft-only. **Do not execute production DDL/FK/issuer changes without a separately approved maintenance window, explicit owner approval, and final preflight/rollback review.** No production DDL/DML, app data, Auth settings, secrets, issuer, Worker, or live login route was changed in this continuation.

### Stage 4 — frontend preparation, not cutover

- The current [frontend migration inventory](AUTH-FRONTEND-MIGRATION-INVENTORY.md) records **17 direct `supabase.auth` callsites across five files** as of 8 November, not the older 36/41 counts above.
- Nine identity-only lookup paths now use the shared provider-neutral identity accessor. AppContext remains the single owner of provider subscription, hydration, guest behavior, cache invalidation, and the 25-minute idle logout contract. The app-owned auth service and session-event bridge remain the only session coordination layer.
- The typed Better Auth HTTP transport and in-memory short-lived resource-token broker are prepared behind an explicit preview-only flag bound to the isolated staging Supabase project. Supabase Auth remains the production/default provider; no production login path was switched.
- The ZeptoMail Admin panel is already mounted in `/admin/core?tab=settings`; new Agent drafts now default to ZeptoMail and Brevo Free remains an explicit fallback. This is only a UI default: no sender account was created, activated, or charged. Real verification/reset email remains blocked until the owner configures a verified sender and Agent token directly in the staging Admin panel.
- The Google/Facebook/X login-provider Admin panel is still **not implemented**. The Worker currently reads these optional credentials only from server-side environment pairs; no D1-backed encrypted settings API exists. A safe UI requires an additive D1 migration, a separate `AUTH_PROVIDER_ENCRYPTION_KEY`, write-only encrypted secrets, active-admin APIs, and cache-revision invalidation for the Better Auth instance. Instagram is not a consumer login provider; Telegram remains phone verification.
- `ProfileInterfaceSettingsPage` no longer calls Supabase Auth directly for password changes. It uses provider-neutral `auth.service.updatePassword()`: production/default Supabase mode keeps its previous `updateUser` behavior; the Better Auth preview requires the current password, calls `/change-password` with `revokeOtherSessions=true`, and clears the short-lived cached resource token. The local Worker integration test verifies incorrect current password rejection, successful password change, rejection of the old password, revocation of a second device session, and continued use of the active session/cookie. OAuth accounts without a credential password must use the existing email “Lupa Password” flow; real reset-email delivery remains blocked until the staging sender is configured.
- Remaining direct calls have different responsibilities and must not be replaced mechanically: core credential/session wrappers, organizer email/phone verification, and the legacy private-chat service/Admin Chat Console. The chat callsites are not a feature to migrate; preserve the separate decision to retire private chat rather than carry it into Better Auth. Organizer phone verification remains gated on the trusted Telegram consent/projection path.
- The temporary typed fetch transport remains an explicit staging scaffold; a final SDK/transport decision and full UX regression are still required before cutover.

### Stage 5 — backend preparation, not deployment

- The shared fail-closed `requireApplicationUser()` resolver and seven Cloudinary/payment handler adaptations remain branch-only. `AUTH_IDENTITY_MODE=supabase` remains the default; `better-auth` is opt-in only.
- No production Edge Function was deployed and no production mode flag changed. Hosted positive Better Auth-token and two-user IDOR acceptance for the affected handlers, schema-compatible staging deployment, and a separate endpoint deployment review remain open.

### Stages 6–7 — reset and production

- Account classification/reset, admin bootstrap, full end-to-end regression, production monitoring, cutover, and rollback rehearsal remain not started.
- Preserve PR #177 as Draft/unmerged until Stage 2 service-surface acceptance, controlled Stage 3 production approval, Stage 4/5 acceptance, base reconciliation, and rollback gates are all complete.

## Owner-priority checkpoint — 8 November 2026 (login first; transactional email deferred)

The owner has explicitly changed the execution order: **finish Better Auth login, OIDC resource access, identity migration, frontend/backend integration and login regression before configuring transactional email**. Do not configure, activate, test or spend time on ZeptoMail/Brevo until the login/migration work is complete. The Admin panel may retain its ZeptoMail-first UI default, but no sender account is to be created or activated during this workstream.

Execution focus within the existing seven-stage roadmap:

1. **Stage 1:** Cloudflare Worker, custom auth hostname, dedicated Free D1, Better Auth schema/migrations and ES256 key infrastructure are already in place on isolated staging. Treat the infrastructure foundation as complete for login work; defer only transactional email. Telegram phone verification remains an optional separate gate, not a login prerequisite.
2. **Stage 2:** Core hosted Custom OIDC/JWT/Data API/two-user RLS acceptance is complete. Close the remaining positive Storage HTTP, Realtime WebSocket and Edge Function token tests using an actual verified Better Auth session. Prefer the Google social-login test path while transactional email is deferred.
3. **Stage 3:** The identity-root/69-FK/issuer plan and full disposable production-schema acceptance have passed. Do not mutate production until the explicit owner approval and maintenance-window/rollback gates are satisfied. Complete the isolated staging identity projection and test it before the production operation.
4. **Stage 4:** The provider-neutral auth service, AppContext single-session adapter, shared Supabase SDK `accessToken` injection, Google/Facebook/X login controls and Admin “Metode Login” panel are now in branch. Better Auth remains off by default; migration 0007, encryption-key setup, OAuth app credentials, real social callback acceptance and positive Supabase Data API/Storage/Realtime/Edge token tests remain.
5. **Stage 5:** The shared JWT identity resolver and seven Cloudinary/payment handler source adaptations remain branch-only. Integrate and test against the Better Auth-only issuer after Stage 3/4 acceptance; do not retain the legacy Supabase Auth issuer after the fresh-account-only cutover.
6. **Stage 6:** Do not delete demo accounts or application data until identity ownership/classification is verified. Then create the first admin through the audited bootstrap path and run login/session/refresh/logout, role, RLS, Storage, Realtime, Edge and feature regressions. Keep email-delivery acceptance for the final email phase.
7. **Stage 7:** Perform production cutover only after all gates, explicit approvals, free-tier quota checks, monitoring and rollback rehearsal pass. Then configure/test the transactional email provider as the final deferred work item.

No production schema, account, secret, OAuth provider, DNS, Worker deployment or login route is changed by this checkpoint.


## Owner decision — no legacy account migration (8 November 2026)

The owner explicitly confirmed that SYKABELAJAR login will start from zero: **do not migrate Supabase Auth accounts**. Do not copy old emails, password hashes, provider identities, OAuth tokens, sessions, email/phone verification state, or user metadata into Better Auth or the new identity root. New accounts receive fresh Better Auth UUIDs and new application profiles/roles from the trusted provisioning RPC.

The 69 existing application foreign keys still need valid parent UUIDs if existing application data is retained. The revised FK generator therefore creates only identity_origin='legacy_reference' UUID tombstones from currently referenced child FK values. This is referential-integrity metadata, not an account: no email, credentials, session, verified state, or role is copied, and it cannot create a Better Auth session. Old Auth UUIDs with no dependent application FK row are not included. The Stage 3 identity draft drops the three legacy Auth signup/referral triggers and the RLS issuer draft accepts only the Better Auth issuer; legacy Supabase Auth JWTs are not accepted after that cutover.

This revised SQL/generator/workflow has not yet passed fresh CI or a new full-schema disposable restore. Production remains unchanged: no private.app_users, all 69 FKs still target auth.users, and the three original Auth triggers remain. The new plan does not delete old application records or old auth.users rows. Stage 6 will classify and clean those separately; no destructive reset will be performed without its own approval.


## Staging login infrastructure checkpoint — 8 November 2026

- D1 remote migration workflow [#42470369751](https://github.com/taufx98/sykabelajar4.0/actions/runs/42470369751) passed. It verified the fixed database name/UUID and applied the reviewed additive migration 0007 (managed social provider settings and metadata). Remote verification found all 20 expected tables, all seven registration/profile columns and the encrypted-provider settings columns. No account, session, OAuth credential or user row was seeded.
- Worker staging deploy [#42470726571](https://github.com/taufx98/sykabelajar4.0/actions/runs/42470726571) passed after Worker typecheck/security tests, fixed-target preflight, 20-table verification, deploy, and hosted health/issuer/discovery/PKCE/JWKS checks. Deployed Worker version: `a3b0411e-0794-47e5-bfb7-36a8c778b928`.
- The deploy step created a dedicated random 256-bit AUTH_PROVIDER_ENCRYPTION_KEY Cloudflare secret because no binding existed. The key was never printed or stored in the repository. Future deployments first list secret names and preserve this key; they do not rotate it.
- Hosted deployment diagnostic confirmed Google OAuth credentials are absent, the email Agent is not configured, and no user/session was seeded. Email remains deferred by owner instruction. Social providers are not active until OAuth credentials are added; the first Better Auth staging admin/bootstrap is still required before the Metode Login admin panel can save credentials.
- Production remains untouched. This staging deployment did not enable the Better Auth frontend flag in production, did not enable Supabase provisioning, did not change production DNS or Supabase Auth settings, and did not run any production DDL/DML.

## Stage 4/5 implementation checkpoint — 8 November 2026

### Stage 4 branch changes

- Registration UI and regression tests now match the Better Auth worker contract: password minimum 8 characters and username 3–40 lowercase safe characters.
- Password reset emails in Better Auth mode point to the BrowserRouter `/reset-password` page. The page consumes the single-use query token in memory, removes it from the visible URL/history, validates the new password, and completes recovery through the selected provider. Legacy Supabase recovery redirection remains unchanged.
- Login recognizes the unverified-email response and exposes a resend action. The helper sends through Better Auth or `supabase.auth.resend(type: signup)` according to the selected provider; the UI uses a generic result for unknown, verified and rate-limited addresses.
- Organizer onboarding now reads the verified-phone boolean from an authenticated Worker session and starts Telegram OIDC in Better Auth mode. The browser does not submit an identity UUID or verification claim. The old Supabase Auth OTP path remains for legacy mode. The phone-status RPC exists only in the Stage 3 SQL draft and disposable fixture until the approved Stage 3 migration is applied.

### Stage 5 branch changes

- The seven resolver-backed handlers and their `verify_jwt=false` gateway routing remain source-only. This does not remove endpoint authentication: each handler performs in-handler verification and operation-specific checks before privileged data access.
- Tests cover Cloudinary caller-owned profile namespaces, exact UUID profile deletion, payment order ownership and reconciliation constraints, user-context admin checks, Midtrans bearer forwarding, and independent webhook signature validation.
- The Stage 5 migration matrix was reconciled with the current dual-mode implementation and V2 alias boundary.

### CI evidence at this checkpoint

- [Auth Worker CI #42503883055](https://github.com/taufx98/sykabelajar4.0/actions/runs/42503883055) passed both jobs on head `ae8e8a1`: Worker/security tests, D1 migration checks, OIDC/JWKS smoke and dry-run, frontend lint, typecheck and build. This validates branch code only; it is not a Worker deployment.
- [Supabase Local Auth Claims CI #42503878656](https://github.com/taufx98/sykabelajar4.0/actions/runs/42503878656) completed successfully on the frontend-contract update, including the local JWT/RLS/pgTAP suite. The previously reported 73/73 assertions remain green.
- Cloudflare Pages branch preview built successfully for head `ae8e8a1`: [security-auth-poc-stage-1 preview](https://security-auth-poc-stage-1.sykabelajar4.pages.dev). This is a Pages preview only; it does not deploy the Auth Worker or change the production app.

No production Supabase schema, function, trigger, grant, policy, account, Worker secret, Cloudflare route, login flag or Edge Function was changed. PR #177 remains Draft and unmerged.

### Admin transactional-email panel identity bridge — 8 November 2026

The Admin ZeptoMail/Brevo panel already uses the shared Supabase resource-token provider. In Better Auth preview, the Worker recognizes only the exact configured Better Auth issuer, cryptographically verifies the ES256 resource token against issuer JWKS and audience, verifies matching `sub` through UserInfo and requires `email_verified=true`, then checks the active `admin` business-role row only in the isolated Free Supabase project using the Worker-held service-role key. The legacy Supabase Auth verifier remains available for the default provider path. The browser receives neither service-role credentials nor stored email-provider tokens. No provider credential was entered and no test email was sent.

## Stage 4/5 continuation checkpoint — 9 November 2026

### Changes and acceptance since the 8 November checkpoint

- **Referral read RPCs:** the Stage 3 identity draft now preserves the legacy output shape of `get_my_referrals()` (8 columns), `get_my_referrals_v2()` (9 columns), and `get_my_verified_referrals()` (5 columns), returns typed `NULL::timestamptz` for `last_login_at`, uses empty `search_path`, and grants EXECUTE only to `authenticated`. Production-shaped SQL now checks the output fields, referrer scope, and denial of `anon`/`service_role`. This remains a draft; production grants are unchanged.
- **Password recovery:** the Worker integration test now follows the actual reset email action URL and verifies it returns to the app origin/path `/reset-password` with the exact single-use token expected by the frontend page. It also allows only the Worker test's `localhost`/`127.0.0.1` loopback host alias at the same port.
- **Cloudinary profile deletion:** the branch endpoint now reads username from the verified caller's own profile via the caller-scoped Supabase client and accepts the exact username profile/cover path plus the exact UUID legacy path. Other users' IDs, products, organizers and nested paths are rejected before the Cloudinary secret/provider call.
- **CI:** [Auth Worker CI #42510452619](https://github.com/taufx98/sykabelajar4.0/actions/runs/42510452619) passed both jobs on head `72b077a`: local Worker/D1/auth/OAuth integration tests, Worker bundle dry-run, frontend lint, typecheck and build. [Supabase Local Auth Claims CI #42510373128](https://github.com/taufx98/sykabelajar4.0/actions/runs/42510373128) passed the Cloudinary ownership contracts, Deno type-check, Edge verifier/webhook contracts and local JWT/RLS tests. [Auth Production Schema Baseline #42509768714](https://github.com/taufx98/sykabelajar4.0/actions/runs/42509768714) passed the schema-only export, disposable restore, 69-FK simulation, production-shaped provisioning/referral/phone/organizer regression, issuer/RLS acceptance and rollback simulations.
- **Staging preflight:** [#42510452626](https://github.com/taufx98/sykabelajar4.0/actions/runs/42510452626) passed the Cloudflare account/staging resource preflight. This is not a Worker deploy or production change.

### Still gated

- PR #177 is still Draft, unmerged, and GitHub reports `mergeable=false`; do not force merge or rebase while the branch's base-branch state is unresolved.
- No Better Auth production flag, Cloudflare Worker deployment, Supabase Edge deployment/config, production SQL/ACL/RLS/trigger, user/account, credential or Cloudinary asset was changed.
- Real Google/Facebook/X OAuth client credentials, initial staging admin bootstrap, real ZeptoMail delivery, and live Telegram consent/callback are not configured/accepted yet.
- Positive hosted Storage upload/download, Realtime WebSocket, and two-user Edge/IDOR acceptance with a real Better Auth session remain open. All 109 RLS policy operations still need a table/operation/role coverage sign-off; the disposable run is representative and production-shaped, not proof of exhaustive operation-by-operation coverage.
- Stage 5 SQL/trigger lifecycle still needs the remaining focused profile-trigger parity and legacy trigger-overlap review before production DDL. Keep all production data/roles/triggers untouched until owner approval and rollback sign-off.

### Better Auth email callback result — 9 November 2026

Signup and resend verification now use the public `/auth/verified` callback route. The frontend page reads the actual Worker session and confirms success only when `emailVerified=true`; URL query status is not treated as proof. Worker integration follows the issued verification link and checks the exact callback origin/path. Auth Worker CI [#42511915688](https://github.com/taufx98/sykabelajar4.0/actions/runs/42511915688) passed. This validates local integration behavior; real hosted ZeptoMail delivery/provider credentials are still not configured.

## Profile trigger and RLS inventory acceptance — 9 November 2026

The latest schema-only snapshot recorded the four actual public.profiles triggers and their full function source. The rollback-only Stage 3 production-shaped SQL now additionally executes both previously untested profile functions against the synthetic Better Auth referrer: normalize_profile_fields() (lower/trim username, upper/trim institution, trim full name) and set_updated_at() (overwrites a stale client-supplied timestamp on every update). Existing behavior tests for prevent_profile_account_type_client_mutation() and prevent_profile_currency_client_mutation() remain intact. All synthetic modifications are inside the surrounding transaction and roll back.

The same snapshot enumerates 109 auth.uid() policies across 61 tables: 55 SELECT, 19 INSERT, 12 UPDATE, 12 DELETE and 11 ALL. Target roles include 100 authenticated references, 9 PUBLIC references and one anon reference (the public-profile read policy also targets authenticated). Nine PUBLIC policies are explicitly listed in the identity dependency inventory. They are review candidates, not automatically unsafe; no policy has been removed or broadened by this work.

The 9 November acceptance run that captured this metadata and completed schema restore, FK cutover simulation, provisioning/referral/phone/organizer regression, issuer guard and rollback is [Auth Production Schema Baseline #42555805128](https://github.com/taufx98/sykabelajar4.0/actions/runs/42555805128). The profile behavior assertions were added immediately after that successful run and are being re-executed in the current head's baseline run; do not cite the old run as having executed the newly added assertions.

## Latest branch status — 9 November 2026, 10:35 WIB

- Current PR head: `5eb6114e71fef965eff44709c0d122ea368d98db` (`test(auth): guard against concurrent email account activation and deletion`). PR #177 remains Draft and unmerged; GitHub currently reports `mergeable=false`.
- [Auth Worker CI #42557171907](https://github.com/taufx98/sykabelajar4.0/actions/runs/42557171907) passed both jobs on the current head: Worker/auth/OIDC/D1/security integration, frontend lint, TypeScript typecheck and production build. No Worker deploy was performed by this job.
- [Auth Cloudflare Staging Preflight #42557171882](https://github.com/taufx98/sykabelajar4.0/actions/runs/42557171882) passed read-only credential and staging-resource inspection. The Pages PR preview succeeded for this head; the preview is not the production app or an Auth Worker deployment.
- [Supabase Local Auth Claims CI #42556434077](https://github.com/taufx98/sykabelajar4.0/actions/runs/42556434077) and [Auth Production Schema Baseline #42556434080](https://github.com/taufx98/sykabelajar4.0/actions/runs/42556434080) passed at SQL checkpoint `45d427c`. The seven commits after that SQL checkpoint contain no SQL draft, migration, or regression-file changes; they change identity/roadmap/status documentation and the transactional email-admin Worker/test. Thus the disposable schema/trigger/RPC/RLS acceptance evidence remains applicable to the current source head.
- The latest full-schema run verified the production catalog at 69 FKs/62 tables, 3 Auth triggers, 4 profile triggers/36 profile columns, 109 `auth.uid()` policies across 61 tables, and 10 Auth-dependent functions. It then applied the Stage 3 draft only to the disposable restore, passed the identity/referral/email/phone/organizer regression, retired the legacy Auth triggers while preserving profile triggers, ran issuer guard/RLS acceptance, and completed both rollback simulations. All synthetic writes were rolled back and the temporary schema export/restore were cleaned up.
- The current head additionally hardens concurrent activation/deletion of transactional email accounts with a single guarded SQL mutation and verifies the affected-row count; it does not change provider secrets or production email settings.

**Not complete / still gated:** real Google/Facebook/X credentials and a first staging-admin bootstrap; actual ZeptoMail delivery; hosted Telegram consent/callback; hosted Better Auth Storage, Realtime and two-user Edge/IDOR tests; exhaustive operation-by-operation review/sign-off for all 109 RLS policies; PR base/mergeability reconciliation; and explicit owner approval/rollback sign-off. Production login flag, Supabase schema/ACL/RLS/triggers, Edge Functions, Cloudflare Worker, user records, credentials and Cloudinary assets remain unchanged.


## Stage 4 hosted frontend checkpoint — 9 November 2026 (DNS delegation blocker)

This checkpoint supersedes older Stage 4 statements in this document that described the Better Auth frontend transport as entirely unimported or Stage 4 as not started. It does **not** authorize production cutover.

### Completed on the isolated branch/staging resources

- The Better Auth session bridge now performs one initial provider-session read on mount, then schedules one revalidation at the server-issued session expiry. Same-user renewal refreshes the deadline without a false sign-in event; an expired session emits the normal signed-out transition; bridge teardown clears the timer. This is deadline-based revalidation, not periodic polling.
- The frontend Better Auth transport is enabled only by explicit preview configuration and only for the isolated Free Supabase staging project. Remote browser use is restricted to the exact same-site origin `https://staging.sykabelajar.my.id`; generic `*.pages.dev` preview hosts are intentionally rejected because they are cross-site from the auth Worker's `SameSite=Lax` cookie.
- The OAuth callback resolver accepts only `https://sykabelajar.my.id/auth/oidc/callback` and `https://staging.sykabelajar.my.id/auth/oidc/callback`. Worker bootstrap validation requires that exact two-entry redirect allowlist, and D1 migration 0008 adds the staging callback to the single fixed public first-party PKCE client.
- The guarded D1 migration workflow successfully applied migration 0008 to the dedicated non-production D1 `sykabelajar-auth-poc`. The deployment workflow verified the 20 expected tables and confirmed that the Better Auth user, session, account, verification and phone-challenge tables were still empty.
- The Pages project `sykabelajar` is associated with `staging.sykabelajar.my.id`; its proxied CNAME points to the exact `security-auth-poc-stage-1.sykabelajar4.pages.dev` branch alias. Cloudflare currently reports the Pages custom-domain status as `pending` and certificate status as `active`.
- The isolated Worker `sykabelajar-auth-poc` deployed successfully using the existing secret bindings. The dedicated OAuth-provider encryption secret was preserved; it was not rotated. Supabase identity provisioning remains disabled.
- Auth Worker CI [#42570149130](https://github.com/taufx98/sykabelajar4.0/actions/runs/42570149130) passed both jobs on code head `6ccf4140ca52b8ca3644c5ee4b40b428ce81c405`: Worker/security/D1/OIDC local integration and frontend lint/typecheck/build. This is branch/staging validation, not production validation.

### Current hosted blocker — authoritative nameserver delegation

The deployed Worker hosted health/OIDC/JWKS acceptance did **not** pass. GitHub Actions recorded `getaddrinfo ENOTFOUND auth.sykabelajar.my.id`; independent public DNS-over-HTTPS checks also returned NXDOMAIN for `auth.sykabelajar.my.id` and `staging.sykabelajar.my.id`.

Cloudflare assigns these nameservers to the `sykabelajar.my.id` zone:

- `rita.ns.cloudflare.com`
- `wilson.ns.cloudflare.com`

The publicly delegated nameservers are still:

- `ns1.idwebhost.id`
- `ns2.idwebhost.id`

Therefore Cloudflare's zone records are not yet authoritative on the public DNS. The zone has 11 records in the Cloudflare dashboard/API inventory: the apex Pages CNAME, the email/ZeptoMail CNAME, the staging Pages CNAME, the auth Worker AAAA record, three Cloudflare Email Routing MX records, and four TXT records. The public DNS check found the three MX destinations and the email CNAME consistent with the Cloudflare copy. It found only three of the four Cloudflare TXT selectors publicly, with `cf2024-1._domainkey.sykabelajar.my.id` absent from the public answers. The public resolver also returned no apex A/AAAA/CNAME answer and NXDOMAIN for `www.sykabelajar.my.id`; verify whether those names are intentionally unused or have records/types outside this inventory before changing registrar delegation.

**Do not switch nameservers automatically.** A nameserver cutover affects the entire domain, not only the Better Auth subdomain. Before any cutover, reconcile the full IDWebHost authoritative zone with the Cloudflare copy, especially the website apex/`www`, all MX, SPF/DKIM/DMARC and service-verification TXT records. No registrar nameserver change was made by this checkpoint. No production Worker, production Supabase schema/data/Auth settings, user records, roles, Edge Functions or production login route were changed.

### Remaining Stage 4 acceptance gates

1. Reconcile the complete current IDWebHost DNS zone against the Cloudflare zone and obtain owner approval for any registrar nameserver change. After the nameserver delegation is updated by the domain owner/registrar, re-run public DNS, Pages-domain and hosted Worker health/discovery/JWKS checks.
2. Test the staging frontend on `https://staging.sykabelajar.my.id` with real browser cookies, initial-session hydration, cross-tab synchronization and expiry/logout.
3. Complete real hosted signup/login/password recovery and social OAuth callback tests. Google/Facebook/X credentials and an initial staging-admin account are still absent; email delivery remains deferred and unconfigured by owner instruction. Do not create, activate or spend on a transactional-email account during this login-first workstream.
4. Complete positive Supabase Data API, Storage HTTP, Realtime WebSocket and staging Edge-function/two-user tests using a real Better Auth session. These are cross-stage acceptance prerequisites, not production deployment.
5. Keep PR #177 Draft/unmerged. Do not start Stage 5/6/7 work or change production until Stage 4 hosted acceptance, Stage 5 endpoint review, base reconciliation and owner-approved rollback gates are complete.


## Stage 4 concurrency hardening checkpoint — 9 November 2026

This records source-only changes made on `security/auth-poc-stage-1` after the hosted frontend/DNS checkpoint. It is not an acceptance or deployment claim.

- The Better Auth PKCE resource-token broker now checks the Worker session again after token exchange and before caching or returning the resource token. A changed generation, different UUID, unverified email flag, or expired/missing session rejects the in-flight result with `AUTH_SESSION_CHANGED_DURING_TOKEN_REQUEST`. This closes the case where an old account's delayed token response could reach a caller after an account switch.
- `AppContext` now generation-guards `refreshUser()` and `updateProfile()`, including after both the profile read and role read. The guard compares both request generation and the active UUID, so an older request cannot publish stale profile/role data after another login, even when the UUID matches.
- Initial `getSession()` bootstrap now has an independent generation from profile hydration. New auth events, explicit state clear, manual login and effect cleanup invalidate older bootstrap work. Auth-event hydration is deferred outside the provider callback, captures its own event/hydration generations, and only its still-current failure may clear the active session.
- React effect cleanup is tracked per effect instance; a stale Strict Mode effect cannot publish profile state or update loading state after cleanup. A queued auth-provider callback from a disposed effect is also rejected before it publishes an identity event or mutates session state.
- `auth-hydration-gate.test.mjs` now covers the refresh/update/bootstrap/event-generation source contracts. The file was added to the `auth-worker-ci.yml` push-path filter so test-only edits trigger the same Auth Worker CI.

### Verification boundary

- The changed source and test files were re-read from the branch and their core static invariants were checked during this session. This is source inspection only; it does not establish a passing GitHub Actions run.
- The workflow path filter now includes the hydration test and the latest workflow file change should trigger Auth Worker CI. Do not mark the new tests as passing until the run for the resulting head is inspected.
- No Worker or Pages deployment, D1 migration, Supabase function deployment, production SQL/ACL/RLS/trigger change, production login flag change, OAuth credential setup, user bootstrap, nameserver update, or email-provider setup was performed in this checkpoint.

### Explicit email deferral

Per owner instruction, real email verification, resend delivery and password-recovery delivery are **skipped for this login-first workstream**. The Worker transactional-email provider remains unconfigured; no real email was sent, no sender or token was activated, and no credits were purchased or consumed. Keep these tests/configuration as the final phase after login and identity migration acceptance. The code must continue to fail closed for unverified users; do not forge an `emailVerified` state to bypass the missing provider.

### Remaining independent gates

- PR #177 is still Draft/unmerged and GitHub reports `mergeable=false`; do not force-merge or blindly retarget its base.
- Hosted DNS/browser acceptance remains blocked by the previously recorded mismatch between IDWebHost public nameserver delegation and the Cloudflare zone. Do not change registrar nameservers until the full authoritative DNS zone is reconciled and the domain owner approves it.
- Stage 2 still requires positive Storage HTTP, private Realtime WebSocket and Edge Function calls with an actual verified Better Auth session. No substitute synthetic fixture should be reported as a live protocol test.
- Stage 3 production identity/FK/issuer migration remains gated on explicit owner approval, maintenance window, read-only preflight and rollback review. No production migration was applied.
- Stage 5 endpoint deployment and two-user IDOR acceptance with Better Auth tokens remain gated on Stages 2–4 and a schema-compatible isolated project. Keep `AUTH_IDENTITY_MODE=supabase` as the compatibility default.


## Stage 4–5 source implementation checkpoint — 9 November 2026

This checkpoint records source work on `security/auth-poc-stage-1`; it does not mark hosted acceptance or production deployment complete.

### Stage 4 — frontend source
- The provider-neutral typed Better Auth HTTP/PKCE transport remains the single Better Auth client boundary. It is selected only for the exact staging host, Worker host and isolated Supabase project under the explicit preview flag.
- AppContext remains the sole visible session owner. Bootstrap/event/profile hydration generations, disposed callback guards, cross-tab revalidation and expiry handling are in the branch.
- The single Supabase client supplies an in-memory Better Auth resource JWT in preview mode; it disables Supabase's own persistent auth session only for that mode. Existing Supabase Auth remains the production/default path.
- Login, role hydration, registration, Google/Facebook/X provider selection, password change, recovery route, verification callback and organizer phone-verification provider boundary are source-integrated. Remaining direct auth calls are classified compatibility paths or the separately planned private-chat removal; comments and other social functionality are not part of this auth branch.
- Transactional email delivery/verification/recovery mail testing is intentionally deferred. Do not configure ZeptoMail/Brevo, send a test email, consume credits or weaken the email-verification/resource-token gate.

### Stage 5 — backend source
- Nine user-facing Cloudinary/payment handlers now use the shared `requireApplicationUser()` resolver: signer, upload, upload V2, delete asset, delete asset V2, profile delete, payment admin, create and reconcile. `midtrans-create-payment` remains a compatibility delegate that forwards the caller bearer to the independently verified create handler.
- The two Cloudinary V2 aliases retain their endpoints and upload response shape but now have branch implementations using the common verifier. V2 delete restricts deletion to the caller's exact UUID profile/cover IDs, `image`, and `upload`.
- Checkout's initial order lookup is constrained by both order ID and verified UUID. Reconciliation confirms the caller-owned order before reading its payment-intent row. Admin continues to execute `is_active_admin()` with caller context before privileged settings operations. Provider webhooks continue provider-signature authentication; public status and certificate flows remain intentionally distinct.
- Branch CI now includes Deno 2.9.8 type-checking for the shared JWT adapter/resolver, all nine user-facing handlers and the Midtrans delegate, in addition to the source-contract and frontend checks.

### Verification and deployment boundary
- The changed source, config, CI paths and regression tests have been re-read from the branch and source invariants checked. This is not a substitute for a passing CI run: the latest HEAD workflow result must be inspected before marking the branch validated.
- Hosted Better Auth cookie/browser, Storage HTTP, Realtime WebSocket, positive Edge token and two-user IDOR acceptance still need an actual verified staging session. Public DNS delegation, staging admin bootstrap and OAuth credentials remain live external acceptance prerequisites; email provider setup is not one of them.
- PR #177 remains Draft/unmerged and base reconciliation is still required. No Edge Function has been deployed, no `AUTH_IDENTITY_MODE=better-auth` setting enabled in production, no production RLS/RPC/trigger/FK change applied, and no production Auth/login/Cloudflare/DNS/secret/account state changed.


## Better Auth continuation checkpoint — 9 November 2026, evening

This checkpoint supersedes only the newer implementation details below; it does not close hosted acceptance or authorize cutover.

### Stage 2 — verifier and staging probe correction
- Re-read the pinned `@supabase/server@1.9.2` verifier behavior. Its default `user` mode uses the Supabase project's JWKS, not the Better Auth issuer's signing key set. The shared Better Auth adapter now explicitly supplies the fixed `https://auth.sykabelajar.my.id/api/auth/jwks` URL through the SDK `env.jwks` override, and passes the exact Better Auth issuer and SYKABELAJAR resource audience. Cryptographic signature verification remains inside the SDK; no hand-written JWT signature code was added.
- The shared adapter returns 503 `AUTH_VERIFICATION_UNAVAILABLE` for an unavailable JWKS/verifier and 401 for missing/invalid bearer tokens. Expected issuer, audience and JWKS URL are fixed in source.
- The isolated Free staging read-only `better-auth-oidc-acceptance` probe was updated to **version 2** on project `ydamszdfsxqisanazdkb`. The probe uses the same pinned Better Auth JWKS/issuer/audience, reads only the synthetic RLS fixture through the caller-scoped client, selects its actual `note` column, and performs no writes or service-role operations. No application Edge handler was deployed.
- A positive probe invocation still requires an already verified synthetic Better Auth session. Email setup is not a prerequisite; do not create fake verified accounts or weaken the email-verification gate.

### Stage 4 — same-origin redirect guard
- Added shared `resolveSafeInternalRedirect()` and applied it to LoginPage, RegisterPage and the Better Auth social OAuth callback boundary. The helper resolves the candidate URL against the actual current origin and falls back to `/home` when it is external, protocol-relative, malformed or browser-normalized backslash authority syntax.
- Added regression checks for safe in-app path/query/hash preservation, external/protocol-relative URLs, JavaScript/data URLs, backslash authority redirects, and wiring through login/register/social auth service.
- Added the test path to both Auth Worker CI and Supabase Local CI trigger/test lists. A local Node sanity check of representative URL cases returned the expected same-origin paths/fallbacks; this is not a claim that the full GitHub Actions suite passed.

### Latest validation and hard blockers
- The latest PR head at this checkpoint is recorded in GitHub as a Draft PR #177. The GitHub commit-status lookup returned no status rows, and the available commit-workflow lookup returned no PR-triggered runs for this SHA. Do not report the newest source/tests as CI-passing until an actual successful workflow run is retrieved.
- PR #177 remains `mergeable=false`. Base `security/auth-migration-phase-0` has advanced **17 commits** beyond the merge base; do not force-merge, blindly change the PR base, or discard those changes. A reviewed three-way reconciliation is still required.
- Public auth/staging DNS delegation, browser session acceptance, OAuth credentials/admin bootstrap, positive Storage HTTP, private Realtime WebSocket, Edge probe token invocation and two-user endpoint IDOR matrix remain open. Production Stage 3 identity/FK/issuer migration still requires explicit approval, maintenance window, read-only preflight and rollback review.
- Transactional email sender setup, real verification mail and password-recovery mail remain intentionally deferred to the final phase. No provider configuration, real email send or credit consumption occurred.
- No production Edge Function, auth mode, Supabase schema/RPC/trigger/FK/RLS policy, login setting, Cloudflare secret, DNS/nameserver, payment setting, Cloudinary asset, user or account was changed. The only hosted function refresh in this checkpoint is the read-only staging acceptance probe v2.


### Stage 4 callback boundary extension — 9 November 2026
- The same-origin resolver is now also applied to email-verification resend callbacks and password-reset redirect parameters, including the legacy Supabase fallback. Login, registration, social OAuth, resend-verification and reset-password all use the same browser-origin validation boundary.
- The regression test asserts the service wiring for these verification/reset paths. A Node-only helper sanity check passed 14 representative safe/unsafe URL cases; the full repository test suite and latest GitHub Actions are still unverified.


### Staging probe runtime evidence — 9 November 2026

Supabase unified Edge logs show multiple anonymous `POST` calls to `better-auth-oidc-acceptance` v2 on isolated project `ydamszdfsxqisanazdkb` at 13:28–13:30 UTC, all returning HTTP 401. This verifies the deployed probe's anonymous rejection path is reachable. It does not establish a positive token-backed call or cross-user RLS behavior with a real Better Auth session; those remain open.

## CI remediation and source-validation checkpoint — 9 November 2026

This checkpoint records the verified CI result after correcting the two redirect-contract assertions and enabling Deno's npm package installation for the shared Supabase verifier. It supersedes the immediately preceding entries that described these latest checks as pending or failing.

- Current verified merge head: `6796b9822ac4dabc14003fecb30a755d9db6c310`. The merged tree passed the pull-request workflows below.
- **Auth Worker CI run #720 — success:** [workflow run](https://github.com/taufx98/sykabelajar4.0/actions/runs/42636153886). Dependency audit, Worker typecheck, 121 Worker security/integration tests, Deno type-check of the Better Auth verifier/resolver and migrated user-facing Edge handlers, auth/Cloudinary/payment/frontend contract tests, local D1 migration/OIDC smoke flow, Worker bundle dry-run, and frontend lint/typecheck/build all completed successfully. No deployment was part of this run.
- **Supabase Local Auth Claims CI run #499 — success:** [workflow run](https://github.com/taufx98/sykabelajar4.0/actions/runs/42636154079). The isolated local database contract job completed successfully, including the updated redirect and frontend transport assertions and local JWT/RLS test path. This is local fixture acceptance, not hosted positive-token acceptance.
- The two immediately preceding failures were test/configuration mismatches, not a demonstrated authentication bypass: one test still expected the pre-guard password-reset URL expression; another expected the same outdated expression in the frontend transport contract. Both now assert the shared same-origin resolver flow. The Worker CI's Deno check also now explicitly uses `--node-modules-dir=auto` so the pinned `npm:@supabase/server@1.9.2` dependency resolves under Deno 2.9.8.
- The production/default auth mode remains Supabase Auth. `AUTH_IDENTITY_MODE=better-auth` is not enabled for production. No application Edge Function was deployed and no production schema, FK, trigger, RPC, RLS, Auth setting, account or Cloudflare production resource was modified.
- Hosted Stage 2–5 acceptance is still open for positive token-backed tests: a real verified staging Better Auth session is needed for Supabase Data API/Storage HTTP/Realtime WebSocket/Edge Function tests and the two-user endpoint/IDOR matrix. Cloudflare zone delegation, auth Worker custom domain, Pages staging domain/certificate, and hosted OIDC issuer are now verified healthy; do not change registrar nameservers. The remaining external prerequisites are the first staging admin identity and Google/Facebook/X OAuth credentials. Do not fabricate verified-email state or weaken the email-verification gate.
- Transactional email provider setup, delivery and password-recovery mail tests remain explicitly deferred to the final phase. Do not configure a provider, send test mail or consume credits as a prerequisite for the auth implementation.
- PR #177 remains Draft and unmerged. A reviewed two-parent merge commit (`6796b9822ac4dabc14003fecb30a755d9db6c310`) has reconciled the target branch history; comparison now reports 0 commits behind and GitHub reports `mergeable=true`. Pull-request-triggered Auth Worker CI #722 and Supabase Local Auth Claims CI #500 both passed on that merge head. The PR itself has not been merged.

## Hosted DNS correction and current staging Worker deployment — 9 November 2026

This checkpoint corrects an earlier interpretation of the Cloudflare preflight output and records the latest isolated staging deployment. It supersedes earlier status text that treated the `b.dns.id`–`f.dns.id` nameservers as evidence that `sykabelajar.my.id` itself was delegated away from Cloudflare.

- **Authoritative DNS delegation is verified.** The earlier `publicParentNameservers` value came from a recursive `NS my.id` lookup; those are the parent zone's authoritative servers, not the child-zone delegation. The corrected read-only preflight [#246](https://github.com/taufx98/sykabelajar4.0/actions/runs/42640007940) queries all five `my.id` authoritative nameservers directly for the delegation of `sykabelajar.my.id`. All five returned exactly `rita.ns.cloudflare.com` and `wilson.ns.cloudflare.com`, matching Cloudflare's assigned nameservers. No DS record is present. Do not make or request a registrar nameserver change on the basis of the old interpretation.
- Cloudflare zone `sykabelajar.my.id` is `active`; Worker script `sykabelajar-auth-poc` exists; custom domain `auth.sykabelajar.my.id` is enabled and attached to that Worker. The staged Pages CNAME points `staging.sykabelajar.my.id` to `security-auth-poc-stage-1.sykabelajar4.pages.dev`; the Pages custom domain and TLS certificate both report `active`.
- Hosted auth preflight verifies `https://auth.sykabelajar.my.id/healthz`, exact issuer `https://auth.sykabelajar.my.id/api/auth`, PKCE S256 discovery, and a public P-256 ES256 JWKS key with a non-empty `kid` and no private key material.
- **Latest staging Worker deploy succeeded:** [Auth Worker Staging Deploy #15](https://github.com/taufx98/sykabelajar4.0/actions/runs/42640714588), branch head `a9292bf343c43b594a2c1152353276ffb439be9d`. Cloudflare reports Worker version `8c891e36-f724-4e94-957e-ff7521603c0e`. This updates only the isolated `sykabelajar-auth-poc` Worker/D1 binding and exposes the current managed social-login Admin API source on staging; it is not an application Edge Function or production deploy.
- Before deploy, the guarded workflow passed Worker typecheck, unit/security tests and bundle build; verified all 20 expected remote D1 tables, all seven Better Auth registration columns, provider-aware email schema, and the exact first-party OAuth callback allowlist; and confirmed the staging identity tables contained zero users, sessions, accounts, verifications, phone challenges and social-provider settings. One social-provider metadata singleton row and one fixed public OAuth client were present.
- `SUPABASE_PROVISIONING_ENABLED=false` remains unchanged. The deploy did not enable identity projection, use a staging Supabase service-role key, create an account, or seed a session. The existing `AUTH_PROVIDER_ENCRYPTION_KEY` Worker secret was found and preserved; it was not rotated. Existing `BETTER_AUTH_SECRET`, email encryption key and OAuth bootstrap token were not regenerated.
- Post-deploy smoke tests passed: exact origin CORS allowed the staging site and rejected `https://attacker.example`; issuer/PKCE/JWKS were healthy; public provider metadata returned only its allowlisted shape; Admin API rejected anonymous requests with 401 and hostile-origin requests with 403. The hosted result explicitly reported `emailAgentConfigured=false`, `googleOAuthCredentialsConfigured=false`, and `noUserOrSessionSeeded=true`.
- **Latest source CI also passed on the current implementation:** [Auth Worker CI #731](https://github.com/taufx98/sykabelajar4.0/actions/runs/42641159559) and [Supabase Local Auth Claims CI #506](https://github.com/taufx98/sykabelajar4.0/actions/runs/42641159587). This includes Worker/frontend build checks, Deno type-check, isolated local Supabase startup, JWT subject/ownership RLS acceptance, and the full local contract path.
- Remaining hosted work is not blocked by DNS: the first staging admin identity and Google/Facebook/X provider credentials are absent, so no real verified Better Auth session exists yet. Complete positive-token Data API, Storage HTTP, Realtime WebSocket, Edge Function, and two-user IDOR acceptance only with a real verified staging token. Do not manufacture `emailVerified=true`, weaken the verification gate, or configure/send transactional email during this stage; email delivery remains deferred to the final phase.
- Production remains untouched: no production Auth settings, secrets, database schema, RLS/RPC/FK/trigger, Edge Function, account, login routing, DNS or nameserver change was made. PR #177 remains Draft, unmerged, `mergeable=true`, and zero commits behind its target.


## Caller-scoped Admin role authorization — 9 November 2026

- The Better Auth Admin verifier no longer uses the Supabase service-role key to read `public.user_roles`. After signature/JWKS, issuer/audience, token-lifetime, UUID and verified-email UserInfo checks, the Worker issues a GET using the original caller JWT and the staging project's public publishable key.
- The staging-only migration `auth_admin_role_self_read` creates `user_roles_better_auth_select_own`: SELECT is limited to `auth.uid()` and the exact Better Auth issuer. Authenticated table privileges are SELECT-only; INSERT/UPDATE/DELETE are revoked. The query still returns only an active `admin` role for the verified subject.
- Read-only inspection of `ydamszdfsxqisanazdkb` confirmed the policy and privileges. The production `user_roles` SELECT policy already contains the own-row `auth.uid() = user_id` path; production RLS is enabled and authenticated SELECT is granted. No production SQL was changed.
- Local Supabase RLS regression test and current Worker/frontend tests passed on CI #536 and #788. Guarded staging deploy #18 then passed the hosted smoke for both Admin APIs. The implementation is active on the hosted staging Worker after deploy #18.
- This does not enable account provisioning. `SUPABASE_PROVISIONING_ENABLED=false` remains unchanged; any later provisioning writes continue to require their separate server-only secret and approval gate.
- A real verified staging admin user/role is still absent. Do not seed a fake verified identity or enable the production login path to bypass this prerequisite.


## Latest verified Admin hardening deployment — 9 November 2026, 23:22 WIB

- Added a hosted negative-access smoke check for the second Admin surface, `/api/admin/email-settings`, in addition to `/api/admin/login-providers`. For each endpoint, the deploy workflow requires an allowed staging origin with no bearer token to receive HTTP 401 and an untrusted origin to receive HTTP 403 with no CORS permission. No email request/provider test is made.
- [Auth Worker Staging Deploy #18](https://github.com/taufx98/sykabelajar4.0/actions/runs/42653879313) succeeded. Current Cloudflare version is `762291b0-7981-44ae-b3e6-a2bcec8fa874`. Hosted health, issuer, PKCE, public ES256/P-256 JWKS, D1 tables/empty identity state, and the two Admin negative-access checks passed.
- [Auth Worker CI #788](https://github.com/taufx98/sykabelajar4.0/actions/runs/42653893356) and [Supabase Local Auth Claims CI #538](https://github.com/taufx98/sykabelajar4.0/actions/runs/42653893478) passed after the workflow/test correction.
- The deployment preserved the dedicated `AUTH_PROVIDER_ENCRYPTION_KEY`; `SUPABASE_PROVISIONING_ENABLED=false` remains unchanged. The deploy's sanitized result reports `emailAgentConfigured=false`, `googleOAuthCredentialsConfigured=false` and `noUserOrSessionSeeded=true`.
- No first staging admin identity or Google/Facebook/X credentials exist, so no positive authenticated Admin/OAuth/Data API/Storage/Realtime/Edge/two-user IDOR session test has yet been performed. Email provider setup and all mail sending remain deferred.
- Production Supabase and app login remain untouched. PR #177 remains Draft and unmerged; the seven-stage cutover gates are still mandatory.



## First staging Admin bootstrap readiness — 9 November 2026, 23:30 WIB

- Added the owner-operated staging-only SQL template `docs/security/AUTH-STAGING-FIRST-ADMIN-BOOTSTRAP.sql` and step-by-step runbook `AUTH-STAGING-FIRST-ADMIN-BOOTSTRAP.md`. It creates no public bootstrap endpoint. It requires a real Better Auth staging session with `user.emailVerified=true`, an exact UUID copied from that session, execution as the Supabase staging database owner `postgres`, and zero pre-existing admin role rows. It refuses a second run, an `auth.users` shadow row, or a `legacy_reference` UUID. **It has not been executed for a real user.**
- The staging `private.app_users` fixture lacked `identity_origin`; an additive migration has now added the checked `better_auth | legacy_reference` column and the live staging `private.provision_better_auth_user` function now marks new Better Auth users, locks the identity row, and rejects legacy-reference tombstones before profile or role creation. The public wrapper remains the only Worker RPC entry point; direct execution of the private helper is revoked from `service_role`, `authenticated` and `anon`.
- Staging migrations applied: `20261109170548_stage3_identity_origin` and `20261109170823_stage3_provisioner_origin_guard`. Read-only ACL inspection confirmed `service_role` cannot execute the private helper directly, `anon`/ `authenticated` cannot execute it, and `service_role` can execute the public wrapper.
- A rollback-only staging SQL contract created a synthetic Better Auth identity, tested first-admin role assignment, then attempted a `legacy_reference` promotion. The legacy attempt was rejected with `LEGACY_REFERENCE_IDENTITY_CANNOT_AUTHENTICATE`; the outer transaction was rolled back. A follow-up read showed `private.app_users=0`, `profiles=0`, `user_roles=0`, `admin role rows=0`. No synthetic account or admin was left in staging.
- Local pgTAP acceptance now contains 15 assertions covering owner-only first-admin bootstrap, one-time guard, non-privileged account type, no shadow `auth.users`, no self-insert privilege, and rejection of legacy-reference identities. [Supabase Local Auth Claims CI #561](https://github.com/taufx98/sykabelajar4.0/actions/runs/42663635674) passed. [Auth Worker CI #812](https://github.com/taufx98/sykabelajar4.0/actions/runs/42663635818) also passed, including the static runbook/SQL security contract.
- The first real staging admin requires a genuine Better Auth session whose email is verifiably confirmed, but **does not require Google OAuth or any other social provider**. Email/password can satisfy this after a genuine verification-delivery path is deliberately enabled; transactional email remains deferred by owner instruction. Keep Google/Facebook/X disabled unless the owner explicitly chooses a provider. Do not forge `emailVerified=true`, remove the verification guard, or seed a synthetic browser session. The bootstrap and positive-token acceptance remain pending until an owner-approved genuine verification path exists. `SUPABASE_PROVISIONING_ENABLED=false` remains unchanged.
- Production remains untouched. No production schema/RLS/RPC/FK/trigger, auth settings, secrets, Edge Function, account or login routing was changed.


## Login-first continuation checkpoint — 10 November 2026

This checkpoint supersedes earlier provider-prerequisite wording above. It records only the Better Auth migration state and does not authorize a production change.

- Owner scope reaffirmed: continue only the seven Better Auth migration stages. Do not start unrelated feature work. Google/Facebook/X are optional social-login providers, not prerequisites for Better Auth, email/password architecture, OIDC, or frontend integration. Zoho/ZeptoMail/Brevo and all transactional email setup remain deferred.
- PR #177 remains open, Draft, unmerged, and mergeable. Current PR head: `804c6a348a1eeef2d95f7e063704cff0856e99bb`. Branch: `security/auth-poc-stage-1`. Latest head CI: [Auth Worker CI #42805528181](https://github.com/taufx98/sykabelajar4.0/actions/runs/42805528181) and [Supabase Local Auth Claims CI #42805528302](https://github.com/taufx98/sykabelajar4.0/actions/runs/42805528302), both success.
- The current Worker config keeps `SUPABASE_PROVISIONING_ENABLED="false"` and pins the provisioning URL to the isolated staging project. The staging publishable key is present for caller-scoped reads. No server-only Supabase provisioning secret is installed; do not enable provisioning or put a secret into Pages, source, Actions logs, or chat.
- `sb_secret_*` header handling is already implemented and covered by focused Worker tests: `apikey` only, no Bearer header; the legacy `service_role` JWT retains Bearer compatibility; `sb_publishable_*` is rejected for server provisioning. Do not repeat this work unless a regression is found.
- The auth Worker still enforces a genuine verified-email state before creating a session. Do not remove or weaken this gate merely to produce a hosted test session. With transactional email deferred and no social provider configured, there is currently no approved hosted route to create a verified staging session. This limits real-session acceptance but does not block continuing source implementation, static checks, local integration tests, and staging-negative tests.
- Read-only Supabase inventory on 10 November found one active Edge Function in the isolated staging project: `better-auth-oidc-acceptance` version 2. Production has 15 active Edge Functions. The branch contains the shared Better Auth verifier/identity adapter and the application function source contracts, but application Edge Functions have not yet been deployed to staging. Do not deploy application functions until the staging environment variables, function secrets, and target schema are confirmed; keep production untouched.
- The staging Security Advisor reports 17 RLS-enabled tables without policies (including private identity/internal fixtures and public tables with deny-by-default behavior) and one warning for `public.create_organizer(text,text)` being SECURITY DEFINER and executable by authenticated users. Read-only inspection confirmed the function checks a non-null `auth.uid()`, an active `organizer_member` role, a matching `private.app_users` identity, verified email, verified phone and the single-use free-organizer identity claim before writes. Its ACL is `postgres`, `authenticated`, and `service_role`. Do not mass-revoke or modify it without a full role/business-flow regression; keep it in the Stage 5 function-by-function review.
- No staging data, staging schema, function deployment, provisioning secret, production setting, production database, DNS, login route, or user account was changed in this checkpoint.

