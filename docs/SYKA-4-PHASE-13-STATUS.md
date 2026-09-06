# SYKABELAJAR 4.0 — Phase 13 Performance / Egress

Date: 2026-09-06
Status: COMPLETE

## Goal

Reduce unnecessary database work and bandwidth on the highest-traffic participant/public paths while preserving the existing architecture and security model.

## Implemented

- Removed a duplicate `orders(user_id,created_at)` index.
- Removed a redundant non-unique certificate verification-code index because the unique verification-code index already covers that lookup.
- Added a public-competition read index scoped to `visibility='PUBLIC'` with status/date ordering.
- Added a published-question index scoped to `(competition_id,display_order)` for live assessment reads.
- Added a canonical-attempt read index scoped to `(canonical_participant_id,status,updated_at desc)`.
- Added a registration competition/created-at index for organizer/participant listing paths.
- Ran `ANALYZE` on the affected high-traffic tables.
- Bounded `listPublicCompetitions()` to a safe maximum of 50 rows and replaced `select('*')` with an explicit projection, reducing unnecessary public payload egress.

## Existing performance safeguards retained

- Home snapshot already uses bounded competition/feed/leaderboard payloads.
- Feed pagination uses a cursor-based `listPublishedPostsPage()` flow.
- Notifications use a dedicated unread partial index.
- Competition work keeps question answers scoped and autosaved through existing services.
- Cloudinary media is transformed/lazy-loaded on high-traffic UI surfaces.
- Persistent cache and realtime reconciliation remain in use for navigation badges and live state.

## Security

The performance changes do not weaken RLS or RPC authorization. Existing stable `(select auth.uid())` policy patterns are retained where already present.

## Scope boundary

Broader Supabase advisor findings (legacy foreign-key indexes, unused informational indexes, unrelated RLS optimization debt) remain outside this phase unless directly tied to the critical participant/public read paths. No blind mass index cleanup was performed.

## Legacy safety

No business lifecycle, participant identity, payment, certificate, collective participant, Guru, or Organizer model was replaced.

## Exit criteria

- Public competition reads are bounded and have a narrower payload.
- Critical participant/live assessment paths have targeted indexes.
- Redundant indexes were removed only where equivalence was established.
- Existing cache/realtime/media optimizations remain intact.
- Production schema verification passes.
- Final Phase 13 CI passes.

## Next phase

Phase 14 — Security / Anti-Abuse.
