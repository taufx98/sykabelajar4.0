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

This is only a shared adapter. The four existing user-invoked endpoint implementations still use Supabase Auth `getUser()` today and have **not** been rewritten or deployed. The helper is intentionally not wired until Stage 2/3 acceptance gates have passed.

## Function-by-function migration

| Function | Current authentication | Stage 5 target | Required authorization after identity verification |
|---|---|---|---|
| `get-cloudinary-signature` | `auth.getUser()` with caller Authorization header | `requireBetterAuthUser(req)` | Use the verified UUID only for the request context. Keep Cloudinary signing secret server-only; constrain permitted `public_id` namespace to the authenticated user's profile path where the current frontend contract permits. Do not move images to Supabase Storage; Cloudinary remains canonical. |
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
