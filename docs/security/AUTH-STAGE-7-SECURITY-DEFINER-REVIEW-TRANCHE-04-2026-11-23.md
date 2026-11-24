# Stage 7 SECURITY DEFINER manual review — Tranche 04

Date: 23 November 2026  
Production project: `mvdczyitbkxkldjughor`  
Scope: three organizer/award/grading RPCs with early protected-row reads, plus three direct Admin certificate/order RPCs.

## Decision

**Six additional signatures source-reviewed and runtime-tested on the schema-only PostgreSQL 17.6 disposable restore. Cumulative manual review: 26/202; 176 remain.**

This tranche addresses an actual information-disclosure boundary: three organizer/grading SECURITY DEFINER RPCs previously read an attempt, competition, or award before their downstream issuer-gated membership/Admin helper ran. A legacy issuer could distinguish object existence from an authorization failure.

The Stage 3 issuer draft now performs an explicit `private.current_user_is_better_auth()` check as the first authorization gate, before the first protected SELECT, while preserving existing role/membership checks and business behavior.

## Catalog identity

Read-only Production queries on 23 November confirmed these exact source fingerprints match the canonical 21 November triage snapshot. All six are owned by `postgres`, are `SECURITY DEFINER`, and retain their existing authenticated/service-role ACLs.

| Exact signature | Source MD5 | Reviewed boundary |
|---|---|---|
| `auto_grade_essay_item(uuid,uuid)` | `f78a0bbe4075f63c787a16b785454169` | Explicit Better Auth issuer gate precedes the first `attempts` read. |
| `generate_awards_for_competition(uuid)` | `e140ece54ee20f544712e76bd9f7b50e` | Explicit Better Auth issuer gate precedes the first competition read and any award generation. |
| `issue_certificate_for_award(uuid)` | `670c6da23d9593d2682fc550a3ac719e` | Explicit Better Auth issuer gate precedes the first award read and certificate creation path. |
| `admin_set_certificate_status(uuid,certificate_status,text)` | `6a1745db4fd6e09eb7b7c74303e6871c` | Legacy issuer is denied; valid Better Auth Admin proceeds to certificate lookup. |
| `admin_transition_certificate(uuid,certificate_status,text)` | `d99856df12a29a7bc20df1c08d913794` | Legacy issuer is denied; valid Better Auth Admin proceeds to certificate lookup. |
| `admin_transition_order(uuid,order_status,text,text,text)` | `5e0033dcf0442eb5839b73ceec0203a0` | Legacy issuer is denied; valid Better Auth Admin proceeds to order lookup. |

## Runtime evidence

- PR [#255](https://github.com/taufx98/sykabelajar4.0/pull/255) inserted the first-statement issuer guards and paired legacy/Better Auth regression probes.
- Auth Production Schema Baseline [#45213452403](https://github.com/taufx98/sykabelajar4.0/actions/runs/45213452403) passed **68/68 steps** on commit `298e2a15302a4d7d1e673c1191f9f780752dfe58`, including this tranche on the schema-only PostgreSQL 17.6 disposable restore.
- For the first three functions, the legacy Supabase Auth issuer is rejected with `BETTER_AUTH_ISSUER_REQUIRED` before protected row reads. The exact Better Auth issuer passes that first gate and reaches `ATTEMPT_NOT_FOUND`, `COMPETITION_NOT_FOUND`, or `AWARD_NOT_FOUND` for deliberately nonexistent synthetic UUIDs.
- For the three direct Admin functions, the legacy issuer is denied with `FORBIDDEN`; the Better Auth Admin reaches `CERTIFICATE_NOT_FOUND` or `ORDER_NOT_FOUND`. No target rows exist and no mutation succeeds.
- The runtime fixtures are part of the rollback-only Stage 3 regression. Local Supabase JWT/RLS CI [#45213452285](https://github.com/taufx98/sykabelajar4.0/actions/runs/45213452285) also passed.

Function signatures, owners, EXECUTE grants and `search_path` settings were preserved. No Production DDL/DML, account data, roles, policies, credentials, Worker, DNS, or secrets were changed.

## Remaining work

The other 176 signatures still require individual source/dependency review and class-specific evidence. This tranche does not complete or approve the global Stage 7 gate.
