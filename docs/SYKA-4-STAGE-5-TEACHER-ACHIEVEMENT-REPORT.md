# SYKABELAJAR 4.0 — Stage 5: Teacher Achievement Report

## Objective

Provide teachers with one read-only report for the students in their existing managed rosters. The report combines participation progress, official published competition results, published certificates, and public awards without creating a parallel student or participant registry.

## Existing data reused

- `teacher_rosters` and `roster_students` remain the teacher-owned roster source.
- `collective_participants` remains the teacher-managed competition enrolment record.
- `participants` remains the canonical competition participant identity from Stage 1.
- `attempts` remains the official result source. The report follows Stage 3's latest-finalized, non-preview and competition-ranking contract.
- `participant_certificates` remains the unified certificate source.
- `awards` are included only when public and linked to an account that the teacher-managed enrolment already identifies.

## Changes

1. Add authenticated route `/guru/laporan` and a teacher feature navigation entry.
2. Add a read-only paginated RPC `get_teacher_achievement_report(limit, offset, search)`.
3. Show roster-level student totals, enrolments, published results, published certificates and public awards.
4. Provide each student's competition history and a CSV export of the current page/filter.
5. Keep the report separate from access-card credentials and live exam monitoring.

## Disclosure and authorization rules

- A caller must be authenticated and hold an active `teacher` or `admin` role.
- Student rows come only from rosters whose `teacher_user_id` equals `auth.uid()`.
- Competition enrolments additionally require `collective_participants.managed_by_user_id = auth.uid()`.
- Scores and ranks are omitted until a competition is `RESULT_PUBLISHED` or `ARCHIVED`.
- Only `FINALIZED` attempts with `is_preview = false` contribute to score/rank. Ranking is competition-wide and uses the Stage 3 `rank()` tie contract, not a teacher-only subset.
- Only certificates with status `PUBLISHED` are included.
- Only awards with `visibility = 'PUBLIC'` are included, and only for an account linked to one of that student's managed competition enrolments.
- The RPC is `SECURITY DEFINER` with an empty `search_path`, explicit owner scoping, a bounded page size (100), and execute permission granted only to `authenticated`.
- No phone numbers, emails, participant passwords, access tokens, answer data, or raw unpublished scores are returned.

## Migration and rollout

Migration: `supabase/migrations/20261101000100_stage_5_teacher_achievement_report.sql`

The migration adds one read-only RPC and grants; it creates no tables, changes no rows, and does not create any teacher/student/participant test records. The companion SQL regression script is `supabase/tests/teacher_achievement_report_stage5.sql` and inspects function definition, privileges, and existing RLS without inserting test data.

Production contains no active teacher rosters, roster students, collective participants, finalized collective attempts, or issued collective certificates at the time this stage was audited. The page will therefore show its empty state until real teacher-managed data exists. Do not seed fake records in production.

## Verification

- `npm run test:teacher-achievement-report-contract`
- `npm run lint`
- `npm run typecheck`
- `npm run build`
- `npm run test:performance-budget`
- Run the read-only SQL regression script after the migration is approved and applied.