# SYKABELAJAR 4.0 — Stage 3: Results, Ranking & Publication

## Scope

Stage 3 adds an organizer-controlled results lifecycle on top of Stage 1's canonical participant identity and Stage 2's participant dashboard. It does not create a second scoring or ranking engine.

## Lifecycle

1. A competition reaches \`SUBMISSION_CLOSED\`.
2. An authorized organizer owner/editor moves it to \`GRADING\`.
3. The organizer reviews the official result overview and completes any manual grading in the existing grading workspace.
4. The overview shows readiness blockers. Official \`IN_PROGRESS\`, \`SUBMITTED\`, \`GRADING\`, and \`NOT_STARTED\` attempts block publication.
5. On publish, the server resolves linear exam timeouts only for official sessions whose server global deadline has passed. Sessions without a linear runtime are not auto-finalized.
6. Publication is accepted only when no official attempt remains pending, no manual grading item remains ungraded, no finalized attempt is missing its canonical participant, and at least one official finalized result exists.
7. The competition transitions to \`RESULT_PUBLISHED\` through the existing \`transition_competition\` RPC. Public results are exposed only for PUBLIC competitions in \`RESULT_PUBLISHED\` or \`ARCHIVED\`.

## Ranking

\`private.canonical_competition_results\` follows the Stage 1 canonical source:
- latest finalized non-preview attempt per canonical participant;
- \`rank()\` by score descending, so tied scores share rank (1, 2, 2, 4);
- individual and collective participants use the same \`participants\` identity.

Preview/simulation attempts never enter the public ranking.

## Manual grading score integrity

The manual-finalization RPC no longer trusts the score sent by the browser. It uses the server-stored attempt score as the automatic base, adds manually graded items, and applies only the delta for an AI Similarity item that a grader explicitly overrides. The \`automatic_score\` snapshot prevents AI-scored points being counted twice. Every manual item must be saved by a grader before finalization; score limits use the exam snapshot when available.

## New access surfaces

- Organizer preview: \`/organizer/competition/:id/results\`
- Public results: \`/lomba/:slug/hasil\`
- Organizer result overview and publish RPC are authenticated and restricted to admin or competition owner/editor.
- Public results RPC returns no data unless the competition is PUBLIC and officially published.

## Verification

Run:
\`\`\`sh
npm run test:results-contract
npm run lint
npm run typecheck
npm run build
npm run test:performance-budget
npm run check:performance
npx playwright test
\`\`\`

Run the read-only database contract test after applying the migration:
\`\`\`sh
psql -v ON_ERROR_STOP=1 -f supabase/tests/competition_results_stage3.sql "$DATABASE_URL"
\`\`\`

Do not apply the Stage 3 migration to Supabase production until the reviewed PR has passed CI and the rollout is explicitly approved.
