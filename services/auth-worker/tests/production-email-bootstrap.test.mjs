import test from "node:test";
import assert from "node:assert/strict";
import { handleProductionEmailBootstrap } from "../src/production-email-bootstrap.mjs";

const ownerToken = "owner-only-production-bootstrap-token-2026-11";
const providerToken = "sendpulse-local-test-api-key-0123456789";
const encryptionKey = "local-only-email-encryption-key-with-32-bytes";

const productionEnv = Object.freeze({
  BETTER_AUTH_URL: "https://auth-prod.sykabelajar.my.id",
  APP_ORIGIN: "https://sykabelajar.my.id",
  SUPABASE_PROVISIONING_ENV: "production",
  SUPABASE_PROVISIONING_URL: "https://mvdczyitbkxkldjughor.supabase.co",
  SUPABASE_URL: "https://mvdczyitbkxkldjughor.supabase.co",
  AUTH_EMAIL_PROVIDER: "managed",
  AUTH_SIGNUP_DISABLED: "true",
  SUPABASE_PROVISIONING_ENABLED: "false",
  AUTH_EMAIL_BOOTSTRAP_TOKEN: ownerToken,
  AUTH_EMAIL_ENCRYPTION_KEY: encryptionKey,
});

function emptyState(overrides = {}) {
  return {
    users: 0,
    accounts: 0,
    sessions: 0,
    verifications: 0,
    access_tokens: 0,
    refresh_tokens: 0,
    email_accounts: 0,
    bootstrap_markers: 0,
    email_verification_required: 1,
    auto_failover_enabled: 1,
    ...overrides,
  };
}

function mockEnv(state = emptyState(), batchChanges = [1, 1, 1]) {
  const captured = { preflightCalls: 0, statements: null, batchCalls: 0 };
  const DB = {
    prepare(sql) {
      return {
        sql,
        values: [],
        bind(...values) {
          this.values = values;
          return this;
        },
        async first() {
          captured.preflightCalls += 1;
          return state;
        },
      };
    },
    async batch(statements) {
      captured.batchCalls += 1;
      captured.statements = statements;
      return batchChanges.map((changes) => ({ success: true, meta: { changes } }));
    },
  };
  return { env: { ...productionEnv, DB }, captured };
}

function request({
  token = ownerToken,
  origin,
  body = {
    senderAddress: "info@sykabelajar.my.id",
    senderName: "SYKABELAJAR",
    credentials: { apiKey: providerToken },
  },
  method = "POST",
} = {}) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (token) headers.set("Authorization", "Bearer " + token);
  if (origin) headers.set("Origin", origin);
  const payload = method === "GET" ? undefined : JSON.stringify(body);
  if (payload !== undefined) headers.set("Content-Length", String(new TextEncoder().encode(payload).length));
  return new Request("https://auth-prod.sykabelajar.my.id/_internal/bootstrap-production-email", {
    method,
    headers,
    body: payload,
  });
}

test("Production SendPulse bootstrap rejects browser origins before database access", async () => {
  const { env, captured } = mockEnv();
  const response = await handleProductionEmailBootstrap(
    request({ origin: "https://sykabelajar.my.id" }),
    env,
    { checkSendPulseConnection: async () => ({ total: 1 }), encryptEmailSecret: async () => "cipher" },
  );
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, "ORIGIN_NOT_ALLOWED");
  assert.equal(captured.preflightCalls, 0);
  assert.equal(captured.batchCalls, 0);
});

test("Production SendPulse bootstrap requires the one-time owner token", async () => {
  const { env, captured } = mockEnv();
  const response = await handleProductionEmailBootstrap(
    request({ token: "wrong-owner-token-012345678901234567890" }),
    env,
    { checkSendPulseConnection: async () => ({ total: 1 }), encryptEmailSecret: async () => "cipher" },
  );
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, "BOOTSTRAP_AUTH_FAILED");
  assert.equal(captured.preflightCalls, 0);
  assert.equal(captured.batchCalls, 0);
});

test("Production bootstrap is unavailable unless exact Production stays closed", async () => {
  const { env, captured } = mockEnv();
  env.AUTH_SIGNUP_DISABLED = "false";
  const response = await handleProductionEmailBootstrap(
    request(),
    env,
    { checkSendPulseConnection: async () => ({ total: 1 }), encryptEmailSecret: async () => "cipher" },
  );
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error, "BOOTSTRAP_NOT_AVAILABLE");
  assert.equal(captured.preflightCalls, 0);
  assert.equal(captured.batchCalls, 0);
});

