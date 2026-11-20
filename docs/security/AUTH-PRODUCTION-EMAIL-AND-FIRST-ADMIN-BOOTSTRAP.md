# Production SendPulse and first-admin bootstrap — preparation only

Status: **code and contracts pass CI; neither route is deployed or executed in Production.** Target: Worker **sykabelajar-auth-prod**, D1 **sykabelajar-auth-prod**, issuer **https://auth-prod.sykabelajar.my.id/api/auth**, Supabase DB2 **mvdczyitbkxkldjughor**.

## Safety boundary

Current live Production state remains closed:

- AUTH_SIGNUP_DISABLED=true.
- SUPABASE_PROVISIONING_ENABLED=false.
- email_verification_required=1 in Production D1.
- There is no Better Auth user/account/session and no managed email provider row in Production D1.
- DB2 Stage 3 identity/FK/issuer DDL is not applied; 69 FKs still point to auth.users.
- No Production sender credentials, bootstrap tokens or provisioning key were installed in this continuation.

Two narrowly scoped internal endpoints are implemented in the preparation branch:

- services/auth-worker/src/production-email-bootstrap.mjs → POST /_internal/bootstrap-production-email
- services/auth-worker/src/production-first-account-bootstrap.mjs → POST /_internal/bootstrap-first-production-account

Worker CI #44683114356 passed Worker lint/typecheck/build and all 267 Worker tests; the email-bootstrap tests passed 9/9 and owner first-account tests passed 7/7. This was code/local test execution only. There was no Worker deploy, Production D1 write or email delivery.

## 1. One-time SendPulse provider bootstrap

Preconditions: separately approved Worker code deployment to the dedicated Production Worker; correct Production-only AUTH_EMAIL_ENCRYPTION_KEY already present; sender domain/address verified in SendPulse.

Add a random 32-byte-or-stronger value as Production Worker secret AUTH_EMAIL_BOOTSTRAP_TOKEN. Do not put the value in Git, Actions logs, source files, SQL or chat.

The endpoint accepts one POST, with no Origin header and the bearer token. The JSON body contains only the verified sender address (expected info@sykabelajar.my.id), sender name SYKABELAJAR and SendPulse API key.

Before writing D1, the Worker calls SendPulse's read-only SMTP statistics endpoint. It does not send a message. It then encrypts the API key with the Production-only AUTH_EMAIL_ENCRYPTION_KEY (AES-256-GCM), writes the first SendPulse provider row and consumes a one-time D1 marker. It requires zero Better Auth identities, accounts, sessions, verification rows, OAuth tokens and provider rows. It never opens public signup or provisioning.

Run from a trusted local terminal after the endpoint is deployed and the token is installed:

    umask 077
    payload="$(jq -n \
      --arg senderAddress 'info@sykabelajar.my.id' \
      --arg senderName 'SYKABELAJAR' \
      --arg apiKey "$SENDPULSE_API_KEY" \
      '{senderAddress:$senderAddress,senderName:$senderName,credentials:{apiKey:$apiKey}}')"

    curl --fail-with-body --silent --show-error \
      --request POST \
      --header "Authorization: Bearer $AUTH_EMAIL_BOOTSTRAP_TOKEN" \
      --header 'Content-Type: application/json' \
      --data-binary "$payload" \
      'https://auth-prod.sykabelajar.my.id/_internal/bootstrap-production-email'

    unset payload SENDPULSE_API_KEY AUTH_EMAIL_BOOTSTRAP_TOKEN

Expected success confirms only that the API key passed the read-only check and the encrypted provider row was written. The response explicitly says verificationEmailSent=false, publicSignupStillDisabled=true and supabaseProvisioningStillDisabled=true. No OTP/test email is sent by this operation.

After success, remove AUTH_EMAIL_BOOTSTRAP_TOKEN from the Production Worker secret store. Keep the consumed D1 marker. On any ambiguous failure/conflict, do not retry blindly; inspect D1 with SELECT-only queries.

## 2. Apply Production identity foundation and enable provisioning

Only after the SendPulse row is configured, the disposable Stage 3 baseline passes, the external backup destination checksum is verified in the private owner release record, and the exact Production DDL is explicitly approved:

