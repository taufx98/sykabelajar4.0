## Latest owner result — 12 November 2026 (real Better Auth session 4/4 passed)

The owner has now rerun the Admin acceptance panel after the staging OPTIONS/CORS correction. **All four checks passed** with the signed-in Better Auth session:

1. Session/Data API/profile/active role and foreign-row isolation.
2. Private Storage upload, download and cleanup for the owner's UUID; another UUID folder is denied.
3. Private Realtime Broadcast send/echo; another UUID topic is denied.
4. Read-only Edge Function acceptance using the real ES256 token, exact issuer/audience/subject/Postgres role and RLS.

The panel did not expose or copy the token. The Storage probe object is deleted after the test. Treat Stage 2 hosted acceptance as complete for these tested surfaces; do not repeat the owner action unless the implementation or staging configuration changes. This does **not** close Stage 5's separate Cloudinary/payment handler IDOR and business-regression gates.

Production Supabase, auth configuration, schema, data, Edge Functions, DNS and Pages were not changed. The result applies only to the isolated staging project.

---

# Stage 2 — OIDC/JWT hosted acceptance runbook

## Latest hosted Edge probe correction — 12 November 2026

The owner ran the four-surface acceptance panel on the staging site and reported **3/4 passed**. Better Auth session/Data API/profile/role, Storage and Realtime all passed. The Edge check returned “Failed to send a request to the Edge Function”.

The isolated staging Edge Function logs showed that the browser preflight request `OPTIONS` received HTTP 405. The handler previously returned `METHOD_NOT_ALLOWED` for every method other than POST, so the browser did not send the authenticated POST. This was a CORS/preflight defect, not yet a positive or negative JWT-verification result.

The correction is deployed to isolated Free project `ydamszdfsxqisanazdkb` as `better-auth-oidc-acceptance` **version 3**:

- Handles the staging browser preflight with HTTP 204.
- Allows only origin `https://staging.sykabelajar.my.id` (no wildcard origin), methods POST/OPTIONS and Supabase client request headers.
- Rejects untrusted origins with HTTP 403 and no `Access-Control-Allow-Origin`.
- Keeps the existing exact Better Auth issuer/JWKS/audience verification, UUID subject, Postgres role `authenticated`, access-token lifetime maximum 300 seconds, caller-scoped Supabase client, RLS fixture query, and read-only response unchanged.

