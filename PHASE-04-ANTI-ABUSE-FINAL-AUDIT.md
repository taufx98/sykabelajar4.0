# Phase 4 — Anti-abuse / Anti-farming Final Audit

Status: **IMPLEMENTED**

## Free organizer anti-farming

- Creating a self-service organizer now requires a confirmed email and a confirmed phone number.
- The verified phone number is normalized and stored only as a SHA-256 identity hash in the private schema.
- One verified phone identity can claim only one organizer through the self-service free-organizer path.
- The same authenticated user remains limited to one owned organizer.
- Admin-created organizers bypass the end-user free-organizer identity guard.
- Existing production organizer owners were not retroactively blocked because they currently have no confirmed phone numbers.

## Referral anti-farming

- A referred account must have a confirmed email before it can become eligible for referral verification.
- A referred user can generate at most one referral event globally.
- Referral rewards are now created as `PENDING` and are not immediately credited.
- The existing verification worker credits the reward only after the referred user performs qualifying activity.
- Reward ledger insertion remains idempotent by `(user_id,event_type,event_id)`.

## Production verification

- Existing referral events: 0.
- Existing organizer free-identity claims: 0 before rollout.
- Existing organizers: 2.
- Existing organizer owners with confirmed phone numbers: 0.
- No production organizer data was modified by the migration.

## Deliberate scope boundary

Device/IP fingerprinting and CAPTCHA are not treated as database identity controls because reliable client/device signals require an edge/application integration. The database now enforces the durable business control at the organizer free-benefit boundary; a future edge layer can add velocity/risk scoring without changing the entitlement model.

## Exit criteria

Phase 4 anti-abuse core controls are implemented and ready to proceed to the next phase. CI verification must remain green for commit `bbf066a3461a800eb169a26e9deae3f36c612c50`.