1. Re-read DB2's live catalog immediately before DDL. Confirm the exact 69 FK source constraints, 62 source tables, Auth/profile triggers, policy/function inventory and PostgreSQL 17.6 version.
2. Generate and review the three-phase plan with scripts/auth-migration/generate-app-users-fk-plan.mjs. Do not use the checked-in catalog snapshot as the live apply source.
3. Apply docs/security/AUTH-STAGE-3-IDENTITY-ROOT-DRAFT.sql, then seed only UUID-only legacy_reference tombstones required by existing application FK values. Apply the generated FK plan in order: add replacement constraints NOT VALID, validate every replacement, then atomically swap the existing constraints while preserving their delete actions.
4. Verify private.app_users, the exact 69 replacement FKs, all provisioning RPC signatures, postgres ownership, SECURITY DEFINER/search_path and service_role-only EXECUTE grants. Confirm the three legacy Auth signup/referral triggers were retired by the identity-root transaction. Preserve every existing auth.users row, profile, role and application row.
5. Do not apply either issuer-guard draft yet. The RLS issuer restriction and SECURITY DEFINER guards are a separate final security step, applied only after the pinned owner account is genuinely verified and its real Production OIDC resource token is accepted by DB2. This ordering prevents a circular dependency: the owner can only be created after the Stage 3 projection RPCs are active.
6. Install only the Production DB2 server-side provisioning API key in the Production Worker secret store. This is not the Supabase Management API PAT and must never reach the browser, source code, logs or chat. Verify the exact Production project URL and D1-to-DB2 UUID projection.
7. Only after the core identity/FK and RPC checks pass may provisioning be enabled. The current closed-Worker deployment workflow intentionally pins SUPABASE_PROVISIONING_ENABLED=false. A separate owner-gated configuration workflow is still required; it must verify the Stage 3 core state, SendPulse provider row and Production provisioning-secret binding, change only this flag to true, and keep AUTH_SIGNUP_DISABLED=true. Do not manually toggle the flag or reuse the closed-Worker deploy workflow. The public Better Auth signup handler, social signups and application frontend remain signup-disabled; only the one-time internal owner route may create the pinned account.

Do not copy staging provisioning credentials. Stop on any mismatch, orphan UUID, catalog drift, unexpected FK action, permission regression or partial apply; never improvise a Production repair.

## 3. Create the one permitted owner account — public signup stays closed

The first-account route has a separate temporary owner token and exact email allowlist. It also requires the Production provisioning secret, the active SendPulse provider, required email verification and an entirely empty Better Auth D1 identity state.

This is the first Better Auth-only Production identity and therefore the documented point of no return. Before calling the endpoint, confirm the external backup checksum and accept that rollback to a Supabase-Auth-only application is no longer possible after the new identity is created. Do not reset, migrate or delete legacy/demo identities.

After Sections 1 and 2 pass, install these temporary Production Worker secrets:

- AUTH_FIRST_ACCOUNT_BOOTSTRAP_TOKEN: a random 32-byte-or-stronger value.
- AUTH_FIRST_ACCOUNT_EMAIL: the one exact owner email allowed to register. It must be an address the owner controls and can verify.

Do not put these values in Git, Actions logs, SQL or chat. Never set AUTH_SIGNUP_DISABLED=false. The normal HTTP Better Auth handler, social signups and application frontend remain signup-disabled. Only the internal handler creates a transient server-side Better Auth instance for one direct signUpEmail API call.

Run from a trusted local terminal. Keep all input values in a secure password manager/environment and do not echo them:

    umask 077
    payload="$(jq -n \
      --arg name "$OWNER_NAME" \
      --arg email "$AUTH_FIRST_ACCOUNT_EMAIL" \
      --arg password "$OWNER_ACCOUNT_PASSWORD" \
      '{name:$name,email:$email,password:$password}')"

    curl --fail-with-body --silent --show-error \
      --request POST \
      --header "Authorization: Bearer $AUTH_FIRST_ACCOUNT_BOOTSTRAP_TOKEN" \
      --header 'Content-Type: application/json' \
      --data-binary "$payload" \
      'https://auth-prod.sykabelajar.my.id/_internal/bootstrap-first-production-account'

    unset payload OWNER_ACCOUNT_PASSWORD AUTH_FIRST_ACCOUNT_BOOTSTRAP_TOKEN

The password must be 12–128 characters. The endpoint only accepts the email matching AUTH_FIRST_ACCOUNT_EMAIL. It consumes its D1 marker before calling Better Auth so that an ambiguous partial failure cannot be retried blindly. A 202 response means Better Auth accepted the signup and the verification request; it does not mean the account is already verified or has an active session.

If the endpoint reports FIRST_ACCOUNT_CREATE_OR_VERIFICATION_DELIVERY_UNCONFIRMED or another manualInspectionRequired error, **do not retry**. The marker may already be consumed and the account may have been partially created. Inspect D1 users/accounts/verifications/sessions and the marker with SELECT-only queries first.

### Complete the six-digit verification

The Better Auth Email OTP plugin sends the verification code through the configured SendPulse provider. The code is numeric, expires in five minutes and allows three attempts.

