# Stage 7 SECURITY DEFINER manual review — Tranche 20

Date: 28 November 2026  
Project: Production DB2 `mvdczyitbkxkldjughor` (PostgreSQL 17.6)  
Scope: five public competition-detail, home snapshot, feed, Admin-profile flag, and collective-certificate SECURITY DEFINER RPCs  
Decision: **accepted for partial unique-signature review count only; Production remains NO-GO**

## Exact signatures and SELECT-only Production catalog evidence

The five Production functions were inspected through SELECT-only catalog queries on 28 November. Current source hashes match the immutable 21 November triage inventory. All are owned by `postgres`, are SECURITY DEFINER, and have EXECUTE for `anon`, `authenticated`, and `service_role`. None has a PUBLIC ACL grant entry; individual API-role grants remain as they were.

| Exact signature | Production `md5(prosrc)` | Original `search_path` | Return type | Language |
|---|---|---|---|---|
| `get_competition_participant_detail(text,uuid)` | `68183b7176c3f24ec95c018d13b973ef` | empty | `jsonb` | plpgsql |
| `get_home_snapshot(integer)` | `6c57e4102a8a51b39602625f6aeb2eaf` | `public, private` | `jsonb` | sql |
| `get_public_feed(integer,timestamp with time zone)` | `1944c33d7a1d0404151de702e13e894f` | `public, private` | `TABLE(id uuid, author_user_id uuid, author_name text, author_username text, avatar_url text, title text, body text, cover_url text, created_at timestamptz, competition_id uuid, competition_slug text, likes bigint, liked boolean, comments bigint, organizer_name text, organizer_photo_url text)` | sql |
| `is_public_profile_admin(uuid)` | `e94eb7f539ab889dc503ce9d04b36886` | empty | `boolean` | sql |
| `get_public_collective_certificate(text)` | `7a47a902b83e1ea7e2915f69791f55b0` | `public` | `jsonb` | sql |

All five canonical ACLs contain individual `anon=EXECUTE/postgres`, `authenticated=EXECUTE/postgres`, and `service_role=EXECUTE/postgres` entries (plus owner execute for postgres); no explicit PUBLIC execute entry is present. Stage 3's new disposable preflight checks the exact hashes, owner, SECURITY DEFINER flag, original `search_path`, return type, language, canonical ACL (including grant-option state), and effective role privileges before replacing any function. No Production GRANT/REVOKE was run.

## Manual source review and Stage 3 draft disposition

- **`get_competition_participant_detail(text,uuid)`:** public result detail is allowed only for PUBLIC competitions in RESULT_PUBLISHED/ARCHIVED status. Private or unpublished competitions require an authenticated caller who is an Admin or organizer editor; guests receive `RESULT_NOT_PUBLISHED`. The Better Auth draft keeps private badge-collection self access tied to `private.current_user_is_better_auth()` and the exact owner UUID, while Admin and public visibility/settings rules remain explicit. Awards are returned only for PUBLIC award rows; individual and collective certificate projections include only PUBLISHED records with a URL. The reviewed response contains no answer key or question snapshot.
- **`get_home_snapshot(integer)`:** composes only the already-reviewed public competition list, public XP leaderboard, coin leaderboard, aggregate platform statistics, and public feed. Its nested calls are schema-qualified. The draft preserves the JSON shape and feed-limit clamp while setting function `search_path` to empty.
- **`get_public_feed(integer,timestamptz)`:** reads only posts with status PUBLISHED, applies the existing before-cursor and 1–31 row-limit rules, and explicitly projects public author/organizer display values, engagement counts and the caller's like bit. Production also has the `posts_public_read` RLS policy restricting anon/authenticated reads to PUBLISHED posts. The replacement preserves the projection and predicates while moving to an empty `search_path`; all table references remain schema-qualified.
- **`is_public_profile_admin(uuid)`:** returns a boolean, not the Admin role row. The Stage 3 draft requires a matching `private.app_users` row with `identity_origin='better_auth'`, an active Admin role, and a public profile (or the profile owner themselves). This prevents a legacy Supabase Auth UUID from being treated as a Better Auth Admin identity.
- **`get_public_collective_certificate(text)`:** returns the public certificate projection only for PUBLISHED or REVOKED certificates. ELIGIBLE/DRAFT records are intentionally not verifiable through the public endpoint. The draft preserves case-insensitive verification-code lookup and output fields, with an empty `search_path`.

