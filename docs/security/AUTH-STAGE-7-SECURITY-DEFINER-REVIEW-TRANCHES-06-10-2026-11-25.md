# Stage 7 SECURITY DEFINER manual review — Tranches 06–10 acceptance

Date: 25 November 2026  
Project: Production DB2 `mvdczyitbkxkldjughor` (PostgreSQL 17.6)  
Scope: 21 Admin, certificate/order, teacher/collective/organizer, product-order and question-bank RPCs  
Decision: **accepted for partial manual-review count only; Production remains NO-GO**

## Exact signatures and Production fingerprint evidence

A read-only Production catalog query on 25 November compared all 21 current `md5(pg_proc.prosrc)` values with the immutable 21 November triage inventory. **All 21 hashes matched exactly.** Every function remains owned by `postgres`, is SECURITY DEFINER, and retains the inventoried `search_path` and ACL: `postgres=X/postgres`, `authenticated=X/postgres`, `service_role=X/postgres`; `anon` and `PUBLIC` have no EXECUTE.

| Tranche | Exact signature | Production `md5(prosrc)` |
|---:|---|---|
| 06 | `admin_delete_organizer_voucher(uuid)` | `093b683911761457a3b759da13a616f4` |
| 06 | `admin_generate_organizer_vouchers(integer,numeric)` | `d0eb52aa26e6257f7f33b708a23ce712` |
| 06 | `admin_save_organizer_payment_fields(jsonb)` | `6fea7186717004362b6056e603271e5b` |
| 06 | `admin_save_plan_bundle(text,text,text,text,numeric,numeric,boolean,jsonb,numeric,numeric)` | `84bf070fd458c88fc50126f3a7ed276b` |
| 06 | `admin_upsert_organizer_voucher(uuid,text,text,text,numeric,text,integer,text[],text[],integer,timestamptz,timestamptz,boolean)` | `429fd730fc35353e08554ad7275b4af1` |
| 06 | `admin_update_referral_program_settings_v2(boolean,integer,integer,text,text,timestamptz,timestamptz,jsonb,boolean,text,text,text,text)` | `1325dd4f3ed476f10362bfc2b266c32c` |
| 06 | `admin_save_competition(...)` | `78fd51e3b5a3f7c3780e231c68bf95fd` |
| 06 | `admin_save_post(uuid,text,text,text,uuid,text)` | `9f34347c431dfc871badecc07d158fe3` |
| 06 | `admin_save_product(...)` | `9756ef4e11a34249b075d2be0983d475` |
| 06 | `admin_save_shop_promo_banner(uuid,text,text,integer,integer,boolean)` | `edbc31a8c5ef5010e64a8496e9c73f23` |
| 07 | `admin_save_organizer_payment_config(jsonb)` | `9148a749b2c7ad275ed6954c9acd1fce` |
| 07 | `admin_set_collective_certificate_price(numeric)` | `5da5e6d3a927a25f81b1e89429d6e2f6` |
| 08 | `create_collective_certificate_order(uuid)` | `0041c711a1e602b6d15dbd390d4669a3` |
| 08 | `assign_organizer_serial(uuid,uuid)` | `64945c36ee11b196deaf2bfde2ce545c` |
| 08 | `create_certificate_asset(uuid,text,text,integer,integer,bigint,text,text,jsonb)` | `403c3423475cfac9a0f29abbac8593b4` |
| 09 | `create_collective_participants(uuid,uuid[])` | `2a3136e3985e4f85df7e47a822e389ab` |
| 09 | `save_organizer_competition_config(uuid,jsonb,jsonb,jsonb)` | `d59002f0e4468ff55eb4b48f5d3d71a8` |
| 09 | `list_teacher_collective_certificates(uuid)` | `834a7bfabf91c6a068656986b101fa06` |
| 09 | `list_teacher_achievement_report(uuid,text)` | `547f82beb1241918913691f3da6eb234` |
| 10 | `create_product_order(uuid,integer)` | `4f07e6f6fd04ed40ae5661ed8e92c7c2` |
| 10 | `save_question_with_options(uuid,uuid,text,text,numeric,boolean,integer,text,jsonb,jsonb)` | `74c1493792d4b0cdf492d6c3021ac383` |

## Source review and runtime tests

- **Tranche 06 — Admin voucher, plan, referral and content mutations (10):** issuer-gated Admin-helper checks run before the privileged business work. Legacy Supabase Auth is rejected; valid Better Auth Admin requests reach deliberate validation or missing-object boundaries before unintended side effects.
- **Tranche 07 — Admin payment/certificate settings (2):** the payment-config positive test validates the normalized return and rolls back via an exception sentinel. The certificate-price draft replaces direct legacy `user_roles` authorization with the issuer-gated Admin helper.
- **Tranche 08 — Collective certificate/order, organizer serial and asset operations (3):** explicit issuer checks precede protected reads, followed by participant-owner/manager, organizer-owner or Admin scope.
- **Tranche 09 — Teacher/collective/organizer operations (4):** issuer/teacher/Admin gates and row filters protect provisioning, competition configuration and teacher projections.
- **Tranche 10 — Product order and question-bank editing (2):** role/audience and organizer-bank scope are enforced; cross-bank question movement is denied and the foreign question/options remain unchanged.

The rollback-only `stage3-issuer-guard-regression.sql` contains legacy-issuer denial and valid Better Auth/Admin/owner probes for all 21 signatures. The product-order and owned-question positive cases complete in synthetic fixtures. The entire outer transaction ends in `ROLLBACK`.

## Merged PRs and protected baseline

- Tranches 06–10: PRs #257, #259, #260, #261, #262, #263 and SQL terminator correction #264.
- Fixture corrections: PRs #266–#269.
- Protected Auth Production Schema Baseline [#45374215915](https://github.com/taufx98/sykabelajar4.0/actions/runs/45374215915) passed **68/68 steps** on commit `07ccaddd2a2ab745243f71dcbe726d170f61d1a3`. Stage 3 SECURITY DEFINER guard apply, remaining user-bound guard apply and trusted-issuer regression all succeeded.
- The later protected baseline [#45459397254](https://github.com/taufx98/sykabelajar4.0/actions/runs/45459397254) also passed **68/68 steps** on commit `56e04fef7f3658edcca0fd3ebc03a3d2e5571711`.

No Production DDL/DML, account data, grants/roles/policies, Worker, DNS, or secrets were changed.

## Count

Previous accepted manual review: 36/202 (Tranches 01–05).  
Tranches 06–10 accepted signatures: 21.  
**Cumulative accepted manual review after Tranches 06–10: 57/202; 145 remain.**

This remains a partial per-function review count. The final activation manifest remains `status: blocked` and `reviewedAuthenticatedFunctionCount: 0` until all 202 functions have exact post-Stage-3 fingerprints, explicit classifications and class-specific tests. Production remains **NO-GO**.
