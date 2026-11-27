# Stage 7 SECURITY DEFINER manual review — Tranche 18

Date: 27 November 2026  
Project: Production DB2 `mvdczyitbkxkldjughor` (PostgreSQL 17.6)  
Scope: five public statistics and leaderboard SECURITY DEFINER RPCs  
Decision: **accepted for partial manual-review count only; Production remains NO-GO**

## Exact signatures and read-only Production catalog evidence

A SELECT-only Production catalog query on 27 November verified the current function source hashes, owners, SECURITY DEFINER flags, original `search_path`, return types, language, normalized ACL grant set and effective EXECUTE privileges. All five current `md5(pg_proc.prosrc)` values match the immutable 21 November triage snapshot. Every function is owned by `postgres`, is SECURITY DEFINER, uses SQL language, and has effective EXECUTE for `anon`, `authenticated`, and `service_role`.

| Exact signature | Production `md5(prosrc)` | Original `search_path` | PUBLIC EXECUTE | anon/auth/service EXECUTE |
|---|---|---|---|---|
| `get_platform_stats()` | `89940ccab266fee4780fbe2999d8e000` | `public` | Yes | Yes |
| `get_public_coin_leaderboard(integer)` | `c340deca8807f29674602e920f452837` | `public, private` | Yes | Yes |
| `get_public_leaderboard(integer)` | `56a97da61639d334dcdc5298f14c2faa` | `public, private` | Yes | Yes |
| `get_public_leaderboard_enriched(text,integer)` | `442f3995f43dec475d5ed8c79fdbfb8f` | `public, private, pg_catalog` | No | Yes |
| `get_public_school_leaderboard(text,integer)` | `efab75373f8f4db86e2f1e917ee8fe55` | `public, private, pg_catalog` | No | Yes |

The first three ACL grant sets include `PUBLIC=EXECUTE/postgres`; the enriched and school leaderboard ACLs do not. All five include `anon`, `authenticated`, and `service_role` EXECUTE granted by `postgres`. The triage inventory still reports the original snapshot as `reviewStatus: not_reviewed`; that immutable file was not changed. This report adds only the manually accepted review count after source and runtime evidence.

## Manual source review and intended public boundary

- **`get_platform_stats()`:** returns one aggregate row of counts (active profiles, active students, schools, competitions, public non-draft competitions, and certificates in the configured statuses). It returns no profile identifier, contact field, username, or individual profile row. Public invocation exposes aggregate totals only.
- **`get_public_coin_leaderboard(integer)`:** ranks only active profiles whose `is_public` is true (or NULL under the existing legacy default), excludes identities with an active Admin role, and clamps the requested row limit to 1–1000. The returned profile fields are part of the explicit public leaderboard projection.
- **`get_public_leaderboard(integer)`:** applies the same active/public/non-Admin boundary to XP-ranked profiles and clamps the row limit to 1–1000. Rank-change fields are fixed public projection values in this version.
- **`get_public_leaderboard_enriched(text,integer)`:** validates/normalizes the requested all/weekly/monthly period, builds its rows from the `public_profiles` CTE, excludes active Admin identities, requires active/public profiles, and clamps the limit to 1–1000. Average score and competition counts are computed over participant aggregates; private profile rows do not enter the source CTE.
- **`get_public_school_leaderboard(text,integer)`:** builds school aggregates and top-student JSON exclusively from the same active/public/non-Admin `public_profiles` CTE. School grouping falls back to normalized institution name if there is no school ID. The `top_students` projection is limited to five entries and cannot reintroduce private or active-Admin profiles excluded upstream.

The three legacy functions with a PUBLIC grant were reviewed as intentionally public-read projections, not as generic access to private profile rows. The two newer enriched functions have no PUBLIC grant but are explicitly executable by `anon`; both are tested through the anon role. No function was changed or granted new access by this tranche.

## Disposable regression coverage

PR [#351](https://github.com/taufx98/sykabelajar4.0/pull/351) added the immutable fingerprint/ACL/search-path/return-type contract plus rollback-only synthetic profile fixtures and anonymous runtime checks. The fixtures deliberately include:
- two public Better Auth student profiles at the same synthetic school;
- multiple private profiles with XP/coin values larger than public students;
- a public Admin profile with the highest XP/coin values, to prove that public visibility alone does not bypass Admin exclusion.

As `anon`, the rollback-only Stage 3 regression positively reads platform statistics, XP leaderboard, coin leaderboard, enriched leaderboard, and school leaderboard. It asserts that the two public students appear, while all private profile IDs and the public Admin ID are absent from each applicable row set and from the school's `top_students` JSON. For the synthetic school, `student_count=2` is asserted. The existing `normalize_profile_fields()` trigger uppercases `institution`; PR [#352](https://github.com/taufx98/sykabelajar4.0/pull/352) corrected the fixture expectation to this normalized value and retained an explicit count assertion. No application function body was modified.

The first disposable attempt exposed this fixture-only case mismatch as `STAGE7_ANON_PUBLIC_SCHOOL_LEADERBOARD_FAILED:0`; catalog inspection found the existing profile trigger uppercases institution on insert. The assertion was corrected, not the function. The subsequent protected baseline completed successfully.

## Protected baseline and CI evidence

Protected Auth Production Schema Baseline [#46040774742](https://github.com/taufx98/sykabelajar4.0/actions/runs/46040774742) passed **78/78 steps** on commit `53248fd3bf17d3bdfb55e34aec9c312511b2caa6`. This run performed a schema-only Production export, restored it to PostgreSQL 17.6 disposable Supabase, applied the Stage 3 draft to the disposable restore, and passed the Stage 3 trusted-issuer RLS acceptance (the step that executes the updated rollback-only guest leaderboard regression). It also passed the post-Stage-3 RPC issuer checks, all 23 direct RLS table boundaries, all 14 collective portal invalid-token checks, valid portal acceptance, 64-bit portal collision checks over 5,000 synthetic keys, the 69-FK rollback rehearsal, full Stage 3 rollback, and the two-user Cloudinary/payment Edge integration. The disposable Supabase stack was stopped and the schema export/workspace removed successfully.

Supabase Local Auth Claims CI [#46040774710](https://github.com/taufx98/sykabelajar4.0/actions/runs/46040774710) passed **23/23**. Cloudflare staging preflight [#46040774630](https://github.com/taufx98/sykabelajar4.0/actions/runs/46040774630) passed **9/9** in read-only mode; no deployment occurred. Auth Worker frontend build passed **10/10**. The broader Worker audit job separately failed at the previously observed, unrelated payment test `Verify payment Edge Function identity migration boundaries`; no payment files were touched by PR #351/#352, and no payment change is included in this acceptance.

**Cumulative accepted manual review: 93/202 exact signatures; 109 remain.** This adds five public statistics/leaderboard signatures to the previous 88/202 count. The all-functions activation manifest remains `status: blocked` with `reviewedAuthenticatedFunctionCount: 0`; this partial manual-review progress does not satisfy the complete 202-function activation gate. Production DB2 remains **NO-GO**. No Production DDL/DML, grant, policy, role, account/data change, Worker deployment, DNS change, or secret change was performed. All fixture writes were synthetic and rolled back on the disposable restore.
