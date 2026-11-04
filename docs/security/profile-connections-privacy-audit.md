# Profile connections privacy audit

Date: 4 November 2026
Status: confirmed finding; fix migration prepared for review, not applied to production.

## Finding

The public RPC public.get_profile_connections(p_profile_id, p_mode) is a SECURITY DEFINER function executable by the Postgres anon role. It returns follower/following identifiers and public profile fields.

The original implementation relied on a nullable comparison using auth.uid() <> p_profile_id. For an anonymous request, auth.uid() is NULL; SQL three-valued logic makes that comparison NULL, and a PL/pgSQL IF does not enter its branch when the condition is NULL. This can bypass a disabled show_following_popup or show_social_popup setting.

A second boundary was missing: the function did not check profiles.is_public. Because it is SECURITY DEFINER, it cannot rely on the caller's normal RLS restriction on public.profiles. A direct RPC caller who knows or obtains a profile UUID could request a connection list even when the profile itself is private.

The frontend only opens the connections modal after loading a profile, but UI flow is not an authorization boundary. Direct PostgREST RPC requests must be safe independently.

## Impact

Potential disclosure is limited to connection-list rows returned by the RPC: user ID, username, full name, avatar URL, and verification type. This finding does not demonstrate access to passwords, exam answers, payment credentials, or arbitrary profile columns.

## Fix

The migration:

1. Rejects null profile IDs and unsupported connection modes.
2. Reads profiles.is_public and the relevant popup setting inside the privileged function.
3. Allows a non-owner to read connections only when the profile is public and the corresponding popup setting is enabled.
4. Uses IS DISTINCT FROM, so an anonymous caller is always treated as a non-owner.
5. Preserves owner access even when the profile is private or its popup is disabled.
6. Keeps anonymous execution because public profiles are intentionally allowed to expose connection lists when both visibility rules permit it.
7. Sets an empty function search path and fully qualifies application objects.
8. Revokes implicit PUBLIC execute and grants only the intended API roles.

## Verification status

- Contract tests cover anonymous NULL behavior, profile public/private visibility, popup visibility, owner access, invalid inputs, fixed search path, and exact function grants.
- CI runs the regression tests alongside the existing repository suite.
- No production Supabase migration has been applied.
- PostgreSQL integration testing on an isolated Supabase environment is still required before merge or production rollout.

## Additional production audit backlog

The read-only audit also found broad Security Advisor warnings for security-definer functions and RLS-enabled tables without policies. These are not all vulnerabilities: some functions intentionally expose public data, others rely on expiring collective-participant tokens, and internal helpers in the private schema are not directly exposed because anon and authenticated lack USAGE on that schema.

The next review must inspect each function's body and effective grants instead of revoking every function indiscriminately. The separate private.organizer_access_codes table with RLS disabled also remains on the audit list; its schema exposure and privileged function call sites need review before changing its RLS setting.
