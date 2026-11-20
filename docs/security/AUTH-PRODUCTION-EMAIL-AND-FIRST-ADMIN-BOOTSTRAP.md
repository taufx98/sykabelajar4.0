# Production SendPulse and first-admin bootstrap — preparation only

Status: **implementation and tests are being prepared; not deployed or executed in Production.** Target: Worker **sykabelajar-auth-prod**, D1 **sykabelajar-auth-prod**, issuer **https://auth-prod.sykabelajar.my.id/api/auth**, Supabase DB2 **mvdczyitbkxkldjughor**.

## Safety boundary

Production remains closed:

- AUTH_SIGNUP_DISABLED=true.
- SUPABASE_PROVISIONING_ENABLED=false.
- email_verification_required=1 in Production D1.
- Production currently has no Better Auth users/accounts/sessions and no managed email provider account.
- Do not apply Stage 3 to DB2, open signup, enable provisioning, or switch the frontend until the remaining release gates pass and the owner approves the exact operation.

The bootstrap implementation lives in services/auth-worker/src/production-email-bootstrap.mjs and is routed by /_internal/bootstrap-production-email. It is **not yet deployed**. It is pinned to the exact Production Worker/Supabase project and fails closed in staging, when signup is open, when provisioning is enabled, when email verification is not required, or when any Better Auth identity/provider row already exists.

## 1. One-time SendPulse provider bootstrap

The owner will add a random 32-byte-or-stronger value as the Production Worker secret AUTH_EMAIL_BOOTSTRAP_TOKEN only after the guarded code deployment is approved. Do not put the value in Git, GitHub Actions logs, source files, SQL or chat.

The endpoint accepts one POST with no Origin header and a bearer token. The JSON body contains only:

- the verified SendPulse sender address (expected info@sykabelajar.my.id);
- the sender name SYKABELAJAR;
- the SendPulse SMTP API key.

Before writing D1, the Worker calls SendPulse's read-only SMTP statistics endpoint to verify the key. It does **not** send an email. It then encrypts the API key with the existing Production-only AUTH_EMAIL_ENCRYPTION_KEY using AES-256-GCM and inserts the first SendPulse provider account. The D1 batch also records a one-time consumed marker. A unique marker and zero-row preconditions prevent replay or concurrent duplicate insertion. The operation never enables signup or provisioning.

Example owner-operated request from a trusted local terminal after the endpoint is deployed and the Worker secret is set:

    # Load these values from a secure password manager; do not paste them into chat.
    # AUTH_EMAIL_BOOTSTRAP_TOKEN is the exact random secret installed on the Production Worker.
    # SENDPULSE_API_KEY is the SendPulse API key for the approved sender account.
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

Expected success response confirms only that the SendPulse API key passed the read-only check and the encrypted provider row was written. It explicitly reports verificationEmailSent=false, publicSignupStillDisabled=true and supabaseProvisioningStillDisabled=true. No OTP or test email is sent by this operation.

After confirmed success, immediately delete the temporary AUTH_EMAIL_BOOTSTRAP_TOKEN secret from the Production Worker. The D1 consumed marker remains as the durable one-time guard. If the call fails or reports a conflict, do not repeat blindly; inspect the D1 marker/provider row using SELECT-only checks and stop for review.

## 2. Production identity foundation and provisioning

Only after the SendPulse provider is configured and the full disposable Stage 3 baseline remains green:

1. Re-read DB2's live schema and all 69 FK definitions.
2. Obtain explicit owner approval for the exact Production DB2 DDL operation.
3. Apply the reviewed private.app_users identity root, UUID-only legacy-reference tombstones, all 69 FK replacements and issuer restrictions as one controlled sequence. Preserve all existing Auth rows, profiles, roles and application data.
4. Install the Production-only server-side Supabase provisioning API key in the Production Worker secret store. It is not the Supabase Management API PAT and must never be sent to the browser or chat.
5. Enable provisioning only after verifying the exact RPC signatures, postgres ownership, SECURITY DEFINER configuration, service-role-only EXECUTE grants, issuer restrictions and end-to-end disposable tests.

Do not copy staging provisioning credentials. Keep signup closed while this work is prepared.

## 3. Verified owner account and first Admin

After the identity foundation and provisioning are verified:

1. Temporarily open signup only through the guarded Production Worker release procedure. Keep mandatory email verification enabled.
2. Register the owner-controlled email account and complete the real six-digit SendPulse verification code. Confirm receipt in the mailbox. Never set emailVerified manually.
3. Confirm the same browser's /api/auth/get-session response contains the intended UUID and emailVerified: true.
4. Confirm the Worker has projected that exact UUID to private.app_users with identity_origin='better_auth' and a non-null email_verified_at.
5. Run docs/security/AUTH-PRODUCTION-FIRST-ADMIN-BOOTSTRAP-DRAFT.sql once in the verified Production DB2 SQL Editor as postgres, replacing only the UUID sentinel with the UUID from that same verified Production session.
6. The script refuses to run before all 69 FK targets and 61 issuer guard policies match Stage 3. It grants one Admin role only to the already verified Better Auth identity. It does not create an identity, set the verification timestamp, or modify any legacy Admin row.
7. Close public signup again immediately after the owner account has been created and the Admin role confirmed. Sign out/in and verify Admin Settings, then send a test email only to the signed-in Admin address. Confirm verification and password-reset delivery.
8. Keep the Production frontend disconnected until real token acceptance, RLS/Storage/Realtime/Edge tests and rollback gates pass.

## 4. Explicitly not done

- No AUTH_EMAIL_BOOTSTRAP_TOKEN has been installed.
- No SendPulse Production API key has been entered or tested.
- No Production email provider row has been written.
- No Production email has been sent.
- No Production account, Admin role or identity has been created.
- No Production Worker deployment or signup/provisioning flag change has been made.
- No Stage 3 Production DB2 DDL or frontend switch has been performed.
