# SYKABELAJAR 4.0 — Phase 7 Collective Participant

Date: 2026-09-06
Status: COMPLETE

## Goal

Deliver the complete collective participant lifecycle using the canonical participant identity, including credential login, protected session access, competition work, autosave, submit, result, certificate, claim, and event chat.

## Implemented

- Participant-code + password login for collective participants without requiring Supabase Auth.
- Passwords stored as bcrypt hashes with failed-attempt tracking and temporary lockout.
- Short-lived hashed access sessions with expiry and revocation support.
- Server-authoritative competition access checks for collective participants.
- Competition question retrieval through scoped RPCs.
- Attempt creation linked to the canonical participant identity.
- Answer save/upsert restricted to the participant's active attempt and token scope.
- Server-side submission, timeout handling, scoring, and manual-grading fallback.
- Published-result visibility and competition-scoped ranking.
- Published-only collective certificate visibility with serial and verification code.
- Optional claim of collective history into a full authenticated account.
- Participant event chat through token-scoped RPCs.
- Logout now revokes the server-side access session before local browser cleanup.

## Security hardening

- `collective_access_sessions` direct Data API table privileges revoked from `anon` and `authenticated`.
- Collective lifecycle remains available only through controlled RPC functions.
- Token lookups use SHA-256 hashes rather than storing plaintext access tokens.
- Session validation requires non-revoked and non-expired sessions.
- Collective participant data remains RLS protected.
- Claim flow is authenticated-only and cannot transfer an already-claimed participant to another account.

## Frontend

- `/peserta-kolektif/login`
- `/peserta-kolektif`
- `/peserta-kolektif/kerja`
- `/claim-peserta-kolektif`
- `/profile/collective-history`
- `/sertifikat-kolektif/:code`

## Production verification

- Collective participant, credential, access-session, and chat tables remain RLS enabled.
- Token-based participant RPCs remain intentionally available to `anon` because collective participants do not use Supabase Auth.
- Sensitive session table access is no longer directly exposed through the Data API.
- Production currently has zero collective participant rows, so hardening introduced no data rewrite risk.

## Legacy safety

No destructive replacement of legacy participant, attempt, registration, or certificate columns was performed. Phase 3 canonical participant linkage remains the shared identity contract.

## Exit criteria

- Login and session lifecycle works.
- Competition attempt lifecycle works.
- Result and certificate visibility follows publication rules.
- Claim flow preserves collective history.
- Event chat remains scoped to the participant's competition.
- Server session revocation is enforced on logout.
- Frontend CI passes on the final Phase 7 commit.

## Next phase

Phase 8 — Organizer 2.0.