After receiving the code, verify it against the exact owner email through the Production Better Auth endpoint (from the trusted terminal):

    umask 077
    verify_payload="$(jq -n \
      --arg email "$AUTH_FIRST_ACCOUNT_EMAIL" \
      --arg otp "$OWNER_EMAIL_OTP" \
      '{email:$email,otp:$otp}')"

    verify_status="$(curl --silent --show-error \
      --output "$VERIFY_RESPONSE_FILE" \
      --write-out '%{http_code}' \
      --cookie-jar "$OWNER_COOKIE_JAR" \
      --request POST \
      --header 'Content-Type: application/json' \
      --data-binary "$verify_payload" \
      'https://auth-prod.sykabelajar.my.id/api/auth/email-otp/verify-email')"

    unset verify_payload OWNER_EMAIL_OTP
    test "$verify_status" = "200"

    curl --silent --show-error \
      --cookie "$OWNER_COOKIE_JAR" \
      'https://auth-prod.sykabelajar.my.id/api/auth/get-session' \
      --output "$SESSION_RESPONSE_FILE"

    jq -e '.user.emailVerified == true and (.user.id | type == "string")' \
      "$SESSION_RESPONSE_FILE" >/dev/null
    OWNER_BETTER_AUTH_UUID="$(jq -r '.user.id' "$SESSION_RESPONSE_FILE")"

Keep cookie jar and response files local with restrictive file permissions; never paste or publish their contents. The owner must confirm the session UUID and emailVerified=true. The email-verification callback then projects the same UUID into private.app_users and writes email_verified_at using the trusted server-side provisioning RPC. Verify that row with SELECT-only SQL. Never set emailVerified or email_verified_at manually.

### Verify the genuine Production token before issuer restrictions

From the same verified owner session, use the already-registered Production Custom OIDC and the approved PKCE/resource-token flow. Verify the token's exact issuer https://auth-prod.sykabelajar.my.id/api/auth, expected application audience, ES256 signature against the Production JWKS, and UUID sub matching Better Auth user.id, D1 projection and private.app_users.id. Use a safe authenticated read of only the owner's own DB2 profile to prove OIDC/Data API acceptance. Never fabricate a JWT or paste the token/cookie into chat.

Only after that real token succeeds, apply these two drafts in the exact disposable-workflow order:

1. docs/security/AUTH-STAGE-3-ISSUER-RESTRICTION-DRAFT.sql
2. docs/security/AUTH-STAGE-3-SECURITY-DEFINER-ISSUER-GUARDS-DRAFT.sql

Then run scripts/auth-migration/stage3-issuer-guard-regression.sql and confirm all 61 restrictive policies plus the Admin, organizer and collective Realtime SECURITY DEFINER paths reject legacy/untrusted issuers. The Production first-admin grant must not run before this step.

After verification, remove temporary AUTH_FIRST_ACCOUNT_BOOTSTRAP_TOKEN and AUTH_FIRST_ACCOUNT_EMAIL secrets from the Production Worker. Keep the one-time D1 marker. Do not open general public signup.

## 4. Grant the first Admin role

Only after the owner session is verified, DB2 projection is confirmed, the real Production token passes the OIDC/Data API check, and both issuer-guard drafts plus the regression pass:

1. Open the verified Production DB2 SQL Editor for project mvdczyitbkxkldjughor as postgres.
2. Run docs/security/AUTH-PRODUCTION-FIRST-ADMIN-BOOTSTRAP-DRAFT.sql once, replacing only the UUID sentinel with OWNER_BETTER_AUTH_UUID from that same verified Production session.
3. The SQL refuses to run unless all 69 FKs target private.app_users, none target auth.users, all 61 restrictive issuer guards match, identity_origin='better_auth', email_verified_at is non-null and the matching profile exists.
4. It inserts one active admin role for that Better Auth UUID. It does not create an identity, write auth.users, forge email verification or modify the existing legacy admin row.
5. Verify the grant with SELECT-only SQL, sign out/in and confirm the Admin session and Admin Settings path. Send a test mail only to the signed-in Admin address after the owner confirms the sender configuration.

## 5. Explicitly not done

- Production OIDC issuer registration is complete and verified, but no real Production owner token has been accepted yet.
- The updated Production Worker source containing both bootstrap routes is not deployed.
- No AUTH_EMAIL_BOOTSTRAP_TOKEN or AUTH_FIRST_ACCOUNT_BOOTSTRAP_TOKEN is installed.
- No AUTH_FIRST_ACCOUNT_EMAIL owner allowlist is installed.
- No Production SendPulse API key has been entered or tested; no Production email-provider row exists.
- No Production OTP/test email has been sent.
- No Production provisioning credential has been installed or enabled.
- No Stage 3 Production DB2 identity-root/FK/issuer DDL has been applied.
- No Production Better Auth identity/account/session has been created.
- No Production Admin role has been granted.
- The external backup destination checksum remains to be recorded in the private owner release record.
- No Production frontend auth switch has been performed.

