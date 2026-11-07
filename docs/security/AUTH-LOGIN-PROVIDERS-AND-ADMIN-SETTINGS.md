# Better Auth login provider policy and Admin settings panel

**Status:** Approved product requirement for Stage 4 UI/backend integration; provider UI is not part of Stage 3 production cutover.

## Provider priority

| Provider | Product decision | Initial state | Implementation notes |
|---|---|---|---|
| Google (Gmail account) | Primary social sign-in | Default ON once credentials are configured | Better Auth built-in Google provider. Use only `openid email profile`; do not request Gmail mailbox scopes. Require Google's verified-email signal. |
| Facebook | Optional sign-in | OFF until configured and tested | Better Auth built-in Facebook provider. Requires an App ID/Secret, exact callback, required permissions/app availability, and a hosted sign-in smoke test. |
| X (Twitter) | Optional sign-in | OFF until configured and tested | Better Auth built-in Twitter provider. Request `user.email` when supported by the X developer app; do not enable if a stable email claim cannot be returned and safely linked. |
| Instagram | Not offered as a general login provider | Unavailable | Meta's Instagram APIs are for professional Business/Creator accounts, not ordinary consumer accounts. This is not a suitable general "Sign in with Instagram" identity provider for SYKABELAJAR; do not implement a misleading login button or an unofficial workaround. |

"Google/Gmail login" means Google OAuth/OpenID Connect using the user's Google account. It does not mean accessing the user's Gmail inbox or requesting Gmail API permissions.

Google is the priority/default provider. The Admin panel may turn methods on/off, but it must prevent a configuration with no usable login path. Keep Better Auth email/password as the existing fallback unless a separate explicit product decision changes it. Facebook and X remain optional and default disabled until their credentials, provider-side app status, email claim behavior and callback have passed tests. Instagram must be visibly marked unavailable/not supported rather than shown as an activatable toggle.

References:
- Better Auth OAuth/social providers and built-in Facebook/Google/Twitter provider model: https://better-auth.com/docs/concepts/oauth
- Better Auth Twitter provider and the `user.email` scope: https://better-auth.com/docs/authentication/twitter
- Telegram phone verification is a separate account-verification workflow, not a Telegram SYKABELAJAR login option: https://core.telegram.org/bots/telegram-login
- Meta's Instagram API description limits the integration to Business/Creator accounts; the general consumer sign-in use case is not supported: https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api

## Admin panel requirement

Add a "Metode Login" panel under the existing Admin Core **Pengaturan** tab (`/admin/core?tab=settings`), adjacent to the existing ZeptoMail settings panel. Do not add a separate unrelated Admin route unless the Admin navigation is redesigned later.

The panel must display these rows, in this order:
1. Google / Gmail — primary, first and visually emphasized using the existing design tokens.
2. Facebook — optional.
3. X / Twitter — optional.
4. Instagram — unavailable, with a clear reason; no active switch.

For configurable providers show:
- Enabled/disabled switch with clear accessible label and current status.
- Credential status (not configured / saved securely / configuration needs review).
- Client ID field and write-only Client Secret field. Never return or prefill the saved secret.
- Exact callback URL and copy action.
- Save/test action and safe error text (never echo OAuth response bodies or credentials).
- Confirmation before disabling a live provider, plus a guard that keeps at least one usable login method active.
- A clear message when an optional provider is unavailable or lacks a verified email claim.

Use the current SYKABELAJAR dark design system, Plus Jakarta Sans, existing `Card`, `Button`, Badge and Lucide icon conventions. Keep the panel responsive and compact. Do not create sample credentials or fake provider health states.

## Credential and server configuration requirements

- Provider client secrets are server-side secrets only. Never store them in frontend environment variables, browser state beyond the write-only form field, logs, source code, or plaintext D1 columns.
- Store provider credentials encrypted in D1 with a dedicated `AUTH_PROVIDER_ENCRYPTION_KEY`; do not reuse the ZeptoMail encryption key or mix email secrets with OAuth secrets.
- Return only safe metadata such as provider, enabled flag, client ID (masked where suitable), `secretConfigured`, callback URL, and status. The secret is never returned by GET.
- Enforce active-admin authorization on every read/write/test operation. Admin role comes from the trusted application role projection, not Better Auth user metadata or client-submitted role claims.
- Use the Better Auth session as the caller identity after Stage 4 session migration; do not keep the old Supabase Auth access-token dependency for this new panel.
- Provider toggles are stored server-side. Rebuild/invalidate the cached Better Auth instance when its provider config revision changes, so a saved switch takes effect without a stale in-memory auth configuration.
- A provider is enabled only when its credentials are configured and server-side configuration validation succeeds. Saving credentials does not auto-enable Facebook or X.
- Keep the OIDC issuer and Supabase JWT contract unchanged: external social login authenticates the user into Better Auth; it does not become the Supabase JWT issuer and it never changes the PostgreSQL JWT `role: authenticated`.
- Do not provision Google/Facebook/X access tokens into `private.app_users`. They remain Better Auth accounts/tokens in D1, encrypted at rest by Better Auth's OAuth token encryption.

## Callback URLs

Use the custom auth host and the Better Auth callback path:
- Google: `https://auth.sykabelajar.my.id/api/auth/callback/google`
- Facebook: `https://auth.sykabelajar.my.id/api/auth/callback/facebook`
- X/Twitter: `https://auth.sykabelajar.my.id/api/auth/callback/twitter`

Verify the exact callback against the current Better Auth version and each provider console before activation. Never use wildcard callback URLs.

## UI implementation note: shadcn/ui Skills

The user provided https://ui.shadcn.com/docs/skills as the UI guidance source. Use it when building the provider panel and later admin UI. Its skill reads `components.json` to discover framework, Tailwind version, aliases, installed components, icon library and base component library; it helps the assistant use the project's actual APIs rather than inventing imports.

Current branch inspection (7 November 2026):
- No `components.json` exists in this repository.
- The project currently uses React 18, Tailwind CSS 3.4 and local UI primitives such as `src/components/ui/Button.tsx`, `Card.tsx`, `Badge.tsx`, plus `lucide-react`.
- Standard shadcn `switch`, `field`, and `tabs` components are not currently installed.

Do not claim that shadcn/ui Skills or the shadcn components are installed. Before Stage 4 UI implementation, inspect the actual branch and decide whether to install/configure shadcn in a small, scoped way. Avoid a framework/base-library migration or broad UI redesign. If retaining the current local primitives, follow shadcn's documented composition principles (semantic labels/descriptions/errors, accessible switch, field grouping, keyboard support and responsive layout) while using the existing project components and styles. If true shadcn components are installed, first inspect `components.json` and use the matching base API (Radix, Base UI or React Aria) instead of mixing APIs.

The official shadcn Skills installation command documented at the time of review is:
```bash
pnpm dlx skills add shadcn/ui
```
Installing this skill adds AI project context; it does not itself install all UI components. Components are added separately with the shadcn CLI and must match the project's selected base library.

## Stage boundaries

This is a **Stage 4 UI/auth-client requirement**. Stage 3 work may define backend schema/contract only after the production identity baseline is complete. Do not let the provider panel trigger a premature frontend cutover, merge PR #177, change production OAuth settings, or bypass the Stage 3 identity gates.
