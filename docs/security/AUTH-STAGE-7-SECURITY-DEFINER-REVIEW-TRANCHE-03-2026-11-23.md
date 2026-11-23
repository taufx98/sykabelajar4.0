# Stage 7 SECURITY DEFINER manual review — Tranche 03

Date: 23 November 2026  
Production project: `mvdczyitbkxkldjughor`  
Scope: ten authenticated-executable Admin SECURITY DEFINER RPC signatures from the 21 November 2026 inventory.

## Decision

**10 additional signatures source-reviewed and runtime-tested on the schema-only PostgreSQL 17.6 disposable restore. Cumulative manual review: 20/202; 182 remain.**

This is a partial manual-review record, not Production approval. The final activation manifest remains `status: blocked` with `reviewedAuthenticatedFunctionCount: 0` until all 202 functions have exact post-Stage-3/pre-issuer-guard fingerprints and class-specific evidence.

## Catalog identity

The following live `md5(pg_proc.prosrc)` fingerprints were captured using read-only Production catalog queries on 23 November. They match the corresponding source fingerprints in the canonical 21 November triage snapshot. Every function is owned by `postgres`, is `SECURITY DEFINER`, and is executable by `authenticated`; none of these ten grants `anon` EXECUTE.

| Exact signature | Source MD5 | Authorization path in the Stage 3 draft |
|---|---|---|
| `admin_delete_competition(uuid,text)` | `8e851cbd085e921634dca801de23df6b` | Shared issuer-gated Admin helper before competition deletion. |
| `admin_force_delete_competition(uuid,text)` | `e519059ee0400dfdd3cd36eac4fd470c` | Shared issuer-gated Admin helper before force deletion. |
| `admin_force_complete_pending_order(uuid,text)` | `5321c79eee3be3f3a138fc272c81d89f` | Shared issuer-gated Admin helper before order fulfillment. |
| `admin_review_manual_order(uuid,text,text)` | `916b83a7b7cc749ea66edacc06e29edd` | Shared issuer-gated Admin helper before manual order review. |
| `admin_set_user_role(uuid,app_role,boolean,text)` | `7bad6e4a5956c07879751ff00f426675` | Shared issuer-gated Admin helper before business-role mutation. |
| `admin_set_user_status(uuid,user_status,text)` | `6a24fc52a7cd71a193fcc4e69fd686f7` | Shared issuer-gated Admin helper before account-status mutation. |
| `admin_issue_shop_voucher(uuid,text)` | `4e79f49147cf96a1ce9cf0a3e3d1189d` | Shared issuer-gated Admin helper before voucher issuance. |
| `admin_save_shop_voucher_definition(jsonb)` | `405c104b0df4e997ce91eac12c887ec1` | Shared issuer-gated Admin helper before voucher-definition writes. |
| `admin_set_comment_moderation(uuid,text,text)` | `2b96ce5849231e65640c857f7e899b3d` | Shared issuer-gated Admin helper before comment moderation. |
| `admin_update_referral_program_settings(boolean,integer,integer,text,text,timestamptz,timestamptz)` | `c0399b6de32fffa24bc03b4fc2f4315b` | Shared issuer-gated Admin helper before referral settings/reward processing. |

The shared helper path requires a non-null `auth.uid()`, the exact Production Better Auth issuer `https://auth-prod.sykabelajar4.my.id/api/auth`, and a matching `private.app_users.identity_origin='better_auth'` row before checking the active Admin role. A legacy role row alone is insufficient.

## Runtime evidence

- PR [#253](https://github.com/taufx98/sykabelajar4.0/pull/253) added paired legacy-issuer-denial and Better Auth-positive probes for all ten signatures.
- Protected Auth Production Schema Baseline [#45213452403](https://github.com/taufx98/sykabelajar4.0/actions/runs/45213452403) passed **68/68 steps** on commit `298e2a15302a4d7d1e673c1191f9f780752dfe58`. The schema-only Production export was restored into an isolated PostgreSQL 17.6 Supabase instance; the Stage 3 and Stage 7 drafts and all rollback-only regressions ran against that disposable database.
- The negative fixtures reused the same synthetic Admin UUID that has an active Admin role, but supplied the legacy Supabase Auth issuer. All ten RPCs were denied by their Admin guard.
- The Better Auth positive fixtures used deliberately missing UUIDs or invalid payload/state so each RPC passed the issuer/Admin gate and stopped at a business validation boundary before a successful mutation. Notable boundaries include `COMPETITION_NOT_FOUND`, `ORDER_NOT_FOUND`, `USER_NOT_FOUND`, `VOUCHER_DEFINITION_NOT_AVAILABLE`, `VOUCHER_NAME_REQUIRED`, `INVALID_STATE`, and `ACTIVE_FLAG_REQUIRED`.
- The transaction rolled back; no application rows were changed. Supabase Local Auth Claims CI [#45213452285](https://github.com/taufx98/sykabelajar4.0/actions/runs/45213452285) also passed.

No Production DDL/DML, grants, roles, policies, account data, credentials, Worker, DNS, or secrets were changed.

## Remaining work

Review and test the other 182 signatures by their exact caller contract. Keep the 202-function activation manifest blocked and Production DB2 NO-GO.
