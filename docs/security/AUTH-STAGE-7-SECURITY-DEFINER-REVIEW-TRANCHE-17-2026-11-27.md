# Stage 7 SECURITY DEFINER manual review — Tranche 17

Date: 27 November 2026  
Project: Production DB2 `mvdczyitbkxkldjughor` (PostgreSQL 17.6)  
Scope: five profile connections, public badge, public UI-settings and social-summary SECURITY DEFINER RPCs  
Decision: **accepted for partial manual-review count only; Production remains NO-GO**

## Exact signatures and read-only Production fingerprint evidence

A SELECT-only Production catalog query on 27 November compared the current function metadata with the immutable 21 November triage inventory. All five exact `md5(pg_proc.prosrc)` values matched. Every function remains owned by `postgres` and SECURITY DEFINER. Return type, language, original `search_path`, ACL grant set, and effective role EXECUTE flags were checked. The ACLs below are normalized role/privilege/grantor sets; they intentionally do not depend on PostgreSQL's serialization order.

| Exact signature | Production `md5(prosrc)` | Original `search_path` | Language | Production EXECUTE |
|---|---|---|---|---|
| `get_profile_connections(uuid,text)` | `85c419635f365e1af49ba0dddda9701c` | `public` | plpgsql | anon, authenticated, service_role |
| `get_public_profile_badge_visibility(uuid)` | `5ab5851b52904c7e0a8f0d1575eaad9c` | `public, private` | sql | anon, authenticated, service_role |
| `get_public_profile_badges(uuid)` | `f2fb6078710677182c07096c20a36cdf` | `public, private` | sql | anon, authenticated, service_role |
| `get_public_profile_ui_settings(uuid)` | `b737fddaa31055b691adf65aa2d0f032` | `public, private` | sql | PUBLIC, anon, authenticated, service_role |
| `get_public_profile_social(uuid)` | `11b6f840dab3e234aa82d57993b96ed8` | `public, private` | plpgsql | PUBLIC, anon, authenticated, service_role |

For every row, owner is `postgres`, SECURITY DEFINER is true, and `service_role` EXECUTE is true. `authenticated` EXECUTE is true on all five. The exact original ACLs were reconstructed and preflighted in the disposable restore; `get_public_profile_social(uuid)` is deliberately tightened by the Stage 3 draft to authenticated-only because its response is session-scoped. The four public projections retain their intended guest EXECUTE boundary, with their body-level visibility filters.

## Source review and authorization boundaries

- **`get_profile_connections(uuid,text)`:** guest reads are restricted to public profiles and the selected popup/list mode. Private profiles, disabled follower/following lists, and NULL/invalid modes return no rows. Self access to a private profile is limited to the exact verified Better Auth issuer plus a `private.app_users.identity_origin='better_auth'` identity match; a matching UUID under a legacy Supabase issuer is not sufficient.
- **`get_public_profile_badge_visibility(uuid)`:** guest projection is limited to a public profile. A private profile's visibility flags are available only to its verified Better Auth owner or a verified Better Auth Admin.
- **`get_public_profile_badges(uuid)`:** guests receive badge rows only for a public profile whose badge collection is enabled. Private-profile rows are limited to the verified owner/Admin path.
- **`get_public_profile_ui_settings(uuid)`:** public settings are projected for public profiles; private-profile settings are restricted to the verified Better Auth owner/Admin path. No private popup preference is exposed to a guest or unrelated identity.
- **`get_public_profile_social(uuid)`:** the summary requires a verified Better Auth session and permits only public-profile visibility or the verified owner/Admin case. The Stage 3 draft removes `PUBLIC` and `anon` EXECUTE and grants authenticated-only execution.

The replacement definitions use an empty `search_path` and schema-qualified references. Issuer/identity checks precede protected reads. The review preserves intended public profile projections rather than converting all public reads into authenticated-only endpoints.

## Rollback-only regression and protected baseline

PR [#348](https://github.com/taufx98/sykabelajar4.0/pull/348) added positive public badge/UI projection checks, hidden badge-collection denial, private-profile guest denial, verified Better Auth owner access, and unrelated Better Auth user denial. The existing Stage 3 rollback-only regression also covers public/private connection visibility, legacy Supabase issuer denial, Admin checks, and the social-summary EXECUTE restriction.

The first protected baseline run exposed a preflight false negative: equivalent PostgreSQL ACLs were serialized in different array orders between Production and the disposable restore. PR [#349](https://github.com/taufx98/sykabelajar4.0/pull/349) changed the preflight to compare sorted `aclexplode` grant entries (grantee, privilege, grantor, and grant-option state), while retaining the exact function fingerprint, owner, SECURITY DEFINER, search_path, return type, language and effective-role checks. A separate SELECT-only Production query confirmed the five canonical grant sets.

Protected Auth Production Schema Baseline [#46037657998](https://github.com/taufx98/sykabelajar4.0/actions/runs/46037657998) passed **78/78 steps** on merge commit `4d8d7c16265572cfbb075743ee9f1330399841ba`. The run completed schema-only Production export, PostgreSQL 17.6 disposable restore, the Stage 3 SECURITY DEFINER preflight and replacement, and the full Stage 3 trusted-issuer RLS acceptance. It also passed the 23 direct RLS table boundaries, all 14 collective portal invalid-token checks, the 69-FK and Stage 3 rollback rehearsals, and the two-user Cloudinary/payment Edge integration. The disposable Supabase stack and schema export were removed at the end of the run. No Production DDL/DML or account rows were applied or imported.

Supabase Local Auth Claims CI [#46037657928](https://github.com/taufx98/sykabelajar4.0/actions/runs/46037657928) passed **23/23** on the same merge commit.

**Cumulative accepted manual review: 88/202 exact signatures; 114 remain.** This adds five signatures to the previous 83/202 count. The immutable 21 November triage inventory remains unchanged; its `reviewStatus: not_reviewed` values describe the original triage snapshot. The canonical activation manifest remains `status: blocked` with `reviewedAuthenticatedFunctionCount: 0` until the complete 202-function post-Stage-3/pre-issuer-guard manifest and class-specific evidence are complete. Production DB2 remains **NO-GO**. No Production DDL/DML, data/account change, grant, policy, Worker deployment, DNS change, or secret change was performed.
