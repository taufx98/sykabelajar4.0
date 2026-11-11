# Stage 5 — isolated staging dependency map

Audit date: 11 November 2026  
Target: isolated Supabase Free staging project `ydamszdfsxqisanazdkb` only.  
Status: **source handlers and identity adapter pass CI; deployment intentionally held until schema and environment dependencies are satisfied.**

This inventory is based on the current `security/auth-poc-stage-1` handler sources and read-only inspection of the staging catalog. It is not approval to deploy Production functions or copy Production credentials.

## Shared identity contract

All migrated application handlers use `requireApplicationUser()`. The exact isolated staging project selects the Better Auth verifier by project URL; that verifier pins:

- Issuer: `https://auth.sykabelajar.my.id/api/auth`
- Audience: `https://sykabelajar.my.id`
- Public signing keys: Better Auth JWKS at the fixed issuer host
- JWT subject: UUID; PostgreSQL role: `authenticated`; maximum lifetime: 300 seconds

The resolver returns a caller-scoped RLS client. A service-role client must only be used after explicit ownership or business-role checks. The Supabase Edge runtime provides its normal project environment; do not put the Cloudflare Worker provisioning key into Supabase Edge Function secrets.

## Per-handler schema and environment inventory

| Handler | Direct table/RPC dependencies in source | Additional environment/configuration |
|---|---|---|
| `get-cloudinary-signature` | `profiles(id, username)`; `organizers(id, slug, owner_user_id)` when an organizer public ID is requested | `CLOUDINARY_API_SECRET`, `CLOUDINARY_API_KEY`, `CLOUDINARY_CLOUD_NAME`; optional `CLOUDINARY_PROFILE_PRESET` |
| `cloudinary-profile-upload` | Shared identity resolver only; no direct table query | `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `CLOUDINARY_CLOUD_NAME` |
| `cloudinary-profile-upload-v2` | Shared identity resolver only; no direct table query | `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `CLOUDINARY_CLOUD_NAME` |
| `cloudinary-delete-asset` / `cloudinary-delete-asset-v2` | Shared identity resolver and Cloudinary ownership helper; no direct table query in handler | No additional handler-specific environment variable found in handler source; inspect any downstream Cloudinary helper before deployment |
| `cloudinary-delete-profile` | `profiles(id, username)` | `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `CLOUDINARY_CLOUD_NAME` |
| `payment-gateway-admin` | `payment_gateway_state`, `payment_gateway_configs`, RPC `is_active_admin` under the caller JWT | `MIDTRANS_ENV`, `MIDTRANS_SERVER_KEY`, `MIDTRANS_CLIENT_KEY`; Supabase runtime service-role environment |
| `payment-gateway-create` | `orders`, nested `order_items`, `organizer_payment_methods`, `payment_gateway_state`, `payment_gateway_configs`, `payment_intents`, `profiles(full_name, whatsapp)` | `MIDTRANS_ENV`, `MIDTRANS_SERVER_KEY`; XenithPay credentials are read from the selected row in `payment_gateway_configs.secret_config`; Supabase runtime service-role environment |
| `payment-gateway-reconcile` | `orders`, `payment_intents`, `payment_gateway_configs`, `payment_events`, RPC `process_payment_gateway_success` | XenithPay credentials are read from `payment_gateway_configs.secret_config`; Supabase runtime service-role environment |
| `midtrans-create-payment` | Delegates to `payment-gateway-create` | Supabase runtime `SUPABASE_URL` and `SUPABASE_ANON_KEY`; downstream create handler must be ready first |

Provider webhooks are separate: they authenticate with provider signatures, timestamps/replay and idempotency checks. They must not be made dependent on an end-user Better Auth JWT.

## Live staging schema comparison

Read-only catalog checks on 11 November found:

- `profiles` exists with `id`, `username`, `full_name`, `account_type` and profile hydration fields.
- `organizers` exists with `id`, `slug`, `owner_user_id` and `status`.
- `profiles.whatsapp` is not present in the current staging table shape, although the payment-create XenithPay path reads it as a fallback.
- These payment tables are absent: `orders`, `order_items`, `organizer_payment_methods`, `payment_gateway_state`, `payment_gateway_configs`, `payment_intents`, `payment_events`.
- The staging project currently has only 20 auth/identity/referral/organizer fixture tables and only the `better-auth-oidc-acceptance` Edge Function deployed. It is not a full application-schema clone.
- The verified identity and admin state remains empty; no staging user, session, profile, role, order or payment record has been seeded.

## Deployment gates

1. Keep all handler deployments limited to `ydamszdfsxqisanazdkb`. The repository's `supabase/config.toml` names the Production project ref; never use it as the target for this staging operation.
2. Prepare an additive, schema-only staging migration for the minimum application dependencies and their required types, indexes, constraints, policies, grants, and trusted RPCs. Do not copy Production rows, auth credentials, API secrets, or payment state. Preserve the existing Better Auth identity-root and issuer guards; do not restore legacy `auth.users` signup triggers.
3. Include the missing `profiles.whatsapp` contract only after confirming its exact Production type/nullability and profile update policy. Do not broaden profile write permissions.
4. Install staging-only Cloudinary credentials before enabling live upload/signature/delete calls. Use a test public-ID namespace and do not test deletion against real production assets.
5. Payment endpoints remain un-deployed until a dedicated sandbox merchant configuration exists. Do not copy live Midtrans/XenithPay production secrets or payment config rows into staging. Seed no real orders, payment intents or events.
6. Deploy one handler family at a time with explicit `verify_jwt=false` only where `requireApplicationUser()` performs cryptographic verification inside the handler, or where a provider-signed webhook requires it. Preserve public/provider-signature endpoint boundaries.
7. Run the two-user IDOR matrix from [AUTH-EDGE-FUNCTION-MIGRATION-MATRIX.md](AUTH-EDGE-FUNCTION-MIGRATION-MATRIX.md), plus unauthenticated, malformed-token, wrong-issuer, wrong-audience and expired-token tests before treating Stage 5 hosted acceptance as complete.

## What this audit does not authorize

- No Production Edge Function deployment or secret changes.
- No copy of Production provider credentials, business rows or user data.
- No broad 112-table import into the staging project.
- No public signup or first-admin bootstrap.
- No payment-provider calls, Cloudinary destructive calls or real transactions.

The shared Better Auth identity adapter and all nine source handler migrations passed [Auth Worker CI #42949842815](https://github.com/taufx98/sykabelajar4.0/actions/runs/42949842815). This only establishes source/type/security contracts, not hosted application-handler acceptance.
