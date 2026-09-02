# SykaBelajar 4.0 — Full End-to-End Stability & Egress Audit

Date: 2026-09-02

## Production objective

Priorities for the current architecture are: correctness first, route-local data loading, bounded payloads, no unnecessary polling, scoped realtime, no duplicate legacy/canonical calls, and server-authoritative mutations.

## Findings addressed

### Frontend / state

- Global runtime hydration was removed from `AppContext`. The provider no longer loads users, competitions, feed, orders, notifications, certificates, catalog, or daily tasks just because a session exists.
- Authentication bootstrap now loads only the current profile and effective roles, plus the legacy awards collection that is still required by the current Awards page.
- Like/comment mutations no longer trigger a full runtime refresh.
- Auth route guards use already-hydrated context state instead of performing another Supabase auth/role query per protected route.
- Legacy context fields `feed` and `certificates` remain as empty compatibility surfaces so old consumers do not crash, while their heavy global loaders are not restored.

### Home / public content

- Home uses bounded platform loaders (`5` for compact side data and `15` for social posts) rather than large startup reads.
- Competition detail loads only the selected competition's own post instead of depending on global feed hydration.
- Platform public leaderboard/competition reads are cached in memory/session storage with short TTLs.

### Chat / realtime

- Support chat thread lookup is deferred until the widget is opened.
- Chat messages load only for the active thread.
- Realtime subscriptions are created only while the widget is actively viewing an open thread and are removed on cleanup.
- Background 3-second polling was removed.
- App-level chat unread state is refreshed only on initial authenticated use and local Syka events; there is no periodic background chat poll.
- The support ticket flow has one canonical RPC: `create_ticket_thread`. The old `create_support_ticket` RPC was removed from production.
- The support ticket RPC inserts the initial ticket message atomically, preventing the frontend from creating a duplicate first message.

### RPC / backend canonicalization

Confirmed canonical public versioned families currently exposed:

- `get_public_leaderboard_v2`
- `get_public_coin_leaderboard_v2`
- `register_for_competition_v4_8`
- `create_organizer_plan_order_v2`

Confirmed legacy families removed:

- `get_public_leaderboard`
- `get_public_coin_leaderboard`
- `register_for_competition`
- `create_organizer_plan_order`
- `get_or_create_support_thread`
- `get_public_profile_by_username`
- `get_name_change_cooldown`
- `get_display_name_cooldown`
- `create_support_ticket`

The production smoke test was also updated to the canonical leaderboard RPC so CI can catch a stale caller before deployment.

## Supabase egress policy now enforced by code

1. Never hydrate unrelated domains from the root provider.
2. Fetch route-local data only after the route is mounted.
3. Use narrow `select` projections.
4. Hard-cap list sizes at the service boundary.
5. Cache public, slowly-changing read models.
6. Do not refetch an entire page after a small mutation; update local state optimistically where safe.
7. No high-frequency polling for chat/unread state.
8. Scope Realtime filters to the current user or active thread.
9. Preserve server-authoritative RPCs for privileged/money/XP/certificate operations.
10. Never delete migration history; legacy removal is represented by append-only migrations.

## Backend security review notes

The Supabase advisor still reports expected `SECURITY DEFINER` execution warnings. These are not automatically defects: the platform uses server-side authorization inside privileged RPCs. They should be reviewed by function intent, not mass-revoked. Public read RPCs are intentionally callable anonymously where the landing/public app requires them.

The private identity-claim table and internal event/payment delivery tables report RLS-enabled-without-policy informational findings by design; they are not public data surfaces.

## Known remaining technical debt

- `OrganizerPage.tsx` remains reachable only through `/organizer/legacy` and should be migrated behind the canonical organizer workspace before deletion.
- Some active files still contain TypeScript `any`/hook-dependency lint warnings. These are cleanup debt, not suppressed errors.
- Some legacy runtime exports remain solely for compatibility and should be removed after all route consumers are migrated.
- Public competition retrieval is currently small in production, but a future paginated/limited DB RPC should replace any unbounded public competition RPC before the dataset grows substantially.
- Exact Supabase egress bytes must be tracked from the Supabase usage dashboard; the code audit can prove request-path reduction but does not itself expose the dashboard's byte counter.

## Verification

The CI workflow must remain green on `main` with lint, typecheck, production build, and production smoke test. Warnings may remain during debt cleanup, but production-blocking errors must remain zero.
