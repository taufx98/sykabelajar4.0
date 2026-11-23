# Stage 7 SECURITY DEFINER review — Tranche 02

Date: 23 November 2026
Production project: `mvdczyitbkxkldjughor`
Scope: three additional `anon`-executable Admin SECURITY DEFINER signatures from the 21 November 2026 catalog.

## Decision

**3 additional signatures reviewed and runtime-tested on the PostgreSQL 17.6 disposable restore. Cumulative manual review: 10/202 functions; 192 remain.**

This is still a partial Stage 7 record. The global Production gate remains NO-GO. The final activation manifest remains blocked at 0/202 until the complete post-Stage-3/pre-issuer-guard catalog is fingerprinted and all 202 functions have class-specific evidence.

## Catalog identity and source fingerprints

Read-only Production `pg_proc` inspection on 23 November confirmed all three exact signatures still match the source MD5 values in the canonical 21 November triage JSON. Each is owned by `postgres`, is `SECURITY DEFINER`, and uses `search_path=public, private` in the live pre-Stage-3 catalog.

| Exact signature | Source MD5 | Reviewed authorization / behavior |
|---|---|---|
| `admin_diagnose_organizer_voucher_delete(uuid)` | `21f7bf2cc8f19179f12472174c94ec04` | Read-only diagnostic for voucher references/deletion safety. Requires non-null `auth.uid()` and `private.current_user_is_admin()` before reading diagnostics. |
| `admin_update_system_error_status(uuid,text,text)` | `ed9ac818c1564288d4bd6d8f20dff0f5` | Updates incident state and resolution metadata only after non-null `auth.uid()` and the shared issuer-gated Admin helper. |
| `reopen_system_error_incident(uuid,text)` | `b05e8f74ab165d9ec1bea5e99e344871` | Reads the referenced incident and inserts a new incident only after non-null `auth.uid()` and the shared issuer-gated Admin helper. |

All three originally granted direct `anon` EXECUTE. The Stage 3 draft performs targeted `REVOKE EXECUTE ... FROM anon` for each while preserving the intended `authenticated`, `service_role`, and owner privileges. No blanket revocation is used.

The shared Admin path is the same one reviewed in Tranche 01:
- `private.current_user_is_better_auth()` requires a non-null `auth.uid()`, exact Production issuer `https://auth-prod.sykabelajar.my.id/api/auth`, and matching `private.app_users.identity_origin='better_auth'`.
- `private.current_user_has_role()` calls the Better Auth identity helper before checking active business role.
- A legacy Supabase Auth UUID/role row alone cannot authorize these Admin RPCs.

## Disposable runtime evidence

Auth Production Schema Baseline [run #45207241917](https://github.com/taufx98/sykabelajar4.0/actions/runs/45207241917) completed successfully after PR #250:
- The workflow exported Production schema only and restored it into isolated PostgreSQL 17.6; zero Auth/profile rows were imported.
- The Stage 3 SECURITY DEFINER issuer draft and rollback-only regression ran only on the disposable restore.
- The negative issuer fixture used the same synthetic Admin UUID under the legacy Supabase Auth issuer. Each RPC was denied by the shared Admin check.
- The positive Better Auth Admin fixture verified:
  - `admin_diagnose_organizer_voucher_delete` reached its read-only diagnostic result;
  - `admin_update_system_error_status` passed Admin authorization and reached `INCIDENT_NOT_FOUND` for a deliberately missing synthetic incident;
  - `reopen_system_error_incident` passed Admin authorization and reached `INCIDENT_NOT_FOUND` for a deliberately missing synthetic incident.
- The disposable regression checks that `anon` no longer has EXECUTE on all three exact signatures after the targeted Stage 3 ACL draft.
- The full transaction is rolled back and the temporary workspace is removed at the end of the job.

Supabase Local Auth Claims CI [run #45207242307](https://github.com/taufx98/sykabelajar4.0/actions/runs/45207242307) also passed.

No Production DDL/DML, ACL, roles, policies, accounts, credentials, Worker, DNS, or secrets were changed.

## Cumulative review accounting

- Tranche 01: seven signatures — six Admin/organizer functions plus `admin_evaluate_badges()`.
- Tranche 02: three additional Admin functions listed above.
- **Cumulative: 10/202 manually reviewed; 192 remain.**

The original 21 November triage JSON remains the immutable source inventory. The final activation manifest deliberately remains `status: blocked` with `reviewedAuthenticatedFunctionCount: 0`; it represents the all-functions, exact post-Stage-3/pre-issuer-guard activation allowlist, not the manual-review progress counter.
