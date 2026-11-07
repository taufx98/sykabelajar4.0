# Stage 3 RLS policy test matrix

Date: 7 November 2026  
Source: read-only production `pg_policies` metadata query against project `mvdczyitbkxkldjughor`.

## Baseline inventory

The production snapshot contains **109 policies across 61 tables** whose `USING` or `WITH CHECK` expression references `auth.uid()`. The policies are split across 108 public-schema policies and one private-schema policy.

| Policy pattern (lexical classification) | Policies | Tables | Description |
|---|---:|---:|---|
| Owner / self | 86 | 47 | Caller UUID is used for self-owned rows, ownership relationships, or caller-scoped access |
| Admin overlay | 22 | 17 | Expression includes `current_user_is_admin()` together with the row ownership rule |
| Public-or-owner | 1 | 1 | `public.profiles.profiles_public_read`; anon/authenticated can see public profiles while private profiles remain owner-scoped |
| **Total** | **109** | **61 unique tables** | Table counts by pattern overlap; the same table can have policies in more than one pattern |

The pattern labels are a review aid based on expression text, not a semantic proof that every policy is safe. Several policies combine an admin check with a row relationship, and some policies on the same table use different patterns.

Expression placement and command distribution from the catalog:
- `auth.uid()` appears in 90 `USING` expressions and 42 `WITH CHECK` expressions; some policies have both.
- SELECT: 55; INSERT: 19; UPDATE: 12; DELETE: 12; ALL: 11.
- No policy in this 109-policy set directly references `auth.users`.
- Do not mass-rewrite these policies merely because the identity issuer changes. The accepted Supabase JWT contract keeps the Better Auth UUID in `sub`, so `auth.uid()` must continue to resolve that UUID.

## Current rollback-only production-shaped regression coverage

The current local disposable-schema regression is `scripts/auth-migration/stage3-production-schema-regression.sql`. It executes after a full schema-only restore and production ACL parity, uses fixed synthetic UUIDs with collision checks, and rolls back the entire transaction.

| Domain / pattern | Current assertion | Coverage status |
|---|---|---|
| `profiles` owner/self | Owner reads own private profile; cross-user private profile is hidden; cross-user update changes zero rows | Covered |
| `profiles` public-or-owner | Anon cannot read private synthetic profiles; public legacy referral RPC is separately checked for no anon leakage | Partially covered; positive public-profile visibility needs an explicit case |
| Profile backend guards | Authenticated update of `edu_coin` or `account_type` is rejected with the production guard error | Covered |
| `user_roles` owner/self | User can read own role; related users' role rows remain hidden | Covered |
| `referral_events` owner/self | Referrer and referred user can see their own relationship; unrelated user is not part of the tested fixture | Representative coverage |
| `get_my_verified_referrals()` PUBLIC/anon grant | Referrer gets its own verified referral results; referred non-referrer and anon get zero rows | Covered |
| `user_settings` owner/self | Own theme update succeeds; cross-user update changes zero rows | Covered |
| `registrations` owner/self | Participant can read own registration; direct insert with forged `user_id` fails `AUTHORIZATION_REQUIRED` | Covered |
| `notifications` owner/self | Own read/update succeeds; cross-user update changes zero rows | Covered |
| `daily_checkins` owner/self | User sees own check-in row and not another user's row | Covered |
| `organizers` admin/owner overlay | Non-owner update is denied | Negative case covered; positive owner and admin cases remain |
| `create_organizer` authorization | Anon cannot execute; authenticated user still must satisfy business verification checks | Covered with function ACL and behavior checks |

The current set is representative, not exhaustive. It does **not** establish that all 109 policies pass under Better Auth JWTs.

## Required expansion before Stage 3 exit

Run positive and negative owner/admin/teacher/organizer/anon cases by material policy family, including at least:
1. Admin overlay: `orders`, `payment_intents`, `certificates`, `participants`, `attempts`, `user_roles`, `organizers`, and `registrations`. Test a real synthetic active admin role plus a normal user; do not rely on a caller-provided UUID.
2. Organizer scope: `organizer_custom_plan_requests`, `organizer_voucher_claims`, `participants`, collective sessions/participants/certificates, and organizer-owned competition resources. Test owner, active member with allowed role, inactive member, and unrelated organizer.
3. Teacher / roster scope: `teacher_rosters` and `roster_students`. Test roster owner, another teacher, student, and admin.
4. Commerce / payments: `orders`, `order_items`, `payment_intents`, `shipments`, `commerce_product_reviews`, wishlist and entitlements. Test order-owner visibility, admin overlay, and no cross-user reads or writes.
5. Exams / awards: `answers`, `attempts`, `participants`, `awards`, `certificates`, and certificate assets. Test participant/attempt ownership and admin/organizer access only where explicitly intended.
6. Public surfaces: public profile visibility, follows, chat media/read surfaces and any public content policy. Test anon vs private rows and preserve the independent product decision to retire private chat only after dependency/retention review.

For every tested table, preserve existing grants and the business-role checks. Do not add blanket policies, convert SECURITY DEFINER functions wholesale, or change a policy merely to make a synthetic test pass.

## Safety and completion gates

- Execute policy fixtures only on the disposable schema-only local Supabase restore.
- Include positive and negative cases with two or more synthetic users and role contexts.
- Verify forged `sub`, missing `sub`, wrong PostgreSQL role, and cross-tenant/organizer access where applicable.
- Keep the production issuer and all production RLS unchanged until the full behavior matrix, Stage 3 identity foundation, hosted OIDC/Storage/Realtime/Edge acceptance, and rollback rehearsal are approved.
