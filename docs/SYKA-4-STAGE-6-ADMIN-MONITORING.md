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
- Migration syntax was validated in a production transaction and rolled back before rollout.
- Apply the migration only after the PR CI is green; then run the SQL contract and verify grants/trigger metadata.
