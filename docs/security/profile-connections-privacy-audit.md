# Profile connections privacy audit

Date: 4 November 2026  
Status: confirmed finding; fix migration prepared for review, not applied to production.

## Finding

The public RPC `public.get_profile_connections(p_profile_id, p_mode)` is a `SECURITY DEFINER` function and is executable by the Postgres `anon` role. It returns follower/following identifiers and public profile fields.

The original implementation relied on:

```sql
IF auth.uid() <> p_profile_id AND NOT coalesce(v_allow, true) THEN
  RETURN;
END IF;
```

For an anonymous request, `auth.uid()` is `NULL`. In PostgreSQL, `NULL <> p_profile_id` evaluates to `NULL`, and a PL/pgSQL `IF` does not enter its branch when the condition is `NULL`. That means a hidden connection-list setting can be bypassed by anonymous RPC calls.

There is a second boundary omission: the function did not check `profiles.is_public`. Because it is `SECURITY DEFINER`, it does not inherit the caller's normal table-level RLS restriction. A caller who knows or obtains a profile UUID could invoke the RPC directly, even when the profile itself is private.

The frontend only opens the RPC after loading a profile, but UI flow is not an authorization boundary. Direct PostgREST RPC requests must be safe independently.

## Impact

Potential disclosure is limited to connection-list rows returned by the RPC: user ID, username, full name, avatar URL, and verification type. This finding does not demonstrate access to passwords, exam answers, payment credentials, or arbitrary profile columns.

The risk exists because the function is exposed to `anon` in the `public` schema and its `SECURITY DEFINER` body omitted the two required privacy checks.

## Prepared fix

Migration `20261104031713_profile_connections_privacy_guard.sql`:

1. Rejects null profile IDs and unsupported modes.
2. Reads the target profile's `is_public` and its connection-list visibility setting inside the privileged function.
3. Allows a non-owner to read connections only when the profile is public and the corresponding popup setting is enabled.
4. Uses `COALESCE(v_uid = p_profile_id, false)` so anonymous requests are treated as non-owners.
5. Preserves owner access even when the profile is private or its popup is disabled.
6. Keeps the RPC callable by `anon` because public profiles are intentionally allowed to expose these lists when their settings permit it.
7. Sets an empty function search path and fully qualifies referenced database objects.

No broad `REVOKE EXECUTE` was added: removing anonymous execution would break the intentional public-profile experience. The authorization logic is fixed at the function boundary instead.

## Verification status

- Five Node contract tests pass locally. They check the migration's security conditions and the expected visibility cases.
- The SQL migration has not been applied to the production Supabase project.
- A PostgreSQL integration test against an isolated Supabase branch is still required before production rollout.

## Broader authentication migration security work

The read-only production audit also found a wider review backlog. Security Advisor flags security-definer functions executable by `anon` and `authenticated`, plus RLS-enabled tables without policies. Those flags are not all vulnerabilities: some functions intentionally provide public read data, others rely on expiring collective-participant tokens, and internal helpers in the `private` schema are not exposed to `anon` or `authenticated` because those roles do not have `USAGE` on that schema.

The next review must prioritize function bodies and effective grants, not revoke all functions indiscriminately. The separate `private.organizer_access_codes` table with RLS disabled also remains on the audit list; its schema exposure and every privileged function that reads it need review before changing its RLS setting.
