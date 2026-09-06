# SYKABELAJAR 4.0 — PRD Phase 4–5 Completion Audit

Date: 2026-09-07

This record audits the Master PRD against the current production implementation for the next unfinished scope.

## PRD mapping

- PRD Phase 4: Participant Core.
- PRD Phase 5: Guru Workspace.

The current repository had already implemented most of these capabilities, but the previous phase labels in status documents were not aligned one-to-one with the Master PRD. This audit therefore uses the Master PRD as the authority.

## Phase 4 — Participant Core

Verified existing production implementation:

- `public.participants` exists as the shared participant identity for individual and collective participation.
- Individual identity uses `user_id`; collective identity uses `collective_participant_id`.
- `attempts.canonical_participant_id`, `certificates.canonical_participant_id`, and `collective_certificates.canonical_participant_id` exist.
- Canonical participant uniqueness is competition-scoped.
- Individual participant creation is synchronized from registration lifecycle and canonical resolvers are server-authoritative.
- Existing legacy participant/attempt/certificate fields remain for compatibility.
- Production integrity checks previously showed no unlinked existing attempt/certificate rows requiring backfill.

Phase 4 therefore has implementation evidence in production; no destructive schema rewrite is required for this completion pass.

## Phase 5 — Guru Workspace

Existing implementation evidence includes:

- `/guru` workspace route and role guard.
- reusable teacher rosters;
- manual roster student creation;
- CSV import with server-side 500-row cap;
- collective registration wizard;
- server-side quote/payment/order contract;
- collective credential provisioning;
- access-card printing without putting plaintext passwords into the printed card;
- collective monitoring;
- event-scoped teacher chat;
- participant credential regeneration.

The completion gaps addressed by this pass are the PRD roster management UX details that were still missing from the active `/guru` page: student search/filter and student edit/archive controls, plus a focused student detail route/view.

## Safety

No production table replacement, no legacy deletion, and no permission broadening are part of this pass. Existing RLS ownership checks remain the authority for roster mutations.
