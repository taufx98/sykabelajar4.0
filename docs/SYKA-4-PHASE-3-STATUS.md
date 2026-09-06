# SYKABELAJAR 4.0 — Phase 3 Status

Date: 2026-09-06
Status: COMPLETE

## Goal

Introduce one canonical participant identity shared by individual accounts and collective participants, then wire attempt/result/certificate contracts to that identity without destructively replacing the legacy schema.

## Implemented

- Added `public.participants` as the canonical participant table.
- Supported identities:
  - `INDIVIDUAL`: `user_id` present.
  - `COLLECTIVE`: `collective_participant_id` present.
- Added identity snapshot fields: name, class, grade, school, photo, participant code.
- Added unique competition-scoped identity rules.
- Added RLS and least-privilege access for the canonical participant table.
- Added private canonical participant resolvers for individual and collective flows.
- Added `attempts.canonical_participant_id` and backfilled existing rows.
- Added `certificates.canonical_participant_id` and backfilled existing rows.
- Added `collective_certificates.canonical_participant_id` and backfilled existing rows.
- Updated individual and collective attempt-start RPCs to create/link canonical participants.
- Added canonical result RPCs with competition-scoped ranking.
- Added canonical participant/certificate history API contracts.
- Updated individual certificate issuance to create/link the canonical participant.
- Updated collective certificate preparation to create/link the canonical participant.
- Added safe `participant_results` and `participant_certificates` views using `security_invoker=true`; direct public/authenticated table grants remain restricted and controlled RPCs are used for client access.

## Legacy safety

The existing `attempts.participant_id`, `attempts.collective_participant_id`, and `certificates.user_id` columns/FKs remain intact for compatibility. No destructive FK replacement was performed.

Production currently contains zero attempt, certificate, collective participant, or collective certificate rows requiring backfill, so the Phase 3 migration introduced no data rewrite risk.

## Frontend contract

Updated:
- `src/services/competition.service.ts`
- `src/services/collectiveParticipant.service.ts`
- `src/services/certificate.service.ts`

The service layer now exposes canonical participant, attempt, result, and certificate-history calls while preserving existing Phase 2 collective flows.

## Security posture

Canonical table access is RLS-protected and direct client grants are revoked. Security-definer functions have explicit search paths and explicit execute grants. Public certificate/result access remains through the intended narrow RPC surface.

## Exit criteria

- Canonical participant identity exists for both participation modes.
- New individual and collective attempts automatically attach to canonical participants.
- Result ranking can operate over the shared participant identity.
- Individual and collective certificate records can be surfaced through one contract.
- Legacy schema remains compatible.
- Production verification shows zero unlinked existing rows.
- Frontend CI must pass on the final Phase 3 commit.

## Next phase

Phase 4 can focus on anti-abuse/identity integrity hardening, including stronger multi-account controls, participation uniqueness, claim abuse prevention, and organization-scoped policy enforcement.
