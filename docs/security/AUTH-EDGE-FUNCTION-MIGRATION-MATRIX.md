# Better Auth — Supabase Edge Function migration matrix

Status: **adapter and claim-contract tests prepared; application endpoints are not yet switched**. Snapshot date: 6 November 2026.

This is a staged implementation guide for Stage 5. It is not permission to deploy Edge Functions or alter production secrets. The Supabase project currently connected to this workspace is production-only; the Better Auth issuer must first pass Supabase Custom OIDC acceptance in an isolated test project, and Stage 3 identity provisioning/FK work must be approved before the user-facing functions are changed.

## Verified implementation contract

The supported Supabase server package is pinned to `@supabase/server@1.9.2`. The adapter in `supabase/functions/_shared/better-auth-user.ts` delegates cryptographic request-token verification to `createSupabaseContext(request, { auth: "user" })`. It never decodes a bearer token or implements JWT signature verification itself.

After cryptographic verification, `auth-claims.mjs` enforces the SYKABELAJAR resource contract:
- exact `BETTER_AUTH_ISSUER=https://auth.sykabelajar.my.id/api/auth`;
- exact `BETTER_AUTH_RESOURCE_AUDIENCE=https://sykabelajar.my.id`;
- UUID `sub`, matching Supabase `userClaims.id`;
- PostgreSQL `role=authenticated` only (never `admin`, `teacher`, `organizer_member`, or `student`);
- valid integer `iat`/`exp`, no future issue time beyond the 30-second clock tolerance, and maximum 300-second token lifetime.

The adapter fails closed with 503 if the expected issuer/audience settings are missing, or 401 for an invalid caller token/claim. It returns both `ctx.supabase` (caller JWT + RLS) and `ctx.supabaseAdmin` (service-role bypass); the latter must not be used until the relevant owner/business-role check succeeds.

This is only a shared adapter. The four existing user-invoked endpoint implementations still use Supabase Auth `getUser()`; no endpoint has switched to Better Auth JWT verification or been deployed. The `get-cloudinary-signature` source also received a separate owner-scoped `public_id` authorization guard, but it still verifies the legacy Supabase Auth token. These are source-branch changes only, intentionally not deployed until Stage 2/3 acceptance gates have passed.

## Function-by-function migration

| Function | Current authentication | Stage 5 target | Required authorization after identity verification |
|---|---|---|---|
| `get-cloudinary-signature` | `auth.getUser()` with caller Authorization header | `requireBetterAuthUser(req)` | Use the verified UUID only for the request context. The branch now adds an owner-scoped signer guard: profile avatar/cover IDs are derived from the caller-owned profile row, and organizer logo IDs are accepted only for rows whose `owner_user_id` matches the verified UUID. Continue to query with the caller-scoped client; do not use service-role for ownership. Do not move images to Supabase Storage; Cloudinary remains canonical. |
| `payment-gateway-create` | `auth.getUser()`, then service-role order lookup | `requireBetterAuthUser(req)` | Keep `orders.user_id === verified userId` before returning or mutating payment intent/provider data. Recheck pending/payable status, payment method selection, amount and idempotency server-side. Never trust a body-supplied user ID. |
| `payment-gateway-reconcile` | `auth.getUser()`, plus order lookup constrained by `user_id` | `requireBetterAuthUser(req)` | Keep the order lookup constrained by both order ID and verified UUID; ensure intent belongs to the same order. Only provider-verified status, amount and currency may trigger fulfillment. Browser return data is not payment proof. |
| `payment-gateway-admin` | `auth.getUser()`, user-context `is_active_admin()`, then service-role settings access | `requireBetterAuthUser(req)` | Call `ctx.supabase.rpc("is_active_admin", { p_uid: userId })` with the original caller context. Only after true may service-role reads/writes execute. Preserve safe settings responses and never return provider secrets. |
| `midtrans-create-payment` | Compatibility delegate; `verify_jwt=true` | Keep as a thin delegate or remove only after frontend callers are migrated | The target `payment-gateway-create` still independently verifies identity. Keep `verify_jwt=true` on both paths. |
| `payment-gateway-public` | Public status endpoint | Remain public | Return only deliberately public provider status; do not expose secret config, order data or admin actions. |
| `payment-webhook`, `payment-gateway-webhook` | Provider callbacks with `verify_jwt=false` | Remain outside user-JWT adapter | Keep provider signature verification, timestamp/replay handling, amount/currency checks and idempotent event processing. Never replace provider signature verification with a Better Auth user token. |

