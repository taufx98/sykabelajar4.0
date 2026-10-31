# SYKABELAJAR 4.0 — Stage 2: Lomba Saya participant dashboard

## Scope

Create one personal dashboard for an authenticated account to track its own competition activity. It does not replace the collective participant portal or teacher monitoring.

## Included

- Individual competition registrations in every registration state, including pending/rejected/cancelled entries that do not yet have a canonical participant row.
- Canonical individual participant activity and the latest official attempt.
- Collective participant history only after the participant explicitly claims it to the signed-in account.
- One competition card with status, schedule, latest attempt state, published score/rank and certificate counts.
- Filters for all competitions, registration, in-progress, waiting for results and published results.
- Search by competition title/category/participant name.
- Desktop sidebar entry and configurable mobile bottom navigation item.
- Responsive loading, error/retry, and empty states.

## Data and access

Migration: \`20261031140000_stage_2_my_competitions_dashboard.sql\`

The authenticated RPC \`public.list_my_competition_dashboard()\` is server-authoritative and returns only:
- individual registrations where \`registrations.user_id = auth.uid()\`;
- individual canonical participants where \`participants.user_id = auth.uid()\`;
- collective records where \`collective_participants.user_id = auth.uid()\` (explicitly claimed).

It does not query participants belonging to a teacher merely because the teacher manages them. It does not grant access to the collective participant portal token or exam workflow.

Attempt previews are excluded. Score and rank are returned only when a finalized official attempt exists and the competition is in \`RESULT_PUBLISHED\` or \`ARCHIVED\`. Ranking uses Stage 1's canonical ranking helper.

## Routes and navigation

- Route: \`/lomba-saya\`
- Sidebar: Lomba Saya
- Mobile navigation: selectable in Profile → Tampilan & Privasi; included in the default mobile navigation.

Collective entries link to claimed collective history. Individual exam entry uses the existing competition work route and does not create a new exam engine.

## Verification

Run after applying the Stage 1 and Stage 2 migrations:

\`\`\`sh
psql -v ON_ERROR_STOP=1 -f supabase/tests/canonical_participant_stage1.sql "$DATABASE_URL"
psql -v ON_ERROR_STOP=1 -f supabase/tests/competition_dashboard_stage2.sql "$DATABASE_URL"
\`\`\`

The Stage 2 RPC and SQL contract test were also executed against the production schema inside a transaction with a temporary ranking-helper stub and rolled back. The RPC returned an empty list for a non-existent test user. No production rows, schema or functions were changed by that verification.

## Rollout dependencies

This pull request is based on `main` so its frontend and CI can be reviewed independently; it does not include Stage 1 commits. Its RPC intentionally calls `private.canonical_competition_rank`, so the Stage 1 schema and canonical backfill must already be present.

Safe rollout order:
1. Merge Stage 1.
2. Apply the Stage 1 migration to the production Supabase project and run `supabase/tests/canonical_participant_stage1.sql`.
3. Merge Stage 2 only after those checks pass.
4. Apply the Stage 2 migration and run `supabase/tests/competition_dashboard_stage2.sql`.

Do not enable the Stage 2 dashboard in production before the Stage 1 migration and regression checks succeed. Cloudflare branch deployments are previews and do not replace the database rollout.
