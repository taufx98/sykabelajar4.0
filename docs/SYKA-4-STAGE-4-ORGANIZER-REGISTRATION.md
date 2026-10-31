# SYKABELAJAR 4.0 — Stage 4: Organizer Registration & Invitations

## Objective

Harden the existing organizer onboarding and invitation flow without introducing a second organizer registry, changing existing free-plan rules, or rewriting production organizer data.

## Existing backend reused

- Self-service workspace creation remains on `create_organizer`.
- Free workspace creation still requires verified email and verified phone.
- The existing one-free-claim-per-phone identity guard remains authoritative.
- Workspace invitation acceptance remains on `join_organizer`.
- Invitation secrets remain bcrypt-hashed in `private.organizer_access_codes`.
- Owner/admin invitation rotation uses `rotate_organizer_access_code`; raw invitation codes are returned once and are not stored in the public `organizers.access_code` column.
- Membership and role authorization remain based on `organizer_members`, `user_roles`, and existing RLS/governance helpers.

## Changes in this stage

1. Add a role-sync trigger after organizer membership changes. Active membership grants `organizer_member`; the role is deactivated after the last active membership is removed, unless the user's profile remains an organizer account eligible for self-service onboarding.
2. Reconcile existing active memberships into `user_roles` without deactivating organizer-account eligibility for users who have not created a workspace.
3. Add the authenticated `/organizer/join` page for invited users who do not yet have the organizer role. It accepts organization slug/name plus the 10-character invitation code, calls `join_organizer`, refreshes backend roles, and opens the organizer workspace.
4. Preserve the invitation slug across the login redirect. The invitation code is never placed in the URL.
5. Replace the admin console's deprecated plaintext `organizers.access_code` editor with the existing server-side hashed-code rotation RPC.
6. Add owner controls in Organizer > Member to rotate a code and copy the invitation link separately from the secret code. The raw code is shown only immediately after rotation in the current page session.
7. Allow Admin or the owning organizer to rotate its invitation code; normal workspace members cannot rotate it.

## Migration

File: `supabase/migrations/20261031170000_stage_4_organizer_invitation_membership.sql`

The migration has **not** been applied to Supabase production. It is included for review and CI only. It does not create organizers, members, plans, participants, competitions, attempts, scores, payment rows, or certificates.

## Security notes

- Direct table authorization continues to rely on the existing RLS policies and the existing `organizer_members` governance trigger.
- Membership-role synchronization is performed only by a private SECURITY DEFINER trigger function with a fixed empty search path; its direct EXECUTE privilege is revoked from client roles.
- Invitation codes are rotated by a SECURITY DEFINER RPC that verifies Admin or owner authorization, stores only the bcrypt hash, and returns the code once.
- Supabase's current Security Advisor flags `private.organizer_access_codes` because RLS is disabled. This stage does not enable RLS or invent a policy for this private table; doing so without validating access paths could interrupt server-side invitation checks. Review the advisor remediation separately before changing that table's policy model.

## Verification

The PR adds `npm run test:organizer-registration-contract` and executes it in CI alongside the normal lint, typecheck, build, performance budget, browser access-control E2E, and production smoke tests.

Production rollout requires an explicit approval to apply the migration, followed by SQL regression checks, function privilege checks, and a verified deployment. Do not test by creating fake organizer or participant records in production.