## Current platform JWT configuration

`supabase/config.toml` explicitly keeps `verify_jwt=true` for `get-cloudinary-signature`, `payment-gateway-admin`, `payment-gateway-create`, `payment-gateway-reconcile`, and the legacy `midtrans-create-payment` delegate. The two provider webhook endpoints remain `verify_jwt=false` because they authenticate using provider signatures. CI now tests these configuration boundaries.

## Two-user acceptance matrix required before deployment

Use only two synthetic Better Auth accounts in an isolated Supabase Free project. Let A and B be distinct UUID subjects.

| Test | Expected result |
|---|---|
| A calls Cloudinary signature for A's allowed profile path | Allowed |
| A requests B's profile namespace | Denied; no signature returned |
| A creates/reuses a payment for A's pending order | Allowed under existing business rules |
| A changes `order_id` to B's order | 404/denied; no provider request or payment-intent mutation |
| A reconciles A's order | Only status verified from provider can fulfill |
| A reconciles B's order/intent | 404/denied; no read of B's private payment data |
| Non-admin A calls payment-gateway-admin | 403; no privileged settings read/write |
| Admin A calls payment-gateway-admin | Allowed after user-scoped `is_active_admin()` passes; response contains no provider secret |
| Missing, malformed, expired, wrong-issuer, wrong-audience or wrong-signature JWT | Rejected before business logic |
| Valid Better Auth subject without a provisioned `private.app_users` identity | Rejected by the Stage 3 provisioning/identity gate; must not create shadow `auth.users` rows |
| Unsigned provider callback | Rejected by provider signature logic |
| Valid signed duplicate callback | Idempotent; no duplicate order fulfillment/ledger entries |

## Deployment sequence / stop conditions

1. Finish the real schema-only baseline export from the owner's trusted local environment; create the reproducible local database baseline.
2. Complete Custom OIDC positive/negative acceptance against an isolated Supabase project. Do not register the issuer in production as a substitute.
3. Complete Stage 3 `private.app_users`, provisioning, referral/email lifecycle and all 69 FK migration tests against the isolated target. Preserve phone-verification semantics for organizer creation.
4. Implement the endpoint changes above as a separate reviewable Stage 5 commit, then run the two-user matrix and full payment/webhook/Cloudinary regression tests.
5. Deploy the four user-facing functions only after explicit review of the exact function versions and verified project target. No production deploy is authorized by this document.
6. Confirm webhook endpoints remain reachable by providers and their signatures still validate. Keep `verify_jwt=false` only for external webhook/public endpoints with independent authentication or deliberately public responses.

Any missing issuer/audience setting, unverified JWT, missing application identity projection, owner mismatch, failed admin check, or unverified payment-provider response must fail closed.

## Official Supabase references

- Custom OIDC issuer, asymmetric JWKS, `role=authenticated`, UUID subject and RLS: https://supabase.com/docs/guides/auth/third-party/custom-oidc
- `@supabase/server` user-mode context and RLS-scoped/admin clients: https://supabase.com/docs/guides/functions/auth
- Pinned server package release: https://github.com/supabase/server/releases/tag/server-v1.9.2


## Deno type-check and verified-session admin bridge — 6 November 2026

## Deno type-check and verified-session admin bridge — 6 November 2026

