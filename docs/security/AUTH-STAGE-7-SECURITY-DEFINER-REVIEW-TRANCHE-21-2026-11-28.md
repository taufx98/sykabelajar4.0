# Stage 7 SECURITY DEFINER manual review — Tranche 21

Date: 28 November 2026  
Project: Production DB2 `mvdczyitbkxkldjughor` (PostgreSQL 17.6)  
Scope: five token-bound collective linear-exam SECURITY DEFINER RPCs and their private session/access/hash helpers  
Decision: **accepted for partial unique-signature review count; Production remains NO-GO**

## Exact signatures and SELECT-only Production catalog evidence

The five public functions were re-read from the Production PostgreSQL catalog using SELECT-only queries on 28 November. Their current `md5(pg_proc.prosrc)` fingerprints match the immutable 21 November triage inventory. Each is owned by `postgres`, SECURITY DEFINER, PL/pgSQL, returns `jsonb`, has an empty function `search_path`, and has effective EXECUTE for `anon`, `authenticated`, and `service_role`. None has a direct `PUBLIC=EXECUTE` ACL entry.

| Exact signature | Production `md5(prosrc)` | Owner / SECDEF | `search_path` | Return type | API EXECUTE |
|---|---|---|---|---|---|
| `start_collective_linear_exam_attempt(uuid,text)` | `e0cb760153c8d32cfc3a4dd7a094bf3f` | postgres / true | empty | jsonb | anon, authenticated, service_role |
| `get_collective_linear_exam_state(uuid,text)` | `6e8de1b7cf650fe44ef470bc6a7cdb97` | postgres / true | empty | jsonb | anon, authenticated, service_role |
| `save_collective_linear_exam_draft(uuid,text,uuid,jsonb)` | `c00ff9db0800c4ebad0197ce8f49f90a` | postgres / true | empty | jsonb | anon, authenticated, service_role |
| `answer_collective_linear_exam_question(uuid,text,uuid,jsonb,boolean)` | `127d65f07194685cc631e2a934a762b1` | postgres / true | empty | jsonb | anon, authenticated, service_role |
| `skip_collective_linear_exam_question(uuid,text)` | `9db307e948270835d17b305d5609d6d4` | postgres / true | empty | jsonb | anon, authenticated, service_role |

All five canonical ACL grantors are `postgres`; the ACL set is `anon=EXECUTE/postgres,authenticated=EXECUTE/postgres,postgres=EXECUTE/postgres,service_role=EXECUTE/postgres`. The Stage 3 draft does not add or revoke grants; it first compares exact source fingerprints, owner, SECURITY DEFINER flag, `search_path`, return type, language, full canonical ACL (including grantor and grant-option state), and effective EXECUTE privileges.

The supporting private helpers were also fingerprinted from Production:

| Exact signature | Production `md5(prosrc)` | Owner / SECDEF | `search_path` | ACL |
|---|---|---|---|---|
| `private.assert_collective_linear_exam_access(uuid,text)` | `df41031f29e376c9b4d5cb8966a09028` | postgres / true | empty | postgres EXECUTE only |
| `private.collective_session_participant(text)` | `6d794ce4a3c96f20324f9ba81ac8658f` | postgres / true | public, private | PUBLIC and postgres EXECUTE |
| `private.hash_collective_token(text)` | `2be53e800f6ecb6995cef723b88806d7` | postgres / false | pg_catalog, extensions, private | PUBLIC and postgres EXECUTE |

The helper ACLs are not public API exposure: the `private` schema's USAGE remains unavailable to API roles, and the Stage 3 regression asserts that schema boundary. The draft preflight deliberately pins the actual catalog ACL for these helpers rather than normalizing or changing it.

## Manual source review and authorization boundary

- **`start_collective_linear_exam_attempt(uuid,text)`:** resolves the session token to a collective participant through `private.collective_session_participant`; rejects an absent/invalid session with `COLLECTIVE_SESSION_INVALID`; confirms the resolved participant is ACTIVE and belongs to the requested competition, otherwise raises `PARTICIPANT_NOT_REGISTERED`. It reuses an active linear attempt or delegates first-attempt creation to the existing token-bound collective start RPC, then prepares the linear runtime and returns the state projection.
- **`get_collective_linear_exam_state(uuid,text)`:** first calls `private.assert_collective_linear_exam_access`, resolves timeouts, and returns the state projection. The caller cannot choose an arbitrary attempt UUID independently of its token.
- **`save_collective_linear_exam_draft(uuid,text,uuid,jsonb)`:** first runs the same access assertion, locks the attempt/runtime/current question, verifies the supplied question matches the active position and that the time window is valid, validates the JSON payload type/size, and saves only the answer draft for that question.
- **`answer_collective_linear_exam_question(uuid,text,uuid,jsonb,boolean)`:** first runs the same access assertion, resolves timeouts, locks the attempt/runtime/current question, checks question identity/deadline and payload shape/size, stores or skips the answer, advances the state machine, and returns the next state. Answer-key snapshots are not part of the participant state projection.
- **`skip_collective_linear_exam_question(uuid,text)`:** first runs the same access assertion, resolves timeouts, locks the current state, deletes the current answer if appropriate, advances the state machine, and returns the next state.

