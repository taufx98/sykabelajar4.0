# Phase 12 — Subscription, Plan Lifecycle & Certificate/QR Final Audit

Status: **CLOSED**

## Scope completed

- Subscription/plan lifecycle is enforced in the database, not only by UI.
- Free, Premium, and Pro entitlement checks are backed by the active organizer plan.
- Premium certificate serial entitlement is capped at 100; Pro at 500.
- Serial generation is transactionally locked per organizer and quota checked before issuing serials.
- Serial assignment verifies organizer ownership, certificate ownership through competition, entitlement, and serial availability.
- Revoked serials cannot be reused.
- Organizer ownership governance is enforced so one user cannot own multiple organizers and ordinary members cannot promote arbitrary users to owner.
- Organizer members can belong to multiple organizations; ownership remains distinct from membership.
- Custom plan requests support arbitrary requested features/notes/contact without exposing a fabricated custom price.
- Public certificate verification uses the safe `certificate_verifications_public` projection.
- Public verification is limited to `PUBLISHED` and `REVOKED` records; `PUBLISHED` is valid, `REVOKED` is invalid.
- Certificate lifecycle transition clears `revoked_at` when a revoked certificate is restored to another valid lifecycle state.
- QR payloads are domain-agnostic: assigned serials store `/verify/<verification_code>` and the frontend resolves the active origin at runtime.
- No production serial rows currently contain a legacy hardcoded SykaBelajar domain.

## Verification state

Production currently contains no certificate/verification/serial rows, so a destructive end-to-end certificate test would require creating test records. No fabricated production data was introduced.

Current production counts checked during finalization:

- certificates: 0
- certificate verifications: 0
- organizer serials: 0
- organizers: 2
- legacy hardcoded QR-domain payloads: 0

## Security advisor notes

The remaining advisor findings are not treated as Phase 12 blockers:

- Leaked password protection remains **OFF intentionally** per product requirement.
- Several existing application functions are `SECURITY DEFINER` and callable by authenticated users; these are protected by function-level authorization checks and/or are legacy application patterns outside the Phase 12 scope.
- Existing informational RLS-no-policy findings for internal/event tables remain intentionally inaccessible directly and are operated through controlled server-side paths.
- Unused-index findings are informational and deferred from this phase.

## CI

Final Phase 12 frontend verification passed after aligning public verification status rules:

- Commit: `7a46e80bcf74bf3253ebfad7a88ebfcb7ec8c5c1`
- Workflow run: `33582238533` (CI #293)
- Install dependencies: PASS
- Lint baseline debt report: PASS
- Typecheck: PASS
- Build: PASS
- Production smoke test: PASS

## Phase 12 exit criteria

Phase 12 is complete and ready to hand off to **Phase 4 — Anti-abuse / Anti-farming**.
