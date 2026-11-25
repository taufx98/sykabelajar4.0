# Stage 7 SECURITY DEFINER manual review — Tranche 14

Date: 25 November 2026  
Project: Production DB2 \`mvdczyitbkxkldjughor\` (PostgreSQL 17.6)  
Scope: five exam-flow, organizer/Admin SECURITY DEFINER RPCs  
Decision: **accepted for partial manual-review count only; Production remains NO-GO**

## Exact signatures and read-only Production fingerprint evidence

A read-only Production catalog query on 25 November compared the current \`md5(pg_proc.prosrc)\` values with the immutable 21 November triage snapshot. All five source fingerprints matched. Each function remains owned by \`postgres\`, remains \`SECURITY DEFINER\`, and retains its existing effective ACL: \`authenticated\` and \`service_role\` have EXECUTE; \`anon\` and \`PUBLIC\` do not.

| Exact signature | Production \`md5(prosrc)\` | \`search_path\` | anon | authenticated | service_role |
|---|---|---|---:|---:|---:|
| \`get_linear_exam_activity(uuid,integer,integer)\` | \`a9d641b464ace5b963f91c9d6a3d096d\` | empty | no | yes | yes |
| \`grade_competition_attempt(uuid)\` | \`a04c581242d9180a7ab7bfd8dfe643d4\` | \`public, private\` | no | yes | yes |
| \`grade_essay_similarity(uuid,uuid)\` | \`92be45614ce3fab0a2e9aa441ca9636f\` | empty | no | yes | yes |
| \`save_manual_grading_item(uuid,numeric,text)\` | \`65a5b9937cdd159a29dad736d996b2fc\` | empty | no | yes | yes |
| \`start_organizer_exam_preview(uuid)\` | \`643f1d4554a7dc62a8037c2eb6d0bd08\` | empty | no | yes | yes |

The draft includes a fail-closed Production fingerprint preflight for all five exact signatures. Before any disposable replacement, it verifies source MD5, owner, SECURITY DEFINER flag, exact \`search_path\`, absence of PUBLIC/anon EXECUTE, and presence of authenticated/service_role EXECUTE. The disposable ACL reconstruction now covers 48 exact functions (previously 43); the user-scoped issuer metadata group now contains 24 entries (previously 19).

No Production function body, signature, owner, search_path, ACL, grant, role, or policy was modified.

## Caller and source review

- \`get_linear_exam_activity(uuid,integer,integer)\` is called by \`src/services/linearExam.service.ts\`. The replacement validates the Better Auth issuer before the first protected read, then checks Admin or organizer ownership before reading attempts/runtime activity or resolving timeouts.
- \`grade_competition_attempt(uuid)\` is called by \`src/services/organizer.service.ts\`. The replacement validates issuer, performs a non-locking attempt/competition scope preflight, checks Admin/organizer ownership before \`FOR UPDATE\`, and rechecks scope after the lock. The scoring, grading-item writes, finalization, and XP logic are retained.
- \`grade_essay_similarity(uuid,uuid)\` is called by \`src/services/organizer.service.ts\`. The replacement validates issuer and Admin/editor scope before locking the attempt, then rechecks scope/status after the lock. Existing question snapshot, entitlement, similarity, and grading-item upsert behavior is retained.
- \`save_manual_grading_item(uuid,numeric,text)\` is called by \`src/services/manualGrading.service.ts\`. The replacement scopes the grading-item/attempt/competition preflight to Admin or the organizer before taking locks, retains the established attempt-then-grading-item lock order, and rechecks scope before updating score/feedback and writing the audit log.
- \`start_organizer_exam_preview(uuid)\` is called by the linear-exam service and organizer preview/configuration pages. The replacement checks issuer, Admin or owner/editor scope, and DRAFT state before the per-user/competition advisory lock; it rechecks those conditions after the lock before recreating the preview attempt.

The frontend call inventory did not identify an additional database function caller for these five signatures. Function signatures, return types, SECURITY DEFINER ownership, search_path, and existing role grants are preserved in the draft.

## Disposable PostgreSQL 17.6 runtime evidence

The appended Tranche 14 section of \`scripts/auth-migration/stage3-issuer-guard-regression.sql\` ran as part of the protected baseline's Stage 3 trusted-issuer regression. The complete script succeeded and the enclosing transaction ended with ROLLBACK.

1. A legacy Supabase Auth issuer received \`BETTER_AUTH_ISSUER_REQUIRED\` from all five RPCs.
2. The synthetic organizer owner and Better Auth Admin could read the organizer's activity and reach the expected business-state checks for grading/preview.
3. The grading fixtures deliberately use an already-finalized synthetic attempt. Therefore automatic/AI/manual grading return the expected \`ATTEMPT_NOT_GRADABLE\` boundary after issuer/scope validation; this tranche does not claim to re-exercise a real scoring mutation. The preview fixture is not DRAFT, so authorized owner/Admin callers reach \`PREVIEW_REQUIRES_DRAFT_COMPETITION\`; no preview attempt is created.
4. An unrelated Better Auth user is denied activity, automatic grading, and AI grading with \`FORBIDDEN\`; manual grading returns \`GRADING_ITEM_NOT_FOUND\` to hide the foreign item; organizer preview returns \`NOT_AUTHORIZED\`.
5. The activity fixture has no exam runtime rows, so the activity RPC does not trigger a timeout state transition during this test.

All IDs and rows are synthetic. The regression is rollback-only; no imported Production account or application rows are used.

## PR, protected baseline, and CI

- PR [#282](https://github.com/taufx98/sykabelajar4.0/pull/282) added the five issuer-first/scope-before-lock replacements, exact Production catalog preflight, 48-function ACL restore coverage, 24-row user-scoped metadata coverage, and rollback-only regression assertions. It merged to \`security/auth-poc-stage-1\` as \`051d4d300edc40179cf7218115019d8faafc8609\`.
- PR Auth Schema Contracts [#45577729501](https://github.com/taufx98/sykabelajar4.0/actions/runs/45577729501), frontend lint/typecheck/build, and Cloudflare Pages preview passed. PR Local Supabase Auth Claims [#45577729482](https://github.com/taufx98/sykabelajar4.0/actions/runs/45577729482) passed.
- Protected Auth Production Schema Baseline [#45578016932](https://github.com/taufx98/sykabelajar4.0/actions/runs/45578016932) passed **68/68 steps** on merge commit \`051d4d300edc40179cf7218115019d8faafc8609\`. The run passed the 48-function ACL reconstruction contract, the all-68 user-bound RPC guard contract, zero imported Auth/profile rows, all catalog/FK parity checks, Stage 3 issuer-guard application, and the full rollback-only Stage 3 trusted-issuer regression containing Tranche 14. Existing Stage 7 portal, 69-FK rollback, and Stage 5 two-user Cloudinary/payment tests also passed. Disposable Supabase and schema-export artifacts were removed successfully.
- Supabase Local Auth Claims CI [#45578017158](https://github.com/taufx98/sykabelajar4.0/actions/runs/45578017158) passed on the same merge commit.

The exporter reads Production schema/catalog metadata only. It explicitly rejects data COPY blocks and reports that no remote DDL/DML or deployment was executed. No account/data export or migration was performed.

## Count and remaining gate

Previous accepted manual review: **68/202** (Tranches 01–13, including the reconciled Tranches 06–10 record).  
Tranche 14 accepted signatures: **5**.  
**Cumulative accepted manual review: 73/202 exact signatures; 129 remain.**

This is partial per-function source/runtime evidence only. The canonical all-functions activation manifest remains \`status: blocked\` with \`reviewedAuthenticatedFunctionCount: 0\`; Production DB2 remains **NO-GO** until all 202 signatures are reviewed and the remaining global gates are satisfied.

No Production DDL/DML, account or application-row changes, role/grant/policy edits, Worker deployment, DNS change, or secret change was performed by this tranche.
