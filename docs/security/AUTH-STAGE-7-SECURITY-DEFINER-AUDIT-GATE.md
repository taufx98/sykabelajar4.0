# Stage 7 — Production SECURITY DEFINER issuer audit gate

Status: **blocking, refreshed 21 November 2026; no Production DB2 changes made.** Project: Production DB2 \`mvdczyitbkxkldjughor\` (PostgreSQL 17.6).

## Read-only live snapshot — 21 November 2026

A fresh Supabase Security Advisor query at 2026-11-21T01:17:16Z reported the following external-facing findings:

| Finding | Count | Treatment |
|---|---:|---|
| SECURITY DEFINER functions executable by \`anon\` | 46 | Review one by one; public/tokenized endpoints may be intentional |
| SECURITY DEFINER functions executable by \`authenticated\` | 202 | Must classify for Better Auth issuer enforcement or explicit public/token allowlist |
| RLS-enabled tables without policies | 23 | Classify internal/private tables vs exposed tables; do not add permissive policies automatically |
| Supabase Auth leaked-password protection disabled | 1 | Applies to legacy Supabase Auth; reassess after Better Auth cutover rather than silently changing the existing Auth configuration |

A separate read-only \`pg_proc\` definition scan produced these overlapping heuristics for the 202 \`authenticated\`-executable functions:

- 84 call \`private.current_user_is_admin()\` (the Stage 3 draft replaces the shared Admin-role path with a Better Auth issuer/identity check).
- 118 do **not** contain \`private.current_user_is_admin\`, \`private.current_user_has_role\`, \`private.current_user_is_better_auth\`, or an explicit \`auth.jwt()\` reference.
- Of those 118, 77 contain \`auth.uid()\`; 19 reference \`user_roles\` directly; 10 accept \`p_access_token\` or \`p_portal_token\`; 41 contain neither \`auth.uid()\` nor an obvious issuer/helper marker.

These groups overlap. They are **static indicators, not vulnerability verdicts**. A function may use a separate token, owner predicate, private helper, or public-data contract not detected by this coarse scan. The 46 \`anon\` functions overlap the 202 \`authenticated\` functions.

The 21 November direct catalog recheck separates Supabase's own internal Auth relations from application relations: 10 FKs in schema \`auth\` still point to \`auth.users\`; the application cutover remains 69 FKs total (65 in \`public\`, 4 in \`private\`). The complete catalog therefore has 79 FKs to \`auth.users\` if the 10 internal Auth FKs are included. The Stage 3 application FK plan must cover only the 69 \`public\`/\`private\` relations; never retarget Supabase's internal \`auth\` constraints.

The exact, read-only 21 November metadata inventory for all 202 signatures is saved in \`docs/security/AUTH-STAGE-7-SECURITY-DEFINER-INVENTORY-2026-11-21.json\` (202 distinct signatures, source MD5, owner, ACL, execute flags, and per-function search_path). Its static markers show 77 with an empty search_path and 125 with a non-empty search_path; 130 mention auth.uid, 84 mention the current Admin helper, 24 mention user_roles, 13 mention access/portal token parameters, and 0 contain a direct auth.jwt marker. These are triage indicators only, not classifications or pass/fail verdicts. Every function still requires manual source/dependency review and per-class runtime tests. The provisioning activation workflow requires the live metadata to match this snapshot exactly and stops on any drift.

A full per-function source triage was added at `docs/security/AUTH-STAGE-7-SECURITY-DEFINER-TRIAGE-2026-11-21.json`. It contains all 202 exact signatures with owner, argument/result signature, language, search-path config, ACL, anon/authenticated/service-role flags, source MD5, static risk markers and a short source excerpt. Heuristic suggestion counts: 104 admin/organizer candidates, 55 Better Auth user candidates, 14 participant/portal token candidates, 11 public-read candidates, 4 worker-internal candidates, 2 scheduler/trigger candidates, and 12 unclassified. All 202 entries remain `reviewStatus: not_reviewed`; all three per-function test states remain `pending`. The category counts are navigation aids, not approvals or vulnerability verdicts. Production provisioning remains blocked until all 202 are individually reviewed, fingerprints are confirmed against the post-Stage-3 catalog, and class-specific legacy-issuer/IDOR/token/public tests pass.

The three custom \`auth.users\` triggers are still present: \`on_auth_user_created\`, \`trg_referral_email_confirmed\`, and \`trg_referral_signup_attribution\`. \`private.app_users\` is still absent. No Production DDL/DML was run.

The machine-readable review gate `docs/security/AUTH-STAGE-7-SECURITY-DEFINER-ALLOWLIST-2026-11-21.json` is intentionally `status: blocked` with 0/202 reviewed functions. The owner-only activation workflow and its tests were merged by PR #202; post-merge Auth Worker CI #44851590910 and read-only staging preflight #44851590980 passed. The workflow refuses to run unless the inventory is completely classified and every per-function legacy-issuer/token boundary test is marked passing. It also rejects any live catalog fingerprint drift, and is not dispatched. Do not change the manifest to complete merely to pass the workflow.

DB2 remains unchanged: 12 Auth users/identities, 46 sessions, 76 refresh tokens, 12 profiles, 17 business-role rows, 69 application FKs still reference \`auth.users\`, \`private.app_users\` is absent, and three legacy Auth lifecycle triggers remain.

## Application RLS gap inventory — 21 November 2026

The read-only catalog found 49 RLS-enabled tables without policies across the whole database: 23 application-owned tables (20 `public`, 3 `private`) and 26 platform-owned tables (16 `auth`, 10 `storage`). The platform-owned tables are outside this application's migration scope and must not be changed.

The exact application list and grants are stored in `docs/security/AUTH-STAGE-7-RLS-NO-POLICY-INVENTORY-2026-11-21.json`; the review matrix is `docs/security/AUTH-STAGE-7-RLS-POLICY-REVIEW-2026-11-21.json`, currently blocked at 0/23 reviewed. Seventeen public tables grant no direct browser-role table privileges. Three public tables (`competition_status_history`, `notification_deliveries`, `supabase_system_logs`) have broad CRUD grants for both `anon` and `authenticated`, but no RLS policies. PostgreSQL RLS therefore remains default-deny for these roles while policies are absent; nevertheless, the broad grants must be reviewed against actual application callers before changing grants or adding policies. No blanket policy or privilege changes are approved.

### Three broad-grant tables — catalog review and canonical Stage 5 draft

A fresh read-only ACL/RLS query confirmed all three tables are owned by `postgres`, have RLS enabled with zero policies, and currently grant SELECT/INSERT/UPDATE/DELETE to `anon`, `authenticated`, and `service_role`. The source scan found these trusted PostgreSQL callers:

- `competition_status_history`: postgres-owned SECURITY DEFINER callers include `public.track_competition_status()`, `public.transition_competition(...)`, `public.get_public_competition_results(...)`, `public.admin_get_monitoring_dashboard(...)`, and `private.monthly_organizer_competition_quota(...)`.
- `supabase_system_logs`: `public.fetch_and_save_supabase_logs()` is a postgres-owned SECURITY DEFINER writer.
- `notification_deliveries`: no PostgreSQL function-body reference was found by the current `pg_proc` scan; retain trusted backend delivery writes via `service_role` and validate its caller on the disposable restore.

The single canonical least-privilege SQL draft is `docs/security/AUTH-STAGE-5-NO-POLICY-TABLE-ACL-DRAFT.sql`, already integrated into `.github/workflows/auth-schema-baseline.yml`. It is applied **only to the disposable PostgreSQL 17.6 restore**, not Production. Its preflight checks exact `postgres` ownership, RLS enabled, zero policies and the current browser/backend grants; it revokes only `PUBLIC`, `anon`, and `authenticated`, retaining all `service_role` and `postgres` CRUD. Its postcondition rechecks owner, RLS, policy count and all four CRUD privileges for the trusted roles. Tests for this shared draft are in `scripts/auth-migration/stage5-no-policy-table-acl-draft.contract.test.mjs` and `services/auth-worker/tests/stage7-rls-no-policy-hardening-contract.test.mjs`. The duplicate Stage 7 SQL copy was removed to avoid conflicting drafts.

This is catalog/source review and static contract coverage only until the current `Auth Production Schema Baseline` workflow passes the complete disposable run. The Stage 7 RLS review matrix remains `blocked_unreviewed` at 0/23 acceptance-reviewed tables; three have catalog notes, the remaining 20 still need review, and positive/negative runtime and owner-approval evidence is still outstanding. Do not apply this SQL to Production as part of this PR.

### Anon-executable function review — additional source findings (21 November 2026)

A fresh source scan of the 46 anon-executable/authenticated-executable `SECURITY DEFINER` functions identified a concrete privacy-boundary defect in `public.get_profile_connections(uuid,text)`: when an anonymous request calls the function, `auth.uid() <> p_profile_id` evaluates to SQL NULL, and the PL/pgSQL `IF` does not enter the early-return branch. A profile with `show_following_popup=false` or `show_social_popup=false` could therefore have connection rows returned to anon. The Stage 3 guard draft now replaces this function with a NULL-safe check and allows the private-owner exception only when the JWT issuer is the exact Production Better Auth issuer and the UUID exists in `private.app_users` as `identity_origin='better_auth'`. Explicitly public profile settings still allow public reads.

The same draft also hardens `get_public_profile_badge_visibility`, `get_public_profile_badges`, and `get_public_profile_ui_settings`: self-access to a private profile now requires the Better Auth issuer/identity helper, while public profiles retain the existing public visibility path. `get_follow_status` and `get_public_profile_social` now require a valid Better Auth identity; their `PUBLIC`/`anon` EXECUTE grants are removed. Redundant `anon` EXECUTE is also removed from `admin_diagnose_organizer_voucher_delete`, `admin_evaluate_badges`, `admin_update_system_error_status`, and `reopen_system_error_incident`; authenticated/service-role/owner access is preserved and pre/post catalog assertions are included.

Static contract tests were added under `services/auth-worker/tests/stage7-*-contract.test.mjs`. These are draft/source checks, not runtime proof. The rewritten profile functions and ACL changes still require PostgreSQL 17.6 disposable restore tests: anonymous + private setting must return no rows; the verified Better Auth owner may read their own private connections/settings; a different Better Auth user and a legacy issuer must be denied; explicitly public profiles must remain public; authenticated Admin/organizer paths must continue to work. The 202-function classification remains 0/202 acceptance-reviewed until every function has its own reviewed boundary and class tests.

## Why this blocks Stage 3

The issuer restrictive RLS policies do not constrain a \`SECURITY DEFINER\` function while it runs with its owner's privileges. Therefore an old Supabase Auth JWT may still reach a definer RPC whose authorization relies only on \`auth.uid()\`, direct \`user_roles\` reads, or another legacy identity assumption. The presence of 61 issuer RLS guards and 21 specially rewritten functions is not proof that all exposed RPCs reject a legacy issuer.

Do **not** revoke \`EXECUTE\` from all 46/202 functions in bulk. Some intentionally support unauthenticated public data, competition portal tokens, participant access tokens, or other application contracts. Blanket revokes would break the unreleased application without proving the remaining functions safe.

## Required completion before Production DDL

1. Capture the complete current function inventory from \`pg_proc\`: exact schema/signature, \`prosecdef\`, owner, ACL for \`PUBLIC\`/\`anon\`/\`authenticated\`/\`service_role\`, source definition, and dependent tables/functions.
2. Assign every function to one reviewed class:
   - **Better Auth user RPC:** must require the exact Production issuer and \`private.app_users.identity_origin='better_auth'\`, directly or through an issuer-gated shared helper.
   - **Admin/organizer RPC:** must use only issuer-gated role/membership helpers; never authorize from a legacy \`user_roles\` row alone.
   - **Public read RPC:** must expose only intentionally public fields/rows and be explicitly allowlisted.
   - **Public event RPC:** may accept narrowly scoped unauthenticated interaction events (for example, active banner VIEW/CLICK). Validate the event type, object state, visitor-key entropy/format, idempotent replay and bounded side effects; do not treat it as a public read or use it to expose user data.
   - **Participant/portal token RPC:** must validate a high-entropy, scoped, expiring, replay-safe token without relying on \`auth.uid()\`; keep the exact intended \`anon\`/authenticated grants.
   - **Worker/internal RPC:** revoke browser roles and grant only the server role required by the Worker.
   - **Scheduler/trigger RPC:** grant only the actual owner/scheduler/trigger role; prove it cannot be invoked as an arbitrary browser user.
   - **Deprecated/unused RPC:** remove browser EXECUTE grants only after proving there are no callers; do not drop the function in this pass.
3. For every Better Auth user RPC, update its definer body to call the shared Better Auth identity helper (or a helper that is proven to call it). For every token RPC, test wrong token, expired token, other participant, replay, and information-leak cases. Do not rely on the RLS policy when the function is SECURITY DEFINER.
4. Add a machine-readable allowlist/denylist contract covering **all** 202 functions, plus tests that fail when a new exposed SECURITY DEFINER function appears without classification.
5. On the disposable PostgreSQL 17.6 restore, test each class with a legacy Supabase Auth JWT, a valid Better Auth JWT, an unrelated Better Auth UUID, and anon access. Expected: legacy issuer rejected for every Better Auth-only route; only explicit public/token routes remain available to anon; Admin/organizer gates remain server-verified.
6. Re-run Supabase Security Advisor and record the intentionally remaining public/authenticated SECURITY DEFINER findings with their allowlist rationale. A remaining Advisor warning is not automatically an exploitable vulnerability, but an unexplained function is a release blocker.

## Existing draft coverage

\`docs/security/AUTH-STAGE-3-SECURITY-DEFINER-ISSUER-GUARDS-DRAFT.sql\` rewrites a limited set of high-impact Admin/organizer/teacher/realtime functions and the common helper layer. It does **not** yet provide a complete classification or rewrite for all 202 functions returned by the live advisor. Do not describe the current draft as complete coverage.

The disposable baseline [#44683755623](https://github.com/taufx98/sykabelajar4.0/actions/runs/44683755623) proves the reviewed 69-FK/identity-root/rollback/Stage 5 regression set, not this full 202-function catalog review. Production DB2 remains NO-GO until this gate is completed and re-rehearsed on the disposable restore.
