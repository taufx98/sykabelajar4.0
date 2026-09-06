# SYKA-4 Phase 2 Status

Status: CORE IMPLEMENTATION COMPLETE

## Delivered
- Teacher roster and reusable roster students.
- Collective participant entity with stable participant code and separate bcrypt password.
- Temporary 8-hour collective access session; plaintext password is not persisted in browser storage.
- Collective participant portal and timed competition workspace.
- Collective attempt identity is compatible with existing full-account attempts via `attempts.collective_participant_id`.
- Collective attempts use the existing answer/grading infrastructure where possible and appear in the existing organizer grading flow.
- Teacher monitoring with attempt status, score, expiry time, and event chat.
- Printable participant access cards without printing plaintext passwords.
- Event-scoped group chat for participants, teachers, organizers, and admins with role-scoped access.
- Collective certificate foundation with distinct serial number and verification code, plus public verification route.
- Mixed ranking calculation compares finalized collective attempts against all finalized attempts in the same competition.
- RLS enabled on all Phase 2 public tables and privileged RPC execution restricted by role.

## Intentionally deferred
- Certificate ordering/payment integration for collective certificates.
- Automatic certificate document generation/asset publication.
- Claim/link collective participant history into a full SYKABELAJAR account.
- Full CSV roster import UI and large-batch import optimization.
- Unified result/certificate tables replacing the legacy `user_id NOT NULL` certificate path.

These deferred items belong to the later lifecycle/integration phase because changing the legacy attempt/certificate foreign-key model would risk existing production participant data.

## Verification
- Production Supabase target: `mvdczyitbkxkldjughor`.
- Phase 2 RLS tables verified enabled.
- Attempt identity integrity verified: zero rows with both identities and zero rows with neither identity at verification time.
- Latest frontend CI run on `ddb498dafa54d661ed5201611f5f79844f8a2daf`: lint, typecheck, build, and production smoke test passed.
