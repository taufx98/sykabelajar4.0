import assert from "node:assert/strict";
import test from "node:test";
import {
  completeSupabaseEmailVerification,
  isSupabaseProvisioningEnabled,
  normalizeBetterAuthRegistration,
  reconcileSupabaseApplicationIdentity,
} from "../src/supabase-provisioning.mjs";

const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SERVICE_KEY = "test-service-role-key-never-log";
const env = {
  SUPABASE_PROVISIONING_ENABLED: "true",
  SUPABASE_URL: "https://mvdczyitbkxkldjughor.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
};

function response(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("provisioning is opt-in and remains disabled by default", async () => {
  assert.equal(isSupabaseProvisioningEnabled({}), false);
  assert.equal(isSupabaseProvisioningEnabled({ SUPABASE_PROVISIONING_ENABLED: "false" }), false);
  assert.equal(isSupabaseProvisioningEnabled({ SUPABASE_PROVISIONING_ENABLED: "true" }), true);

  let called = false;
  const result = await reconcileSupabaseApplicationIdentity({}, { id: USER_ID }, async () => {
    called = true;
    return response({ user_id: USER_ID });
  });
  assert.deepEqual(result, { enabled: false, userId: null });
  assert.equal(called, false);
});

test("registration attributes are normalized before a Better Auth user row is inserted", () => {
  assert.deepEqual(normalizeBetterAuthRegistration({}), {
    accountType: "student",
    username: null,
    referralCode: null,
  });
  assert.deepEqual(normalizeBetterAuthRegistration({
    accountType: "TEACHER",
    username: "  Teacher.Name_1 ",
    referralCode: "  REF-123  ",
  }), {
    accountType: "teacher",
    username: "teacher.name_1",
    referralCode: "REF-123",
  });
  assert.deepEqual(normalizeBetterAuthRegistration({
    accountType: "organizer",
    username: null,
    referralCode: null,
  }), {
    accountType: "organizer",
    username: null,
    referralCode: null,
  });
});

test("admin, unsupported account types and invalid registration metadata are rejected before persistence", () => {
  for (const input of [
    { accountType: "admin" },
    { accountType: "superadmin" },
    { accountType: " ORGANIZER_ADMIN " },
    { username: "../admin" },
    { username: "ab" },
    { username: 123 },
    { referralCode: {} },
    { referralCode: "x".repeat(81) },
  ]) {
    assert.throws(() => normalizeBetterAuthRegistration(input));
  }
});

test("a fresh unverified student account provisions with least-privilege defaults", async () => {
  const calls = [];
  const result = await reconcileSupabaseApplicationIdentity(env, {
    id: USER_ID,
    name: "  Student One  ",
    email: "student@example.test",
  }, async (url, init) => {
    calls.push({ url: String(url), init });
    return response({ user_id: USER_ID, account_type: "student", role: "student" });
  });

  assert.deepEqual(result, { enabled: true, userId: USER_ID });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://mvdczyitbkxkldjughor.supabase.co/rest/v1/rpc/better_auth_provision_user");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.apikey, SERVICE_KEY);
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${SERVICE_KEY}`);
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    p_user_id: USER_ID,
    p_account_type: "student",
    p_full_name: "Student One",
    p_username: null,
    p_referral_code: null,
    p_email_verified: false,
  });
});

test("teacher and organizer account types are passed only as the approved registration values", async () => {
  for (const accountType of ["teacher", "organizer"]) {
    let body;
    await reconcileSupabaseApplicationIdentity(env, {
      id: USER_ID,
      name: "Member",
      accountType,
      username: "Member.Name_1",
      referralCode: "  REF-123  ",
    }, async (_url, init) => {
      body = JSON.parse(init.body);
      return response({ user_id: USER_ID, account_type: accountType });
    });
    assert.equal(body.p_account_type, accountType);
    assert.equal(body.p_username, "member.name_1");
    assert.equal(body.p_referral_code, "REF-123");
    assert.equal(body.p_email_verified, false);
  }
});

test("an admin or unknown account type is rejected before any Supabase request", async () => {
  let called = false;
  await assert.rejects(
    reconcileSupabaseApplicationIdentity(env, {
      id: USER_ID,
      name: "Attacker",
      accountType: "admin",
    }, async () => {
      called = true;
      return response({ user_id: USER_ID });
    }),
    /BETTER_AUTH_ACCOUNT_TYPE_NOT_ALLOWED/,
  );
  assert.equal(called, false);
});

test("malformed UUIDs and usernames are rejected before network access", async () => {
  let called = false;
  const fakeFetch = async () => {
    called = true;
    return response({ user_id: USER_ID });
  };
  await assert.rejects(
    reconcileSupabaseApplicationIdentity(env, { id: "not-a-uuid" }, fakeFetch),
    /BETTER_AUTH_USER_ID_INVALID/,
  );
  await assert.rejects(
    reconcileSupabaseApplicationIdentity(env, {
      id: USER_ID,
      username: "../admin",
    }, fakeFetch),
    /BETTER_AUTH_USERNAME_INVALID/,
  );
  assert.equal(called, false);
});

test("verified Google/email identity reconciles the app projection and trusted email state", async () => {
  const calls = [];
  await reconcileSupabaseApplicationIdentity(env, {
    id: USER_ID,
    name: "Verified User",
    accountType: "student",
    emailVerified: true,
  }, async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    if (calls.length === 1) return response({ user_id: USER_ID, account_type: "student" });
    return response(true);
  });

  assert.equal(calls.length, 2);
  assert.ok(calls[0].url.endsWith("/better_auth_provision_user"));
  assert.equal(calls[0].body.p_email_verified, true);
  assert.ok(calls[1].url.endsWith("/better_auth_complete_email_verification"));
  assert.equal(calls[1].body.p_user_id, USER_ID);
  assert.equal(typeof calls[1].body.p_verified_at, "string");
});

test("afterEmailVerification retries provisioning before completing the verified-email projection", async () => {
  const calls = [];
  await completeSupabaseEmailVerification(env, {
    id: USER_ID,
    name: "Verified Later",
    emailVerified: false,
  }, async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    return calls.length === 1
      ? response({ user_id: USER_ID, account_type: "student" })
      : response(true);
  });
  assert.equal(calls.length, 2);
  assert.ok(calls[0].url.endsWith("/better_auth_provision_user"));
  assert.equal(calls[0].body.p_email_verified, true);
  assert.ok(calls[1].url.endsWith("/better_auth_complete_email_verification"));
});

test("missing server secret and unsafe Supabase URL fail closed", async () => {
  await assert.rejects(
    reconcileSupabaseApplicationIdentity({
      ...env,
      SUPABASE_SERVICE_ROLE_KEY: "",
    }, { id: USER_ID }, async () => response({ user_id: USER_ID })),
    /SUPABASE_PROVISIONING_CONFIGURATION_MISSING/,
  );
  await assert.rejects(
    reconcileSupabaseApplicationIdentity({
      ...env,
      SUPABASE_URL: "http://127.0.0.1:54321",
    }, { id: USER_ID }, async () => response({ user_id: USER_ID })),
    /SUPABASE_PROVISIONING_URL_NOT_ALLOWED/,
  );
});

test("Supabase errors are reduced to stable codes and never expose response bodies or secrets", async () => {
  await assert.rejects(
    reconcileSupabaseApplicationIdentity(env, { id: USER_ID }, async () =>
      response({ message: `secret details ${SERVICE_KEY}` }, 404),
    ),
    (error) => {
      assert.equal(error.message, "SUPABASE_PROVISIONING_RPC_NOT_INSTALLED");
      assert.equal(error.message.includes(SERVICE_KEY), false);
      return true;
    },
  );
  await assert.rejects(
    reconcileSupabaseApplicationIdentity(env, { id: USER_ID }, async () =>
      response({ message: `secret details ${SERVICE_KEY}` }, 500),
    ),
    (error) => {
      assert.equal(error.message, "SUPABASE_PROVISIONING_REJECTED");
      assert.equal(error.message.includes(SERVICE_KEY), false);
      return true;
    },
  );
});

test("unexpected provision response cannot open an application session", async () => {
  await assert.rejects(
    reconcileSupabaseApplicationIdentity(env, { id: USER_ID }, async () =>
      response({ user_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }),
    ),
    /SUPABASE_PROVISIONING_RESPONSE_INVALID/,
  );
});
