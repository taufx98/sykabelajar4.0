# Better Auth + D1 Free-tier quota resilience

Status: implementation policy for the seven-stage auth migration. No production Cloudflare resource or Supabase Auth configuration is changed by this document.

## Architecture decision

**Better Auth + Cloudflare D1 remains the single authentication and session authority. Supabase PostgreSQL remains the application data and authorization backend.**

D1 is the primary auth store, not a disposable cache. It owns Better Auth users, password credentials, OAuth account records, verification state, sessions, OIDC grants/JWKS and rate-limit records. Supabase trusts the short-lived ES256 access JWT from the Better Auth issuer and continues to serve application data through Data API, Storage, Realtime and Edge Functions.

This is already a two-system design, but it is not two interchangeable login databases:

- Normal operation: the browser authenticates with Better Auth/D1 and uses its access JWT with Supabase.
- D1 read/write quota outage: Supabase application requests can continue with an already-issued JWT until that JWT expires. The current access-token lifetime is five minutes and refresh-token issuance is disabled; a new token/session lookup still needs Better Auth/D1.
- Supabase does not receive or store Better Auth passwords, D1 sessions, OAuth credentials or reset tokens. Therefore an automatic redirect to Supabase Auth cannot authenticate a Better Auth-only account.

Do not try to bypass Cloudflare limits by creating more D1 databases, Workers or accounts. The Free limits are enforced at account/plan level and multiple databases do not provide a supported quota multiplier.

## Current Cloudflare Free quotas (verify again before deployment)

According to Cloudflare's current public documentation:

| Resource | Workers Free allowance | What happens when exceeded |
|---|---:|---|
| Worker requests | 100,000/day | Cloudflare returns Error 1027; a request can be rejected before Worker code runs |
| D1 rows read | 5,000,000/day | D1 query requests fail until the daily reset |
| D1 rows written | 100,000/day | D1 query requests fail until the daily reset |
| D1 storage | 5 GB total | New writes and schema changes can fail when storage is full |

D1 daily read/write quota resets at 00:00 UTC (07:00 WIB). Stored D1 data is not erased when a daily row quota is reached.

Sources:
- https://developers.cloudflare.com/d1/platform/pricing/
- https://developers.cloudflare.com/d1/reference/faq/
- https://developers.cloudflare.com/changelog/post/2026-09-01-d1-free-tier-limit-enforcement/
- https://developers.cloudflare.com/workers/platform/limits/

## Failure handling

### 1. D1 read/write daily quota

The Worker recognises only Cloudflare's documented daily read/write quota messages. It returns a safe HTTP 503 response with:
- a stable machine-readable code (`D1_FREE_TIER_ROWS_READ_LIMIT_REACHED` or `D1_FREE_TIER_ROWS_WRITTEN_LIMIT_REACHED`);
- `Retry-After` in seconds until 00:00 UTC;
- `retry_at_utc`;
- `Cache-Control: no-store`;
- no raw database error, SQL, credential, or internal stack trace.

It does not redirect the user to Supabase Auth. The existing JWT continues to be usable by Supabase until its five-minute expiration. The frontend integration (Stage 4) must treat this as a temporary auth-service outage: preserve the visible app state/session until its actual expiry, show an understandable status, and retry after `Retry-After`. It must not erase local app state or force logout merely because one renewal request failed.

The Worker catch is only a final guard after Cloudflare returns the D1 quota error. It cannot prevent the quota from being reached.

### 2. Worker request daily limit

Cloudflare's 100,000/day request cap is enforced outside the application Worker. When it rejects a request (Error 1027), Worker code cannot catch the error, call Supabase, or customise the response.

Cloudflare documents route modes called fail-open and fail-closed. Fail-open bypasses the Worker and sends traffic to the origin as if the Worker were not configured; it does **not** switch authentication to Supabase. For a security-critical authentication Worker, do not use fail-open as a supposed authentication failover. Use fail-closed and let the app handle a network/1027 availability response with a recovery message. This behaviour must be tested with the eventual custom-domain routing before production.

The current `workers.dev` POC is not yet a production route and has no Supabase fallback origin.

### 3. D1 storage limit

Storage exhaustion is distinct from the daily row quotas. A new registration, session creation, password reset, or schema write may fail even after midnight UTC. Monitor database size and keep an approved cleanup/backup policy; never delete users, credentials, active sessions, or JWKS rows automatically to make room.

## Monitoring and prevention

