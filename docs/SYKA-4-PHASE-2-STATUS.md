# SYKA-4 Phase 2 Status

Status: COMPLETE

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

## Verification
- Production Supabase target: `mvdczyitbkxkldjughor`.
- Phase 2 RLS status checked across `teacher_rosters`, `roster_students`, `collective_participants`, `participant_access_credentials`, `collective_access_sessions`, `collective_certificates`, `collective_certificate_orders`, and `collective_chat_messages`.
- Function privilege audit confirmed teacher listing RPCs are not executable by `anon`.
- `private.hash_collective_token` now has an explicit fixed search path.
- Final frontend CI must pass on the commit containing this document and all Phase 2 UI changes before this milestone is treated as closed.