test("bootstrap refuses any existing D1 identity, provider account or consumed marker", async () => {
  for (const state of [
    emptyState({ users: 1 }),
    emptyState({ accounts: 1 }),
    emptyState({ email_accounts: 1 }),
    emptyState({ bootstrap_markers: 1 }),
  ]) {
    const { env, captured } = mockEnv(state);
    const response = await handleProductionEmailBootstrap(
      request(),
      env,
      { checkSendPulseConnection: async () => ({ total: 1 }), encryptEmailSecret: async () => "cipher" },
    );
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error, "BOOTSTRAP_ALREADY_CONSUMED_OR_IDENTITY_EXISTS");
    assert.equal(captured.batchCalls, 0);
  }
});

test("bootstrap refuses unverified-email policy or disabled failover defaults", async () => {
  for (const state of [
    emptyState({ email_verification_required: 0 }),
    emptyState({ auto_failover_enabled: 0 }),
  ]) {
    const { env, captured } = mockEnv(state);
    const response = await handleProductionEmailBootstrap(
      request(),
      env,
      { checkSendPulseConnection: async () => ({ total: 1 }), encryptEmailSecret: async () => "cipher" },
    );
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, "PRODUCTION_EMAIL_POLICY_NOT_READY");
    assert.equal(captured.batchCalls, 0);
  }
});

test("bootstrap checks the SendPulse API key, encrypts it and consumes a single D1 operation", async () => {
  const { env, captured } = mockEnv();
  let checkedCredentials;
  let encryptedPlaintext;
  const response = await handleProductionEmailBootstrap(request(), env, {
    checkSendPulseConnection: async (credentials) => {
      checkedCredentials = credentials;
      return { total: 12 };
    },
    encryptEmailSecret: async (key, plaintext) => {
      assert.equal(key, encryptionKey);
      encryptedPlaintext = plaintext;
      return "v1.encrypted-test-ciphertext";
    },
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(checkedCredentials, { apiKey: providerToken });
  assert.equal(encryptedPlaintext, JSON.stringify({ apiKey: providerToken }));
  assert.deepEqual(body, {
    ok: true,
    provider: "SendPulse",
    accountId: "production-sendpulse-primary",
    connectionVerified: true,
    verificationEmailSent: false,
    publicSignupStillDisabled: true,
    supabaseProvisioningStillDisabled: true,
    oneTimeBootstrapConsumed: true,
  });
  assert.equal(captured.preflightCalls, 1);
  assert.equal(captured.batchCalls, 1);
  assert.equal(captured.statements.length, 3);
  const serializedBindings = JSON.stringify(captured.statements.map((statement) => statement.values));
  assert.equal(serializedBindings.includes(providerToken), false);
  assert.equal(serializedBindings.includes(ownerToken), false);
  assert.equal(serializedBindings.includes("v1.encrypted-test-ciphertext"), true);
  assert.match(captured.statements[0].sql, /auth_worker_internal_config/);
  assert.match(captured.statements[1].sql, /auth_email_provider_accounts/);
  assert.match(captured.statements[2].sql, /SET value = 'consumed'/);
});

test("invalid SendPulse credentials are rejected before any D1 write", async () => {
  const { env, captured } = mockEnv();
  const response = await handleProductionEmailBootstrap(request(), env, {
    checkSendPulseConnection: async () => {
      throw Object.assign(new Error("sensitive provider response must not escape"), {
        code: "EMAIL_PROVIDER_CREDENTIAL_REJECTED",
      });
    },
    encryptEmailSecret: async () => "unused",
  });
  assert.equal(response.status, 422);
  assert.equal((await response.json()).error, "EMAIL_PROVIDER_CREDENTIAL_REJECTED");
  assert.equal(captured.batchCalls, 0);
});

test("unexpected D1 batch results fail closed and do not claim success", async () => {
  const { env, captured } = mockEnv(emptyState(), [0, 0, 0]);
  const response = await handleProductionEmailBootstrap(request(), env, {
    checkSendPulseConnection: async () => ({ total: 1 }),
    encryptEmailSecret: async () => "cipher",
  });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, "BOOTSTRAP_NOT_APPLIED_OR_ALREADY_CONSUMED");
  assert.equal(captured.batchCalls, 1);
});