The common authorization chain is:
1. `private.collective_session_participant(token)` hashes the presented token using `private.hash_collective_token`, then requires an existing session whose hash matches, `revoked_at IS NULL`, `expires_at > now()`, and `session_type='COMPETITION'`; it resolves the associated collective participant.
2. `private.assert_collective_linear_exam_access(attempt_id, token)` re-resolves that participant and checks that the requested `attempts.id` belongs to that exact `collective_participant_id`; otherwise it raises `ATTEMPT_NOT_FOUND`.
3. The start RPC separately confirms that the requested competition matches the resolved participant and that the participant is active.

This protects both session possession and object ownership. A valid token for one participant cannot be replayed against another competition or another participant's attempt. Expired and revoked sessions fail before state or mutation work.

## Rollback-only disposable regression

The existing Stage 3 SQL regression now seeds a dedicated synthetic PRIVATE + LIVE + COLLECTIVE_TEACHER competition by INSERT, with a separate synthetic collective participant and two published questions. This avoids mutating the existing Tranche 12 `RESULT_PUBLISHED` fixture; an initial baseline attempt caught the competition status trigger rejecting a direct UPDATE with `STATUS_MUST_USE_TRANSITION_RPC`. The fixture was corrected to insert a separate LIVE competition, without weakening the trigger or changing an application function.

Three synthetic session rows are created for the same participant:
- a valid `COMPETITION` session with a future expiry and no revocation;
- an expired session;
- a revoked session.

A separate synthetic attempt is created for another collective participant to test cross-attempt access. Under the `anon` role, the rollback-only regression verifies:
- an unknown token cannot start an exam;
- a valid token cannot start an exam for a different competition;
- the valid token starts its own attempt and receives an ACTIVE state with the expected first question;
- state output does not reveal answer-key data;
- wrong, expired, and revoked tokens cannot read the attempt state;
- a valid token cannot read another participant's attempt UUID;
- wrong tokens cannot save a draft, submit an answer, or skip a question;
- the valid token can save a draft, answer the first question, advance to the second question, and skip to the completed state.

All fixture inserts, attempt creation, answer writes, session use, and role/claim setup run inside the existing disposable transaction ending in `ROLLBACK`. The private helper and public RPC preflight also runs only on the schema-only disposable restore.

## Protected baseline and CI evidence

Protected Auth Production Schema Baseline [#46141402273](https://github.com/taufx98/sykabelajar4.0/actions/runs/46141402273) passed **78/78 steps** on commit `43be40d178f6f36481dda9105428b7689947c361`. Stage 3 trusted-issuer RLS acceptance (step 48) passed, executing the new token/session/attempt assertions on the PostgreSQL 17.6 disposable restore. The run also passed post-Stage-3 issuer checks, all 23 direct RLS table boundaries, all 14 collective portal invalid-token checks, valid portal acceptance, 5,000 selector collision cases, 69-FK rollback, full Stage 3 rollback, two-user Cloudinary/payment Edge integration, and cleanup of the disposable Supabase stack and schema export.

Supabase Local Auth Claims [#46141402312](https://github.com/taufx98/sykabelajar4.0/actions/runs/46141402312) passed **23/23**. Cloudflare staging preflight [#46141402275](https://github.com/taufx98/sykabelajar4.0/actions/runs/46141402275) passed **9/9** read-only. Auth Worker frontend lint/typecheck/build [#46141402256](https://github.com/taufx98/sykabelajar4.0/actions/runs/46141402256) passed **10/10**. The Auth Schema PR Contracts and correction PR #361 static suite [#46141253963](https://github.com/taufx98/sykabelajar4.0/actions/runs/46141253963) passed **30/30**. The broader Auth Worker audit job separately failed its pre-existing `Verify payment Edge Function identity migration boundaries` test; no payment source was touched by this tranche and that failure is not represented as a passing check.

**Cumulative accepted unique manual review: 103/202 exact signatures; 99 remain (51.0%).** This adds five signatures whose Production fingerprints were checked against all prior tranche reports and were not previously accepted. The immutable 21 November triage inventory remains unchanged. The all-functions activation manifest remains `status: blocked` with `reviewedAuthenticatedFunctionCount: 0`; partial SECURITY DEFINER review progress does not satisfy the full 202-function activation gate. Production DB2 remains **NO-GO**. No Production DDL/DML, grants, policies, roles, accounts, or application data were changed. No Worker deployment, DNS change, or secret update occurred.
