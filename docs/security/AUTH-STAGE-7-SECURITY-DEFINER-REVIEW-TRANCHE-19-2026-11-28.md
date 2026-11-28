# Stage 7 SECURITY DEFINER manual review — Tranche 19

Date: 28 November 2026  
Project: Production DB2 `mvdczyitbkxkldjughor` (PostgreSQL 17.6)  
Scope: five public competition catalogue/detail/participant/question-count/results SECURITY DEFINER RPCs  
Decision: **accepted for partial unique-signature review count only; Production remains NO-GO**

## Exact signatures and SELECT-only Production catalog evidence

The current Production function catalogue was inspected with SELECT-only queries on 28 November. The source hashes below match the immutable 21 November triage inventory. All five functions are owned by `postgres`, are SECURITY DEFINER, and are executable by `anon`, `authenticated`, and `service_role`. Four use an empty `search_path`; the public list RPC originally used `public, private` and is changed to an empty path in the Stage 3 draft.

| Exact signature | Production `md5(prosrc)` | Original `search_path` | Return type | PUBLIC EXECUTE |
|---|---|---|---|---|
| `get_public_competition_detail_summary(uuid)` | `911222960fda1b15c410c5407482f548` | empty | `TABLE(participant_count bigint, organizer_name text, organizer_logo_url text, question_bank_name text, question_provider_name text, question_count bigint)` | No |
| `get_public_competition_participants(text,integer,integer)` | `695758d3c7df1347a79fe5189439f35e` | empty | `jsonb` | No |
| `get_public_competition_question_count(uuid)` | `c1fd7dd6f06f405252d6e93b77498638` | empty | `integer` | Yes |
| `get_public_competition_results(text,integer,integer)` | `223b202465fb18d721d7a5fe1b011237` | empty | `jsonb` | No |
| `get_public_competitions(integer)` | `72fda47f09a2bfa2a868e2458a1a1631` | `public, private` | `TABLE(id uuid, organizer_id uuid, slug text, title text, short_description text, description text, category text, status competition_status, registration_starts_at timestamptz, registration_ends_at timestamptz, starts_at timestamptz, ends_at timestamptz, announcement_at timestamptz, poster_url text, juknis_url text, visibility text, participant_count bigint, organizer_name text, organizer_photo_url text)` | No |

All original ACL grantors are `postgres`. The question-count RPC is the only one of these five with an explicit `PUBLIC=EXECUTE` entry; the others grant EXECUTE to `anon`, `authenticated`, and `service_role` individually. The Stage 3 draft preserves existing function ACLs through `CREATE OR REPLACE`; no GRANT or REVOKE was executed against Production. The draft preflight compares canonical ACL entries (grantee, privilege, grantor, and grant-option state) alongside exact source hash, owner, SECURITY DEFINER, `search_path`, return type, language, and effective EXECUTE flags.

## Manual source review and findings

- **`get_public_competition_detail_summary(uuid)`:** returns one detail projection only when the competition is PUBLIC and in an allowed published/registration/live/grading/results/archive state. It returns participant count, organizer display metadata, public question-bank/provider names and the count of published questions associated with the public competition or its configured bank. A private competition returns no row.
- **`get_public_competition_participants(text,integer,integer)`:** resolves a competition by slug only when visibility is PUBLIC and its state is eligible for the public page. Private and unknown slugs raise `COMPETITION_NOT_FOUND`. Participant fields are explicitly projected. Canonical rank/score fields are joined only for `RESULT_PUBLISHED` or `ARCHIVED`; before publication, the result fields remain unavailable.
- **`get_public_competition_question_count(uuid)`:** the Production body counted PUBLISHED questions for competitions in `LIVE`, `RESULT_PUBLISHED`, or `ARCHIVED`, but omitted `competitions.visibility='PUBLIC'`. Since the function is executable by anon and PUBLIC, a caller who knew a private competition UUID could infer the number of its published questions. This is the concrete privacy gap found in this tranche. The Stage 3 draft now requires both a PUBLIC competition and the existing allowed status before counting. Private competitions therefore return zero, while public competitions retain the existing count behavior.
- **`get_public_competition_results(text,integer,integer)`:** resolves only PUBLIC competitions in `RESULT_PUBLISHED` or `ARCHIVED`; private and unpublished results raise `COMPETITION_RESULTS_NOT_FOUND`. The response exposes the canonical published result projection, not answer keys or private question snapshots.
- **`get_public_competitions(integer)`:** lists only PUBLIC competitions in the public lifecycle states and clamps the requested result limit to 1–20. Every relation in the reviewed SQL body is schema-qualified. The Stage 3 draft preserves its output/signature and hardens the function-level `search_path` from `public, private` to empty.

