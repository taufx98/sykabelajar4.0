# SYKABELAJAR 4.0 — Stage 6: Admin Monitoring & Investigations

## Objective

Provide administrators with a read-only operational view across competitions and an evidence-based way to inspect official participant attempts, while preserving the canonical participant model and server-authoritative exam engine.

## Included

- Admin-only dashboard at `/admin/monitoring`.
- Cross-competition overview: competition lifecycle, canonical participants, official attempt states, active attempts, and open system incidents.
- Competition-level counts and organizer activity summary.
- Search/filter/pagination for official attempts; page size is 25 in the UI and the backend caps requests at 100.
- Attempt investigation timeline from `exam_attempt_events`, plus answer/skip/timeout counts from the immutable exam snapshot.
- Result score is withheld until competition status is `RESULT_PUBLISHED` or `ARCHIVED`.
- Before/after result snapshots for future official attempt score/status changes, written to the existing `audit_logs` table by a database trigger.
- Relevant existing `attempt.finalize`, `MANUAL_GRADING`, and competition publication history are surfaced as audit evidence.
- CSV export for the currently loaded attempt page, with spreadsheet-formula injection protection.
- Admin access is checked inside both RPCs; anonymous access is denied. Preview/simulation attempts are excluded at the backend.
- Investigation projection does not return question text, answer payloads, answer keys, or private question snapshots.
- Skip/timeout thresholds are review indicators only; they do not assert cheating and do not change scores, rankings, or account status.

## Reuse and boundaries

- Reuses canonical `participants`, `attempts`, `exam_attempt_runtime`, `exam_attempt_questions`, `exam_attempt_events`, `audit_logs`, `competition_status_history`, and existing system incident records.
- Does not call `get_linear_exam_activity`: that organizer RPC reconciles overdue timers as part of its read flow. Admin monitoring is intentionally read-only and must never advance or mutate a participant's exam.
- No second exam engine, participant identity store, or result/ranking store is introduced.
- Existing Error Intelligence and Admin Operations remain the system-error and general-operational audit workspaces; this page links to them instead of duplicating their workflows.
- The current database has no canonical participant complaint/appeal intake workflow or case table. This stage therefore exposes available investigation evidence and does not fabricate appeal cases or claim to manage a participant appeal lifecycle.

## Production data snapshot at implementation time

The live database had no non-preview official attempts and no `LIVE` competitions when the implementation was inspected. One preview attempt and its event trail existed. The new dashboard deliberately excludes that preview data, so an empty official-attempt list is expected until real official attempts exist. No production participant, attempt, answer, score, or ranking rows were inserted or changed by the dashboard.

## Migration and verification

- Migration: `supabase/migrations/20261101100000_stage_6_admin_monitoring_investigations.sql`.
- Read-only contract: `supabase/tests/admin_monitoring_stage6.sql`.
- Frontend contract: `npm run test:admin-monitoring-contract`.
- PR #152 merged to `main` in commit `d2d94bf9d878eb31f0af32095d79330c62ed9f31`.
- Production migration applied successfully to Supabase project `mvdczyitbkxkldjughor` on 1 November 2026.
- Read-only SQL contract passed. Both RPCs were verified as `SECURITY DEFINER`, pinned to an empty `search_path`, executable by `authenticated`, and not executable by `anon`. The result-audit trigger is enabled.
- Authenticated-admin runtime smoke test passed: dashboard returned three competitions, three canonical participants, two organizer summaries, 18 open system incidents, and zero official attempts. The only attempt present in the production snapshot was a preview; its investigation request correctly returned `ATTEMPT_NOT_FOUND`.
- PR CI run `#41231037820` and post-merge `main` CI run `#41231263003` both passed contract tests, lint, TypeScript, Vite build, performance asset budget, browser E2E access-control, and production smoke test.
- No participant, attempt, answer, score, or ranking rows were inserted or changed during rollout. The audit trigger records future official result/status changes only; it does not backfill historical snapshots.
- Cloudflare Pages production deployment is triggered separately; a trigger marker is added for this Stage 6 merge. The actual Cloudflare deployment state is not independently observable from the connected tools.
