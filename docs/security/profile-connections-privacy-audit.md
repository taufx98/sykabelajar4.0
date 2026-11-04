# Profile social privacy audit

Date: 4 November 2026
Status: confirmed findings; fix migration prepared for review, not applied to production.

## Finding 1: profile connections list

The public RPC public.get_profile_connections(p_profile_id, p_mode) is a SECURITY DEFINER function executable by the anon role. It returns follower/following identifiers and public profile fields.

The original implementation relied on a nullable comparison using auth.uid() <> p_profile_id. For an anonymous request, auth.uid() is NULL; SQL three-valued logic makes that comparison NULL, and a PL/pgSQL IF does not enter its branch when the condition is NULL. This can bypass a disabled show_following_popup or show_social_popup setting.

A second boundary was missing: the function did not check profiles.is_public. Because it is SECURITY DEFINER, it cannot rely on the caller's normal RLS restriction on public.profiles. A direct RPC caller who knows or obtains a profile UUID could request a connection list even when the profile itself is private.

## Finding 2: social summary for private profiles

The public.get_public_profile_social(p_profile_id) RPC is SECURITY DEFINER and returns follower_count, following_count, and follow_status. It requires an authenticated caller, but it did not verify that the requested profile is public or owned by that caller. Direct authenticated RPC callers could request the counts for a private profile even though the public.profiles SELECT policy would deny the corresponding row.

The live function ACL also contained a PUBLIC execute grant, despite the original migration intending to restrict it to authenticated callers. Its body rejects a NULL auth.uid(), so this was not an anonymous data disclosure by itself, but the grant did not match the intended access boundary. The new migration explicitly revokes PUBLIC/anon execution and grants the RPC only to authenticated.

## Impact

The connections RPC can disclose rows containing user ID, username, full name, avatar URL, and verification type when its visibility guard is bypassed. The social summary RPC can disclose aggregate follower/following counts and the caller's follow status for a private target profile.

These findings do not demonstrate access to passwords, exam answers, payment credentials, or arbitrary profile columns.

## Fix

The migration:

1. Rejects null profile IDs and unsupported connection modes.
2. Reads profiles.is_public and the relevant popup setting inside the connections RPC.
3. Allows a non-owner to read connection rows only when the profile is public and the corresponding popup setting is enabled.
4. Uses IS DISTINCT FROM, so an anonymous caller is always treated as a non-owner.
5. Preserves owner access even when the profile is private or its popup is disabled.
6. Makes the social summary return no rows unless the target is public or belongs to the authenticated caller.
7. Revokes implicit PUBLIC execution from the social summary and grants execution only to authenticated.
8. Sets an empty function search path and schema-qualifies referenced application objects.
9. Keeps anonymous execution only for the connections-list RPC, because public profiles are intentionally allowed to expose those lists when both visibility rules permit it.

## Verification status

- Seven Node contract tests cover NULL identity, private profile visibility, popup visibility, owner access, invalid inputs, fixed search path, and exact function grants.
- CI runs the regression tests alongside the existing repository suite.
- No production Supabase migration has been applied.
- PostgreSQL integration testing on an isolated Supabase environment remains required before production rollout.

## Additional production audit backlog

The read-only audit also found broad Security Advisor warnings for security-definer functions and RLS-enabled tables without policies. These are not all vulnerabilities: some functions intentionally expose public data, others rely on expiring collective-participant tokens, and internal helpers in the private schema are not directly exposed because anon and authenticated lack USAGE on that schema.

The next review must inspect each function's body and effective grants instead of revoking every function indiscriminately. The separate private.organizer_access_codes table with RLS disabled also remains on the audit list; its schema exposure and privileged function call sites need review before changing its RLS setting.
