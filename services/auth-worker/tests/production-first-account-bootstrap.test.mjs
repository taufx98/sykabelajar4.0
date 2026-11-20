import test from "node:test";
import assert from "node:assert/strict";
import { handleProductionFirstAccountBootstrap } from "../src/production-first-account-bootstrap.mjs";

const ownerToken = "t".repeat(64);
const dbSecret = "sb_secret_" + "x".repeat(48);
const credentials = {
  BETTER_AUTH_URL: "https://auth-prod.sykabelajar.my.id",
  APP_ORIGIN: "https://sykabelajar.my.id",
  SUPABASE_PROVISIONING_ENV: "production",
  SUPABASE_PROVISIONING_URL: "https://mvdczyitbkxkldjughor.supabase.co",
  SUPABASE_URL: "https://mvdczyitbkxkldjughor.supabase.co",
  AUTH_EMAIL_PROVIDER: "managed",
  AUTH_SIGNUP_DISABLED: "true",
  SUPABASE_PROVISIONING_ENABLED: "true",
  SUPABASE_PROVISIONING_API_KEY: dbSecret,
  AUTH_FIRST_ACCOUNT_BOOTSTRAP_TOKEN: ownerToken,
};
const newPassword = "S".repeat(28);

function state(overrides = {}) {
  return {
    users: 0, accounts: 0, sessions: 0, verifications: 0,
    access_tokens: 0, refresh_tokens: 0, bootstrap_markers: 0,
    email_verification_required: 1, active_sendpulse_accounts: 1,
    ...overrides,
  };
}

function mockEnv(current = state(), markerChanges = 1, postflight = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  email: "owner@example.test",
  emailVerified: 0,
  sessions: 0,
}) {
  const captured = { preflightCalls: 0, markerWrites: 0, signupCalls: 0, statements: [] };
  const DB = {
    prepare(sql) {
      const statement = { sql, values: [] };
      statement.bind = (...values) => { statement.values = values; return statement; };
      statement.first = async () => {
        if (sql.includes("WHERE lower(email) = ?1")) return postflight;
        captured.preflightCalls += 1;
        return current;
      };
      statement.run = async () => {
        captured.markerWrites += 1;
        captured.statements.push(statement);
        return { success: true, meta: { changes: markerChanges } };
      };
      return statement;
    },
  };
  return { env: { ...credentials, DB }, captured };
}

function makeRequest({ token = ownerToken, origin, body = {
  name: "Owner", email: "Owner@Example.test", password: newPassword,
} } = {}) {
  const payload = JSON.stringify(body);
  const headers = new Headers({
    "Content-Type": "application/json",
    "Content-Length": String(new TextEncoder().encode(payload).length),
  });
  if (token) headers.set("Authorization", "Bearer " + token);
  if (origin) headers.set("Origin", origin);
  return new Request("https://auth-prod.sykabelajar.my.id/_internal/bootstrap-first-production-account", {
    method: "POST", headers, body: payload,
  });
}

function authRecorder(captured, fail = false) {
  return {
    api: {
      async signUpEmail(args) {
        captured.signupCalls += 1;
        captured.signupBody = args.body;
        if (fail) throw new Error("INTERNAL_ERROR");
        return { token: "do-not-return", user: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" } };
      },
    },
  };
}

test("rejects browser Origin and wrong owner token before D1 access", async () => {
  for (const request of [
    makeRequest({ origin: "https://sykabelajar.my.id" }),
    makeRequest({ token: "wrong" }),
  ]) {
    const { env, captured } = mockEnv();
    const response = await handleProductionFirstAccountBootstrap(request, env, {
      createAuth: async () => authRecorder(captured),
    });
    assert.ok(response.status === 403 || response.status === 401);
    assert.equal(captured.preflightCalls, 0);
    assert.equal(captured.markerWrites, 0);
  }
});

test("requires pinned Production, closed public signup, enabled provisioning and server credentials", async () => {
  for (const override of [
    { AUTH_SIGNUP_DISABLED: "false" },
    { SUPABASE_PROVISIONING_ENABLED: "false" },
    { SUPABASE_PROVISIONING_ENV: "staging" },
    { SUPABASE_PROVISIONING_URL: "https://other-project.supabase.co" },
    { SUPABASE_PROVISIONING_API_KEY: "sb_publishable_not_server" },
  ]) {
    const { env, captured } = mockEnv();
    Object.assign(env, override);
    const response = await handleProductionFirstAccountBootstrap(makeRequest(), env, {
      createAuth: async () => authRecorder(captured),
    });
    assert.ok(response.status === 404 || response.status === 503);
    assert.equal(captured.markerWrites, 0);
  }
});

test("rejects an existing identity, missing required verification or no enabled SendPulse account", async () => {
  for (const current of [
    state({ users: 1 }),
    state({ accounts: 1 }),
    state({ bootstrap_markers: 1 }),
    state({ email_verification_required: 0 }),
    state({ active_sendpulse_accounts: 0 }),
  ]) {
    const { env, captured } = mockEnv(current);
    const response = await handleProductionFirstAccountBootstrap(makeRequest(), env, {
      createAuth: async () => authRecorder(captured),
    });
    assert.notEqual(response.status, 202);
    assert.equal(captured.markerWrites, 0);
  }
});

test("uses one server-side email signup call and leaves public signup disabled", async () => {
  const { env, captured } = mockEnv();
  const response = await handleProductionFirstAccountBootstrap(makeRequest(), env, {
    createAuth: async () => authRecorder(captured),
  });
  const result = await response.json();
  assert.equal(response.status, 202);
  assert.equal(captured.signupCalls, 1);
  assert.deepEqual(captured.signupBody, {
    name: "Owner", email: "owner@example.test", password: newPassword,
  });
  assert.equal(env.AUTH_SIGNUP_DISABLED, "true");
  assert.deepEqual(result, {
    ok: true,
    verificationRequestAccepted: true,
    emailVerificationRequired: true,
    publicSignupStillDisabled: true,
    provisioningStillEnabled: true,
    oneTimeBootstrapConsumed: true,
  });
  assert.equal(JSON.stringify(result).includes("do-not-return"), false);
  assert.equal(JSON.stringify(result).includes(dbSecret), false);
  assert.equal(captured.markerWrites, 1);
  assert.equal(captured.statements[0].values[0], "production_first_account_bootstrap");
});

test("consumes the one-time marker before an ambiguous Better Auth failure", async () => {
  const { env, captured } = mockEnv();
  const response = await handleProductionFirstAccountBootstrap(makeRequest(), env, {
    createAuth: async () => authRecorder(captured, true),
  });
  const result = await response.json();
  assert.equal(response.status, 503);
  assert.equal(result.error, "FIRST_ACCOUNT_CREATE_OR_VERIFICATION_DELIVERY_UNCONFIRMED");
  assert.equal(result.manualInspectionRequired, true);
  assert.equal(captured.markerWrites, 1);
});

test("fails closed if verification or session postflight is inconsistent", async () => {
  for (const postflight of [
    { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", email: "owner@example.test", emailVerified: 1, sessions: 0 },
    { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", email: "owner@example.test", emailVerified: 0, sessions: 1 },
  ]) {
    const { env, captured } = mockEnv(state(), 1, postflight);
    const response = await handleProductionFirstAccountBootstrap(makeRequest(), env, {
      createAuth: async () => authRecorder(captured),
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, "FIRST_ACCOUNT_POSTFLIGHT_MISMATCH");
  }
});
