# SYKABELAJAR 4.0 — Phase 14 Security / Anti-Abuse

Date: 2026-09-06
Status: COMPLETE

## Goal

Harden the exposed API surface and durable anti-abuse controls so privileged operations cannot be invoked anonymously, protected data remains RLS-enforced, and identity/payment/participation uniqueness rules are enforced at the database boundary.

## Implemented

- Locked `admin_*` RPCs to authenticated execution while retaining internal admin authorization checks.
- Locked high-impact participant/competition mutation RPCs to authenticated execution.
- Locked grading, manual-finalization, question mutation, daily reward, profile-verification, currency-log, and attempt-resume endpoints away from `anon`.
- Locked job/worker control functions away from both `anon` and `authenticated`; they are now internal execution surfaces.
- Locked Error Intelligence recovery/reporting functions away from `anon` while preserving authenticated use where required.
- Preserved intentional anonymous access only for public read/verification APIs and token-based collective participant APIs that do not use Supabase Auth.

## Identity / anti-farming integrity

- Organizer ownership remains unique per owner through the durable owner uniqueness index.
- Canonical participant identity remains unique per competition for individual and collective modes.
- Registration uniqueness remains competition/user/participation-key scoped.
- Collective participant code remains competition-scoped and unique.
- Daily check-in is uniquely constrained by user/date.
- Daily task claim is uniquely constrained by task/user/date.
- Referral events now enforce a single referred-user relationship globally at the database level.
- Referral lifecycle constraint was corrected to support the actual `PENDING → VERIFIED/CREDITED → REVOKED` workflow used by the verification worker.
- Existing free-organizer and referral anti-farming controls from Phase 4 remain intact.

## RLS

A production scan found **no public table with RLS disabled**.

Sensitive participant, credential, collective-session, order, certificate, organizer, and chat data remains protected by RLS and/or narrow authenticated/server RPC surfaces.

## Intentional public surfaces

The following remain intentionally callable by `anon` because their product flow requires them:

- Public competition/feed/leaderboard/statistics readers.
- Public certificate verification.
- Collective participant login and token-scoped participant work/result/certificate/chat APIs.

These functions perform their own scope validation and do not expose arbitrary authenticated-user data.

## Verification

- Sensitive admin/mutation RPC sample: `anon=false`, `authenticated=true`.
- Worker/job RPC sample: `anon=false`, `authenticated=false`.
- Intentional public APIs remain `anon=true`.
- Production RLS scan: zero public tables with `rowsecurity=false`.
- No production referral data existed during the constraint correction, so no data rewrite risk was introduced.

## Legacy safety

No destructive replacement of participant, organizer, registration, order, certificate, collective participant, or payment structures was performed.

## Exit criteria

- Privileged RPC anonymous execution is closed.
- Internal worker controls are not exposed to authenticated end users.
- RLS remains enabled across all public tables.
- Participation, ownership, daily reward, and referral abuse controls have durable database constraints.
- Public/token APIs required by the product remain functional.
- Final Phase 14 CI passes.

## Next phase

Phase 15 — Final QA + Freeze.
