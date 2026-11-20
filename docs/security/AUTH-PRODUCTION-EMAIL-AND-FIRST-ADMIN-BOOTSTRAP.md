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

Only after the sender row is configured and the disposable Stage 3 baseline still passes:

1. Re-read DB2's live schema and all 69 FK definitions.
2. Obtain explicit owner approval for the exact Production DB2 DDL sequence.
3. Apply the reviewed private.app_users identity root, UUID-only legacy-reference tombstones, all 69 FK replacements, 61 issuer guards and corrected function/trigger lifecycle. Preserve all existing Auth rows, profiles, roles and application data.
4. Install the Production-only server-side Supabase provisioning API key in the Production Worker secret store. This is not the Supabase Management API PAT; never expose it to the browser or chat.
5. Verify the exact RPC signatures, postgres ownership, SECURITY DEFINER/search_path, service-role-only EXECUTE grants, issuer restrictions and D1-to-DB2 projection behavior.
6. Only then set SUPABASE_PROVISIONING_ENABLED=true for the Production Worker. Keep AUTH_SIGNUP_DISABLED=true. The public signup path remains closed; only the dedicated internal first-account route can create the one pinned owner identity.

Do not copy staging provisioning credentials.

## 3. Create the one permitted owner account — public signup stays closed

The first-account route has a separate temporary owner token and exact email allowlist. It also requires the Production provisioning secret, the active SendPulse provider, required email verification and an entirely empty Better Auth D1 identity state.

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

After verification, remove temporary AUTH_FIRST_ACCOUNT_BOOTSTRAP_TOKEN and AUTH_FIRST_ACCOUNT_EMAIL secrets from the Production Worker. Keep the one-time D1 marker. Do not open general public signup.

## 4. Grant the first Admin role

Only after the owner session is verified and DB2 projection is confirmed:

1. Open the verified Production DB2 SQL Editor for project mvdczyitbkxkldjughor as postgres.
2. Run docs/security/AUTH-PRODUCTION-FIRST-ADMIN-BOOTSTRAP-DRAFT.sql once, replacing only the UUID sentinel with OWNER_BETTER_AUTH_UUID from the same verified Production session.
3. The SQL refuses to run unless all 69 FKs target private.app_users, none target auth.users and all 61 restrictive issuer guards match. It requires identity_origin='better_auth', a non-null email_verified_at and the matching profile.
4. It inserts one active admin role for that Better Auth UUID. It does not create an identity, write auth.users, forge email verification or modify the existing legacy admin row.
5. Verify the grant with SELECT-only SQL, sign out/in and confirm the Admin session and Admin Settings path. Send a test mail only to the signed-in Admin address after the owner confirms the sender configuration.

## 5. Explicitly not done

- The email and first-account bootstrap routes are not deployed to Production or staging.
- No AUTH_EMAIL_BOOTSTRAP_TOKEN or AUTH_FIRST_ACCOUNT_BOOTSTRAP_TOKEN is installed.
- No AUTH_FIRST_ACCOUNT_EMAIL owner allowlist is installed.
- No Production SendPulse API key has been entered or tested.
- No Production provider row or Better Auth identity/account/session has been written.
- No OTP/test email has been sent.
- No Production provisioning credential has been installed or enabled.
- No Production Admin role has been created.
- No Stage 3 Production DB2 DDL or frontend switch has been performed.
