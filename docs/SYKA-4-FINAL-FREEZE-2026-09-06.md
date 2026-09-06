# SYKABELAJAR 4.0 — Final QA + Freeze

Date: 2026-09-06
Status: FINAL FREEZE

## Final baseline

Phases 00–15 have been implemented and re-verified. Phase 15 is closed under an explicit Free-plan exception for Supabase Auth leaked-password protection.

The final CI run on commit `52b2da71295c6604dcec70d65253dedb91f0f9a4` completed successfully. It includes lint, TypeScript typecheck, Vite production build, browser E2E, and production smoke testing.

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

## Free-plan security exception

Supabase Security Advisor reports `auth_leaked_password_protection` as `WARN` because leaked-password protection is disabled.

This setting requires a Supabase Pro plan or higher. The SYKABELAJAR production project currently runs on the Free plan, so the control cannot be enabled without changing the subscription tier.

This is explicitly accepted as a **platform-plan limitation**, not an application/database security defect. No application code or SQL migration is used to misrepresent or bypass the hosted Auth limitation.

All security controls within the repository and database scope have been hardened and independently verified.

## Functional CI baseline

Verified on the final completed CI run:

- Supabase production target verification
- dependency setup/cache
- lint
- TypeScript typecheck
- Vite production build
- browser E2E: **7/7 passed**
- production smoke: **3 public routes passed**

## Freeze rule

The repository is frozen with the Free-plan Auth exception documented above. Future work that changes security architecture, authentication, payment, participant identity, grading, certificate lifecycle, or realtime access must reopen QA and invalidate this freeze until re-verified.

## Release status

**SYKABELAJAR 4.0 modernization roadmap: FINAL FREEZE — FROZEN.**