**Hosted verification passed:** trusted staging preflight returned 204; untrusted-origin preflight returned 403 without a CORS grant; anonymous POST returned 401 `AUTH_REQUIRED`. The requests were served by deployed version 3. Auth Worker CI [#43204434638](https://github.com/taufx98/sykabelajar4.0/actions/runs/43204434638) and Supabase Local Auth Claims CI [#43204434746](https://github.com/taufx98/sykabelajar4.0/actions/runs/43204434746) passed, including Deno type-check, the acceptance-panel source contract, and the actual hosted CORS allow/deny smoke test.

**Remaining Stage 2 owner action:** repeat **Admin → Pengaturan → Uji Penerimaan Better Auth — Staging → Jalankan tes** while signed in to `https://staging.sykabelajar.my.id`. The function preflight is now verified, but the positive authenticated POST with the owner's active resource token is still pending. The panel does not display or copy the token. If the Edge check fails after preflight, use the safe response code and hosted function invocation log to investigate JWT/JWKS/claims; do not weaken verification or platform security.

Only this staging function was deployed. Production Supabase, Production auth settings, data, schema, functions, DNS and Pages were not touched. The Stage 2 harness must not be run on Production.

---

Status as of 7 November 2026: **Supabase Custom OIDC, hosted Better Auth token acceptance, Data API and two-user RLS acceptance have passed on the isolated Free staging project.** Storage owner/issuer RLS and Realtime private-topic policy semantics have now passed transaction-scoped synthetic tests. A read-only Edge Function acceptance probe is deployed to staging, and its source/contract is checked in CI. Full hosted Storage API and Realtime WebSocket tests, plus a positive Edge Function invocation with a real Better Auth access token, remain pending until a verified synthetic staging user/session is available. A transactional email sender is not required for Stage 2 protocol acceptance: use an already verified synthetic test account or an approved staging-only social-login path. Do not configure Zoho/ZeptoMail/Brevo, send real email, or consume credits during Stages 2–5. Email-verification and password-recovery delivery are deferred to the final phase. This runbook never authorizes production OIDC changes.

## Fixed issuer contract

After the staging Worker and hostname have been deployed and verified, the exact issuer is expected to be:

- Issuer: `https://auth.sykabelajar.my.id/api/auth`
- Discovery: `https://auth.sykabelajar.my.id/api/auth/.well-known/openid-configuration`
- JWKS: the exact URL returned by discovery
- OAuth callback: `https://sykabelajar.my.id/auth/oidc/callback`
- Resource audience: `https://sykabelajar.my.id`
- Client: `sykabelajar_web_tSXvLgIj2QKRk69g14KgjRD12uQERQnFYm7_kucut1Y` (public client ID; not a secret)
- Grant: Authorization Code only
- Client authentication: `none` (public SPA client)
- PKCE: mandatory `S256`
- Scopes: `openid profile email`
- Refresh tokens / `offline_access`: intentionally disabled
- Access-token lifetime: at most 300 seconds

Do not use a workers.dev issuer for the final hosted acceptance because Supabase must trust the same stable HTTPS issuer URL used by the application. The auth hostname must resolve to the isolated Worker before this runbook is used.

## Provider discovery and signing-key checks

From a trusted environment, request the discovery URL and confirm:

1. HTTP 200 and a JSON OIDC discovery document.
2. `issuer` equals the fixed issuer above exactly, including `/api/auth`.
3. Authorization endpoint, token endpoint, UserInfo endpoint, and `jwks_uri` are HTTPS and use that same auth host.
4. `code_challenge_methods_supported` includes `S256`.
5. `scopes_supported` includes only the intended identity scopes needed for this integration; do not enable `offline_access`.

Fetch the returned JWKS URI. It must expose a public asymmetric ES256 key with a non-empty `kid` (EC / P-256). Public JWKS must not expose private key material such as `d`. Keep Better Auth's D1-backed private key storage and encryption enabled; never export private keys to CI artifacts or the repository.

## ES256/JWKS key rotation

Supabase refreshes third-party issuer signing keys periodically; allow up to **30 minutes** for a published JWKS change to be picked up. Use overlap rather than immediate replacement:

1. Publish the new ES256/P-256 public JWK with a unique `kid`, while retaining the old public JWK.
2. Wait at least 30 minutes and verify Supabase accepts a token signed by the new key before switching the Worker's active signer `kid`.
3. Switch the Worker signer to the new key. Keep the old public JWK until the last old-key token has expired plus the JWKS propagation window.
4. Verify new-key acceptance and old-key expiry/rejection. Only then remove the old key from public JWKS.
5. Never export private keys from D1, write them to CI artifacts, or commit them. Keep the private key encrypted in D1 and keep JWT lifetimes short.

This is a rollout rule, not permission to rotate production keys during the current staging work. The current five-minute resource-token lifetime means the old public key must remain available for the full Supabase propagation window after old-key tokens stop being issued.

## Token acceptance contract

Complete the authorization-code flow from the exact first-party callback and inspect tokens only in a secure test environment. A valid access token must satisfy all of the following:

- Header: `alg=ES256`, with a `kid` present in the issuer's JWKS.
- `iss`: exact issuer URL above.
- `sub`: the Better Auth user UUID.
- `aud`: includes the configured SYKABELAJAR resource audience; verify it explicitly when validating the token for the protected API.
- `role`: `authenticated` (PostgreSQL role only, never a business role).
- `iat` and `exp`: valid; lifetime no longer than 300 seconds.
- The public client receives no refresh token.

The OIDC ID token must validate with the same ES256/JWKS, exact issuer, the public client ID as audience, the same UUID subject, and the original authorization-request nonce.

## Negative security checks

The local suite already verifies these controls; repeat them against the hosted staging issuer before enabling the Supabase provider:

- Authorization request without PKCE is rejected.
- Wrong PKCE verifier is rejected.
- Authorization code replay is rejected.
- `offline_access` is rejected.
- Wrong issuer, wrong audience, modified signature, and expired JWT are rejected.
- UserInfo rejects the token after the underlying Better Auth session is signed out.
- An untrusted browser Origin does not receive credentialed CORS permission.
- A callback URI other than the one exact registered URI is rejected.

Also verify OIDC authorization responses carry the exact `iss` value (RFC 9207) to prevent authorization-server mix-up.

## Supabase hosted acceptance — isolated Free project only

Supabase Custom OIDC must be registered in a dedicated, non-production Supabase Free project. The provider setup is not available through Supabase CLI; use the Supabase Dashboard under Authentication → Sign In / Providers → Third-Party Auth → Custom OIDC, or the documented Management API after an isolated project is available.

Register only the fixed issuer URL. Then run this acceptance matrix:

| Area | Positive case | Negative case |
|---|---|---|
| Provider/JWKS | Supabase fetches OIDC discovery and validates ES256 key by `kid` | Unknown key ID, wrong signature, or wrong issuer rejected |
| JWT claims | Valid token has UUID `sub`, `role=authenticated`, correct `aud`, unexpired `exp` | Wrong audience, expired token, altered `sub`, or missing role rejected |
| Postgres identity | `auth.uid()` equals the Better Auth UUID | A second UUID cannot read or mutate the first user's private rows |
| Data API | Allowed RLS-protected operations work using the external JWT | Anonymous/forged/cross-user access denied |
| Storage | Existing intended RLS behavior works with external JWT | Cross-user object access denied |
| Realtime | Authorized channels receive only allowed events | User B cannot subscribe/read user A's private events |
| Edge Functions | Each function validates the external identity and intended business role | Invalid issuer or unauthorized business role rejected |

Use at least two synthetic Better Auth accounts with distinct UUIDs. Do not use production user records, production service-role keys, real tokens, or real payment/competition records. Keep business roles in the existing application role model; never put `admin`, `guru`, or `penyelenggara` in the Postgres `role` claim.

## Current blockers and safe continuation

- Stage 1 remote D1 migrations and the provider-aware/Telegram-capable Worker are already documented in the staging checkpoints. Transactional email provider setup and real delivery are deliberately deferred to the final phase; they are not prerequisites for frontend auth integration, resource-token validation, Edge JWT verification, Storage/Realtime acceptance, or the source/contract CI.
- The Custom OIDC provider is already registered on isolated Free Supabase project `ydamszdfsxqisanazdkb`; hosted acceptance passed in [#42328168345](https://github.com/taufx98/sykabelajar4.0/actions/runs/42328168345). Do not create a second project, branch, or paid development environment.
- Telegram remains disabled until BotFather app registration, exact callback allowlisting, Worker Client ID/Secret and real hosted consent/callback acceptance are complete.
- Storage owner/issuer RLS and Realtime private-topic policy semantics passed rollback-only SQL fixtures. Actual Storage API upload/download and Realtime WebSocket join/broadcast with a real Better Auth token remain untested.
- A read-only Edge Function probe is deployed in staging. It uses `createSupabaseContext(..., { auth: 'user' })` for third-party token verification and the caller-scoped database client only. A positive invocation with a valid Better Auth token remains pending.
- Production Supabase schema, OIDC settings, users, application data, and frontend login remain unchanged.

## Latest local verification

The Auth Worker CI run [#42177805558](https://github.com/taufx98/sykabelajar4.0/actions/runs/42177805558) passed after adding explicit tests for the RFC 9207 authorization-response `iss` parameter and UUID-shaped JWT subject. Both Worker/OIDC and frontend checks succeeded. This is local Worker/D1 verification, not hosted Supabase acceptance.

## Official references

- Supabase Custom OIDC requirements: https://supabase.com/docs/guides/auth/third-party/custom-oidc
- Better Auth OAuth Provider: https://better-auth.com/docs/plugins/oauth-provider
- Better Auth tokens, scopes, resources and PKCE: https://better-auth.com/docs/plugins/oauth-provider/tokens
- Better Auth JWT plugin and ES256/JWKS: https://better-auth.com/docs/plugins/jwt


## Verified staging issuer — 6 November 2026

Deployment [#42190609080](https://github.com/taufx98/sykabelajar4.0/actions/runs/42190609080) now verifies the hosted issuer and public signing key. The issuer is `https://auth.sykabelajar.my.id/api/auth`; hosted discovery, hostname consistency, PKCE S256 advertisement and public ES256 P-256 JWKS all passed.

This does **not** yet prove a complete hosted authorization-code exchange, minted access/ID-token claims, token renewal/session behavior, or Supabase acceptance. No staging user/session has been seeded.

The connected Supabase project inventory exposes only the production project `mvdczyitbkxkldjughor`. Do not register the staging issuer there. Stage 2 remains blocked until an isolated Supabase Free project is available and the complete acceptance matrix above passes. Supabase documents Custom OIDC registration through Dashboard or Management API, not CLI: https://supabase.com/docs/guides/auth/third-party/custom-oidc.


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


## Supabase staging project created — 7 November 2026

The earlier Free-project quota blocker is superseded by this verified staging resource:

- Project: `sykabelajar-auth-staging`
- Ref: `ydamszdfsxqisanazdkb`
- Region: `ap-southeast-1`
- Plan/cost quote: Free, **US$0/month**
- Status at creation: `ACTIVE_HEALTHY`

This project is separate from production project `mvdczyitbkxkldjughor`. Its initial database was empty. A dedicated staging-only table `public.auth_oidc_acceptance_rows` was added with FORCE RLS, owner-only access, and a restrictive issuer predicate for `https://auth.sykabelajar.my.id/api/auth`. Two synthetic UUID owner rows were inserted. A SQL transaction tested owner A and owner B isolation, owner-only insert/update, forged cross-user insert rejection, and rejection for an untrusted issuer; the transaction was rolled back. A final inventory confirmed two seeded synthetic fixture rows, five RLS policies, and RLS enabled/forced.

**Important scope:** this proves PostgreSQL RLS behavior for supplied JWT claims in the isolated project. It does not prove Supabase Auth has accepted the Better Auth issuer cryptographically. The Custom OIDC integration is still not registered, and no real Better Auth user token was sent through Supabase Data API, Storage, Realtime, or Edge Functions.

The connected Supabase app integration exposes project and SQL operations but not the Management API endpoint or Dashboard mutation for Third-Party Auth. Therefore the remaining Stage 2 configuration is one of:
1. Add `https://auth.sykabelajar.my.id/api/auth` at this staging project's **Authentication → Sign In / Providers → Third-Party Auth → Custom OIDC**; or
2. Use a Supabase Management API personal access token with the documented `auth:write` permission to create the integration on project ref `ydamszdfsxqisanazdkb`.

Do not register this issuer in the production project. Do not place a personal access token or secret in chat or source control.

Official guide: https://supabase.com/docs/guides/auth/third-party/custom-oidc


## Updated hosted issuer and CORS verification — 7 November 2026

The updated Worker deployment [#42265308348](https://github.com/taufx98/sykabelajar4.0/actions/runs/42265308348) succeeded after D1 migration 0004. It reconfirmed the fixed issuer, PKCE S256 and public ES256 P-256 JWKS, and added an exact CORS acceptance check: the branch Pages preview origin is allowed while `https://attacker.example` receives no `Access-Control-Allow-Origin` permission.

Worker version: `ab04efd9-5750-48c0-8dbe-56c2a6d1118a`.

The isolated Supabase Free project `ydamszdfsxqisanazdkb` now exists, and its synthetic owner/issuer RLS fixture is applied. Local Supabase CI [#42264325438](https://github.com/taufx98/sykabelajar4.0/actions/runs/42264325438) passes with the additional hosted-issuer fixture migration/test. The actual Supabase Auth Custom OIDC integration is still not registered; the current Supabase app connector does not expose the Management API or Dashboard provider-write operation. Real Better Auth tokens therefore have not yet been accepted by Supabase, and downstream Data API/Storage/Realtime/Edge Function acceptance remains pending.

No user/session was seeded in staging D1 at this early checkpoint. Email Agent configuration remains intentionally deferred; this does not block local implementation, protocol tests, or OIDC acceptance using an already verified synthetic identity. Do not wait for ZeptoMail or send a real email during Stages 2–5.



## Hosted Supabase Custom OIDC acceptance — verified 7 November 2026

The staging-only OIDC registration workflow [#42324487931](https://github.com/taufx98/sykabelajar4.0/actions/runs/42324487931) completed successfully and registered exactly one Custom OIDC integration:

- Supabase staging project: `sykabelajar-auth-staging`
- Project ref: `ydamszdfsxqisanazdkb`
- Issuer: `https://auth.sykabelajar.my.id/api/auth`
- Integration ID: `ecb9da1f-ba63-445a-9585-bb9385099b13`
- Production project: not touched

Hosted acceptance run [#42328168345](https://github.com/taufx98/sykabelajar4.0/actions/runs/42328168345) completed successfully. It used two synthetic Better Auth users whose UUIDs matched only the two staging fixture owners. It did not use real user accounts, production records, or email delivery.

Verified against the hosted Worker and the staging Supabase Data API:

1. Hosted discovery reports the exact issuer and PKCE S256; JWKS exposes a public ES256/P-256 key.
2. Authorization Code + PKCE S256 completed against the exact first-party callback. The authorization response carried the RFC 9207 `iss` parameter.
3. Access tokens had ES256, exact `iss`, the synthetic user's UUID as `sub`, the SYKABELAJAR resource audience, `role=authenticated`, and a lifetime no longer than 300 seconds. No refresh token was issued.
4. ID tokens validated with the first-party client audience and original nonce.
5. Supabase Data API accepted the Better Auth access token. `auth.uid()` resolved to the UUID in `sub`.
6. Each synthetic user could read only their own fixture row. Cross-user insert and a token with a modified signature were rejected.
7. Session-bound UserInfo rejected the access token after the corresponding Better Auth session was signed out.

**Cleanup verified:** both synthetic users were deleted; the final remote D1 count for their users, sessions, and accounts was zero. The temporary `OIDC_ACCEPTANCE_TEST_TOKEN` Worker secret was removed and its absence was verified. The temporary acceptance-only helper code and workflow were then removed from the source branch; the regular staging Worker deployment is being restored so the live Worker no longer contains the temporary helper route.

**What this run does not establish:** it does not test hosted password sign-up, email-verification delivery, or password-reset delivery; those mail-delivery tests are explicitly deferred to the final phase and are not Stages 2–5 gates. Storage and Realtime SQL policy semantics passed rollback-only fixtures, but full Storage API and Realtime WebSocket calls with a valid Better Auth token remain open. A read-only Edge Function probe is deployed but has not yet received a positive token-backed call. Do not treat Data API acceptance as proof for every Supabase surface.

Production Supabase authentication settings, schema, users, and application data remain unchanged.



## Clean staging Worker restored — verified 7 November 2026

The temporary OIDC authorization-code acceptance helper was removed after the core hosted run. The staging Worker includes Telegram phone-verification routes and a managed transactional-email dispatcher. Its provider account and real delivery remain intentionally unconfigured until the final email phase.

- Worker version: `49495d57-d039-4a0e-9767-5963225f398b`
- Health: `ok`
- Issuer: `https://auth.sykabelajar.my.id/api/auth`
- PKCE S256: advertised
- JWKS: public ES256 / P-256 key verified
- Remote D1: migrations 0000–0006 applied; all 18 expected tables and `auth_email_accounts.provider` verified; zero users, sessions, accounts, verification rows, or phone challenges
- Email provider: managed dispatcher deployed; no active Brevo/ZeptoMail account yet, so real delivery remains fail-closed
- Google OAuth credentials: not configured; optional

The temporary `OIDC_ACCEPTANCE_TEST_TOKEN` was removed after the core hosted OIDC test. The current staging Worker has no test-only auth token endpoint. The separate read-only Supabase Edge Function probe is a controlled staging fixture, not a Worker route.

### Supabase surfaces not exercised

The successful hosted test proves Custom OIDC, JWT signature/claims, Data API acceptance, and two-user RLS isolation. It must not be generalized to other Supabase services:

- Storage: an owner/issuer RLS fixture against `storage.objects` passed inside a transaction that was rolled back. It verified owner read, cross-user denial, forged owner insert denial and wrong-issuer denial. No bucket or object was retained; HTTP Storage upload/download still requires a real Better Auth token.
- Realtime: private-topic policy semantics using `realtime.topic()`, UUID subject and issuer guard passed using a rollback-only test table. Direct insert into `realtime.messages` was blocked before RLS because no current-date partition exists; no persistent policy or data was added. A hosted WebSocket subscribe/broadcast test remains pending.
- Edge Functions: a read-only staging function `better-auth-oidc-acceptance` is ACTIVE. It verifies the external Better Auth JWT inside the handler with pinned `@supabase/server@1.9.2`, requires exact issuer/audience/UUID/role and a five-minute lifetime, and reads only the synthetic fixture through the caller-scoped client. Its `verify_jwt=false` platform setting is intentional because in-handler third-party verification is used; positive token invocation still awaits a verified staging session.

The staging PostgreSQL fixture rows are retained as synthetic test fixtures; the temporary Better Auth user/session/account records were removed. No production project or production login flow was changed.

## Latest staging surface test checkpoint — 7 November 2026

- Storage policy acceptance: PASS for owner read, cross-user read denial, forged owner insert denial and wrong issuer denial. The test bucket and policies were transaction-scoped and rolled back; inventory confirms no bucket or storage policy remains.
- Realtime policy semantics: PASS for per-user private topic read/write, cross-user isolation and wrong issuer denial using `realtime.topic()`. The actual `realtime.messages` table has no current-date partition in this staging environment, so a SQL insert stopped before RLS evaluation. A real Supabase Realtime WebSocket test is not yet complete.
- Supabase provisioning contract: PASS on staging through a rollback-only synthetic RPC test. Organizer maps to `organizer_member`; email and phone verification are idempotent; a duplicate Telegram subject is rejected; only the SHA-256 phone identity hash is stored. All generated identities were rolled back and `private.app_users` remains empty.
- Edge probe: `better-auth-oidc-acceptance` version 1 is ACTIVE on the isolated project, and its source is in `services/auth-worker/supabase-test/supabase/functions/better-auth-oidc-acceptance/index.ts`. Static CI contract tests and Deno type-check are now wired. A positive hosted invocation still needs a real Better Auth access token.
- No production schema, Storage, Realtime, Edge Function, user, or authentication settings were changed.


## Stage 4/5 continuation — email delivery explicitly deferred (9 November 2026)

- Do not configure Zoho/ZeptoMail, Brevo, sender domains or API tokens during Stages 2–5. Do not send a real test email or spend provider credits.
- Stage 4 email-verification and password-recovery pages/client calls remain source-tested; local Worker CI uses a mock delivery provider. These code paths can be completed and type-checked without proving external mail delivery.
- A real verified staging identity for OIDC/Storage/Realtime/Edge acceptance must come from an already verified synthetic staging account or a staging-only social OAuth path. If neither is available because domain delegation or provider credentials are missing, continue the remaining source implementation and static/local tests; record only the hosted positive-session matrix as pending.
- Actual email deliverability and end-to-end verification/recovery mail testing belong to the final stage after the core login/resource architecture is accepted.


## Latest implementation correction — Better Auth JWKS and read-only probe v2 (9 November 2026)

- Supabase `@supabase/server@1.9.2` verifies against the project JWKS by default. The shared Better Auth Edge adapter and isolated staging probe now explicitly override that default with `https://auth.sykabelajar.my.id/api/auth/jwks`, and pass the exact issuer and resource audience to the SDK.
- Verifier infrastructure/JWKS failures return 503 `AUTH_VERIFICATION_UNAVAILABLE`; missing or invalid bearer tokens remain 401. The issuer and JWKS host/path are fixed in source rather than being chosen by a request.
- Read-only staging probe `better-auth-oidc-acceptance` was refreshed on isolated project `sykabelajar-auth-staging` to version 2. It reads only the synthetic `auth_oidc_acceptance_rows` fixture through the caller-scoped RLS client and selects its actual `note` column. It does not use a service-role client or perform writes. No application Edge handler or production project was deployed.
- The positive hosted invocation still requires an already verified synthetic Better Auth session. Do not seed fake verified accounts, bypass the verified-email gate, or spend provider credits. Real email verification and recovery delivery remain final-phase work.


### Probe v2 hosted anonymous rejection — 9 November 2026

Supabase unified Edge logs for isolated project `ydamszdfsxqisanazdkb` contain multiple `POST` requests to `better-auth-oidc-acceptance` **version 2** at 13:28–13:30 UTC on 9 November 2026. Each returned HTTP **401**. This confirms the deployed probe denies unauthenticated calls after the v2 deployment. It is only negative/anonymous acceptance; there is no positive Better Auth token call in this evidence, and the browser/Storage/Realtime/Edge two-user matrix remains open.
