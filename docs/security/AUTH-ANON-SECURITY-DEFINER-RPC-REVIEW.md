# Anonymous SECURITY DEFINER RPC review — Stage 5

Audit date: 6 November 2026  
Source: read-only PostgreSQL catalog, function-definition and privilege inspection against the production project. No RPC was executed as a test user, no row data was queried for this review, and no production grants, functions, policies or tables were changed.

## Snapshot

The 6 November Security Advisor reported 46 functions in the exposed `public` schema that are executable by `anon` and marked `SECURITY DEFINER`. The same snapshot reported 202 callable by `authenticated`. These are ACL/advisor counts, not a count of 46 confirmed vulnerabilities. Because the functions execute with owner privileges, every anonymous entry point must enforce its own input, publication, ownership, one-time token or business-role boundary.

All 46 reviewed definitions have an explicit fixed `search_path` setting, and the static first-pass scan found no dynamic SQL execution in these definitions. This reduces search-path/dynamic-query risk but does not prove the authorization logic safe.

## Triage by intended caller

### 1. Admin-only operations — anonymous grant should not be part of the contract

These four functions contain explicit authenticated/admin guards, but the current ACL still allows an anonymous role to reach the function entry point and rely on the function body to reject it:

- `admin_diagnose_organizer_voucher_delete(uuid)`
- `admin_evaluate_badges()`
- `admin_update_system_error_status(uuid,text,text)`
- `reopen_system_error_incident(uuid,text)`

The bodies check `auth.uid()` and/or the private badge/admin guard. Their grants should be tightened to authenticated/service-only in a reviewed migration after confirming all callers. Do not change production grants as part of this audit.

### 2. Signed-in, user-specific operations — review ACL and identity semantics

- `get_follow_status(uuid,uuid)` checks a non-null caller and owner/endpoint/admin relation.
- `get_my_verified_referrals()` filters by `auth.uid()`, but directly joins `auth.users`; it must be redesigned in Stage 3 and should not be treated as a general anonymous endpoint.
- `get_profile_connections(uuid,text)` has a confirmed private-profile/NULL-semantics flaw described below.
- `get_public_profile_social(uuid)` requires a signed-in caller but historically omitted the requested profile's visibility/ownership check; this is included in the same confirmed profile-privacy fix.
- `get_public_feed(integer,timestamptz)` deliberately permits public feed reads and makes the per-user `liked` flag false for anonymous users. Preserve that distinction.
- `get_competition_participant_detail(text,uuid)` allows anonymous detail only when the competition is PUBLIC and results are RESULT_PUBLISHED/ARCHIVED; before publication it requires an authenticated admin or authorized competition editor. Public response includes participant display fields, while score/duration/question summary are only returned after the publication gate. Badge collection uses profile visibility, awards require PUBLIC visibility, and certificates require PUBLISHED status.
- `get_public_profile_badge_visibility(uuid)`, `get_public_profile_badges(uuid)`, and `get_public_profile_ui_settings(uuid)` return a public projection only for the profile owner/admin or a profile meeting the respective public/visibility settings.
- `is_public_profile_admin(uuid)` is a public visibility predicate, not an admin mutation endpoint.

### 3. Intentional guest participant/portal APIs — token-authenticated, not user-JWT APIs

These functions intentionally accept `anon` because collective participants and school portals can use a separate password/session flow. Their security boundary is a high-entropy bearer token, token hash, expiry, revocation and participant/session binding—not a Supabase user UUID.

- `answer_collective_linear_exam_question(uuid,text,uuid,jsonb,boolean)`
- `choose_collective_linear_exam_timeout(uuid,text,text)`
- `get_collective_linear_exam_state(uuid,text)`
- `get_collective_participant_certificate(text)`
- `get_collective_participant_result(text)`
- `list_collective_portal_competitions(text)`
- `open_collective_competition_session(text,uuid,text)`
- `resolve_collective_linear_exam_timeout(uuid,text)`
- `revoke_collective_access_session(text)`
- `revoke_collective_portal_session(text)`
- `save_collective_linear_exam_draft(uuid,text,uuid,jsonb)`
- `skip_collective_linear_exam_question(uuid,text)`
- `start_collective_linear_exam_attempt(uuid,text)`
- `verify_collective_participant_access(text,text)`
- `verify_collective_portal_password(text)`

