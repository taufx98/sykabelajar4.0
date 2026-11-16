# Stage 3 validation checkpoint — 14 November 2026

**Status: pre-production validated; Production DB2 unchanged. This record is not a Production migration approval.**

## Fresh read-only Production DB2 check

Project `mvdczyitbkxkldjughor` is `ACTIVE_HEALTHY`, PostgreSQL 17.6.

- The live catalog exactly matches the committed sanitized FK snapshot: **69/69**, with no missing, extra or changed constraints.
- The 69 validated application FKs span 62 source tables: 42 CASCADE, 18 SET NULL, 8 NO ACTION and 1 RESTRICT.
- `private.app_users` is absent; zero application FKs reference it.
- 109 application policies reference `auth.uid()`.
- Three non-internal `auth.users` triggers remain.
- Eight public/private function bodies directly reference `auth.users`. The broader dependency inventory contains ten Auth-dependent functions; those counts use different definitions and are not contradictory.

The query inspected catalog metadata only. No application rows, credentials, tokens or user PII were selected. No Production DDL or DML was run.

## Disposable Stage 3 rehearsal evidence

[Auth Production Schema Baseline run #43462380374](https://github.com/taufx98/sykabelajar4.0/actions/runs/43462380374) completed successfully on 13 November 2026 using a disposable PostgreSQL 17.6 restore.

The job:
- Restored and verified the schema-only Production baseline and exact 69-FK catalog.
- Generated the FK plan and simulated UUID-only legacy-reference tombstones, all 69 replacement FK validations, and the atomic forward cutover on the disposable database only.
- Passed identity provisioning, role mapping, referral/email/phone verification, organizer and representative RLS regression fixtures.
- Verified fail-closed reverse-FK behavior for a Better Auth-only identity, then simulated all 69 reverse FKs and the full Stage 3 rollback on the disposable database.
- Rolled back all synthetic fixture writes. No Production DDL/DML was performed.

The following Stage 3 implementation files have unchanged Git blob SHAs between the tested run's commit `46caf034c4188782e4df19dcb463c8b02bec3cc7` and current branch head `1e0ec68dc2bdd94d7cc3c7f56e8fdf43849d9e5f`:

| File | Blob SHA |
|---|---|
| `docs/security/AUTH-STAGE-3-IDENTITY-ROOT-DRAFT.sql` | `764cbe71360dcad7f20810d4854120929018f36f` |
| `docs/security/AUTH-STAGE-3-ROLLBACK-DRAFT.sql` | `5ab7a23e3642c5c3cf9932f18ed8d31b339602c5` |
| `scripts/auth-migration/generate-app-users-fk-plan.mjs` | `6df1e7a71a8cac3cf8671201ff01483ab96a6e30` |
| `scripts/auth-migration/generate-app-users-fk-rollback-plan.mjs` | `83b2d8d04800addc03308ada9ee53542f7983d5f` |
| `.github/workflows/auth-schema-baseline.yml` | `f0a31ebdca1ee885d596054465584db07b3d0290` |
| Stage 3 forward/rollback contract tests | unchanged |

## Latest branch CI

Current head `1e0ec68dc2bdd94d7cc3c7f56e8fdf43849d9e5f` passed:
- [Auth Worker CI](https://github.com/taufx98/sykabelajar4.0/actions/runs/43574938146)
- [Supabase Local Auth Claims CI](https://github.com/taufx98/sykabelajar4.0/actions/runs/43574938134)
- [Better Auth staging browser smoke](https://github.com/taufx98/sykabelajar4.0/actions/runs/43574938176)
- [Auth Cloudflare Staging Preflight](https://github.com/taufx98/sykabelajar4.0/actions/runs/43574938168)

The Production D1 schema apply/verify also passed in [run #43496965722](https://github.com/taufx98/sykabelajar4.0/actions/runs/43496965722): `sykabelajar-auth-prod` has migrations `0000–0007` applied and zero account/session/credential rows. The existing Worker has not been promoted.

## Backup custody confirmation

The owner confirmed on 14 November 2026 that the encrypted backup has been copied to durable storage outside GitHub. The restore rehearsal remains passed. This session cannot inspect the external storage; retain the destination checksum verification in the private release record. Keep the age private identity offline and separate.

## Remaining gates

1. Repeat the read-only catalog preflight inside the approved maintenance window, immediately before any Production DDL.
3. Complete Production Custom OIDC, Production-only Worker secret/configuration and one-time Worker promotion, real transactional email verification/reset, protected first-admin bootstrap, frontend smoke, monitoring and rollback gates.
4. Obtain explicit owner approval for the Production maintenance window.

**Do not apply the Stage 3 draft or generated FK SQL to Production yet.** Existing legacy Auth accounts and application data remain untouched; new Better Auth accounts use fresh UUIDs and do not inherit old records by email.
