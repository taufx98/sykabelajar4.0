# create_organizer PL/pgSQL output-parameter ambiguity

Date discovered: 7 November 2026  
Scope: read-only production inspection and disposable local schema-only restore.  
Status: a forward migration is prepared in this branch; it has **not** been applied to production.

## Finding

The live database reports these PL/pgSQL settings:

| Setting | Production value |
|---|---|
| `plpgsql.variable_conflict` | `error` |
| `plpgsql.extra_warnings` | `none` |
| `plpgsql.extra_errors` | `none` |

The live `public.create_organizer(text,text)` function returns a table with an output column named `id`. Its body contains:

```sql
select * into v_user from auth.users where id = v_uid;
```

In PL/pgSQL, the `RETURNS TABLE(id uuid, ...)` output parameter named `id` is also a variable. Under the production `plpgsql.variable_conflict = error` setting, the unqualified `id` in that query is ambiguous with `auth.users.id`.

The full-schema disposable restore exposed the defect during the production-shaped organizer regression. The error was:

```text
column reference "id" is ambiguous
QUERY: select * from auth.users where id = v_uid
CONTEXT: PL/pgSQL function create_organizer(text,text)
```

This is a source-level ambiguity in the existing production function, not a Better Auth token or FK parity issue. No production write was attempted.

## Forward fix prepared

Migration: `supabase/migrations/20261107000100_fix_create_organizer_plpgsql_output_parameter_ambiguity.sql`

The only logic change is to qualify the selected row:

```sql
SELECT au.* INTO v_user
FROM auth.users AS au
WHERE au.id = v_uid;
```

All existing checks remain unchanged:
- authenticated UUID and active `organizer_member` role;
- one-workspace limit;
- confirmed email and confirmed phone, with at least eight normalized digits;
- SHA-256 of normalized verified phone digits;
- one FREE organizer claim per phone identity;
- organizer owner membership, six-month FREE plan, hashed access code and identity claim.

`CREATE OR REPLACE FUNCTION` preserves the existing function owner and ACL. The migration is append-only and must be reviewed with the normal Stage 3 migration set.

## Validation plan

The baseline workflow verifies the original restored production definition and ACLs first. Only after that parity succeeds does it apply this pending migration to the disposable local restore. The rollback-only production-shaped regression then invokes `create_organizer` with `plpgsql.variable_conflict = error`, and checks both successful verified-phone provisioning and the email/phone/duplicate-identity rejection paths.

This local-only application does not alter the hosted production project. Production execution remains blocked until all Stage 3/4/5 gates, OIDC resource-surface acceptance, RLS coverage, and rollback rehearsal have passed.
