# SykaBelajar 4.0 — Baseline Audit

Date: 2026-09-02
Repository baseline: `main`
Latest observed commit: `6fba9743b5c8238c208d71a6f54f42ded2e11b73`

## Scope
This baseline records the current architecture before refactoring. No production data/schema was changed by this baseline step.

## Hosting / Application
- Frontend: React 18 + TypeScript + Vite 6
- Router: react-router-dom 7
- Build target: Vite
- Repository: `taufx98/sykabelajar4.0`
- Default branch: `main`
- GitHub Actions workflows include deployment and chat-media cleanup.

## Frontend structure observed
- `src/pages`
- `src/components`
- `src/hooks`
- `src/services`
- `src/store`
- `src/types`
- `src/lib`
- `src/data`

## Backend
Supabase project:
- Project ID: `jrfogwueytiddnanetth`
- Name: `sykabelajarid`
- Region: `ap-southeast-1`
- Status: ACTIVE_HEALTHY
- PostgreSQL 17.6.1

Observed domains include:
- Auth / profiles / roles
- Competitions / levels / rewards / registrations / attempts / grading
- Organizer / organizer members / organizer plans
- Certificates / verification / certificate assets
- Chat / media / threads / blocks / reads
- Commerce / orders / order items / products / benefits / entitlements
- Payments / payment intents / payment events
- Notifications / preferences / deliveries
- Referrals
- Daily check-in / daily tasks
- Edu Coin / XP
- Feature flags / settings
- Job processing (`job_runs`)

## Storage
Cloudinary is isolated behind `src/services/cloudinary.service.ts`.
Profile/cover uploads use a signed Edge Function flow; general image/raw uploads use Cloudinary upload presets.

## Payment
Current provider: Midtrans.
Current frontend payment integration is still provider-specific through `payment.service.ts` -> `midtrans-create-payment` Edge Function.

## Job system
`public.job_runs` already exists and includes queue-related indexes, retry fields, locking fields and idempotency/dedupe support.
Supabase Cron is active; observed job calls `verify_pending_referrals()` hourly.

## Database baseline
- Approximate database size: 16 MB
- Public tables observed: 80+ domain/system tables
- Public views observed: platform/admin/profile/leaderboard/certificate/organizer views
- RLS is enabled on essentially all public tables reviewed.
- Exceptions requiring review: `competition_status_history`, `notification_deliveries`, and `payment_events` have RLS enabled with zero policies.
- `private.organizer_access_codes` exists outside `public` and currently has RLS disabled.

## Current performance/security findings
- Multiple permissive RLS policies exist on a number of tables.
- Several RLS policies trigger `auth_rls_initplan` warnings.
- There are many unindexed foreign keys reported by the Supabase performance advisor.
- Multiple indexes are currently reported as unused; these are candidates for later verification, not immediate deletion.
- Supabase security advisor reports multiple SECURITY DEFINER functions executable by `anon` and/or `authenticated`; these require authorization review before cleanup.
- Several views are reported as SECURITY DEFINER and require explicit security-model review.

## Important current facts
- The earlier audit claiming missing indexes for `awards.user_id`, `certificates.user_id`, `registrations.user_id`, and `notifications.user_id` is outdated: these indexes already exist.
- The earlier audit claiming no job queue is outdated: `job_runs` and queue RPCs already exist.
- The earlier audit claiming `currency_adjustment_logs` and `certificate_assets` lack RLS is outdated: both currently have RLS enabled.

## Safety baseline
This phase did not alter:
- user data
- competition data
- registrations
- orders/payments
- certificates
- Cloudinary assets
- Supabase schema

Next phase: dependency mapping and usage tracing before any cleanup/refactor.
