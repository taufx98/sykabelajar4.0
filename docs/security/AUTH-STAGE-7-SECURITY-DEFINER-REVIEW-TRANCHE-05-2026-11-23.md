# Stage 7 SECURITY DEFINER manual review — Tranche 05

Date: 23 November 2026  
Production project: `mvdczyitbkxkldjughor`  
Scope: ten further Admin delete, diagnostic, dashboard, and shop-listing SECURITY DEFINER RPCs.

## Decision

**Ten additional signatures source-reviewed and runtime-tested on the schema-only PostgreSQL 17.6 disposable restore. Cumulative manual review: 36/202; 166 remain.**

All ten functions are authenticated-executable Admin routes. The Stage 3 draft's shared Admin helper verifies the exact Production Better Auth issuer and the fresh `private.app_users.identity_origin='better_auth'` identity before checking the active Admin role.

## Catalog identity

The following Production source fingerprints were captured by read-only `pg_proc` queries on 23 November. They match the canonical 21 November triage inventory. Each function is owned by `postgres`, is `SECURITY DEFINER`, and has no `anon` EXECUTE grant.

| Exact signature | Source MD5 | Reviewed behavior |
|---|---|---|
| `admin_delete_organizer_payment_method(uuid)` | `0ade33108d40e08526cecd91a3c511f4` | Admin guard precedes delete; missing synthetic payment-method UUID returns `PAYMENT_METHOD_NOT_FOUND`. |
| `admin_delete_post(uuid,text)` | `d4d1edf341c14be9904d3494a7628077` | Admin guard precedes row lock/delete; missing synthetic post returns `POST_NOT_FOUND`. |
| `admin_delete_product(uuid,text)` | `0ed985a912942ceed4299896db0c9a99` | Admin guard precedes row lock/delete; missing synthetic product returns `PRODUCT_NOT_FOUND`. |
| `admin_delete_shop_promo_banner(uuid)` | `202565363ec69ce6b401ee8411f78f84` | Admin guard precedes delete; missing synthetic banner returns `false`. |
| `admin_get_attempt_investigation(uuid)` | `8d0bbf0b06057ebe0fd1277256ad9410` | Admin guard precedes attempt/event/audit reads; missing synthetic attempt returns `ATTEMPT_NOT_FOUND`. |
| `admin_get_competition_delete_blockers(uuid)` | `5f9aee0996d65e5a59f40205df229d96` | Admin guard precedes blocker counts; missing competition returns `COMPETITION_NOT_FOUND`. |
| `admin_get_monitoring_dashboard(uuid,text,text,integer,integer)` | `128fac67b5071f1b2db7305a1cec5ee4` | Admin guard precedes aggregate dashboard reads; valid Better Auth Admin gets the expected JSON object/array shape. |
| `admin_list_issued_shop_vouchers()` | `1d34d032428fe194d8eb4146eff4b8ee` | Admin guard precedes voucher/profile/definition listing; empty disposable schema returns zero rows. |
| `admin_list_shop_promo_banners()` | `85731c1f5cdbb47a7d0a0b7e1579aeee` | Admin guard precedes banner listing; empty disposable schema returns zero rows. |
| `admin_list_shop_voucher_definitions()` | `6f23f25b36e865ff151160b79a518376` | Admin guard precedes definition listing; empty disposable schema returns zero rows. |

## Runtime evidence

- PR [#256](https://github.com/taufx98/sykabelajar4.0/pull/256) added paired legacy issuer denial and Better Auth positive probes for all ten signatures.
- Auth Production Schema Baseline [#45213452403](https://github.com/taufx98/sykabelajar4.0/actions/runs/45213452403) passed **68/68 steps** on commit `298e2a15302a4d7d1e673c1191f9f780752dfe58`; these tests ran on the schema-only PostgreSQL 17.6 disposable restore.
- Under the legacy Supabase Auth issuer, all ten calls stop at the Admin helper before any row read or deletion.
- Under the exact Better Auth issuer, deletion probes use nonexistent synthetic UUIDs and stop at their not-found/false boundaries. Diagnostic reads return expected missing-object errors, dashboard output shape is checked, and the three shop listings return zero rows from the empty schema-only restore.
- All tests run inside the existing rollback-only regression; no application rows are created, changed, or deleted. Local Supabase JWT/RLS CI [#45213452285](https://github.com/taufx98/sykabelajar4.0/actions/runs/45213452285) also passed.

No Production DDL/DML, grants, roles, policies, account data, credentials, Worker, DNS, or secrets were changed.

## Remaining work

The other 166 signatures still require individual review and class-specific runtime evidence. The final activation manifest remains blocked and Production remains NO-GO.
