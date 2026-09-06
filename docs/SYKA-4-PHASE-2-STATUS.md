# SYKA-4 Phase 2 Status

Status: COMPLETE — REVALIDATED 2026-09-06

## Delivered
- Teacher workspace with reusable rosters and roster students.
- Browser CSV import for up to 500 roster students per import, backed by an ownership-checked bulk RPC.
- Collective participant entities for teacher/school-organized competitions with stable participant codes and separate bcrypt passwords.
- 8-hour participant access sessions with hashed tokens; plaintext passwords are not persisted in browser storage.
- Collective participant login, portal, timed competition workspace, autosave, submit, result and mixed ranking.
- Collective attempt identity integrated into the existing assessment/grading infrastructure without breaking full-account attempts.
- Teacher live monitoring, participant credential regeneration and printable access cards without plaintext passwords.
- Event-scoped collective chat for participants, teachers, organizers and admins with scope checks.
- Collective certificate preparation after finalized/published results.
- Collective certificate ordering through the existing `orders` lifecycle and payment status transitions.
- Automatic publication of the collective certificate when the linked order becomes `PAID`, with separate serial number and verification code.
- Public collective certificate verification and print/save-to-PDF certificate page.
- Admin-configurable collective certificate price.
- Authenticated claim flow to link a collective participant to a full SYKABELAJAR account, plus a claimed collective history page.
- RLS enabled on Phase 2 public tables; privileged RPCs restricted to intended roles, while custom-token participant RPCs are explicitly limited to the token-based public surface.
- Security hardening for the Phase 2 token hash helper and teacher listing RPC privileges.

## Safety boundary carried forward
- The legacy `certificates.user_id NOT NULL` path and legacy attempt identity are intentionally not replaced in Phase 2. Existing production data remains intact; Phase 3 can perform a controlled common-participant/result/certificate consolidation with backfill and verification.
- Static Cloudinary certificate asset generation remains unnecessary for the Phase 2 operational flow because the published certificate is generated from the verified public route and can be printed/saved as PDF; a later asset pipeline can be added without changing certificate identity.

## Revalidation 2026-09-06
- Production Supabase target: `mvdczyitbkxkldjughor`.
- The Phase 2 public tables remain RLS-enabled in production: `teacher_rosters`, `roster_students`, `collective_participants`, `participant_access_credentials`, `collective_access_sessions`, `collective_certificates`, `collective_certificate_orders`, and `collective_chat_messages`.
- Teacher/owner operations such as roster import, participant creation, registration, certificate preparation/order and teacher listings are not executable by `anon`.
- Token-based participant operations remain intentionally available to `anon` only where the Phase 2 public token surface requires them.
- `private.hash_collective_token(text)` has the fixed configuration `search_path=pg_catalog, extensions, private`.
- The canonical Phase 2 route set remains active in `src/App.tsx`, including `/guru`, `/guru/daftar`, `/guru/kartu`, `/guru/monitoring`, `/peserta-kolektif/login`, `/peserta-kolektif`, `/peserta-kolektif/kerja`, `/claim-peserta-kolektif`, `/profile/collective-history`, and `/sertifikat-kolektif/:code`.
- `src/services/collectiveParticipant.service.ts` remains wired to the production Phase 2 RPC/table contract for roster, collective participant, assessment, chat, claim and certificate flows.
- CI run #1055 for the Phase 2 revalidation commit completed successfully: production target check, canonical source report, lint, typecheck, build, browser access-control E2E, and production smoke all passed.

## Exit decision

Phase 2 is revalidated and closed on the current production baseline. No Phase 2 runtime rewrite or destructive migration was introduced by this revalidation. Subsequent work should proceed to Phase 3 using the same prove-before-remove and append-only migration safety boundaries.
