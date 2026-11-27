# Stage 7 SECURITY DEFINER manual review — Tranche 16

Date: 27 November 2026  
Project: Production DB2 `mvdczyitbkxkldjughor` (PostgreSQL 17.6)  
Scope: five organizer/registration SECURITY DEFINER RPCs  
Decision: **accepted for partial manual-review count only; Production remains NO-GO**

## Exact signatures and fingerprint evidence

The read-only Production schema export in protected baseline #46001136856 restored these exact function definitions into the disposable PostgreSQL 17.6 database. The Stage 3 preflight compared the resulting `md5(pg_proc.prosrc)` values against the immutable 21 November Production triage snapshot. It also checked the exact signature, owner, SECURITY DEFINER flag, `search_path`, return type, language, stored ACL, and effective EXECUTE grants.

| Exact signature | Production `md5(prosrc)` | Return type | Owner | SECURITY DEFINER | `search_path` | anon | authenticated | service_role |
|---|---|---|---|---|---|---:|---:|---:|
| `choose_organizer_plan(uuid,text)` | `5ddce4c8479e0ef29315a289680c823b` | `organizer_plans` | `postgres` | yes | `public, private` | no | yes | yes |
| `get_organizer_competition_result_overview(uuid,integer,integer)` | `cb9939c070a2ae7512a72dfd2a2c4539` | `jsonb` | `postgres` | yes | empty | no | yes | yes |
| `list_organizer_registrations(uuid)` | `7cc4b51d7604d7a591a6b7feccb1084a` | `TABLE(registration_id uuid, competition_id uuid, competition_title text, user_id uuid, full_name text, username text, institution text, avatar_url text, status text, submitted_at timestamptz, created_at timestamptz, social_proof_url text)` | `postgres` | yes | `public, private` | no | yes | yes |
| `request_custom_organizer_plan(uuid,jsonb,text,text)` | `b7513a253a348990382f06cbbbf8d382` | `organizer_custom_plan_requests` | `postgres` | yes | `public, private` | no | yes | yes |
| `review_registration(uuid,text,text)` | `248f15764ae7b4c89888407ba0031851` | `registrations` | `postgres` | yes | `public` | no | yes | yes |

The preflight in `docs/security/AUTH-STAGE-3-SECURITY-DEFINER-ISSUER-GUARDS-DRAFT.sql` fails closed on any source fingerprint, owner, SECURITY DEFINER, path, return type, language, ACL, or effective privilege drift. The immutable 21 November triage JSON is not edited; its original `reviewStatus: not_reviewed` values remain the source snapshot, and this report records the later accepted manual review.

No Production function body, signature, owner, SECURITY DEFINER flag, search path, ACL, grant, role, policy, or row was changed.

## Caller and authorization review

- `choose_organizer_plan` validates `auth.uid()` and the exact Better Auth issuer before checking the organizer owner/Admin boundary. The plan catalog and active assignment are read only after authorization. The existing business rule still restricts self-service selection to the FREE plan; paid upgrades continue through the payment path.
- `get_organizer_competition_result_overview` uses an empty `search_path` and fully qualified object references. It validates Better Auth before its first competition read, then selects only a competition visible to an Admin or an authorized organizer editor. A foreign or nonexistent competition returns the same not-found boundary. Participant counts, canonical results, attempt readiness, and grading readiness are derived only after that scope check.
- `list_organizer_registrations` applies the Better Auth identity helper in its query predicate and restricts rows to the requested organizer ID plus Admin or organizer membership. It returns registration/profile fields, including social proof, only within that organizer boundary.
- `request_custom_organizer_plan` validates Better Auth before input processing/writes and requires the caller to manage the target organizer or be Admin. It validates the requested-feature object, feature array, quantities, and WhatsApp contact before inserting the custom-plan request with `requester_user_id=auth.uid()`.
- `review_registration` validates the Better Auth issuer first, performs a non-locking registration/competition authorization preflight before `FOR UPDATE`, then re-reads the competition and rechecks Admin/organizer ownership after the lock. Only then can it change status, write audit data, and notify the registrant. This closes the foreign-registration IDOR and lock-time ownership race.

The five replacements preserve the exact PostgreSQL signatures, result types, owner, SECURITY DEFINER mode, and existing role grants.

## Disposable PostgreSQL 17.6 runtime evidence

