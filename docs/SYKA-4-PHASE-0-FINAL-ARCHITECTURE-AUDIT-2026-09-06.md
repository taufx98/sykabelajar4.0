# SYKABELAJAR 4.0 — Phase 0 Final Architecture Audit

Date: 2026-09-06
Status: COMPLETE AUDIT / NO RUNTIME REFACTOR IN THIS PHASE

## Source of truth

- Production web: `https://sykabelajar.my.id`
- GitHub: `taufx98/sykabelajar4.0`
- Branch: `main`
- Supabase project: `mvdczyitbkxkldjughor` (`sykabelajar_db2`)
- Supabase region: `ap-southeast-1`
- Cloudinary cloud name configured by the repository: `sykabelajar`

## Current runtime shape

```text
Browser
  -> src/main.tsx
  -> src/App.tsx
  -> AppProvider / Router / shared shells
  -> page
  -> src/services/*
  -> src/lib/supabase.ts
  -> Supabase RPC / tables / views
  -> RLS / privileged functions
```

Cloudinary signed upload infrastructure is routed through the Supabase Edge Function path when configured. GitHub Actions is the CI gate for lint, typecheck, build, and production smoke test.

## What is already structurally healthy

- Route-local data loading and bounded payload discipline are established.
- Global runtime hydration was intentionally removed from the root provider.
- Chat background polling was removed; realtime is scoped to active usage.
- Service layer already exists and is split by business area.
- Organizer, competition, assessment, grading, commerce, certificate, chat, notification, gamification, and admin infrastructure are already present.
- Error Intelligence / RPC recovery infrastructure is real and must be preserved as core platform infrastructure.
- CI currently validates the production Supabase target before build.

## Canonicalization findings

### Versioned page files still present

Observed in `src/pages`:

- `AdminChatConsolePageV2.tsx`
- `AdminChatConsolePageV3.tsx`
- `AdminPlanUsagePageV2.tsx`
- `MessagesPageV6.tsx`
- `NotificationsPageV2.tsx`
- `OrganizerPlanPageV2.tsx`
- `ProfilePageV3.tsx`
- `ProfilePageV4.tsx`

Additional legacy page families already documented include non-versioned predecessors such as `MessagesPage.tsx`, `NotificationsPage.tsx`, `ProfilePage.tsx`, `AdminChatPage.tsx`, `LeaderboardPageV2.tsx`, and the explicit legacy `OrganizerPage.tsx` route.

These are **cleanup candidates, not automatic deletions**. Each must first be traced from every caller/route/adapter, then consolidated into one canonical filename and implementation.

### Obvious temporary files present

- `src/pages/AdminPage.tsx.tmp`
- `src/pages/AdminUsernameMove.tmp`

These are strong removal candidates after confirming they are not build/runtime inputs.

### Service layer

Current services are already separated by domain, including auth, profile, role, competition, registration, assessment, grading, organizer, entitlement, serials, commerce, payment, certificate, chat, notification, social, Cloudinary, platform, runtime, ads, and daily tasks.

The next canonicalization phase should **consolidate responsibilities rather than explode the number of files**. The rule is one clear responsibility per module, not one tiny file per helper.

## Current router findings

`src/App.tsx` is the composition root. Current first-class role guards cover `admin` and `organizer_member` only.

Current user-facing competition flow is built around authenticated accounts. There is no first-class router/domain for:

- Guru workspace
- Student roster
- Collective participant portal
- Two-layer collective access
- Teacher monitoring
- Competition group chat

These are planned architecture gaps, not dead code.

## Supabase production findings

Production schema contains core tables for users, roles, organizers, organizer members, competitions, registrations, attempts, answers, grading, question banks, certificates, certificate assets, certificate verification, orders, order items, payment intents/events, plans/entitlements, chat, notifications, social, gamification, jobs, and system logs.

No first-class public tables were found for the future teacher/collective domains searched during this audit:

- participant
- student
- teacher
- class
- collective access

Therefore the Participant abstraction must be introduced deliberately before implementing collective participation features.

## RPC findings

Production currently contains both canonical and versioned families. Confirmed examples:

- `get_public_competitions`
- `get_public_competitions_v2`
- `get_public_competitions_v3`
- `get_public_feed_v2`
- `get_public_feed_v3`
- `load_my_threads`
- `load_my_threads_v2`
- `create_organizer_plan_order_v2`
- `create_organizer_plan_order_v3`
- `register_for_competition_v4_8`
- `get_home_snapshot_v1`

This proves the earlier backend cleanup is not yet a final canonical state. Before removing any versioned RPC, caller and migration dependency tracing is required.

`validate_organizer_voucher` is overloaded by argument signature; this is not automatically wrong, but its public contract should be simplified/documented during canonicalization.

## Security / privilege findings

Privileged `SECURITY DEFINER` functions are heavily used for server-authoritative mutations and internal guards. They must be reviewed by intent, not mass-revoked.

Private schema helper functions and internal tables exist for organizer access, identity claims, authorization, entitlement guards, audit writing, and runtime/error recovery.

The next hardening pass must preserve these boundaries while ensuring public RPC exposure, ownership checks, and RLS remain explicit.

## Error Intelligence / egress baseline

The platform already enforces these principles and they are part of the target architecture:

1. No unrelated global hydration.
2. Route-local reads.
3. Narrow selects.
4. Bounded list sizes.
5. Short-lived caching for suitable public data.
6. Local optimistic updates where safe instead of full-page refetch.
7. No high-frequency chat polling.
8. Scoped realtime filters.
9. Server-authoritative privileged/money/certificate mutations.
10. Append-only migration history.

Future Error Intelligence upgrades should add request deduplication, retry classification, backoff, circuit breaking, freshness-aware caching, and egress-aware telemetry without removing the current recovery infrastructure.

## Target final architecture decision

SYKABELAJAR must move toward:

```text
Identity
  -> Roles / Context
  -> Organization
  -> Domain Services
  -> Canonical RPCs
  -> Database
```

with one canonical implementation per business action and no permanent `V1/V2/V3/...` naming.

The final platform participant model is:

```text
Participant
  -> Full Account (`user_id` present)
  -> Collective Participant (`user_id` nullable)
```

Both must share registration, attempt, result, certificate, and verification lifecycle contracts.

## Phase 0 exit criteria

- Production repository/source of truth verified.
- Frontend entrypoint/router/services mapped.
- Versioned/legacy page candidates identified.
- Temporary files identified.
- Production Supabase tables and RPC surface inspected.
- Error Intelligence/egress infrastructure explicitly protected as core.
- Missing Guru/Collective/Participant database domains confirmed.
- No runtime behavior changed by Phase 0.
- Baseline is ready for Phase 1: Canonical Frontend + RPC/DB consolidation.