No account/identity-based restriction is required for the intentionally public projections; the exact public-visibility and publication-state predicates are the authorization boundary. The list RPC's `search_path` hardening is defense in depth, not a change to its public visibility policy.

## Disposable regression

The Stage 3 rollback-only regression adds two synthetic published questions: one attached to the existing PUBLIC result competition and one attached to a PRIVATE result competition. It then switches to `anon` and asserts:
- public competition list and detail summary return the PUBLIC fixture, but never the private fixture;
- public participant roster returns its JSON projection, while the private competition raises `COMPETITION_NOT_FOUND`;
- published public results remain readable, while private and unpublished results remain denied;
- public question count returns exactly one; the private competition, despite also containing a PUBLISHED question and being in an otherwise countable result state, returns zero.

The regression runs inside the existing transaction ending in `ROLLBACK`; fixtures, plans, organizers, question banks, questions, and role/claim setup exist only on the disposable restore.

## Protected baseline and CI evidence

Protected Auth Production Schema Baseline [#46092190442](https://github.com/taufx98/sykabelajar4.0/actions/runs/46092190442) passed **78/78 steps** on commit `1f83a5d88872904818824ea9f3ffd41e0e9433ff`. It performed a schema-only Production export and PostgreSQL 17.6 disposable restore, passed the Stage 3 SECURITY DEFINER fingerprint/ACL preflight and replacement, and passed the Stage 3 trusted-issuer RLS acceptance (step 48), which executes the new anon public/private competition regression. It also passed the post-Stage-3 RPC issuer checks, all 23 direct RLS table boundaries, all 14 collective portal invalid-token checks, valid portal acceptance, 64-bit portal collision checks over 5,000 synthetic keys, the 69-FK rollback rehearsal, full Stage 3 rollback, and the two-user Cloudinary/payment Edge integration. The disposable Supabase stack was stopped and the schema export/workspace removed successfully.

Supabase Local Auth Claims CI [#46092026732](https://github.com/taufx98/sykabelajar4.0/actions/runs/46092026732) passed **23/23**. Auth Schema PR Contracts [#46092026785](https://github.com/taufx98/sykabelajar4.0/actions/runs/46092026785) passed **28/28**, including six Tranche 19 contracts. Auth Worker frontend lint/typecheck/build [#46092026818](https://github.com/taufx98/sykabelajar4.0/actions/runs/46092026818) passed **10/10**. Cloudflare staging preflight [#46092190365](https://github.com/taufx98/sykabelajar4.0/actions/runs/46092190365) passed **9/9** in read-only mode; no Worker deployment occurred. The broad Worker audit job was `skipped` and is not represented as a passing test.

**Cumulative accepted unique manual review: 93/202 exact signatures; 109 remain.** This adds five unique signatures to the previous 88/202 count; all five Production fingerprints were checked against prior tranche reports and were not previously accepted. The immutable 21 November triage inventory remains unchanged. The all-functions activation manifest remains `status: blocked` with `reviewedAuthenticatedFunctionCount: 0`; partial manual-review progress does not satisfy the complete 202-function activation gate. Production DB2 remains **NO-GO**. No Production DDL/DML, grants, policies, roles, accounts, or application data were changed. No Worker deployment, DNS change, or secret update was performed.
