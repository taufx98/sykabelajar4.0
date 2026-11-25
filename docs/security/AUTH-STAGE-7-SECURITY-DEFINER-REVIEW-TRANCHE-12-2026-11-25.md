# Stage 7 SECURITY DEFINER manual review — Tranche 12

Date: 25 November 2026  
Project: Production DB2 `mvdczyitbkxkldjughor` (PostgreSQL 17.6)  
Scope: canonical individual and collective competition-result RPCs  
Decision: **accepted for partial manual-review count only; Production remains NO-GO**

## Exact signatures and Production fingerprint evidence

A read-only Production catalog query compared the current `md5(pg_proc.prosrc)` values with the immutable 21 November triage snapshot. Both exact source fingerprints matched. The query also confirmed owner, SECURITY DEFINER, function configuration, and effective execution grants.

| Exact signature | Production `md5(prosrc)` | Owner | `anon` EXECUTE | `authenticated` EXECUTE | `service_role` EXECUTE | `search_path` |
|---|---|---|---:|---:|---:|---|
| `get_canonical_competition_result(uuid)` | `e8523cc64cfa98e828ea8fc12902eaba` | `postgres` | no | yes | yes | empty |
| `get_my_canonical_competition_result(uuid)` | `e59a13014024e2878dcc5573bec0d5ef` | `postgres` | no | yes | yes | `public, private, pg_catalog` |

The effective ACL entries are `authenticated=X/postgres`, `service_role=X/postgres`, and `postgres=X/postgres` for each function. Neither function grants EXECUTE to `PUBLIC` or `anon`. No Production owner, ACL, signature, or search-path change was made.

## Source review

- `get_canonical_competition_result(p_participant_id uuid)` is the participant-ID lookup. The reviewed replacement checks `private.current_user_is_better_auth()` and raises `BETTER_AUTH_ISSUER_REQUIRED` before the first read of `public.participants`. After the participant lookup, it retains the existing Admin, individual-owner, and collective-manager/member authorization checks. Unpublished competitions return no attempt or rank; official results are selected only from finalized, non-preview attempts.
- `get_my_canonical_competition_result(p_competition_id uuid)` is the frontend-facing wrapper used by `getMyCanonicalCompetitionResult(competitionId)`. Its reviewed replacement checks the Better Auth issuer before its participant lookup, scopes the lookup to `auth.uid()`, and delegates the resolved participant ID to the direct RPC. The direct RPC repeats issuer and object authorization at its own boundary.
- The frontend wrapper remains the user-facing path. No other database-function caller or separate server/Edge caller for the direct RPC was found in the repository search. Existing signatures, owner, SECURITY DEFINER attribute, and EXECUTE ACLs are preserved.

## Disposable PostgreSQL 17.6 runtime evidence

The rollback-only Stage 3 issuer regression covers both RPCs and the supported individual/collective ownership paths:

1. A legacy Supabase Auth issuer is rejected by both direct and wrapper RPCs with `BETTER_AUTH_ISSUER_REQUIRED`.
2. A valid Better Auth participant reads their own published result through the wrapper and direct RPC; the finalized official score and `published=true` projection are returned.
3. The same owner cannot see attempt score or rank before publication; the function returns `attempt=null`, `rank=null`, and `published=false`.
4. An unrelated Better Auth user receives `NOT_AUTHORIZED` when given another participant's existing ID.
5. Better Auth Admin retains access to the published result.
6. A non-Admin Better Auth collective manager can read the published collective result through its trigger-created canonical participant; an unrelated Better Auth user is denied for that exact existing collective participant ID.
7. Synthetic competitions, roster data, participants, attempts, and related fixture changes remain inside the outer transaction and are rolled back. The collective IDOR test captures the trigger-created canonical UUID before switching JWT claims, so the negative test proves an existing object boundary rather than a NULL/missing-ID response.

## CI and protected baseline

- PR #274 added the issuer-first direct RPC guard and individual owner/Admin/publication/IDOR regression coverage; its Auth Schema PR Contracts, Local Auth Claims, and Auth Worker CI checks passed before merge.
- PR #275 added the direct RPC to the read-only Production metadata export and local-only ACL reconstruction allowlist. The disposable restore now reconstructs the exact Production grants for 38 allowlisted Stage 3 identity/user/result functions. No Production grant/revoke statement is run.
- PR #276 added the collective manager positive path and collective IDOR fixture.
- PR #277 corrected the collective IDOR fixture to reuse the trigger-created canonical participant UUID after changing JWT identity.
- Protected Auth Production Schema Baseline [run #45459397254](https://github.com/taufx98/sykabelajar4.0/actions/runs/45459397254) passed **68/68 steps** on commit `56e04fef7f3658edcca0fd3ebc03a3d2e5571711`. The workflow applied the issuer-guard draft and completed the rollback-only trusted-issuer regression on a PostgreSQL 17.6 schema-only disposable restore.
- Supabase Local Auth Claims CI [run #45459397223](https://github.com/taufx98/sykabelajar4.0/actions/runs/45459397223) passed on the same commit.
- PR #277 checks on commit `8e15543a5bf2b345a084900ab6a2cf2e891592e0`: Auth Worker CI #45458956959 success; Auth Schema PR Contracts #45458956766 success; Supabase Local Auth Claims CI #45458956733 success.

## Count and remaining gate

Previous accepted manual review: 40/202.  
Tranche 12 accepted signatures: 2.  
**Cumulative accepted manual review: 42/202; 160 remain.**

This partial per-function review count does not change the final activation manifest. The canonical all-functions manifest remains `status: blocked` with `reviewedAuthenticatedFunctionCount: 0` until all 202 signatures have exact post-Stage-3 fingerprints, explicit classification, and class-specific tests. Production DB2 remains **NO-GO**.

No Production DDL/DML, account/data changes, role/grant/policy edits, Worker deployment, DNS change, or secret change was performed by this tranche.
