# Phase 05 — Dependency Mapping & Usage Tracing

## Status
CLOSED

Phase 5 is intentionally an audit/mapping phase. No runtime behavior, production data, or database schema was changed by this phase.

## Entry Points

- `src/main.tsx` is the React bootstrap entry.
- `src/App.tsx` is the application/router composition root.
- `App.tsx` mounts `AppProvider`, `BrowserRouter`, global mobile navigation, chat bridge, routes, and toast container.
- Public entry routes: `/`, `/register`, `/login`, `/verify/:code`.
- Authenticated application routes are guarded by `AuthGuard` and `AppLayout`.
- Admin routes are guarded by `RoleRoute(role="admin")`.
- Organizer routes are guarded by `RoleRoute(role="organizer_member")` and `OrganizerShell`.

## Runtime Layer Map

```text
Browser
  -> src/main.tsx
  -> src/App.tsx
  -> AppProvider / Router / global UI
  -> page component
  -> service layer (src/services/*)
  -> Supabase client (src/lib/supabase.ts)
  -> Supabase RPC / table / view
  -> database policies + functions

Special infrastructure paths:
  page/service -> Cloudinary service -> signed Edge Function
  scheduled jobs -> Supabase Cron -> database job functions
```

## Core Frontend Dependency Boundaries

### `src/pages`
Page-level composition and user interaction. Pages should call the service layer for reusable business operations; direct Supabase usage remains present in several legacy/domain pages and should not be mass-rewritten during lint cleanup.

### `src/services`
Current domain/service boundary includes:

- authentication/profile: `auth.service.ts`, `profile.service.ts`, `role.service.ts`
- competitions/assessment: `competition.service.ts`, `registration.service.ts`, `assessment.service.ts`, `manualGrading.service.ts`
- organizer: `organizer.service.ts`, `organizerAuth.service.ts`, `organizerCompetition.service.ts`, `organizerEntitlement.service.ts`, `organizerSerial.service.ts`
- commerce/payment: `commerce.service.ts`, `payment.service.ts`
- certificates: `certificate.service.ts`
- communications: `chat.service.ts`, `chatMedia.service.ts`, `notification.service.ts`, `social.service.ts`
- platform/runtime: `platform.service.ts`, `runtime.service.ts`
- media: `cloudinary.service.ts`
- admin: `adminCore.service.ts`, `adminCurrency.service.ts`
- supporting features: `ad.service.ts`, `daily-task.service.ts`

### `src/lib`
Shared infrastructure:

- `supabase.ts` — Supabase client
- `env.ts` — environment/config access
- `realtimeBus.ts` — realtime event bridge
- `toast.ts` — toast abstraction
- `utils.ts` — general utilities

### `src/store`
`AppContext.tsx` is the global application/session state boundary and is consumed by the router, layout, pages, and selected UI components.

### `src/components`
Shared UI/layout primitives. `App.tsx` confirms the global structural components currently in use are `AppLayout`, `MobileNavigationOverride`, `OrganizerShell`, `ChatUXBridge`, and `ToastContainer`.

## Active Route Mapping Highlights

The current router explicitly uses:

- profile: `ProfilePageV3`
- notifications: `NotificationsPageV2`
- messages: `MessagesPageV3`
- leaderboard: `LeaderboardPage`
- organizer workspace: `OrganizerControlCenterPage` plus the organizer feature pages
- admin: `AdminControlCenterPage` plus the separate admin feature pages
- certificate verification: `VerifyPage`
- certificate lifecycle: `CertificateLifecyclePage`
- QR/serial management: `OrganizerSerialsPage`

## Legacy / Adapter Candidates Identified

These files exist in the repository but are not direct routes in `src/App.tsx`:

- `src/pages/ProfilePage.tsx`
- `src/pages/MessagesPage.tsx`
- `src/pages/AdminChatPage.tsx`
- `src/pages/AdminChatPageV2.tsx`
- `src/pages/LeaderboardPageV2.tsx`
- `src/pages/NotificationsPage.tsx`

They are **not deleted in Phase 5**. Their absence from the main router only establishes them as cleanup candidates that require import/reference tracing before removal.

Important adapter finding:

- `MessagesPageV3.tsx` is intentionally active and dispatches between `AdminChatConsolePage` and `MessagesPageV6.tsx`; therefore the underlying `MessagesPageV6.tsx` is still a live dependency.

`OrganizerPage.tsx` is also retained because `/organizer/legacy` is an explicit route. It must not be classified as dead code until that compatibility route is intentionally removed.

## Dependency / Cleanup Rules Established

1. Do not delete a `V2/V3/V6` file solely because another version exists.
2. Remove a page only after confirming it is not imported by another adapter/wrapper and is not reachable by an explicit route.
3. Do not rewrite page-to-Supabase access solely for lint cleanup; lint cleanup should preserve behavior.
4. Do not remove a service because it has few imports without tracing its exported functions and route-level usage.
5. Database RPCs/functions are a separate dependency surface from frontend imports and must be reviewed against migrations before deletion.
6. `supabase/functions/get-cloudinary-signature` is a live infrastructure dependency for signed Cloudinary profile/cover uploads and is not frontend dead code.
7. `scripts/rpd-smoke.mjs` and GitHub workflow files are operational tooling, not application dead code.
8. Blogger XML files are deployment/content artifacts and are outside frontend lint cleanup scope.

## High-Risk Areas for the Next Cleanup Phase

- Versioned page families (`ProfilePage*`, `MessagesPage*`, `LeaderboardPage*`, `NotificationsPage*`).
- Direct `supabase.from(...)` / `supabase.rpc(...)` usage inside pages.
- Large admin pages containing legacy helpers or inline query logic.
- Service functions whose exported API has drifted after earlier backend consolidation.
- Duplicate or historical Supabase migrations: migration files are append-only history and must not be deleted merely because a later migration supersedes behavior.

## Phase 5 Exit Criteria

- Application entry points identified.
- Route guards and route ownership identified.
- Service/infrastructure boundaries mapped.
- Active adapter/versioned pages distinguished from obvious non-routed legacy candidates.
- No destructive cleanup performed without usage tracing.
- Ready for the next phase: Config / Environment, followed only afterward by lint cleanup.
