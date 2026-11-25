# Stage 7 SECURITY DEFINER manual review — Tranche 15

Date: 25 November 2026  
Project: Production DB2 `mvdczyitbkxkldjughor` (PostgreSQL 17.6)  
Scope: five Admin currency, organizer-plan, username and organizer-creation SECURITY DEFINER RPCs  
Decision: **accepted for partial manual-review count only; Production remains NO-GO**

## Exact signatures and read-only Production fingerprint evidence

A read-only Production catalog query on 25 November compared all five exact signatures with the immutable 21 November triage snapshot. Every `md5(pg_proc.prosrc)` value matched. All five functions remain owned by `postgres`, remain `SECURITY DEFINER`, and retain `search_path=public, private`. Their effective ACL is unchanged: `authenticated` and `service_role` have EXECUTE; `anon` and `PUBLIC` do not.

| Exact signature | Production `md5(prosrc)` | Return type | Owner | SECURITY DEFINER | `search_path` | anon | authenticated | service_role |
|---|---|---|---|---|---|---:|---:|---:|
| `admin_adjust_user_currency(uuid,text,bigint,text)` | `aa8f5302840e39728b006496ad817275` | `jsonb` | `postgres` | yes | `public, private` | no | yes | yes |
| `admin_assign_organizer_plan(uuid,text,timestamptz,timestamptz)` | `ee68f31dacc8cee624c80e7a42867c56` | `organizer_plans` | `postgres` | yes | `public, private` | no | yes | yes |
| `admin_bulk_adjust_currency(uuid[],text,bigint,text)` | `1f6215cccdc383120bbb6787e96c0f2b` | `jsonb` | `postgres` | yes | `public, private` | no | yes | yes |
| `admin_change_username(uuid,text,text)` | `f2303a11f19903297554639acbd87f06` | `profiles` | `postgres` | yes | `public, private` | no | yes | yes |
| `admin_create_organizer(uuid,text,text)` | `860b70d16e5d204cebad55924ab8c66d` | `TABLE(id uuid,name text,slug text,access_code text)` | `postgres` | yes | `public, private` | no | yes | yes |

The Stage 3 draft contains exact Production fingerprint/ACL preflight for these five functions. It also pins the shared Admin helper source fingerprint `79bb70032b67655f0e84d60a853fe548`. The pre-replacement `private.current_user_has_role(app_role)` fingerprint (`c994079fbd7e5a56913ca1fdb8dc9666`) is checked in the earlier issuer-restriction draft, before that helper is replaced. PR #286 moved that preflight to the correct point in the sequence.

No Production function definition, owner, SECURITY DEFINER flag, search_path, ACL, role, grant or policy was modified.

## Caller and authorization review

The five functions are Admin-only mutation surfaces. The Stage 3 shared authorization chain is:

`private.current_user_is_admin()` → `private.current_user_has_role('admin')` → `private.current_user_is_better_auth()`.

The issuer restriction verifies the exact Production Better Auth issuer and a matching `private.app_users.identity_origin='better_auth'` identity before the shared role helper accepts an Admin role. The two currency RPC replacements also perform the Admin helper check before protected dynamic SQL; they do not independently authorize from a legacy `user_roles` row.

- `admin_adjust_user_currency` changes one target's XP or EDU Coin and writes its currency adjustment/notification records. The replacement checks the issuer-gated Admin helper before the protected dynamic SQL and mutation path.
- `admin_bulk_adjust_currency` applies the same Admin-only boundary across the supplied UUID array. Its Admin check precedes the protected dynamic SQL.
- `admin_assign_organizer_plan` checks the issuer-gated Admin helper before reading the active catalog plan, deactivating an existing assignment, or inserting a new assignment.
- `admin_change_username` checks the same shared Admin helper before updating the target profile.
- `admin_create_organizer` checks the same shared Admin helper before creating the organizer, owner membership, initial FREE plan and private access-code hash.

The original signatures, return types, PostgreSQL owner, SECURITY DEFINER mode and Production grants are preserved in the reviewed replacements. The draft wraps the full set of SECURITY DEFINER replacements, including Tranches 14 and 15, in one transaction. PR #290 moved the existing `COMMIT` from the middle of the draft to its end; the PR gate now tests this transaction boundary.

## Disposable PostgreSQL 17.6 runtime evidence

The Tranche 15 regression is part of `scripts/auth-migration/stage3-issuer-guard-regression.sql`. It ran within the full protected Stage 3 trusted-issuer regression on the schema-only Production restore. All synthetic writes are enclosed by the script's final `ROLLBACK`.

1. **Legacy Supabase issuer denied:** a synthetic subject that has a Better Auth identity and Admin role was presented with the legacy Supabase Auth issuer. All five RPCs rejected it at the issuer-gated Admin path.
2. **Unrelated Better Auth user denied:** a distinct synthetic Better Auth non-Admin identity could not adjust currency, assign an organizer plan, change a username, or create an organizer through any of the five RPCs.
3. **Valid Better Auth Admin positive path:** the synthetic Admin successfully adjusted a user's XP, bulk-adjusted EDU Coin, changed a synthetic username, created an organizer, and assigned the PRO plan to the newly created organizer.
4. **Organizer owner fixture is isolated:** the positive create-organizer test uses the synthetic Better Auth teacher identity `ffffffff-ffff-4fff-8fff-fffffffffff6`, which is not an owner in the earlier Stage 7 organizer fixtures. A preflight fails closed if the identity already owns an organizer. The regression verifies exactly one active owner membership was created for the new organizer. PR #291 added this collision guard and assertion after an earlier run exposed reuse of an already-claimed owner UUID.
5. **Plan fixture matches the Production constraint:** the disposable test uses `PRO`, one of the only allowed `plan_catalog.plan_code` values (`FREE`, `PREMIUM`, `PRO`). PR #288 corrected the earlier invalid synthetic value.
6. **Access code stored hash-only:** the RPC returns the generated access code to the authorized Admin caller for the one-time response; the public organizer row stores only the `SECURED` sentinel, while `private.organizer_access_codes` stores the bcrypt hash. The test confirms the hash is non-empty, is not plaintext, and verifies via `extensions.crypt(access_code, code_hash)`. The private-table inspection occurs only after the test restores the disposable database owner; the public RPC call itself remains under authenticated Admin.

