# SYKABELAJAR 4.0 — Stage 3: Results, Ranking & Publication

## Scope

Stage 3 adds an organizer-controlled results lifecycle on top of Stage 1's canonical participant identity and Stage 2's participant dashboard. It reuses the existing grading, competition status, attempt, and certificate architecture; it does not create a second exam or ranking engine.

## Lifecycle

1. A competition reaches `SUBMISSION_CLOSED`.
2. An authorized competition owner/editor opens the official grading stage, moving the competition to `GRADING` through the existing transition RPC.
3. The organizer reviews the canonical result preview and completes outstanding manual grading in the existing grading workspace.
4. The overview shows publication blockers. Official `NOT_STARTED`, `IN_PROGRESS`, `SUBMITTED`, and `GRADING` attempts block publication.
5. During publication, the server resolves timeouts only for official linear exam sessions whose server-issued global deadline has passed. A batch is processed repeatedly when an exam has more than 200 questions, with a no-progress guard. Sessions without the linear runtime are not auto-finalized.
6. Publication is accepted only when no official attempt remains pending, all manual grading items are saved, all finalized attempts are linked to a canonical participant, and at least one official finalized result exists.
7. The server transitions the competition to `RESULT_PUBLISHED` using the existing transition RPC. Results are exposed publicly only for competitions with `visibility = PUBLIC` and status `RESULT_PUBLISHED` or `ARCHIVED`.

## Canonical ranking

`private.canonical_competition_results` follows the Stage 1 source of truth:
- One latest finalized, non-preview attempt per canonical participant.
- Ranking uses `rank()` by score descending, so tied scores share rank (1, 2, 2, 4).
- The set-based result projection applies the same ranking filters as the existing Stage 1 participant-rank lookup. It does not replace that hot-path helper, avoiding a full-table ranking recalculation for each dashboard row.
- Individual and collective participants use the same canonical `participants` identity.
- Preview/simulation attempts never enter official ranking.

## Score integrity for mixed automatic/manual exams

The manual-finalization RPC does not trust the score sent by the browser. It uses the server-calculated score already stored on the attempt as the automatic base, adds manual/post-submit AI grading items, and applies only the difference when an AI score that was already included in a linear attempt is deliberately overridden. The `automatic_score` snapshot is captured only for built-in linear AI scores already included in `attempts.score`; regular post-submit AI grading remains a separate grading item and is added in full. This prevents both omitted AI points and double counting.

Question ceilings and prompt/type metadata for linear attempts are read from the attempt snapshot through the authorized `get_attempt_grading_limits` RPC. The browser receives only the relevant per-question projection and a sanitized AI-assessment enabled flag; direct authenticated access to the private exam snapshot table stays closed and answer keys are never returned in that projection.

AI essay grading reads `answer_key_snapshot` on the server for linear attempts, falling back to the source question only for legacy attempts without a snapshot. It also enforces the AI-assessment-enabled flag from that same immutable snapshot (or the legacy question configuration). The UI receives the similarity percentage, while the stored grading value is weighted by the original question points (for example, 80% of a 10-point question becomes 8 points).

Manual items must be saved by a grader before the attempt can be finalized. Score ceilings use the original attempt snapshot when available, not an edited source question.

The browser role has read-only access to `grading_items`; all direct table writes (including truncate/trigger privileges) are revoked from `anon` and `authenticated`. The organizer UI uses the authorized grading RPCs for changes, and the database trigger only captures automatic scores from the trusted linear completion function.

## Routes and access

- Organizer result overview: `/organizer/competition/:id/results`
- Public results: `/lomba/:slug/hasil`
- Organizer overview and publication RPCs require an authenticated admin or competition owner/editor.
- Public result RPC only returns public competitions whose official results have been published.
- The public results route is outside the authenticated application route guard.
- Public competitions link to the published results page from competition details. Private competitions keep participant score/rank inside the authenticated participant dashboard.

## Verification

CI includes:
```sh
npm run test:results-contract
npm run lint
npm run typecheck
npm run build
npm run test:performance-budget
npm run check:performance
npx playwright test
```

After the migration is approved and applied to the target database, run the read-only database contract checks:
```sh
psql -v ON_ERROR_STOP=1 -f supabase/tests/competition_results_stage3.sql "$DATABASE_URL"
```

The Stage 3 migration has not been applied to Supabase production. Production rollout must happen only after PR review, successful CI, and explicit approval.
