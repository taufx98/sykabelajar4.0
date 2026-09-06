# SYKABELAJAR 4.0 — Phase 2 Revalidation

Date: 2026-09-06
Status: REVALIDATED

## Scope

Phase 2 was revalidated against the current `main` runtime and production Supabase project without rewriting the existing implementation.

## Verified frontend contract

- `src/App.tsx` exposes the Phase 2 teacher workspace routes under `/guru`, `/guru/daftar`, `/guru/kartu`, and `/guru/monitoring`.
- Collective participant routes remain active under `/peserta-kolektif/*`.
- Collective claim/history/certificate routes remain active under `/claim-peserta-kolektif`, `/profile/collective-history`, and `/sertifikat-kolektif/:code`.
- `src/pages/GuruCollectivePage.tsx` is wired to the collective participant service for roster, CSV import, participant access, password regeneration, and certificate ordering.
- `src/services/collectiveParticipant.service.ts` uses the production Supabase RPC/table contracts for roster management, collective registration, participant access, timed attempts, chat, certificates, and claims.

## Verified production database contract

Production target: `mvdczyitbkxkldjughor`.

The following Phase 2 tables have RLS enabled in production:

- `teacher_rosters`
- `roster_students`
- `collective_participants`
- `participant_access_credentials`
- `collective_access_sessions`
- `collective_certificates`
- `collective_certificate_orders`
- `collective_chat_messages`

The Phase 2 function surface was rechecked for intended privilege boundaries. Teacher/owner operations such as roster bulk import and collective participant/certificate management are not executable by `anon`, while token-based participant operations are intentionally exposed through the limited custom-token RPC surface.

`private.hash_collective_token(text)` has an explicit fixed search path of `pg_catalog, extensions, private`.

## Safety result

No destructive schema change, participant identity replacement, certificate identity replacement, payment lifecycle rewrite, or runtime feature deletion is introduced by this revalidation. Existing Phase 2 behavior remains the source of truth.

## CI gate

Current `main` commit `5505a35a13bb0461754baec6e17e1699b7083b30` passed the repository CI run #1054 with conclusion `success`, including the configured production-target check, canonical source report, lint, TypeScript typecheck, Vite build, browser access-control E2E, and production smoke test.

## Exit

Phase 2 is revalidated and remains complete on the current canonical baseline. No implementation rewrite is required before moving to the next phase.
