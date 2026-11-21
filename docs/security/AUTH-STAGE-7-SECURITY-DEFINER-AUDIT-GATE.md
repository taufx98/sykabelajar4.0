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

The three custom \`auth.users\` triggers are still present: \`on_auth_user_created\`, \`trg_referral_email_confirmed\`, and \`trg_referral_signup_attribution\`. \`private.app_users\` is still absent. No Production DDL/DML was run.

The machine-readable review gate \`docs/security/AUTH-STAGE-7-SECURITY-DEFINER-ALLOWLIST-2026-11-21.json\` is intentionally \`status: blocked\` with 0/202 reviewed functions. The new owner-only activation workflow refuses to run unless the inventory is completely classified and every per-function legacy-issuer/token boundary test is marked passing. Do not change the manifest to complete merely to pass the workflow.

DB2 remains unchanged: 12 Auth users/identities, 46 sessions, 76 refresh tokens, 12 profiles, 17 business-role rows, 69 application FKs still reference \`auth.users\`, \`private.app_users\` is absent, and three legacy Auth lifecycle triggers remain.

## Why this blocks Stage 3

The issuer restrictive RLS policies do not constrain a \`SECURITY DEFINER\` function while it runs with its owner's privileges. Therefore an old Supabase Auth JWT may still reach a definer RPC whose authorization relies only on \`auth.uid()\`, direct \`user_roles\` reads, or another legacy identity assumption. The presence of 61 issuer RLS guards and 21 specially rewritten functions is not proof that all exposed RPCs reject a legacy issuer.

Do **not** revoke \`EXECUTE\` from all 46/202 functions in bulk. Some intentionally support unauthenticated public data, competition portal tokens, participant access tokens, or other application contracts. Blanket revokes would break the unreleased application without proving the remaining functions safe.

## Required completion before Production DDL

1. Capture the complete current function inventory from \`pg_proc\`: exact schema/signature, \`prosecdef\`, owner, ACL for \`PUBLIC\`/\`anon\`/\`authenticated\`/\`service_role\`, source definition, and dependent tables/functions.
2. Assign every function to one reviewed class:
   - **Better Auth user RPC:** must require the exact Production issuer and \`private.app_users.identity_origin='better_auth'\`, directly or through an issuer-gated shared helper.
   - **Admin/organizer RPC:** must use only issuer-gated role/membership helpers; never authorize from a legacy \`user_roles\` row alone.
   - **Public read RPC:** must expose only intentionally public fields/rows and be explicitly allowlisted.
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
