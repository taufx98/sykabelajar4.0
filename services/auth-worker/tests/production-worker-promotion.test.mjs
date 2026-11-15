import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const workflow = read("../../../.github/workflows/auth-cloudflare-production-worker-promote.yml");
const productionConfig = read("../wrangler.production.toml");
const stagingConfig = read("../wrangler.toml");

test("Production Worker promotion requires one exact owner marker or manual confirmation", () => {
  assert.match(workflow, /^on:\n  push:/m);
  assert.match(workflow, /\.github\/auth-ops\/PROMOTE-PRODUCTION-WORKER-0001/);
  assert.match(workflow, /PROMOTE-PRODUCTION-WORKER-sykabelajar-auth-poc/);
  assert.match(workflow, /exact one-time Production promotion authorization/);
  assert.match(workflow, /github\.event_name == 'workflow_dispatch' \|\| github\.event_name == 'push'/);
  assert.doesNotMatch(workflow, /^  pull_request:/m);
  assert.match(workflow, /cancel-in-progress: false/);
});

test("promotion verifies the existing staging Worker/D1 and preserves the sole auth hostname", () => {
  assert.match(workflow, /scriptName = "sykabelajar-auth-poc"/);
  assert.match(workflow, /stagingD1Id = "7a4f9008-a1c6-42b6-8a04-abde12699248"/);
  assert.match(workflow, /productionD1Id = "6d4dc7b5-8e71-4fdc-9cda-3230e49951c7"/);
  assert.match(workflow, /d1Bindings\[0\]\.database_id \?\? d1Bindings\[0\]\.id/);
  assert.match(workflow, /domainList\.filter/);
  assert.match(workflow, /auth\.sykabelajar\.my\.id/);
  assert.match(workflow, /no DNS\/domain changes are permitted/);
  assert.match(workflow, /wrangler\.production\.toml deploy --dry-run/);
  assert.match(workflow, /wrangler\.production\.toml deploy --message/);
  assert.doesNotMatch(workflow, /wrangler d1 (delete|create)|workers\/scripts\/[^\s]+\/delete/);
});

test("promotion requires a fully migrated, empty Production D1 with verification enabled", () => {
  assert.match(workflow, /0008_auth_runtime_settings\.sql/);
  assert.match(workflow, /productionD1Name = "sykabelajar-auth-prod"/);
  assert.match(workflow, /email_verification_required\) AS email_verification_required/);
  assert.match(workflow, /Number\(row\.email_verification_required\) !== 1/);
  for (const field of ["users", "accounts", "sessions", "verifications", "access_tokens", "refresh_tokens", "consents", "email_accounts", "phone_challenges"]) {
    assert.match(workflow, new RegExp("Number\\(row\\." + field + "\\) !== 0"));
  }
  assert.match(workflow, /first_party_clients\) !== 1/);
  assert.match(workflow, /redirectUris\.length !== 1/);
  assert.match(workflow, /https:\/\/sykabelajar\.my\.id\/auth\/oidc\/callback/);
});

test("the new Worker must remain closed to public signup and Supabase provisioning", () => {
  assert.match(productionConfig, /^AUTH_SIGNUP_DISABLED = "true"$/m);
  assert.match(productionConfig, /^SUPABASE_PROVISIONING_ENABLED = "false"$/m);
  assert.match(productionConfig, /^SUPABASE_PROVISIONING_ENV = "production"$/m);
  assert.doesNotMatch(productionConfig, /DEV_APP_ORIGIN|OAUTH_STAGING_CALLBACK_URL|staging\.sykabelajar\.my\.id|ydamszdfsxqisanazdkb/);
  assert.match(stagingConfig, /^database_id = "7a4f9008-a1c6-42b6-8a04-abde12699248"$/m);
  assert.match(workflow, /emailVerificationRequired, true/);
  assert.match(workflow, /publicSignup: "closed"/);
  assert.match(workflow, /supabaseProvisioning: "disabled"/);
  assert.match(workflow, /mainFrontendSwitch: "not performed"/);
});

test("promotion removes staging-only secret bindings and generates fresh Production-only key material", () => {
  const rotation = workflow.slice(
    workflow.indexOf("name: Replace staging-only secrets with fresh Production-only Worker keys"),
    workflow.indexOf("name: Deploy the existing Worker resource to Production D1"),
  );
  assert.match(rotation, /SUPABASE_PROVISIONING_API_KEY/);
  assert.match(rotation, /SUPABASE_SERVICE_ROLE_KEY/);
  for (const name of [
    "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET",
    "FACEBOOK_CLIENT_ID", "FACEBOOK_CLIENT_SECRET",
    "TWITTER_CLIENT_ID", "TWITTER_CLIENT_SECRET",
    "AUTH_TELEGRAM_CLIENT_ID", "AUTH_TELEGRAM_CLIENT_SECRET",
  ]) assert.ok(rotation.includes(name), "staging social/Telegram secret must be removed: " + name);
  assert.match(rotation, /DELETE/);
  assert.match(rotation, /randomBytes\(32\)/);
  for (const name of ["BETTER_AUTH_SECRET", "AUTH_PROVIDER_ENCRYPTION_KEY", "AUTH_EMAIL_ENCRYPTION_KEY"]) {
    assert.ok(rotation.includes(name), "fresh Production key must be generated: " + name);
  }
  assert.match(rotation, /valuesReadOrLogged: false/);
  assert.doesNotMatch(rotation, /console\.log\([^\n]*(?:generatedKey|productionKeys|secretValue)/i);
});

test("post-promotion smoke tests preserve OIDC, exact CORS and zero seeded identity data", () => {
  assert.match(workflow, /discovery\.issuer, expectedIssuer/);
  assert.match(workflow, /key\.alg === "ES256"/);
  assert.match(workflow, /attacker\.example/);
  assert.match(workflow, /unauthenticated access/);
  assert.match(workflow, /EMAIL_VERIFICATION_DELIVERY_NOT_CONFIGURED/);
  assert.match(workflow, /Production D1 must remain identity\/credential-empty after the promotion smoke checks/);
});