D1 exposes `rowsRead`, `rowsWritten`, query latency and storage-size metrics in the Cloudflare dashboard and GraphQL Analytics API. The D1 Binding API also returns exact `rows_read` / `rows_written` metadata for individual queries. D1 analytics are retained for 31 days.

Source: https://developers.cloudflare.com/d1/observability/metrics-analytics/

Use these internal warning bands across the account's total D1 usage:

| Level | D1 rows read | D1 rows written | Worker requests | Action |
|---|---:|---:|---:|---|
| Observe | 3,000,000 (60%) | 60,000 (60%) | 60,000 (60%) | Review query insights and request trends |
| Warning | 3,750,000 (75%) | 75,000 (75%) | 75,000 (75%) | Investigate unusual login/verification loops and inefficient queries |
| Protect | 4,250,000 (85%) | 85,000 (85%) | 85,000 (85%) | Apply edge rate controls to abuse, stop nonessential repeated work, alert operator; preserve normal sessions where possible |
| Critical | 4,750,000 (95%) | 95,000 (95%) | 95,000 (95%) | Treat new auth operations as at risk; prepare degraded-mode messaging; do not attempt a database switch |

These are engineering warning thresholds, not Cloudflare platform guarantees. The final monitoring implementation must use account-level usage, avoid assuming analytics have zero delay, and must not create enough monitoring traffic or storage writes to worsen the quota.

### Monitoring source of truth

1. Cloudflare Dashboard → D1 → select the auth database → Metrics: inspect rows read/written, query latency and storage.
2. Cloudflare Dashboard → Billing → Billable Usage: inspect account-level usage and available usage notifications.
3. Use D1 GraphQL analytics for automated summaries when the monitoring workflow is implemented. Do not infer precise daily quota remaining from raw query counts; row counts are the relevant measure.
4. Cloudflare sends email alerts when D1 Free daily read/write limits are reached. This is a last-resort alert, not proactive prevention.

No Cloudflare paid feature, paid observability service, third-party paid monitor or extra paid database is approved.

## Why automatic Supabase Auth failover is not enabled

Supabase Custom OIDC can coexist with Supabase Auth and can trust multiple issuers, but every trusted issuer needs an explicit issuer restriction and an unambiguous identity mapping. Supabase's RLS `auth.uid()` resolves JWT `sub`; a second issuer can have a different `sub` for the same person. The current SYKABELAJAR identity plan assumes one canonical UUID in Better Auth, `private.app_users.id`, and JWT `sub`.

A transparent Supabase Auth fallback would therefore require, at minimum:

1. A separately designed and secured recovery credential/enrollment flow for every new Better Auth account. Better Auth password hashes and D1 sessions cannot be assumed to work in Supabase Auth.
2. A canonical identity-link table mapping each issuer + provider subject to one application user UUID, with conflict/duplicate-account protections.
3. A reviewed migration of every RLS policy and SQL function that assumes `auth.uid() = private.app_users.id`, or a proven method ensuring both issuers always issue the same canonical UUID.
4. Strict issuer allowlists in RLS, RPC, Edge Functions, Storage and Realtime.
5. Explicit account linking, email-verification, password-reset, logout/revocation, referral, role and admin-bootstrap behavior for both issuers.
6. Two-user IDOR and disaster-recovery tests before the second provider can be enabled.

This is a separate identity architecture, not a small quota-handling switch. It must not be silently added to Stages 1–3 or activated in production. If a real second login provider is later approved, treat it as a separately gated design decision while preserving the seven-stage roadmap.

## Implementation status

- [x] Document the D1/Supabase responsibility split and prohibit unsafe transparent auth failover.
- [x] Add safe Worker handling for the exact documented D1 daily read/write quota errors.
- [ ] Validate the new quota handler and all existing Worker auth/OIDC flows in current-head CI.
- [x] Stage 4: preserve the current auth identity snapshot on a known D1 daily-quota response, avoid rapid retry loops, and show the server-provided UTC retry point in the recovery UI.
- [ ] Stage 4: test Cloudflare Error 1027 / Worker request-cap handling on the eventual custom-domain route; the Worker cannot intercept a request rejected before execution.
- [ ] After staging D1 exists: configure dashboard monitoring/notifications and baseline normal rows-read, rows-written, request and storage use.
- [ ] Add proactive warning automation only after proving its freshness, free-tier limits, low overhead and no paid dependency.
- [ ] Before production: perform controlled D1 quota simulation in local/test code; never intentionally exhaust the production account's quota.
