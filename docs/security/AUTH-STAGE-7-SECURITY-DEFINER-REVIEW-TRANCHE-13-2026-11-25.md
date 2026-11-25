# Stage 7 SECURITY DEFINER manual review — Tranche 13

Date: 25 November 2026  
Project: Production DB2 `mvdczyitbkxkldjughor` (PostgreSQL 17.6)  
Scope: five currency-log, organizer-entitlement, effective-plan and competition-quota RPCs  
Decision: **accepted for partial manual-review count only; Production remains NO-GO**

## Exact signatures and read-only Production fingerprint evidence

On 25 November, a read-only Production catalog query compared each current `md5(pg_proc.prosrc)` with the immutable 21 November triage snapshot. All five hashes match exactly. Each function remains owned by `postgres`, remains SECURITY DEFINER, and retains the original effective ACL: `postgres=X/postgres`, `authenticated=X/postgres`, `service_role=X/postgres`; `anon` and `PUBLIC` have no EXECUTE.

| Exact signature | Production `md5(prosrc)` | `search_path` | anon | authenticated | service_role |
|---|---|---|---:|---:|---:|
| `get_all_currency_logs(integer)` | `58989fc6a65d26a228f06769e444903a` | `public, private` | no | yes | yes |
| `get_user_currency_logs(uuid,integer)` | `bf7a478554b65bffaddb761ecae34019` | `public, private` | no | yes | yes |
| `get_active_organizer_entitlements(uuid)` | `347c3643c3860af5dca477b5a4f4f598` | empty | no | yes | yes |
| `get_organizer_effective_plan(uuid)` | `a07ecfd264fc5401b954d1381f0fc8b5` | empty | no | yes | yes |
| `get_organizer_competition_quota(uuid)` | `72d733e2b864c9f5171176d158f2d366` | empty | no | yes | yes |

No Production function body, owner, signature, search-path setting, ACL, role or grant was modified.

## Caller and source review

- `get_all_currency_logs(integer)` is used by the Admin currency-log frontend service. The reviewed replacement filters on the exact Better Auth issuer helper and the issuer-gated Admin helper before returning logs.
- `get_user_currency_logs(uuid,integer)` is used by the Admin/user currency-log frontend service. The prior self-read branch used `auth.uid() = p_target_user_id`; the replacement now requires `private.current_user_is_better_auth()` in the SQL row filter before either the self-owner or Admin branch. This closes the legacy Supabase Auth self-read path.
- `get_active_organizer_entitlements(uuid)` and `get_organizer_effective_plan(uuid)` are called by the organizer entitlement service. Both now reject a non-Better-Auth issuer at function entry, then require Admin or the organizer owner/member boundary before reading plan/entitlement data.
- `get_organizer_competition_quota(uuid)` is called by the organizer competition-configuration page. Its issuer check now runs before Admin/competition-owner authorization and before the quota projection.

All five signatures, default arguments, return columns, owners, SECURITY DEFINER attributes, search_path settings and Production EXECUTE grants are preserved. PR #280 adds all five exact signatures to the local disposable ACL reconstruction allowlist so the schema-only restore reproduces Production's effective grants before applying this draft.

## Disposable PostgreSQL 17.6 runtime evidence

The rollback-only tranche 13 section of `stage3-issuer-guard-regression.sql` verifies:

1. A legacy Supabase Auth issuer receives empty currency-log projections and `BETTER_AUTH_ISSUER_REQUIRED` from all three organizer entitlement/plan/quota RPCs.
2. A valid Better Auth Admin can call the Admin currency-log RPCs and can inspect a synthetic organizer's entitlements, FREE effective plan and Admin quota projection.
3. A valid Better Auth organizer owner can inspect their own entitlements, effective plan and quota; the result remains scoped to that organizer.
4. An unrelated Better Auth user gets no foreign currency-log rows and receives `ACCESS_DENIED` for the other organizer's entitlement, effective-plan and quota RPCs.
5. All synthetic fixtures are part of the outer transaction and are rolled back.

**Currency-log fixture limitation:** the schema-only Production restore intentionally imports no `auth.users`, profile or currency-log rows. Therefore the Admin/self currency-log positive calls execute against an empty projection; the test does not claim to verify a non-empty log result. The source contract separately asserts the direct issuer predicate and self-owner filter. No real user/log data was exported or inserted.

## PRs, baseline and CI

- PR #279 adds the five Better Auth issuer/owner/Admin boundaries and rollback-only runtime/static contracts.
- The first post-merge baseline correctly failed closed because the local ACL reconstruction allowlist did not yet include these five functions. PR #280 fixed only the disposable restore metadata and generator, expanding the allowlist from 38 to 43 functions and the user-scoped metadata group from 14 to 19 rows.
- Protected Auth Production Schema Baseline [#45527720909](https://github.com/taufx98/sykabelajar4.0/actions/runs/45527720909) passed **68/68 steps** on commit `e7b0b20b853fc83682cabb8894499922428e2a6d`. The Stage 3 SECURITY DEFINER issuer-guard apply step succeeded, the trusted-issuer/RLS regression succeeded, all 14 collective portal invalid-token checks passed, the 5,000-key selector test passed, the two-user Cloudinary/payment Edge integration passed, and disposable cleanup completed.
- Supabase Local Auth Claims CI [#45527720794](https://github.com/taufx98/sykabelajar4.0/actions/runs/45527720794) passed on the same commit.
- Auth Worker CI [#45527720824](https://github.com/taufx98/sykabelajar4.0/actions/runs/45527720824) passed on the same commit.

No Production DDL/DML, row changes, account/data export, role/grant/policy edits, Worker deployment, DNS change or secret change was performed by this tranche.

## Count and remaining gate

Previous accepted manual review: 63/202 (Tranches 01–12, including the reconciled Tranches 06–10 record).  
Tranche 13 accepted signatures: 5.  
**Cumulative accepted manual review: 68/202; 134 remain.**

This is a partial per-function source/runtime review count, not all-functions activation approval. The canonical activation manifest remains `status: blocked` and `reviewedAuthenticatedFunctionCount: 0` until all 202 functions have exact post-Stage-3 fingerprints, explicit classifications and class-specific tests. Production DB2 remains **NO-GO**.

## Next tranche

The next reviewed candidates are five exam-flow RPCs not yet covered by a dedicated manual-review tranche: `get_linear_exam_activity`, `grade_competition_attempt`, `grade_essay_similarity`, `save_manual_grading_item` and `start_organizer_exam_preview`. Review must focus on issuer checks before the first protected read/row lock, organizer/Admin scope, and rollback-only owner/IDOR tests.
