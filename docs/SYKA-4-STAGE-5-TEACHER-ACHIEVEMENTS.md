# SYKABELAJAR 4.0 — Stage 5: Teacher Achievement Dashboard & Reports

## Objective

Give teachers a consolidated view of the competition outcomes and achievements of students they already manage. Reuse the existing teacher workspace, roster, collective participant, canonical participant, official attempt, and collective certificate records. This stage does not create a new student or participant identity system.

## Existing source of truth

- Teacher ownership: `collective_participants.managed_by_user_id`.
- Student and competition identity: existing `collective_participants` linked to canonical `participants`.
- Official exam outcomes: latest non-preview `attempts` row linked by `canonical_participant_id`.
- Rank: existing `private.canonical_competition_rank` helper.
- Certificate lifecycle: existing `collective_certificates` records.

The legacy free-text `profiles.pembina` field is not used for authorization or student discovery. It is not a verified teacher-student relationship.

## Included

1. New authenticated RPC `public.list_teacher_achievement_report(uuid,text)`.
2. Teacher ownership is enforced server-side; admins may inspect the report for support.
3. Official score, rank and certificate details are withheld until competition status is `RESULT_PUBLISHED` or `ARCHIVED`.
4. Preview/simulation attempts are excluded.
5. Teacher page at `/guru/prestasi`, linked from the existing Guru Workspace.
6. Summary metrics for managed students, competitions, published results and issued certificates.
7. Competition filter, search, responsive result cards and CSV export.
8. No writes to participant, attempt, result, ranking, or certificate data.

## Access and limitations

This report currently covers collective participants managed by the authenticated teacher. The existing individual-account participant model does not yet contain an authoritative teacher-student relationship. Individual participants are therefore not inferred from matching names, school text, or the legacy free-text `pembina` field. A future extension to individual student records requires an explicit, consent-aware relationship and corresponding RLS policy, without duplicating participant identities.

## Migration and verification

Migration: `supabase/migrations/20261101090000_stage_5_teacher_achievement_report.sql`.

Read-only SQL contract: `supabase/tests/teacher_achievement_stage5.sql`.

Frontend contract: `npm run test:teacher-achievement-contract`.

## Rollout status — 1 November 2026

- Implementation merged into `main` in PR #151 (merge commit `865933dda96a5ef24d6714db685a97f96796058e`).
- Production migration `stage_5_teacher_achievement_report` is applied and recorded in Supabase migration history.
- Read-only database contract passed after migration.
- Function metadata confirms `SECURITY DEFINER` with an empty `search_path`.
- Execute grants verified: `authenticated = true`, `anon = false`.
- PR CI passed: frontend contract tests, lint, typecheck, Vite build, performance asset budget, browser E2E access-control test, and production smoke test.
- Final post-merge `main` CI run `#41228716348` completed successfully on 1 November 2026, including contract tests, lint, TypeScript, Vite build, performance asset budget, browser E2E access-control, and production smoke test.
- Cloudflare Pages trigger marker commit `249aabeea2b0c2dfeefa42b40546c1b6ff34a18e` was added. The actual Cloudflare Pages deployment was not independently verified from this environment.

No participant, attempt, score, rank, or certificate data was written or modified by this stage.