All fixture identities and business rows are synthetic. No Production account or application row was imported. The Stage 3 regression transaction rolled back.

## Admin organizer pgcrypto search-path finding

The runtime positive path exposed a genuine Production metadata issue in `admin_create_organizer`: its exact Production definition calls `gen_random_bytes`, `crypt` and `gen_salt` without schema qualification, but the function pins `search_path=public, private`. The read-only Production catalog confirms those pgcrypto functions are installed in the trusted `extensions` schema, which is not in this function's current path.

PR #289 added the fail-closed migration `supabase/migrations/20261125103000_fix_admin_create_organizer_pgcrypto_search_path.sql`. It checks the exact current function-definition MD5 (`bd5b5646fdf2bee263f18323480fa7c4`), owner, SECURITY DEFINER flag, old search_path and exact ACL, verifies the required pgcrypto functions and schema privileges, then changes only the function search_path to `public, private, extensions`. It does not replace the function body or grant/revoke privileges. The protected baseline applied and verified this migration **only on the disposable restore** before the Tranche 15 runtime test.

**Outstanding Production remediation:** Production still has the original `search_path=public, private`; the migration has not been applied to Production. It must be included in the separately approved zero-start Production cutover/migration sequence. This report does not authorize that change, and the global Production gate remains NO-GO.

## PR, protected baseline and CI

The implementation and regression corrections were merged in this sequence:

- PR [#283](https://github.com/taufx98/sykabelajar4.0/pull/283) added the five Admin RPC issuer/scope changes.
- PR [#285](https://github.com/taufx98/sykabelajar4.0/pull/285) corrected the hash-only organizer access-code regression so private-table inspection happens after restoring the disposable DB owner.
- PR [#286](https://github.com/taufx98/sykabelajar4.0/pull/286) moved the `current_user_has_role` fingerprint preflight before the helper replacement.
- PR [#288](https://github.com/taufx98/sykabelajar4.0/pull/288) changed the disposable plan fixture to the valid `PRO` code.
- PR [#289](https://github.com/taufx98/sykabelajar4.0/pull/289) added the fail-closed pgcrypto search_path migration and its disposable-baseline step.
- PR [#290](https://github.com/taufx98/sykabelajar4.0/pull/290) restored a single atomic transaction across the full Stage 3 SECURITY DEFINER issuer draft and moved its contract test into the PR gate.
- PR [#291](https://github.com/taufx98/sykabelajar4.0/pull/291) isolated the positive organizer owner fixture and added owner-membership verification.

Protected Auth Production Schema Baseline [#45598325366](https://github.com/taufx98/sykabelajar4.0/actions/runs/45598325366) passed **68/68 steps** on merge commit `17118b4964484988f85f47842b68c72bec4d64eb`. It passed the schema-only export and isolated restore, zero-imported-user-row check, all 69 FK catalog comparisons and cutover/rollback simulations, Stage 3 identity/provisioning/issuer acceptance, the Tranche 15 positive and negative cases, all 23 application RLS boundaries, all 14 collective portal invalid-token checks, valid portal lifecycle and 5,000-selector regression, and two-user Cloudinary/payment Edge integration. The disposable database and export workspace were removed successfully.

Supabase Local Auth Claims CI [#45598325344](https://github.com/taufx98/sykabelajar4.0/actions/runs/45598325344) passed on the same merge commit. PR #291 Auth Schema Contracts [#45598006669](https://github.com/taufx98/sykabelajar4.0/actions/runs/45598006669), Local Auth Claims [#45598006834](https://github.com/taufx98/sykabelajar4.0/actions/runs/45598006834), and Auth Worker CI [#45598006857](https://github.com/taufx98/sykabelajar4.0/actions/runs/45598006857) also passed.

The schema exporter was read-only: no remote DDL/DML or deployment was executed. No user-data export, account backup, account migration or Production row operation was performed.

## Count and remaining gate

Previous accepted manual review: **73/202** (Tranches 01–14, including the reconciled Tranches 06–10 record).  
Tranche 15 accepted signatures: **5**.  
**Cumulative accepted manual review: 78/202 exact signatures; 124 remain.**

This is partial per-function source/runtime evidence only. The canonical all-functions activation manifest remains `status: blocked` with `reviewedAuthenticatedFunctionCount: 0`; the all-202 allowlist/classification and remaining per-function evidence are not complete. Production DB2 remains **NO-GO**.

No Production DDL/DML, application-row changes, role/grant/policy edits, Worker deployment, DNS change or secret change was performed. The pgcrypto migration is pending Production approval and is not part of this acceptance.
