import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const migration = read("../migrations/0009_auth_runtime_settings.sql");
const runtime = read("../src/auth-runtime-settings.ts");
const worker = read("../src/worker.ts");
const auth = read("../src/auth.ts");
const social = read("../src/social-provider-settings.ts");
const client = read("../../../src/services/betterAuthApi.client.ts");
const panel = read("../../../src/components/admin/AuthVerificationSettingsPanel.tsx");

test("email verification runtime policy is additive and defaults to required", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS auth_runtime_settings/);
  assert.match(migration, /email_verification_required INTEGER NOT NULL DEFAULT 1/);
  assert.match(migration, /CHECK \(email_verification_required IN \(0, 1\)\)/);
  assert.match(migration, /INSERT OR IGNORE INTO auth_runtime_settings/);
  assert.match(runtime, /row\?\.email_verification_required\s*!==\s*0/,
    "missing table/row/query failures must fail safe to verification required");
});

test("only an authenticated active Better Auth admin can read or change the setting", () => {
  assert.match(runtime, /isAllowedOrigin\(origin/);
  assert.match(runtime, /isBetterAuthTokenForIssuer\(token,\s*env\.BETTER_AUTH_URL\)/);
  assert.match(runtime, /resolveBetterAuthAdminIdentity\(/);
  assert.match(runtime, /BETTER_AUTH_ADMIN_REQUIRED/);
  assert.match(runtime, /request\.method\s*===\s*"GET"/);
  assert.match(runtime, /request\.method\s*!==\s*"PUT"/);
  assert.match(runtime, /typeof body\?\.emailVerificationRequired\s*!==\s*"boolean"/);
  assert.match(runtime, /updated_by=\?2/);
  assert.match(worker, /url\.pathname === "\/api\/admin\/auth-runtime-settings"/);
});

test("Worker rebuilds cached Better Auth when the Admin changes policy and gates signup only when required", () => {
  assert.match(worker, /const emailVerificationRequired = await readEmailVerificationPolicy\(env\)/);
  assert.match(worker, /existing\.emailVerificationRequired === emailVerificationRequired/);
  assert.match(worker, /createAuth\(env, config, emailVerificationRequired\)/);
  assert.match(worker, /!verificationRequired \|\| await isAuthEmailVerificationConfigured\(env\)/);
  assert.match(auth, /emailVerificationRequired = true/);
  assert.match(auth, /requireEmailVerification: emailVerificationRequired/);
  assert.match(auth, /sendOnSignUp: emailVerificationRequired/);
  assert.match(auth, /emailVerificationRequired && user\.emailVerified !== true/);
});

test("social providers and public discovery follow the same runtime policy", () => {
  assert.match(social, /safeProviders\.facebook && verificationRequired && !\(await isAuthEmailVerificationConfigured\(env\)\)/);
  assert.match(social, /provider === "facebook" && emailVerificationRequired && !emailVerificationConfigured/);
  assert.match(social, /emailVerificationRequired: await readEmailVerificationPolicy\(env\)/);
});

test("frontend signup, session, resource token and Supabase token honor the policy", () => {
  assert.match(client, /async function getEmailVerificationRequired\(\)/);
  assert.match(client, /verificationRequired && payload\.user\.emailVerified !== true/);
  assert.match(client, /verificationRequired && session\.user\.emailVerified !== true/);
  assert.match(client, /if \(\(await getEmailVerificationRequired\(\)\) && !\(await getEmailVerificationConfigured\(\)\)\)/);
  assert.match(client, /'\/api\/admin\/auth-runtime-settings', 'PUT'/);
});

test("Admin panel can disable and re-enable the policy and is hidden outside Better Auth staging", () => {
  assert.match(panel, /isBetterAuthEnabled\(\)/);
  assert.match(panel, /setEmailVerificationRequired\(required\)/);
  assert.match(panel, /Nonaktifkan sementara/);
  assert.match(panel, /Aktifkan verifikasi/);
  assert.match(panel, /window\.confirm/);
  assert.match(panel, /Bypass berarti alamat email belum terbukti milik pengguna/);
});

test("registration and login screens follow the same public runtime policy", () => {
  assert.match(register, /client\.getEmailVerificationRequired\(\)/);
  assert.match(register, /betterAuthPreview && emailVerificationRequired && emailVerificationConfigured !== true/);
  assert.match(register, /window\.location\.replace\(redirectTo\)/);
  assert.doesNotMatch(register, /betterAuthPreview && emailVerificationConfigured !== true/);
  assert.match(login, /client\.getEmailVerificationRequired\(\)/);
  assert.match(login, /emailVerificationRequired && needsEmailVerification/);
});

test("resource-token exchange accepts unverified staging sessions only while the runtime policy is disabled", () => {
  assert.match(client, /const emailVerificationRequired = await getEmailVerificationRequired\(\)/);
  assert.match(client, /emailVerificationRequired && latestSession\.user\.emailVerified !== true/);
});

test("D1 policy toggle workflow is hard-pinned to staging and supports explicit re-enable", () => {
  assert.match(policyWorkflow, /branches: \[security\/auth-poc-stage-1\]/);
  assert.match(policyWorkflow, /database_name = "sykabelajar-auth-poc"/);
  assert.match(policyWorkflow, /database_id = "7a4f9008-a1c6-42b6-8a04-abde12699248"/);
  assert.match(policyWorkflow, /SET-TEMPORARY-EMAIL-BYPASS-ON-STAGING-ONLY/);
  assert.match(policyWorkflow, /REQUIRE-EMAIL-VERIFICATION-ON-STAGING-ONLY/);
  assert.ok(policyWorkflow.indexOf("SET-STAGING-EMAIL-VERIFICATION-REQUIRED-0001") < policyWorkflow.indexOf("SET-STAGING-EMAIL-VERIFICATION-BYPASS-0001"),
    "re-enable marker must take precedence over the retained bypass marker");
  assert.match(policyWorkflow, /email_verification_required=0/);
  assert.match(policyWorkflow, /email_verification_required=1/);
});