The Tranche 16 fixture is part of `scripts/auth-migration/stage3-issuer-guard-regression.sql`. It uses synthetic organizer, competition, registration, and Better Auth identity fixtures within the regression transaction, which ends with `RESET ROLE; ROLLBACK;`.

1. **Legacy Supabase Auth issuer denied:** all five RPCs reject the legacy Supabase issuer before their protected access path.
2. **Unrelated Better Auth user denied:** a separate Better Auth UUID cannot obtain an organizer result overview, list another organizer's registrations, review a foreign registration, select another organizer's plan, or submit a custom-plan request for a foreign organizer.
3. **Authorized organizer positive paths:** the synthetic owner can read their organizer result overview and registrations, review an owned registration, select the permitted FREE plan, and submit a custom-plan request for their own organizer.
4. **Authorized Admin positive paths:** a Better Auth Admin can use all five functions across the synthetic organizer/registration fixture.
5. **Registration review race boundary:** the source replacement checks ownership before the row lock and rechecks the organizer scope after acquiring the lock; only the authorized row may be updated.
6. **Rollback-only data:** all test identities and business rows are synthetic. The fixture does not import accounts or application data from Production and all writes are rolled back.

PR #345 also added negative IDOR coverage for `get_follow_status` and private/unpublished `get_competition_participant_detail`, and verifies the verified-referral read has no anon EXECUTE. Those are additional regression protections, but are not included in this five-signature tranche count.

## PR, baseline and CI

- PR [#345](https://github.com/taufx98/sykabelajar4.0/pull/345) merged the Tranche 16 social/referral and cross-organizer regression additions as `569dca1b727c7e2967a92507c86cfa49e8bb23de`.
- PR [#346](https://github.com/taufx98/sykabelajar4.0/pull/346) added voucher trigger lifecycle acceptance and merged as `0e2a5a30ed60ed3c6075f8ac42e12c1ceda00176`.
- Auth Schema PR Contracts [#46000364001](https://github.com/taufx98/sykabelajar4.0/actions/runs/46000364001), Auth Worker CI [#46000363919](https://github.com/taufx98/sykabelajar4.0/actions/runs/46000363919), and Supabase Local Auth Claims CI [#46000363893](https://github.com/taufx98/sykabelajar4.0/actions/runs/46000363893) passed for the Tranche 16 regression PR.
- Auth Schema PR Contracts [#46000808535](https://github.com/taufx98/sykabelajar4.0/actions/runs/46000808535), Auth Worker CI [#46000808532](https://github.com/taufx98/sykabelajar4.0/actions/runs/46000808532), and Supabase Local Auth Claims CI [#46000808567](https://github.com/taufx98/sykabelajar4.0/actions/runs/46000808567) passed for the voucher trigger lifecycle regression.
- Protected Auth Production Schema Baseline [#46001136856](https://github.com/taufx98/sykabelajar4.0/actions/runs/46001136856) passed **78/78 steps** on commit `0e2a5a30ed60ed3c6075f8ac42e12c1ceda00176`. It included schema-only Production export, exact Stage 3 source/metadata preflight and application, Tranche 16 legacy/owner/Admin runtime regression, Stage 7 payment/voucher owner and trigger lifecycle acceptance, all 23 direct table RLS/ACL boundaries, all 14 portal invalid-token cases, 69-FK and complete Stage 3 rollback, portal/password selector tests, and two-user Cloudinary/payment Edge integration. The disposable database and schema export were removed.
- Supabase Local Auth Claims CI [#46001136934](https://github.com/taufx98/sykabelajar4.0/actions/runs/46001136934) passed **23/23**.

The baseline exported Production schema/catalog metadata read-only and applied all draft changes only to the disposable restore. No Production DDL/DML, grant/policy edit, account/data import, Worker deployment, DNS change, or secret change was performed.

## Count and remaining gate

Previous accepted unique manual review: **73/202** (Tranches 01–15, including the reconciled Tranches 06–10 record).  
Tranche 16 accepted signatures: **5**.  
**Cumulative accepted manual review: 78/202 exact signatures; 124 remain.**

This is partial per-function source/runtime evidence only. The canonical all-functions activation manifest remains `status: blocked` with `reviewedAuthenticatedFunctionCount: 0`. The complete 202-function classification and class-specific evidence are not finished. Production DB2 remains **NO-GO**.