No application output schema or public visibility policy was broadened by this tranche. The three wrapper/search-path replacements are defense in depth and preserve schema-qualified references.

## Disposable regression coverage

The rollback-only regression seeds:
- one authorless PUBLISHED post titled `Stage 7 public feed boundary probe` and one authorless DRAFT post titled `Stage 7 draft feed boundary probe`, to isolate the feed publication-state boundary without changing profile-owner semantics;
- an existing synthetic collective certificate in ELIGIBLE state with a unique verification code;
- existing synthetic Better Auth profiles/roles covering a public Admin, private Admin, and public non-Admin.

As `anon`, the disposable Stage 3 regression asserts that the PUBLISHED feed entry appears and the DRAFT entry does not, the home snapshot has the expected object/array shape and carries the public post but not the draft, the public Admin flag is true while private Admin and public non-Admin flags are false, an ELIGIBLE collective certificate is not publicly returned, and a private/unpublished competition participant-detail request is denied with `RESULT_NOT_PUBLISHED`.

The fixture insert/update and a fixture preflight are deliberately executed **before** `SET LOCAL ROLE anon`. The anonymous read assertions execute after the role switch. All synthetic writes are in the existing regression transaction and are rolled back on the disposable restore. The first attempted baseline exposed a fixture-order bug (posts were inserted after the role had switched to anon and RLS correctly rejected the INSERT); PR #358 moved fixture setup ahead of the switch and added a static order assertion. No application function or Production policy was modified in response to that fixture error.

## Protected baseline and CI evidence

Protected Auth Production Schema Baseline [#46134092233](https://github.com/taufx98/sykabelajar4.0/actions/runs/46134092233) passed **78/78 steps** on commit `05b2ff5d33534b2e9f3bd5061c5523a103edadd7`. It completed the schema-only Production export, PostgreSQL 17.6 disposable restore, Stage 3 fingerprint/ACL preflight and replacements, and Stage 3 trusted-issuer RLS acceptance (step 48), which executes the new Tranche 20 anonymous feed/home/Admin/certificate/detail regression. It also passed all 23 direct RLS table boundaries, all 14 collective portal invalid-token checks, valid portal acceptance, 64-bit selector collision checks over 5,000 synthetic keys, the 69-FK rollback rehearsal, complete Stage 3 rollback, two-user Cloudinary/payment Edge integration, and disposal of the local Supabase stack plus schema-export workspace.

Supabase Local Auth Claims CI [#46134092348](https://github.com/taufx98/sykabelajar4.0/actions/runs/46134092348) passed **23/23**. Cloudflare staging preflight [#46134092242](https://github.com/taufx98/sykabelajar4.0/actions/runs/46134092242) passed **9/9** in read-only mode. Auth Worker frontend lint/typecheck/build [#46134092208](https://github.com/taufx98/sykabelajar4.0/actions/runs/46134092208) passed **10/10**. PR #358's Stage 3–5 static contracts [#46133878280](https://github.com/taufx98/sykabelajar4.0/actions/runs/46133878280) passed **29/29**; its frontend checks [#46133878292](https://github.com/taufx98/sykabelajar4.0/actions/runs/46133878292) passed **10/10** and Local Auth Claims [#46133878350](https://github.com/taufx98/sykabelajar4.0/actions/runs/46133878350) passed **23/23**.

The separate broad Auth Worker audit job ended with the already-observed payment-specific failure `Verify payment Edge Function identity migration boundaries`; that job is not treated as a passing result and no payment files were changed in this tranche. This does not change the protected baseline/Stage 3 RLS result above.

**Cumulative accepted unique manual review: 98/202 exact signatures; 104 remain.** This adds five unique signatures to the previous 93/202 count. A cross-report fingerprint reconciliation found no duplicates among these five. The immutable 21 November triage inventory remains unchanged. The all-functions activation manifest remains `status: blocked` with `reviewedAuthenticatedFunctionCount: 0`; this partial manual-review count does not satisfy the full 202-function activation gate. Production DB2 remains **NO-GO**. No Production DDL/DML, grants, policies, roles, accounts, application rows, or identity changes were performed. No Worker deployment, DNS change, or secret update occurred.
