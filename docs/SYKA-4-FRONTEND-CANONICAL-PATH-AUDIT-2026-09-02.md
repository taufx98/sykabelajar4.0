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

- `src/pages/MessagesPage.tsx`
- `src/pages/MessagesPageV3.tsx`
- `src/pages/NotificationsPage.tsx`
- `src/pages/ProfilePage.tsx`
- `src/pages/LeaderboardPageV2.tsx`
- `src/pages/AdminChatPage.tsx`
- `src/pages/AdminChatPageV2.tsx`

`/pesan` now points directly to `MessagesPageV6`.

## Service / RPC canonicalization

The confirmed legacy entry points were removed from the live database. Active frontend code now uses canonical service functions for the affected domains.

### Canonical platform reads

`platform.service.ts` owns public statistics, competitions, XP leaderboard, and EduCoin leaderboard reads with client caching. `HomePage.tsx` now uses `getPublicLeaderboard()` and `getPublicCoinLeaderboard()` rather than invoking legacy RPC names directly.

### Canonical registration / commerce

`registration.service.ts` uses `register_for_competition_v4_8()`.

`commerce.service.ts` uses `create_organizer_plan_order_v2()` with an explicit MONTHLY/YEARLY billing period.

### Canonical chat

`chat.service.ts` owns the active chat primitives. `AdminChatConsolePage.tsx` and `MessagesPageV6.tsx` use `loadChatMessagesPage()` directly. `ChatWidget.tsx` uses `createTicketThread()` for ticket creation and `loadChatMessagesPage()` for messages.

Obsolete chat aliases `loadMessages`, `loadMyMessages`, and `getOrCreateThread` were removed after their active callers were migrated.

### Confirmed legacy RPCs removed

- `get_public_leaderboard(integer)`
- `get_public_coin_leaderboard(integer)`
- `register_for_competition(uuid,text,uuid,text,boolean)`
- `create_organizer_plan_order(uuid,text,text,text,integer,integer,text,text)`
- `get_or_create_support_thread()`
- `get_public_profile_by_username(text)`
- `get_name_change_cooldown(uuid)`
- `get_display_name_cooldown(uuid)`

The database cleanup is recorded in `supabase/migrations/20260902060000_remove_confirmed_legacy_rpcs.sql`. A verification query after the migration returned zero matching legacy functions.

## Intentionally retained compatibility path

`src/pages/OrganizerPage.tsx` remains because `/organizer/legacy` is still an explicit route. It is the only currently identified page-level legacy route intentionally reachable and is the next deletion candidate after behavioral migration into the canonical organizer workspace.

## Backend / migration rule

Supabase migration files are append-only deployment history and are not deleted merely because a later migration supersedes their behavior.

## Verification rule

Before deleting any future page/service/RPC:

1. Confirm route ownership.
2. Confirm no adapter/wrapper imports the candidate.
3. Confirm the replacement preserves behavior.
4. Confirm no live database dependency remains.
5. Run lint, typecheck, production build, and smoke test.