The pinned Supabase Edge adapter was type-checked successfully with Deno 2.9.8 and `@supabase/server@1.9.2` in Supabase Local Auth Claims CI [#42214172513](https://github.com/taufx98/sykabelajar4.0/actions/runs/42214172513). The same run passed all 12 Edge JWT/webhook contract tests and 73/73 local pgTAP tests. The type-check caught and corrected the missing explicit `Request` parameter type before turning green.

Stage 1 ZeptoMail Admin UI is a pre-cutover bridge: it currently reads the existing Supabase Auth session and the Worker verifies that access token via the current Supabase `/auth/v1/user` endpoint, then calls `is_active_admin()` under the same caller token. It stores only encrypted Agent Send Mail Tokens in the isolated D1 and the test operation sends only to the verified admin's email. This bridge has not been browser-tested with a live admin session and has not sent real mail. Stage 4/5 must replace this bridge with a verified Better Auth access token and the accepted Supabase Custom OIDC identity path before production cutover.


## Full live Edge Function inventory — 6 November 2026

## Full live Edge Function inventory — 6 November 2026

A complete read-only download/source scan of all **15 currently active deployed Edge Functions** in production was performed on 6 November. The earlier four-function count described only direct `supabase.auth.getUser()` calls and was incomplete as a migration-surface count.

### User identity / Cloudinary surface

| Deployed function | Live version | Current live identity model | Authorization observation | Stage 5 action |
|---|---:|---|---|---|
| `get-cloudinary-signature` | 11 | `supabase.auth.getUser()` | The live production version accepts the caller's `public_id` after authentication but does not compare it with a caller-owned profile/organizer namespace. The branch now adds caller-scoped `profiles.username` and `organizers.owner_user_id` checks; not deployed. | Replace verifier with `requireBetterAuthUser` after OIDC/identity gates; keep owner-scoped signer and exact asset namespace. |
| `cloudinary-profile-upload` | 9 | Manual `GET /auth/v1/user` | Derives `profile_pictures/user_{UUID}` or `profile_covers/user_{UUID}` from the verified Supabase Auth response; does not trust a body-supplied owner ID. | Migrate to verified Better Auth UUID; keep the UUID-based public-ID format during compatibility window. |
| `cloudinary-profile-upload-v2` | 9 | Manual `GET /auth/v1/user` | Same caller-derived UUID path and image/size/kind checks. | Same as above; consolidate only after client callers are inventoried. |
| `cloudinary-delete-asset` | 9 | Platform `verify_jwt=true`, but handler only checks that a Bearer header exists | **High-priority owner-check gap:** the live handler does not resolve the caller UUID or compare it to `public_id` before signing a Cloudinary destroy request. Any valid JWT could potentially request deletion of a guessed asset ID. | Branch now contains a replacement source that resolves caller identity from the legacy Auth endpoint and permits only the caller's exact UUID-based avatar/cover IDs; it validates resource/delivery types and uses no body-supplied owner ID. It is not deployed. |
| `cloudinary-delete-asset-v2` | 9 | Manual `GET /auth/v1/user` | Restricts `public_id` to exactly `profile_pictures/user_{callerUUID}` or `profile_covers/user_{callerUUID}`. | Migrate auth verifier and retain exact owner check. |
| `cloudinary-delete-profile` | 9 | Manual `GET /auth/v1/user` | Same exact UUID-owned profile/cover restriction; this is the endpoint currently invoked by `src/services/cloudinary.service.ts`. | Migrate auth verifier and retain its existing caller/asset contract. |
| `payment-gateway-admin` | 5 | `supabase.auth.getUser()` then caller-context `is_active_admin()` | Business admin check exists; service-role is used only after admin check. | Use verified Better Auth user context, then re-run `is_active_admin()` under caller context before privileged access. |
| `payment-gateway-create` | 5 | `supabase.auth.getUser()` | Checks order owner UUID against verified user; service-role order/payment work follows. | Use verified Better Auth UUID and preserve owner/status/idempotency checks. |
| `payment-gateway-reconcile` | 1 | `supabase.auth.getUser()` | Constrains order/intent reads by verified user UUID; the branch explicitly pins `verify_jwt=true`. | Use verified Better Auth UUID, preserve owner and provider-verification/idempotency checks. |
| `midtrans-create-payment` | 10 | Compatibility delegator | Forwards the authorization header to `payment-gateway-create`; it is not a second independent user verifier. | Keep `verify_jwt=true` and preserve the downstream Better Auth verifier until frontend callers migrate; remove only after callsite audit. |

The remaining active functions are deliberately separate from user access-token migration:
- `payment-webhook` v9 and `payment-gateway-webhook` v4 have `verify_jwt=false` and validate provider signatures; keep provider authentication, replay/idempotency, amount/currency and fulfillment checks. Do not replace signatures with user JWTs.
- `payment-gateway-public` v2 is the intentionally public provider-status endpoint; keep its response free of secrets/order-private data.
- `generate-collective-certificate-pdf` v8 exposes a public certificate output route; verify certificate code/visibility semantics separately, not by forcing user JWT onto public verification.
- `cleanup-expired-chat-media` v9 is a service-role background cleanup endpoint with `verify_jwt=false`; its access/trigger should be retired with the already-approved private-chat removal, not treated as a general public API.

### Current branch vs deployed production

The branch contains:
- a caller-owned profile/organizer guard in `get-cloudinary-signature` (the deployed v11 still predates the guard);
- a replacement `cloudinary-delete-asset/index.ts` with caller UUID lookup and exact UUID asset ownership enforcement (the deployed v9 remains the weaker version);
- unit/static ownership tests for new and legacy Cloudinary public-ID formats;
- Deno type-check integration for `get-cloudinary-signature` and `cloudinary-delete-asset`.

These are branch-only changes. Do not claim production protection until the exact sources are deployed and a hosted two-user test proves A cannot sign or delete B's assets.

### Required two-user Cloudinary acceptance

Use only isolated synthetic users A/B:
1. A can upload/delete `profile_pictures/user_A` and `profile_covers/user_A`.
2. A cannot sign or delete either of B's UUID-based asset IDs.
3. A can sign only the username-derived avatar/cover matching A's profile row; a caller-supplied username does not grant access.
4. A can sign an organizer logo only when the organizer row's `owner_user_id=A`.
5. Malformed/traversal/encoded/unsupported public IDs, resource types and delivery types fail before any Cloudinary provider call.
6. Missing, expired, wrong-issuer, wrong-audience or wrong-signature Better Auth tokens fail before the owner query.
7. Browser response never returns Cloudinary API secret or signing key; only short-lived parameters/signature for an owned asset are returned.

No deployed Edge Function, secret, Supabase setting, Cloudinary asset, or production data was changed during this inventory.



## Latest CI status — 6 November 2026 (Cloudinary delete source hardening)

The latest combined CI [Auth Worker #42247015051](https://github.com/taufx98/sykabelajar4.0/actions/runs/42247015051) and [Supabase Local #42247014985](https://github.com/taufx98/sykabelajar4.0/actions/runs/42247014985) both completed successfully on commit `4c00fa315d0e8329d054b4d2d12feeea225ab4b2`. The Worker run passed 56 Worker tests, 12 JWT contract tests, 15 Cloudinary ownership/source tests, two frontend inventory tests, local D1 migration 0000–0004, Better Auth signup/email/session/OAuth integration and frontend lint/typecheck/build. Supabase Local passed Deno checks on the shared JWT adapter, new Cloudinary signer and replacement delete endpoint, and 83/83 pgTAP assertions.

The delete endpoint replacement is **not deployed**. The live production `cloudinary-delete-asset` v9 still only checks Bearer header presence without verifying the caller UUID against `public_id`. Keep this endpoint classified as a production hardening blocker until the branch replacement is reviewed, the synthetic A/B tests are complemented by hosted tests, and the controlled Edge Function deployment is complete. No current production function has been changed.


## Latest delete endpoint regression — 6 November 2026

The latest regression run [#42247915763](https://github.com/taufx98/sykabelajar4.0/actions/runs/42247915763) passed all 15 Cloudinary ownership/source tests, and [Supabase Local CI #42247915859](https://github.com/taufx98/sykabelajar4.0/actions/runs/42247915859) passed Deno type-check for the branch replacement endpoint. The replacement now rejects non-image resource types, preserves the existing browser CORS/OPTIONS contract, limits the auth lookup to five seconds and Cloudinary destroy request to eight seconds, resolves identity from Supabase's verified `/auth/v1/user` response, and permits only the exact UUID-based profile/cover paths for that caller. The generic deletion function is not yet deployed; live production version 9 remains unchanged.
