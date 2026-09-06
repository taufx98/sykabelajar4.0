# SYKABELAJAR 4.0 — Phase 8 Organizer 2.0

Date: 2026-09-06
Status: COMPLETE

## Goal

Harden and consolidate the Organizer 2.0 workspace so organization-scoped management, competition creation/configuration, registrations, members, plans, serials, and organizer workflows use server-authoritative permissions without changing the established architecture.

## Implemented / verified

- Organizer Control Center supports workspace selection and organization-scoped workflow navigation.
- Organizer competition creation and editing use server-side organizer membership/ownership checks.
- Competition configuration and registration review are server-authoritative.
- Organizer member management remains organization-scoped.
- Plan/entitlement checks remain enforced before quota-sensitive organizer operations.
- Organizer certificate serial generation, assignment, and revocation remain permission-checked and entitlement-gated.
- Organizer access-code rotation remains manager-only.
- Custom plan requests remain authenticated and organizer-scoped.
- Organizer registration listing remains organization-scoped and authenticated-only.

## Security hardening

The following previously exposed organizer RPCs no longer accept direct execution by `anon`; they are restricted to `authenticated` while retaining their existing server-side authorization checks:

- `create_organizer`
- `create_organizer_competition`
- `save_organizer_competition`
- `save_organizer_competition_config`
- `list_organizer_registrations`
- `review_registration`
- `generate_organizer_serials`
- `assign_organizer_serial`
- `revoke_organizer_serial`
- `rotate_organizer_access_code`
- `choose_organizer_plan`
- `request_custom_organizer_plan`
- `get_active_organizer_entitlements`
- `join_organizer`
- `admin_assign_organizer_plan`
- `admin_create_organizer`

Administrative operations remain protected by their internal admin checks; changing execute privilege does not replace business authorization.

## Frontend

- `/organizer`
- `/organizer/competition/new`
- `/organizer/question-bank/:bankId`
- `/organizer/registrations`
- `/organizer/members`
- `/organizer/competition/:id/config`
- `/organizer/grading`
- `/organizer/plan`
- `/organizer/serials`
- `/organizer/ads`

## Legacy safety

No destructive replacement of organizer, competition, registration, plan, serial, certificate, or membership structures was performed. Existing Phase 2–7 participant contracts remain unchanged.

## Exit criteria

- Organizer workspace remains functional.
- Competition and registration operations remain organization-scoped.
- Plan/entitlement and serial workflows retain server-side enforcement.
- Sensitive organizer RPCs are not executable by `anon`.
- Existing frontend paths remain intact.
- Final Phase 8 CI must pass.

## Next phase

Phase 9 — Certificate Lifecycle.
