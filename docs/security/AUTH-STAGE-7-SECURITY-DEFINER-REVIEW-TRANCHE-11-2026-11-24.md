# Stage 7 SECURITY DEFINER manual review — Tranche 11

Date: 24 November 2026  
Project: Production DB2 `mvdczyitbkxkldjughor` (PostgreSQL 17.6)  
Scope: four Admin/organizer grading and competition-state SECURITY DEFINER RPCs  
Decision: **accepted for partial manual-review count only; Production remains NO-GO**

## Exact signatures and Production fingerprint evidence

A read-only Production catalog query compared the current `md5(pg_proc.prosrc)` values against the immutable 21 November triage/inventory. All four source hashes matched exactly. The same query confirmed owner, SECURITY DEFINER, function configuration, ACL entries, and effective role privileges.

| Exact signature | Production `md5(prosrc)` | Owner | `anon` EXECUTE | `authenticated` EXECUTE | `service_role` EXECUTE | `search_path` |
|---|---|---|---:|---:|---:|---|
| `finalize_attempt_manual(uuid,numeric,text)` | `ffc89b1ef283cc2c3c9e087e8a1bcd57` | `postgres` | no | yes | yes | empty |
| `get_attempt_grading_limits(uuid)` | `f6525cda1b69b5b808148b4e1ad52595` | `postgres` | no | yes | yes | empty |
| `publish_competition_results(uuid)` | `348530d824ecefb229bd22e4a093522c` | `postgres` | no | yes | yes | empty |
| `release_organizer_competition(uuid)` | `33995f3f29f6d410baf2d84b0c5d512f` | `postgres` | no | yes | yes | empty |

The effective ACL entries were exactly `authenticated=X/postgres`, `service_role=X/postgres`, and `postgres=X/postgres`; there was no `PUBLIC` or `anon` EXECUTE entry. No ownership, ACL, grant, signature, or search-path changes were made by the tranche draft.

## Source review

Each function now requires the exact Better Auth issuer before its first protected attempt/competition read.

- `finalize_attempt_manual`: the first attempt lookup joins its competition and is scoped to an issuer-verified Admin or a user with competition edit access; the row lock is applied only to that scoped row.
- `get_attempt_grading_limits`: the first attempt read excludes previews and is scoped to an issuer-verified Admin or the competition's authorized organizer.
- `publish_competition_results`: the initial competition read and row lock are restricted to an issuer-verified Admin or authorized competition editor.
- `release_organizer_competition`: the initial competition read and row lock are restricted to an issuer-verified Admin or the relevant organizer.

All four functions use the existing shared Better Auth/Admin/organizer helpers; none reads legacy `user_roles` directly to authorize. Missing and out-of-scope IDs share the same not-found boundary to avoid object-existence disclosure. Function signatures, owner, ACL, and `search_path` remain unchanged.

## Disposable PostgreSQL 17.6 runtime evidence

The existing rollback-only Stage 3 issuer regression now covers:

1. A legacy Supabase Auth issuer with a matching synthetic subject is rejected by all four RPCs with `BETTER_AUTH_ISSUER_REQUIRED` before protected reads.
2. A valid Better Auth Admin reaches each scoped function boundary using synthetic missing IDs without a persistent business mutation.
3. The real synthetic organizer owner passes issuer and organizer-scope checks:
   - manual finalization reaches `ATTEMPT_NOT_FINALIZABLE` on a synthetic official attempt already in FINALIZED state, after the test-only `manual_grading` entitlement is checked;
   - grading limits returns its expected empty projection;
   - publication returns the no-op `already_published` result for the synthetic published competition;
   - release reaches `COMPETITION_NOT_DRAFT`.
4. A distinct Better Auth student without organizer membership receives `ATTEMPT_NOT_FOUND` or `COMPETITION_NOT_FOUND` for all four RPCs, preventing IDOR/existence probing.
5. All synthetic identities, plan entitlements, competition/participant/attempt fixtures, and any temporary writes are contained in the outer transaction and rolled back.

The protected baseline also accepted the surrounding Stage 3/Stage 5 regressions, the 69-FK cutover/rollback rehearsal, all 23 no-policy direct-table ACL boundaries, 14 collective portal invalid-token denials, portal lifecycle/password selector tests, and the two-user Cloudinary/payment Edge integration.

- Protected Auth Production Schema Baseline: [run #45374215915](https://github.com/taufx98/sykabelajar4.0/actions/runs/45374215915) — **68/68 steps passed**.
- Supabase Local Auth Claims CI: [run #45374216128](https://github.com/taufx98/sykabelajar4.0/actions/runs/45374216128) — **passed**.

## Count and remaining gate

Previous accepted manual review: 36/202.  
Tranche 11 accepted signatures: 4.  
**Cumulative accepted manual review: 40/202; 162 remain.**

This partial manual-review count is not activation approval. The canonical all-functions activation manifest remains `status: blocked` and `reviewedAuthenticatedFunctionCount: 0` until every one of the 202 SECURITY DEFINER signatures has been individually classified, fingerprint-checked, and tested for its specific public/token/Admin/organizer/worker/trigger boundary.

**Production DB2 remains NO-GO.** No Production DDL/DML, data import/backup, account migration, grant/role/policy edit, Worker deployment, DNS change, or secret change was performed.