The exam state/answer/skip/timeout functions call `private.assert_collective_linear_exam_access`; the portal/session functions validate the hashed token, expiry, revocation and linked identity/participant. Password verification applies failed-attempt lockout. The legacy participant-password verifier currently returns `LEGACY_FLOW_DISABLED`. These guest endpoints must remain separately tested when the user issuer changes; do not replace their token contract with a Supabase user JWT or revoke them indiscriminately.

### 4. Public read/telemetry functions — preserve only their intentionally published projection

- `get_certificate_verification(text)`
- `get_home_snapshot(integer)`
- `get_platform_stats()`
- `get_public_coin_leaderboard(integer)`
- `get_public_collective_certificate(text)`
- `get_public_competition_detail_summary(uuid)`
- `get_public_competition_participants(text,integer,integer)`
- `get_public_competition_question_count(uuid)`
- `get_public_competition_results(text,integer,integer)`
- `get_public_competitions(integer)`
- `get_public_leaderboard(integer)`
- `get_public_leaderboard_enriched(text,integer)`
- `get_public_school_leaderboard(text,integer)`
- `list_active_shop_promo_banners()`
- `list_public_commerce_product_sales_counts()`
- `record_shop_promo_banner_event(uuid,text,text)`
- `sync_competition_registration_status(uuid)`

The public competition list/detail/roster/leaderboard helpers filter to published/public records and bound result/limit fields; public results require a PUBLIC competition in RESULT_PUBLISHED/ARCHIVED. Public certificate endpoints are verification-code projections. Shop banner listing returns active banners only; event recording validates event type and visitor-key format and deduplicates by banner/event/visitor. `sync_competition_registration_status` can only perform timestamp-driven registration state transitions and does not accept an arbitrary target status.

**Data-minimisation item requiring product review:** `get_public_competition_results` currently includes `participant_code` in its public JSON and `CompetitionResultsPage` renders it. The collective portal also uses a participant code as one input when opening a participant session after the portal token is authenticated. This review does not prove a direct compromise, but publicly displaying that second-step identifier weakens its secrecy. Evaluate removing/masking it from public results while preserving legitimate organizer/teacher and collective portal flows. No code or production data was changed for this item.

## Confirmed profile privacy issue and existing fix

Production `get_profile_connections(uuid,text)` used `auth.uid() <> p_profile_id`; for an anonymous caller, `auth.uid()` is NULL and the IF condition can evaluate NULL rather than true. The old function also failed to enforce `profiles.is_public` inside its SECURITY DEFINER body. The paired `get_public_profile_social(uuid)` projection also needed a private-profile check.

PR [#174](https://github.com/taufx98/sykabelajar4.0/pull/174) prepares the fix: `IS DISTINCT FROM` for NULL-safe owner checks, public-profile enforcement, settings-aware visibility, empty search_path/schema-qualified references and explicit anonymous ACL removal for the social-summary RPC. Its CI passed [#41767330665](https://github.com/taufx98/sykabelajar4.0/actions/runs/41767330665), but the PR remains Draft/unmerged and still requires isolated PostgreSQL integration validation. Treat this as a Stage 5 prerequisite; do not claim production is already fixed.

## Separate RLS-with-no-policy finding

The current advisor lists 23 RLS-enabled tables without policies. A read-only privilege check found 20 do not grant SELECT/INSERT to `anon` or `authenticated`; three tables (`public.competition_status_history`, `public.notification_deliveries`, `public.supabase_system_logs`) have table grants but still have zero policies, so RLS remains default-deny for those API roles. This is not proof of exposure. Keep service-role/server-side paths intact and review each table's actual intended read/write path before adding a policy.

## Stage 5 acceptance requirements

1. Test every admin-only entry point with anon, ordinary authenticated, inactive admin and active admin identities.
2. Test all guest participant/portal endpoints with missing, wrong, expired, revoked, cross-participant and valid tokens; include replay/idempotency where the operation mutates state.
3. Test public read RPCs against private/draft/unpublished data and ensure the response contains only the approved public projection.
4. Close the profile privacy issue through PR #174 after isolated PostgreSQL validation.
5. Review and, where intended, remove anonymous ACLs for signed-in-only RPCs; preserve intentionally public endpoints.
6. Test the Better Auth issuer's verified UUID subject, issuer and audience, RLS/IDOR and business-role boundaries in an isolated hosted Supabase project before any production function/grant/policy change.

No grants, policies, schema, Edge Functions or data were modified by this review.
