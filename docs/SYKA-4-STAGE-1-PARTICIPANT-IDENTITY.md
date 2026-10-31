# SYKABELAJAR 4.0 — Stage 1: Canonical participant identity

## Scope

This stage hardens the canonical participant model already introduced by Phase 3. It does not create a second participant store, replace the existing login flows, or require collective participants to create SykaBelajar accounts.

- Individual identity: one \`participants\` row per \`competition_id + user_id\`.
- Collective identity: one \`participants\` row per \`competition_id + collective_participant_id\`.
- A claimed collective participant remains a collective competition identity. Claim ownership is still represented by \`collective_participants.user_id\`, and access checks allow only that account and the assigned teacher/admin.
- Attempts and certificates are linked to the corresponding canonical participant.
- Individual, collective-token and claimed-collective result paths use the same ranking source.

## Changes

Migration: \`20261031134002_stage_1_canonical_participant_identity.sql\`

1. Enforces the relationship between \`participant_type\` and the populated identity column.
2. Backfills approved/active individual registrations and historical official records.
3. Backfills active collective participants and collective identities that have historical attempts/certificates.
4. Adds an insert/update trigger so active collective participants are canonicalized when provisioned, not only when they start an exam or receive a certificate.
5. Links official attempts and certificates to canonical identities; preview attempts remain detached.
6. Calculates rank from one latest finalized non-preview attempt per canonical participant. Equal scores share a rank (competition ranking).
7. Aligns collective portal and claimed-history results with the canonical ranking source.
8. Hides attempt scores from participant-facing list/history RPCs until results are published.

## Access and compatibility

- The collective portal still authenticates with its existing access token.
- The collective result RPC keeps its existing response fields and adds \`canonical_participant_id\`.
- Claimed collective history and certificates are visible only to the account that claimed that collective participant.
- The private rank helper is not directly executable by \`anon\` or \`authenticated\`.
- Existing public/organizer/admin status checks for results are preserved.

## Verification

Run after applying the migration:

\`\`\`sh
psql -v ON_ERROR_STOP=1 -f supabase/tests/canonical_participant_stage1.sql "$DATABASE_URL"
\`\`\`

The SQL check validates identity/backfill completeness, required trigger and RPC privileges, and the ranking policy for repeated attempts, ties and previews.

The repository CI also runs canonical-source checks, cache tests, lint, TypeScript typecheck, Vite build, performance budget checks, browser access-control E2E and production smoke checks on pull requests.

## Production rollout status (31 October 2026)

- The migration has been applied to the production Supabase project as version `20261031134002`.
- The canonical participant regression SQL completed successfully after deployment.
- Post-deployment integrity checks found no active individual registration missing a canonical participant, no participant identity mismatch, no official attempt missing its canonical link, and no preview attempt linked to a canonical participant.
- The repository filename matches the version recorded in Supabase so future CLI migration checks do not attempt to reapply the same migration.
