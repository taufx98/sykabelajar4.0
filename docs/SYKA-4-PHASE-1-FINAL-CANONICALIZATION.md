# SYKABELAJAR 4.0 — Phase 1 Final Canonicalization

Date: 2026-09-06
Status: COMPLETE

## Scope

Phase 1 establishes one canonical frontend implementation path per active user-facing feature and preserves the existing production runtime contract. This phase does not rewrite business logic, delete working features, or perform destructive database migrations.

## Canonical runtime

```text
src/main.tsx
  -> src/App.tsx
  -> route
  -> page
  -> domain service
  -> src/lib/supabase.ts
  -> Supabase RPC / tables / views
```

`src/App.tsx` is the authoritative route composition root. Active routes reference the canonical page filenames currently present in `src/pages`.

## Canonical page map

| Feature | Canonical implementation | Status |
| --- | --- | --- |
| Landing | `LandingPage.tsx` | active |
| Home | `HomePage.tsx` | active |
| Competition detail | `CompetitionDetailPage.tsx` | active |
| Competition work | `CompetitionWorkPage.tsx` | active |
| Daily tasks | `DailyTasksPage.tsx` | active |
| Leaderboard | `LeaderboardPage.tsx` | active |
| Profile | `ProfilePage.tsx` | active |
| Notifications | `NotificationsPage.tsx` | active |
| User messages | `MessagesPage.tsx` | active |
| Admin chat | `AdminChatConsolePage.tsx` | active |
| Organizer workspace | `OrganizerControlCenterPage.tsx` + feature pages | active |
| Certificate verification | `VerifyPage.tsx` | active |
| Certificate lifecycle | `CertificateLifecyclePage.tsx` | active |
| QR / serial | `OrganizerSerialsPage.tsx` | active |
| Teacher workspace | `GuruCollectivePage.tsx` + teacher feature pages | active |
| Collective participant | collective participant route/page set | active |

## Duplicate/versioned source policy

The formerly documented versioned candidates such as `ProfilePageV3.tsx`, `NotificationsPageV2.tsx`, `MessagesPageV6.tsx`, `LeaderboardPageV2.tsx`, `OrganizerPlanPageV2.tsx`, and the earlier admin-chat variants are not part of the current `main` source tree. Likewise, the documented temporary files are absent from the current tree.

No removal is performed by pattern matching alone. A future candidate must first be traced through routes, imports, adapters, build inputs, and runtime behavior before deletion or consolidation.

## Service / RPC canonicalization

The frontend uses domain services for affected business operations. Confirmed examples include:

- registration through `registration.service.ts` and the canonical `register_for_competition` RPC contract;
- organizer commerce through `commerce.service.ts` and the canonical `create_organizer_plan_order` contract;
- chat through `chat.service.ts` and its active thread/message primitives;
- platform reads through `platform.service.ts` rather than obsolete direct RPC aliases.

The confirmed legacy RPC removal migration remains append-only at:

`supabase/migrations/20260902060000_remove_confirmed_legacy_rpcs.sql`

It removes only the explicitly confirmed obsolete overloads and does not alter the active canonical contracts.

## Runtime safety rules

Phase 1 deliberately keeps the proven runtime behavior intact:

1. No mass deletion of source files.
2. No mass renaming based only on filename patterns.
3. No strict unused audit used as a reason to remove feature code.
4. No destructive replacement of production tables, participant identity, payment, certificate, grading, or chat infrastructure.
5. Migrations remain append-only deployment history.
6. Canonicalization is verified before any future cleanup is promoted.

## Verification

The repository CI now includes a report-only canonical source audit. The audit follows the runtime import graph from `src/main.tsx`, reports unreachable source candidates, and reports versioned/temp candidates without modifying or deleting runtime code.

Runtime CI remains the authoritative gate for:

- production Supabase target verification;
- lint;
- TypeScript typecheck;
- Vite production build;
- browser access-control E2E;
- production smoke tests.

Phase 1 exit is valid only when the latest CI for the Phase 1 commit is fully green and no runtime feature was removed or rewritten as a side effect of canonicalization.

## Result

Phase 1 canonicalization is complete on the current baseline. The repository has a single active route composition root and current canonical filenames, while confirmed legacy RPC aliases have an append-only removal record and future cleanup is explicitly constrained by reachability/behavior verification.
