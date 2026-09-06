# SYKABELAJAR 4.0 — Phase 5 Participant Core

Date: 2026-09-06
Status: COMPLETE

## Goal

Make the canonical participant identity the stable core for individual participation while preserving the existing collective participant flow and legacy schema compatibility.

## Implemented

- Added a competition-scoped unique index for individual canonical participants `(competition_id, user_id)`.
- Added a server-side registration lifecycle trigger that creates or refreshes the canonical individual participant when a registration becomes `APPROVED` or `ACTIVE`.
- Kept the existing Phase 3 canonical participant resolver for compatibility and refreshed its contract to remain authenticated-only.
- Added `list_my_participant_core()` as the server-authoritative participant dashboard contract, returning participant, competition, registration, latest attempt, and certificate count in one bounded response.
- Added `src/services/participant.service.ts` as the frontend service contract for participant core data.
- Participant records remain protected by the existing RLS posture; direct `anon` and `authenticated` table SELECT are not exposed.

## Lifecycle

Registration → APPROVED/ACTIVE → Canonical Individual Participant → Attempt → Result → Certificate.

Collective participants continue to use the Phase 2/3 collective identity and canonical participant linkage; no parallel participant identity was introduced.

## Production verification

- Canonical participant rows before seeded user registrations: 0.
- Canonical individual uniqueness index exists.
- Registration canonical-participant trigger exists for INSERT and UPDATE status transitions.
- Direct SELECT on `public.participants` is not granted to `anon` or `authenticated`; client access remains through controlled RPC contracts.

## Legacy safety

No destructive migration was performed. Existing `registrations`, `attempts`, `certificates`, `collective_participants`, and legacy participant foreign keys remain compatible.

## Exit criteria

- Canonical individual participant exists from registration approval/activation, not only from attempt start.
- Individual and collective identities remain represented by the same canonical participant table.
- Participant core data is available through a server-authoritative frontend contract.
- Direct table exposure remains restricted.
- Production schema verification passes.
- Frontend change is committed and ready for CI verification.

## Next phase

Phase 6 — Guru Workspace.
