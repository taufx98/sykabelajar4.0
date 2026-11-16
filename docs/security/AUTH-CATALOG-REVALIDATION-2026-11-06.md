# Supabase identity catalog revalidation — 6 November 2026

Status: read-only verification against the current production project. This is a metadata check only, not a schema dump and not authorization to apply a migration.

Project ref: `mvdczyitbkxkldjughor`  
PostgreSQL: 17.6  
Verification date: 6 November 2026 (UTC)

## Results

The Supabase connector's verbose table catalog and a read-only `pg_constraint` aggregation were used to re-check the application references to `auth.users(id)`.

| Check | Result |
|---|---:|
| Current application foreign keys to `auth.users(id)` | 69 |
| Distinct source tables | 62 |
| Existing snapshot constraints matched by name, source schema/table/columns and target schema/table/columns | 69 / 69 |
| Current `ON DELETE CASCADE` | 42 |
| Current `ON DELETE SET NULL` | 18 |
| Current `ON DELETE NO ACTION` | 8 |
| Current `ON DELETE RESTRICT` | 1 |
| `SET NULL` source columns confirmed nullable | 18 / 18 |
| `private.app_users` exists | No |
| `auth.users` row count | 10 (count only; no IDs or user fields read) |

The 69 live FK mappings match `scripts/auth-migration/live-auth-users-fk-catalog.json` exactly for constraint name and source/target relation and column mapping. The delete-action distribution was independently re-read from `pg_constraint`. Each of the 18 source columns participating in a `SET NULL` FK was checked through the verbose table catalog and remained nullable.

## Auth lifecycle checks

The current non-internal triggers on `auth.users` remain:

- `on_auth_user_created` → `handle_new_auth_user()`
- `trg_referral_email_confirmed` → `private.process_referral_email_confirmation()`
- `trg_referral_signup_attribution` → `private.capture_signup_referral()`

A read-only policy catalog query still returned 109 policies whose predicate or check expression uses `auth.uid()`. This is expected under the current production Supabase Auth issuer and is a mandatory compatibility surface for the new JWT issuer; it is not a reason to mass-rewrite policies before testing Custom OIDC.

The active `public.app_role` contract and existing business-role records must be preserved. The JWT `role` claim remains PostgreSQL `authenticated`; it is not one of the application business roles.

## Why this is not the schema-only baseline

This check confirms a narrow identity dependency snapshot only. It does not export all tables, columns, defaults, generated expressions, indexes, constraints, policies, views, materialized views, functions, procedures, triggers, grants, extensions, managed Auth/Storage customizations, or their dependency order.

Therefore it cannot replace `scripts/auth-migration/export-schema-baseline.sh` or a reviewed reproducible local baseline. It is useful to keep the FK migration plan current while the full baseline remains pending.

## Safety and next gates

- No DDL/DML was run.
- No user rows, email addresses, UUIDs, credentials, or tokens were exported.
- No `auth.users` trigger, application FK, RLS policy, RPC, Edge Function, user account, or auth-provider setting was modified.
- Do not run the 69-FK rehome against production. First rebuild and verify a complete sanitized local baseline, then validate identity backfill, orphan detection, exact FK delete semantics, role grants, RLS and RPC behavior in disposable fixtures and a separate hosted Supabase Free project.
