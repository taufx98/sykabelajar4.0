# Stage 7 SECURITY DEFINER review — Tranche 01

Date: 23 November 2026
Production project: `mvdczyitbkxkldjughor`
Scope: seven authenticated-executable SECURITY DEFINER signatures from the 21 November 2026 catalog (admin/organizer class).

## Decision

**7/202 functions source-reviewed and runtime-tested on the PostgreSQL 17.6 disposable restore. 195 remain.**

This is a partial review record only. It does not approve Production changes or complete Stage 7. The final activation manifest remains `status: blocked` and `reviewedAuthenticatedFunctionCount: 0` until every function has its exact post-Stage-3/pre-issuer-guard live fingerprint and all class-specific evidence. The 21 November triage JSON remains the immutable source snapshot; this dated report records the seven later manual reviews.

## Catalog identity and source fingerprints

The following fingerprints are `md5(pg_proc.prosrc)` captured by read-only SQL on Production on 23 November. They match the corresponding `sourceMd5` values in `AUTH-STAGE-7-SECURITY-DEFINER-TRIAGE-2026-11-21.json`. All seven were owned by `postgres`, marked `SECURITY DEFINER`, and used `search_path=public, private` in the live pre-Stage-3 catalog.

| Exact signature | Source MD5 | Reviewed authorization path |
|---|---|---|
| `admin_adjust_user_currency(uuid,text,bigint,text)` | `aa8f5302840e39728b006496ad817275` | Original body checked `auth.uid()` against `user_roles` directly. Stage 3 draft now calls `private.current_user_is_admin()`. |
| `admin_bulk_adjust_currency(uuid[],text,bigint,text)` | `1f6215cccdc383120bbb6787e96c0f2b` | Original body checked the legacy Admin role directly. Stage 3 draft now calls `private.current_user_is_admin()`. |
| `admin_assign_organizer_plan(uuid,text,timestamptz,timestamptz)` | `ee68f31dacc8cee624c80e7a42867c56` | Uses `private.current_user_is_admin()` before plan or organizer writes. |
| `admin_change_username(uuid,text,text)` | `f2303a11f19903297554639acbd87f06` | Uses `private.current_user_is_admin()` before profile mutation and audit. |
| `admin_create_organizer(uuid,text,text)` | `860b70d16e5d204cebad55924ab8c66d` | Uses `private.current_user_is_admin()` before organizer, member, access-code and plan writes. |
| `admin_create_organizer_payment_method(text,text,jsonb,integer,text,text)` | `f7b0c72a386c3a2465887ea3b33374cb` | Uses `private.current_user_is_admin()` before payment-method creation and audit. |
| `admin_evaluate_badges()` | `0bc60d1e2df111228ccd5f31c49ef752` | Calls `private.badge_admin_guard()`, which delegates to `private.current_user_is_admin()`; Stage 3 also removes redundant `PUBLIC`/`anon` EXECUTE. |

The shared Admin path in the Stage 3 draft is issuer-gated:
- `private.current_user_is_better_auth()` requires a non-null `auth.uid()`, the exact Production issuer `https://auth-prod.sykabelajar.my.id/api/auth`, and a matching `private.app_users.identity_origin='better_auth'` row.
- `private.current_user_has_role()` checks that helper before looking at an active `public.user_roles` row.
- The Admin helper then checks the requested business role. A legacy role row alone is insufficient.

The first six signatures retain their intended `authenticated`/`service_role` execute grants and were not broadened to `anon`. For `admin_evaluate_badges()`, the Stage 3 draft removes `PUBLIC` and `anon` execute while retaining the intended authenticated entrypoint.

## Disposable runtime evidence

- PR [#250](https://github.com/taufx98/sykabelajar4.0/pull/250) added paired negative/positive issuer assertions for the first six functions. It was merged as `13d3a7e3c11402e7c1885cf51a9d8fcbf18f3fb4`.
- Auth Production Schema Baseline [run #45207241917](https://github.com/taufx98/sykabelajar4.0/actions/runs/45207241917) completed successfully. It exported Production schema only, restored it to an isolated PostgreSQL 17.6 Supabase instance, confirmed zero imported Auth/profile rows, applied the Stage 3 drafts to that disposable restore, ran the rollback-only regression, and removed the temporary workspace.
- For the six PR #250 cases, the same synthetic Admin UUID was denied under the legacy Supabase Auth issuer. Under the exact Better Auth Production issuer, each call passed the shared Admin guard and reached its expected downstream validation without modifying business rows.
- For `admin_evaluate_badges()`, the existing regression verifies legacy-issuer denial, confirms `anon` no longer has EXECUTE after the Stage 3 draft, and invokes the function under a valid Better Auth Admin context.
- Supabase Local Auth Claims CI [run #45207242307](https://github.com/taufx98/sykabelajar4.0/actions/runs/45207242307) also passed.

All regression fixtures are synthetic and transactionally rolled back. No Production DDL/DML, role grant, policy, account, user record, credential, Worker, DNS, or secret was changed.

## Remaining work

1. Review and test the remaining 195 signatures by their actual authorization contract—not only heuristic name/SQL markers.
2. Separately audit the other 46 `anon`-executable functions, including intentional public and token-based routes.
3. Bind every reviewed function to the exact post-Stage-3/pre-issuer-guard Production catalog fingerprint before populating the final activation manifest.
4. Re-run class-specific IDOR, expiry/replay, public-data, and legacy-issuer tests; keep Production NO-GO until all gates pass.

The separate `create_organizer(text,text)` onboarding RPC is part of the Stage 3 identity-root track, not counted in this seven-function Admin tranche. Its Better Auth version requires the exact Production issuer, a fresh `private.app_users` identity, verified email and trusted Telegram phone hash, and the one-free-organizer claim. The production-shaped Stage 3 disposable regression already tests its creation, verification gates and duplicate-phone rejection.
