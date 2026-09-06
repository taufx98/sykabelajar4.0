# SYKABELAJAR 4.0 — Phase 6 Guru Workspace

Date: 2026-09-06
Status: COMPLETE

## Goal

Provide a server-scoped Guru Workspace for roster management, collective registration, participant credentials, access cards, monitoring, results/certificates, and event chat without introducing a parallel participant identity.

## Implemented

- Guru roster CRUD and reusable student roster.
- Manual student entry and bounded CSV import (max 500 rows per import).
- Collective competition discovery for supported collective modes.
- Bulk collective participant creation from teacher-owned roster students.
- Participant code generation and separate temporary password generation.
- Password regeneration with versioning and lock-state reset.
- Teacher-scoped participant listing with latest attempt status, score, and expiry metadata.
- Printable participant access cards; plaintext passwords are not printed.
- Teacher monitoring workspace with periodic status refresh.
- Teacher event-group chat through scope-checked server RPC.
- Collective certificate preparation/order visibility through the existing Phase 2/3 lifecycle.
- All teacher mutation RPCs verified as authenticated-only; teacher ownership/admin checks remain server-side.

## Security verification

- `teacher_rosters`, `roster_students`, `collective_participants`, `participant_access_credentials`, and canonical `participants` all retain RLS.
- Teacher collective management RPCs are not executable by `anon`.
- Server functions validate authenticated identity and teacher ownership before mutations or scoped reads.
- Participant credentials expose temporary plaintext only at creation/regeneration response time; stored credential value remains hashed.

## Frontend verification

- `/guru` provides the main Guru Workspace.
- `/guru/kartu` provides printable access cards.
- `/guru/monitoring` provides live participant monitoring and event chat.
- Existing Phase 2/3 collective participant routes remain unchanged.

## Legacy safety

No destructive migration was performed. Existing registrations, attempts, canonical participants, collective participants, result, certificate, and legacy foreign-key contracts remain compatible.

## Exit criteria

- Reusable teacher roster works.
- Collective registration and credential lifecycle works.
- Access cards and monitoring are available.
- Results/certificate and group-chat paths remain connected to the same participant identity.
- RLS and server-side ownership checks are enforced.
- Frontend CI passes on the final Phase 6 commit.

## Next phase

Phase 7 — Collective Participant.
