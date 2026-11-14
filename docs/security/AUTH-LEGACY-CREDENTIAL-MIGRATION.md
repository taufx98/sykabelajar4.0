# Legacy credential migration — superseded decision

Status: **Not part of the approved migration plan.**
Superseded on 4 November 2026 by [AUTH-NEW-ACCOUNT-AND-ROLE-CONTRACT.md](AUTH-NEW-ACCOUNT-AND-ROLE-CONTRACT.md).

The owner confirmed that existing Supabase Auth identities are demo/testing accounts and that the migration should focus on new Better Auth registrations. Therefore:

- Do not import legacy bcrypt password hashes, old credentials, sessions, refresh tokens, OAuth account tokens, or legacy login state into Better Auth D1.
- Do not build a just-in-time Supabase password-verification bridge.
- Do not build a forced password-reset campaign for those demo identities.
- New users register and authenticate through Better Auth; each receives a fresh UUID.
- The new UUID is provisioned transactionally into Supabase `private.app_users` and the existing application profile/role/settings model.
- Keep the existing `public.app_role` enum and `public.user_roles` authority intact. Public signup can grant only approved basic roles; admin and other privileged role grants remain protected.
- Do not delete old demo identities or linked application rows during Stages 1–5. Stage 6 handles only the explicitly reviewed demo/test cleanup scope.

This decision does not authorize an immediate production cutover. The seven-stage roadmap, hosted Custom OIDC gate, complete schema baseline, trusted phone-verification requirement, full application regression, protected admin bootstrap, and rollback rehearsal remain mandatory.

No legacy password bridge has been implemented. Any earlier proposal in this file to import bcrypt hashes, verify old passwords through Supabase Auth, or reset old passwords is withdrawn.
