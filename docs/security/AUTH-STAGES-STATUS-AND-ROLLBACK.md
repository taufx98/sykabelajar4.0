# Better Auth migration — live readiness and rollback record

Status date: 5 November 2026  
Scope: SYKABELAJAR 4.0, production Supabase project `mvdczyitbkxkldjughor`, isolated Better Auth branch `security/auth-poc-stage-1`.

This is a verified status record, not authorization to deploy or migrate production. All Cloudflare and Supabase catalog checks described below were read-only. No production DDL/DML, auth-provider configuration, account deletion, DNS change, Worker deployment, or real email sending was performed.

## Executive status

| Stage | Completed locally | Still blocking completion |
|---|---|---|
| 1. Cloudflare foundation | Better Auth Worker package, D1 schema migrations, encrypted ZeptoMail Agent storage, admin API and admin UI; local D1 migrations and Worker dry-run pass | Cloudflare token currently cannot read D1; remote D1 not created; auth Worker not deployed; custom domain and Worker secrets not configured; real ZeptoMail delivery not tested |
| 2. OIDC and JWT | Authorization Code + PKCE S256, ES256, discovery/JWKS, UUID `sub`, PostgreSQL `role=authenticated`, five-minute token and negative tests pass locally | Supabase hosted Custom OIDC acceptance test blocked by Free project limit; no production issuer registration |
| 3. Supabase identity | Live metadata inventory, exact 69-FK catalog comparison, identity/referral/verification design and 73/73 local pgTAP fixture tests | Complete schema-only baseline not exported; `private.app_users` absent; no executable production identity/FK/trigger/RPC migration; organizer phone-verification replacement not available |
| 4. Frontend | ZeptoMail Admin settings panel is implemented and frontend CI passes | Main app still uses Supabase Auth; Better Auth client/token adapter and global session integration not started |
| 5. Backend | Four dependent Edge Functions and ten auth-dependent database functions inventoried; RLS/business-role architecture documented | No Edge Function/RPC/trigger migration; SECURITY DEFINER authorization and issuer review remains open |
| 6. Reset and full testing | Cleanup rules and synthetic provisioning tests prepared | No demo identity has been confirmed or deleted; no admin bootstrap; full feature/IDOR/Realtime test matrix and rollback rehearsal not run |
| 7. Production | No production cutover attempted | Worker/domain/OIDC/monitoring/cutover/sign-up restriction remain unconfigured |

## Stage 1 — Cloudflare and ZeptoMail

### What was verified

The read-only Cloudflare preflight is [run #42043789820](https://github.com/taufx98/sykabelajar4.0/actions/runs/42043789820).

- Cloudflare API credentials are available to GitHub Actions and can read the `sykabelajar.my.id` zone; the zone status is `active`.
- The same token can read Worker scripts. The account currently lists `sykabelajar4-0`; it does not list `sykabelajar-auth-poc`.
- Worker custom domains and routes are readable, but no `auth.sykabelajar.my.id` custom domain or route is present.
- The token's D1 database-list request is rejected with Cloudflare error code `10000`, message `Authentication error`. This shows the current token is not authorized for D1 read access. The `/user/tokens/verify` endpoint itself returned 401, but zone and Worker account-scoped reads succeeded; this endpoint result alone is not treated as proof that the account token is invalid.
- `wrangler.toml` still contains the intentional all-zero D1 database placeholder. It must not be deployed as-is.

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

Before staging delivery, set a stable `AUTH_EMAIL_ENCRYPTION_KEY` Worker secret and the Supabase publishable-key/session-verification bridge variables. Then add the verified ZeptoMail Agent and Send Mail Token through the admin panel. Keep the token server-side and encrypted in D1. The test button sends only to the signed-in admin's own email and can consume existing ZeptoMail credits. Do not purchase credits or enable auto top-up as part of this migration.

## Stage 2 — Supabase Custom OIDC blocker

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
