# SykaBelajar 4.0 — Frontend Canonical Path Audit

Date: 2026-09-02

## Purpose

Prevent duplicate/versioned frontend implementations from being loaded or maintained in parallel. Every user-facing feature must have one canonical route and one canonical implementation path unless a compatibility layer is explicitly justified.

## Canonical runtime entry

`src/main.tsx` → `src/App.tsx` → route → page → service → Supabase/Edge infrastructure.

`src/App.tsx` is the router composition root and is the authoritative source for reachable page implementations.

## Canonical page selections

| Feature | Canonical implementation | Decision |
| --- | --- | --- |
| Landing | `LandingPage.tsx` | active |
| Home | `HomePage.tsx` | active |
| Competition detail | `CompetitionDetailPage.tsx` | active |
| Competition work | `CompetitionWorkPage.tsx` | active |
| Daily tasks | `DailyTasksPage.tsx` | active |
| Leaderboard | `LeaderboardPage.tsx` | active; V2 removed |
| Profile | `ProfilePageV3.tsx` | active; old `ProfilePage.tsx` removed |
| Notifications | `NotificationsPageV2.tsx` | active; old `NotificationsPage.tsx` removed |
| User messages | `MessagesPageV6.tsx` | active; V3 adapter removed; old `MessagesPage.tsx` removed |
| Admin chat | `AdminChatConsolePage.tsx` | active; old `AdminChatPage*` removed |
| Organizer workspace | `OrganizerControlCenterPage.tsx` + feature pages | active |
| Certificate verification | `VerifyPage.tsx` | active |
| Certificate lifecycle | `CertificateLifecyclePage.tsx` | active |
| QR / serial | `OrganizerSerialsPage.tsx` | active |

## Removed redundant implementations

The following files were deleted after confirming they were not part of the canonical route graph:

- `src/pages/MessagesPage.tsx`
- `src/pages/MessagesPageV3.tsx`
- `src/pages/NotificationsPage.tsx`
- `src/pages/ProfilePage.tsx`
- `src/pages/LeaderboardPageV2.tsx`
- `src/pages/AdminChatPage.tsx`
- `src/pages/AdminChatPageV2.tsx`

`/pesan` now points directly to `MessagesPageV6`, so there is no intermediate V3 dispatcher.

## Service / RPC canonicalization

Active frontend service callers are now routed through canonical service APIs. In particular, `HomePage.tsx` uses `getPublicLeaderboard()` and `getPublicCoinLeaderboard()` instead of calling legacy leaderboard RPC names directly. The service layer remains the boundary for reusable platform reads.

Confirmed obsolete RPC entry points were removed from the live database and recorded in the repository migration:

- `get_public_leaderboard(integer)` → `get_public_leaderboard_v2(integer)` via `platform.service.ts`
- `get_public_coin_leaderboard(integer)` → `get_public_coin_leaderboard_v2(integer)` via `platform.service.ts`
- `register_for_competition(...)` → `register_for_competition_v4_8(...)` via `registration.service.ts`
- `create_organizer_plan_order(...)` → `create_organizer_plan_order_v2(...)` via `commerce.service.ts`
- `get_or_create_support_thread()` removed; current chat flow uses the explicit ticket/thread RPCs
- `get_public_profile_by_username(text)` removed; current profile flow uses the canonical profile service/table access
- `get_name_change_cooldown(uuid)` / `get_display_name_cooldown(uuid)` removed; current edit-profile flow computes the cooldown from the canonical profile record

The destructive database cleanup is represented by `supabase/migrations/20260902060000_remove_confirmed_legacy_rpcs.sql`.

## Intentionally retained compatibility path

`src/pages/OrganizerPage.tsx` remains because `/organizer/legacy` is still an explicit route. This is the only currently identified page-level legacy route that remains intentionally reachable. It must be migrated behind `/organizer` before deletion.

## Backend / migration rule

Supabase migration files are append-only deployment history. A later migration superseding an earlier migration does **not** make the earlier migration safe to delete from the repository. Frontend cleanup must not remove database migration history.

## Verification rule

Before deleting any future page/service/RPC:

1. Confirm route ownership in `src/App.tsx`.
2. Confirm no adapter/wrapper imports the candidate.
3. Confirm the replacement preserves all user-facing behavior.
4. Confirm no live database dependency remains.
5. Update the canonical path map.
6. Run lint, typecheck, production build, and smoke test.

## Next cleanup targets

The next audit target is service-level duplication that is not versioned by page name, especially direct table/RPC access duplicated across pages and any remaining service exports that have no live consumers. Lint warnings should continue to be cleaned without suppressing them.
