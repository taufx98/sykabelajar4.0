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
| `profiles` public-or-owner | Anon reads one explicitly public synthetic profile and cannot read private profiles; the public legacy referral RPC returns no referral rows to anon | Covered |
| Profile backend guards | Authenticated update of `edu_coin` or `account_type` is rejected with the production guard error | Covered |
| `user_roles` owner/self and admin overlay | User can read own role; related role rows remain hidden; a trusted synthetic admin can read the test roles | Covered for owner and representative admin overlay |
| `referral_events` owner/self | Referrer and referred user can see their own relationship; unrelated user is not part of the tested fixture | Representative coverage |
| `get_my_verified_referrals()` PUBLIC/anon grant | Referrer gets its own verified referral results; referred non-referrer and anon get zero rows | Covered |
| `user_settings` owner/self | Own theme update succeeds; cross-user update changes zero rows | Covered |
| `registrations` owner/self | Participant can read own registration; direct insert with forged `user_id` fails `AUTHORIZATION_REQUIRED` | Covered |
| `notifications` owner/self | Own read/update succeeds; cross-user update changes zero rows | Covered |
| `orders`, `order_items`, `payment_intents`, `shipments` owner/admin | Order owner reads linked commerce rows; unrelated user sees none; admin reads and updates order/payment/shipment metadata | Covered for representative owner/admin policies |
| `payment_events` admin overlay | Order owner cannot read payment events; trusted admin can read the synthetic event | Covered |
| `participants`, `attempts` owner/admin | Individual participant sees own canonical participant and active attempt; another user cannot read the attempt; admin can read it | Covered for the individual participant path |
| `teacher_rosters`, `roster_students` owner/admin | Active teacher owns a roster and external roster student; unrelated student cannot read it; admin can read both | Covered for owner, student denial, and admin overlay |
| `collective_participants` manager/owner/admin | Active teacher can create/update a collective participant from their own external roster; canonical sync preserves `user_id IS NULL`; unrelated student cannot read/create managed rows; admin can read | Covered for manager, student denial and admin overlay |
| `daily_checkins` owner/self | User sees own check-in row and not another user's row | Covered |
| Exam answers | Participant reads their own active-attempt answer, not another attempt's answer; admin can read a submitted answer but not the live in-progress answer | Covered for individual attempts and result-publication boundary |
| Awards and certificates | Owner and admin can read the synthetic award/certificate; certificate creation must pass the organizer's FREE-plan entitlement guard | Covered for owner/admin read and entitlement gate |
| Certificate asset table grants | `certificate_assets` has no direct SELECT grant for anon/authenticated; user-facing access stays behind server-side/service-role path | Grant boundary verified; RLS policy is defense in depth |
| Wishlist and plan entitlements | User can add/read own wishlist item for an active product; cross-user insertion is denied; plan entitlements are readable to authenticated users but only admin can update | Covered for representative owner/admin paths |
| Product reviews | Public SELECT columns are readable; no direct anon/authenticated INSERT/UPDATE grants are present | Read grant and write boundary verified; verified-purchase write policy is not behavior-tested through direct PostgREST |
| Public feed/comments/follows | Anon sees published posts/comments but not drafts/hidden comments; follows are visible only to the follower/followed user, never anon | Covered for published/hidden and relationship visibility |
| `organizers`, `organizer_plans`, `organizer_members` owner/member/admin | Owner can manage; active viewer member can read plan/member resources but cannot manage; inactive viewer and unrelated user see none; admin can update organizer | Covered for owner, active/inactive viewer, unrelated user and admin representative cases |
| `create_organizer` authorization | Anon cannot execute; authenticated user still must satisfy business verification checks | Covered with function ACL and behavior checks |

The current set is representative, not exhaustive. It does **not** establish that all 109 policies pass under Better Auth JWTs.

## Required expansion before Stage 3 exit

Run positive and negative owner/admin/teacher/organizer/anon cases by material policy family, including at least:
1. Admin overlay: representative tests now cover `orders`, `order_items`, `payment_intents`, `payment_events`, `shipments`, `attempts`, `user_roles`, `audit_logs`, and `organizers`. Remaining admin coverage includes `certificates`, certificate assets, participants/collective participant access, `registrations`, badges/posts, and the other admin-gated application tables. Test a real synthetic active admin role plus a normal user; do not rely on a caller-provided UUID.
2. Organizer scope: owner, active viewer member, inactive viewer member, and unrelated user now have representative coverage for `organizers`, `organizer_plans`, and `organizer_members`. Still test allowed manager/editor roles, unrelated organizer rows in other workspaces, `organizer_custom_plan_requests`, `organizer_voucher_claims`, participants, collective sessions/participants/certificates, and organizer-owned competition resources.
3. Teacher / roster scope: `teacher_rosters`, `roster_students`, and `collective_participants` test owner, unrelated student denial, admin read, teacher-managed insert/update, and canonical sync without linking the external roster entry to a student account. Still test a second teacher, inactive teacher role, and collective registration/payment lifecycle.
4. Commerce / payments: `orders`, `order_items`, `payment_intents`, `payment_events`, and `shipments` have owner/admin tests. Wishlist owner insert/read and cross-user insert denial are covered. `plan_entitlements` read/admin-write boundaries are covered. Product reviews have public column-level SELECT and no direct user write grants; verified-purchase INSERT/UPDATE cannot be exercised through the current direct table grants and remains a backend/RPC acceptance item. Still test review mutation via its supported service path and other payment admin actions.
5. Exams / awards: `participants` and `attempts` now test individual participant ownership and admin visibility. Still test `answers`, collective attempts, awards, certificates, certificate assets, and organizer access only where explicitly intended.
6. Public surfaces: public/private profiles, published/draft posts, published/hidden comments, and follower/followed relationship reads now have anon/user checks. Private-chat media/read surfaces remain a separate retirement/retention audit; do not reintroduce chat or delete history while testing comment policies.

For every tested table, preserve existing grants and the business-role checks. Do not add blanket policies, convert SECURITY DEFINER functions wholesale, or change a policy merely to make a synthetic test pass.

## Safety and completion gates

- Execute policy fixtures only on the disposable schema-only local Supabase restore.
- Include positive and negative cases with two or more synthetic users and role contexts.
- Verify forged `sub`, missing `sub`, wrong PostgreSQL role, and cross-tenant/organizer access where applicable.
- Keep the production issuer and all production RLS unchanged until the full behavior matrix, Stage 3 identity foundation, hosted OIDC/Storage/Realtime/Edge acceptance, and rollback rehearsal are approved.
