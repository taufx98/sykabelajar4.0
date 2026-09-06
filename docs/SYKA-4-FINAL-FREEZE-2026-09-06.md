# SYKABELAJAR 4.0 — Final QA + Freeze

Date: 2026-09-06
Status: HOLD — NOT FROZEN

## Final baseline

Phases 00–14 have been implemented and re-verified. Phase 15 remains intentionally open because one production Auth security control is still reported as disabled by the Supabase Security Advisor.

The latest CI run on commit `7a2a028677a361d0897399287a9462fc6f683221` completed successfully. It includes lint, TypeScript typecheck, Vite production build, browser E2E, and production smoke testing.

## Cross-phase production integrity checks

- Public tables without RLS: 0.
- Invalid canonical participant identities: 0.
- Attempts without canonical participant linkage: 0.
- Certificates without canonical participant linkage: 0.
- Collective certificates without canonical participant linkage: 0.
- Duplicate individual canonical participants per competition/user: 0.
- Duplicate collective canonical participants per competition/collective participant: 0.
- Referral reuse of the same referred user: 0.
- Duplicate daily-task claims by task/user/date: 0.
- Admin RPCs still executable by `anon`: 0.
- Internal worker RPCs exposed to `anon` or `authenticated`: 0.
- Legacy hardcoded public QR domain payloads: 0.

## Lifecycle coverage

Competition → Registration → Participant → Attempt → Grading → Result → Certificate → Payment/Entitlement → Serial/Verification → Revoke → Optional Account Claim.

Both individual and collective participation are represented through the canonical participant layer.

## Security posture

- Public tables remain RLS protected.
- Sensitive mutations are authenticated/server-authoritative.
- Admin RPCs are admin-gated and not anonymously executable.
- Collective participant sessions and credentials are not directly exposed through the Data API.
- Public certificate verification and token-scoped collective participant APIs remain intentionally anonymous where required by the product flow.
- Organizer ownership, participant uniqueness, daily reward uniqueness, referral uniqueness, and anti-farming controls are backed by database constraints and server checks.
- Intentional SECURITY DEFINER RPCs retain their required authenticated or token-gated execution because they enforce authorization/scope inside the function; these are not blindly revoked merely to silence a generic advisor warning.

## Remaining Phase 15 blocker

Supabase Security Advisor currently reports `auth_leaked_password_protection` as `WARN`: leaked-password protection is disabled.

Supabase's current Management API exposes `password_hibp_enabled` on the Auth service configuration, but changing it requires a Management API access token with Auth configuration write permissions. The available Supabase connector in this session does not expose that Management API configuration operation or token.

No database migration can truthfully change this hosted Auth setting, so Phase 15 must remain HOLD until the hosted Auth setting is enabled and the advisor warning disappears.

## Functional CI baseline

Verified on the latest completed CI run:

- Supabase production target verification
- dependency setup/cache
- lint
- TypeScript typecheck
- Vite production build
- browser E2E: **7/7 passed**
- production smoke: **3 public routes passed**

## Freeze rule

Do not label this repository `FINAL FREEZE` until the Phase 15 Auth security blocker is independently verified as cleared and a final CI pass is green against the resulting commit.

## Release status

**SYKABELAJAR 4.0 modernization roadmap: NOT YET FROZEN.**
