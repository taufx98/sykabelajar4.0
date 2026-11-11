import assert from "node:assert/strict";
import test from "node:test";
import {
  completeSupabaseEmailVerification,
  completeSupabasePhoneVerification,
  getSupabasePhoneVerificationStatus,
  isSupabaseProvisioningEnabled,
  normalizeBetterAuthRegistration,
  reconcileSupabaseApplicationIdentity,
  ensureSupabaseApplicationIdentity,
} from "../src/supabase-provisioning.mjs";

const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SERVICE_KEY = "test-service-role-key-never-log";
function createD1Mock({ fail = false, changes = 1 } = {}) {
  const calls = [];
  const valuesByKey = new Map();
  const DB = {
    prepare(query) {
      return {
        bind(...values) {
          return {
            async run() {
              calls.push({ query: String(query), values, operation: "run" });
              if (fail) throw new Error("internal D1 failure");
              if (/INSERT INTO auth_worker_internal_config/i.test(String(query))) {
                valuesByKey.set(String(values[0]), String(values[1]));
              }
              return { success: true, meta: { changes } };
            },
            async first() {
              calls.push({ query: String(query), values, operation: "first" });
              if (fail) throw new Error("internal D1 failure");
              if (/SELECT value FROM auth_worker_internal_config/i.test(String(query))) {
                const value = valuesByKey.get(String(values[0]));
                return value === undefined ? null : { value };
              }
              return null;
            },
          };
        },
      };
    },
  };
  return { DB, calls, valuesByKey };
}

const env = {
  SUPABASE_PROVISIONING_ENABLED: "true",
  // Keep the production URL for the existing Admin bridge; it must never be used for provisioning.
  SUPABASE_URL: "https://mvdczyitbkxkldjughor.supabase.co",
  SUPABASE_PROVISIONING_URL: "https://ydamszdfsxqisanazdkb.supabase.co",
  SUPABASE_PROVISIONING_API_KEY: SERVICE_KEY,
  DB: createD1Mock().DB,
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
    birthDate: null,
    institution: null,
    grade: null,
    subjects: null,
  });
  assert.deepEqual(normalizeBetterAuthRegistration({
    accountType: "TEACHER",
    username: "  Teacher.Name_1 ",
    referralCode: "  REF-123  ",
  }), {
    accountType: "teacher",
    username: "teacher.name_1",
    referralCode: "REF-123",
    birthDate: null,
    institution: null,
    grade: null,
    subjects: null,
  });
  assert.deepEqual(normalizeBetterAuthRegistration({
    accountType: "organizer",
    username: null,
    referralCode: null,
  }), {
    accountType: "organizer",
    username: null,
    referralCode: null,
    birthDate: null,
    institution: null,
    grade: null,
    subjects: null,
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
    { birthDate: "31-12-2009" },
    { birthDate: "2009-02-29" },
    { institution: 123 },
    { grade: "kelas-12" },
    { subjects: [] },
    { institution: "x".repeat(201) },
    { subjects: "x".repeat(2001) },
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
  assert.equal(calls[0].url, "https://ydamszdfsxqisanazdkb.supabase.co/rest/v1/rpc/better_auth_provision_user");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.apikey, SERVICE_KEY);
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${SERVICE_KEY}`);
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    p_user_id: USER_ID,
    p_account_type: "student",
    p_full_name: "Student One",
    p_username: null,
    p_birth_date: null,
    p_institution: null,
    p_grade: null,
    p_subjects: null,
    p_referral_code: null,
    p_email_verified: false,
  });
});

test("identity provisioning retries one transient network failure without changing its idempotent payload", async () => {
  const d1 = createD1Mock();
  const calls = [];
  const result = await reconcileSupabaseApplicationIdentity({ ...env, DB: d1.DB }, {
    id: USER_ID,
    name: "Retry User",
    accountType: "student",
    emailVerified: false,
  }, async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    if (calls.length === 1) throw new Error("temporary socket reset");
    return response({ user_id: USER_ID, account_type: "student" });
  });

  assert.deepEqual(result, { enabled: true, userId: USER_ID });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, calls[1].url);
  assert.deepEqual(calls[0].body, calls[1].body);
  assert.equal(calls[1].body.p_user_id, USER_ID);
});

test("identity and email-verification RPCs retry one transient 5xx, while permanent 4xx errors fail immediately", async () => {
  const d1 = createD1Mock();
  const calls = [];
  const result = await reconcileSupabaseApplicationIdentity({ ...env, DB: d1.DB }, {
    id: USER_ID,
    name: "Verified Retry User",
    accountType: "student",
    emailVerified: true,
  }, async (url, init) => {
    const endpoint = String(url);
    const body = JSON.parse(init.body);
    calls.push({ endpoint, body });
    const sameRpcAttempts = calls.filter((item) => item.endpoint === endpoint).length;
    if (sameRpcAttempts === 1) return response({ message: "temporary provider outage" }, 503);
    return endpoint.endsWith("/better_auth_provision_user")
      ? response({ user_id: USER_ID, account_type: "student" })
      : response(true);
  });

  assert.deepEqual(result, { enabled: true, userId: USER_ID });
  assert.equal(calls.length, 4, "both idempotent identity and verification RPCs receive one retry");
  assert.deepEqual(calls[0].body, calls[1].body);
  assert.deepEqual(calls[2].body, calls[3].body);
  assert.equal(d1.valuesByKey.get("identity_projection:" + USER_ID), "verified");

  let permanentCalls = 0;
  await assert.rejects(
    reconcileSupabaseApplicationIdentity({ ...env, DB: createD1Mock().DB }, {
      id: USER_ID,
      name: "Permanent Failure User",
      accountType: "student",
      emailVerified: false,
    }, async () => {
      permanentCalls += 1;
      return response({ message: "bad request" }, 400);
    }),
    /SUPABASE_PROVISIONING_REJECTED/,
  );
  assert.equal(permanentCalls, 1, "permanent 4xx responses must never be retried");
});

test("phone verification mutations are not included in identity-projection retries", async () => {
  let calls = 0;
  await assert.rejects(
    completeSupabasePhoneVerification(env, {
      userId: USER_ID,
      verifiedAt: "2026-11-07T00:00:00.000Z",
      phoneHash: "f".repeat(64),
      providerSubject: "987654321",
      phoneDigitsCount: 13,
    }, async () => {
      calls += 1;
      return response({ message: "temporary server failure" }, 503);
    }),
    /SUPABASE_PROVISIONING_REJECTED/,
  );
  assert.equal(calls, 1);
});

test("legacy SUPABASE_SERVICE_ROLE_KEY binding remains compatible during migration", async () => {
  const legacyEnv = {
    ...env,
    SUPABASE_PROVISIONING_API_KEY: "",
    SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
  };
  let captured;
  await reconcileSupabaseApplicationIdentity(legacyEnv, {
    id: USER_ID,
    name: "Legacy Binding User",
  }, async (url, init) => {
    captured = { url: String(url), headers: init.headers };
    return response({ user_id: USER_ID });
  });
  assert.equal(captured.headers.apikey, SERVICE_KEY);
  assert.equal(captured.headers.Authorization, `Bearer ${SERVICE_KEY}`);
});

test("multiple preferred and legacy provisioning key bindings fail closed", async () => {
  await assert.rejects(
    reconcileSupabaseApplicationIdentity({
      ...env,
      SUPABASE_PROVISIONING_API_KEY: "sb_secret_preferred",
      SUPABASE_SERVICE_ROLE_KEY: "legacy-service-role-value",
    }, { id: USER_ID }, async () => response({ user_id: USER_ID })),
    /SUPABASE_PROVISIONING_KEY_BINDINGS_CONFLICT/,
  );
});

test("new Supabase sb_secret keys use apikey only and are never sent as Bearer JWTs", async () => {
  const secretKey = "sb_secret_staging_test_only";
  const secretEnv = { ...env, SUPABASE_PROVISIONING_API_KEY: secretKey };
  const calls = [];

  await reconcileSupabaseApplicationIdentity(secretEnv, {
    id: USER_ID,
    name: "Staging Secret User",
  }, async (url, init) => {
    calls.push({ url: String(url), headers: init.headers });
    return response({ user_id: USER_ID });
  });

  await getSupabasePhoneVerificationStatus(secretEnv, USER_ID, async (url, init) => {
    calls.push({ url: String(url), headers: init.headers });
    return response(true);
  });

  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.headers.apikey, secretKey);
    assert.equal(Object.hasOwn(call.headers, "Authorization"), false);
    assert.equal(call.headers["Content-Type"], "application/json");
  }
});

test("a Supabase publishable key cannot be used for server-side provisioning", async () => {
  await assert.rejects(
    reconcileSupabaseApplicationIdentity({
      ...env,
      SUPABASE_PROVISIONING_API_KEY: "sb_publishable_not_a_server_secret",
    }, { id: USER_ID }, async () => response({ user_id: USER_ID })),
    /SUPABASE_PROVISIONING_SECRET_KEY_REQUIRED/,
  );
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
    assert.equal(body.p_birth_date, null);
    assert.equal(body.p_institution, null);
    assert.equal(body.p_grade, null);
    assert.equal(body.p_subjects, null);
    assert.equal(body.p_referral_code, "REF-123");
    assert.equal(body.p_email_verified, false);
  }
});

test("profile details from the existing signup form reach the trusted Postgres projection", async () => {
  const input = {
    id: USER_ID,
    name: "Profile One",
    accountType: "student",
    username: "profile.one",
    birthDate: "2009-02-03",
    institution: "  SMA Negeri 1 Bandung  ",
    grade: "SMA",
    subjects: "math,science",
    referralCode: "REF-123",
  };
  const normalized = normalizeBetterAuthRegistration(input);
  assert.deepEqual(normalized, {
    accountType: "student",
    username: "profile.one",
    referralCode: "REF-123",
    birthDate: "2009-02-03",
    institution: "SMA Negeri 1 Bandung",
    grade: "sma",
    subjects: "math,science",
  });

  let payload;
  await reconcileSupabaseApplicationIdentity(env, input, async (_url, init) => {
    payload = JSON.parse(init.body);
    return response({ user_id: USER_ID, account_type: "student" });
  });
  assert.equal(payload.p_birth_date, "2009-02-03");
  assert.equal(payload.p_institution, "SMA Negeri 1 Bandung");
  assert.equal(payload.p_grade, "sma");
  assert.equal(payload.p_subjects, "math,science");
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

test("successful Postgres projection clears transient profile fields from D1 but keeps role mapping metadata", async () => {
  const d1 = createD1Mock();
  await reconcileSupabaseApplicationIdentity({ ...env, DB: d1.DB }, {
    id: USER_ID,
    name: "Profile One",
    accountType: "teacher",
    username: "profile.one",
    referralCode: "REF-123",
    birthDate: "2009-02-03",
    institution: "SMA Negeri 1 Bandung",
    grade: "sma",
    subjects: "math,science",
  }, async () => response({ user_id: USER_ID, account_type: "teacher" }));

  assert.equal(d1.calls.length, 2);
  assert.match(d1.calls[0].query, /"referralCode" = NULL/);
  assert.match(d1.calls[0].query, /"birthDate" = NULL/);
  assert.match(d1.calls[0].query, /"institution" = NULL/);
  assert.match(d1.calls[0].query, /"grade" = NULL/);
  assert.match(d1.calls[0].query, /"subjects" = NULL/);
  assert.doesNotMatch(d1.calls[0].query, /"accountType"|"username"/);
  assert.deepEqual(d1.calls[0].values, [USER_ID]);
  assert.match(d1.calls[1].query, /INSERT INTO auth_worker_internal_config/);
  assert.deepEqual(d1.calls[1].values, ["identity_projection:" + USER_ID, "unverified"]);
  assert.equal(d1.valuesByKey.get("identity_projection:" + USER_ID), "unverified");
});

test("a completed identity projection is reused on subsequent logins without another Supabase RPC", async () => {
  const d1 = createD1Mock();
  const stagingEnv = { ...env, DB: d1.DB };
  const user = {
    id: USER_ID,
    name: "Student One",
    accountType: "student",
    emailVerified: false,
  };
  let remoteCalls = 0;

  await reconcileSupabaseApplicationIdentity(stagingEnv, user, async () => {
    remoteCalls += 1;
    return response({ user_id: USER_ID, account_type: "student" });
  });
  assert.equal(remoteCalls, 1);
  assert.equal(d1.valuesByKey.get("identity_projection:" + USER_ID), "unverified");

  const result = await ensureSupabaseApplicationIdentity(stagingEnv, user, async () => {
    remoteCalls += 1;
    return response({ user_id: USER_ID, account_type: "student" });
  });
  assert.deepEqual(result, { enabled: true, userId: USER_ID, reused: true });
  assert.equal(remoteCalls, 1, "an established D1 projection must not depend on a Supabase RPC during login");
});

test("an email-verification state transition forces one projection refresh and then becomes reusable", async () => {
  const d1 = createD1Mock();
  const stagingEnv = { ...env, DB: d1.DB };
  const user = {
    id: USER_ID,
    name: "Student One",
    accountType: "student",
    emailVerified: false,
  };
  const calls = [];
  const fetchImpl = async (url, init) => {
    const endpoint = String(url);
    calls.push({ url: endpoint, body: JSON.parse(init.body) });
    return endpoint.endsWith("/better_auth_provision_user")
      ? response({ user_id: USER_ID, account_type: "student" })
      : response(true);
  };

  await reconcileSupabaseApplicationIdentity(stagingEnv, user, fetchImpl);
  const verifiedUser = { ...user, emailVerified: true };
  const refreshed = await ensureSupabaseApplicationIdentity(stagingEnv, verifiedUser, fetchImpl);
  assert.deepEqual(refreshed, { enabled: true, userId: USER_ID, reused: false });
  assert.equal(calls.length, 3, "verification transition must reconcile identity and trusted email state once");
  assert.equal(d1.valuesByKey.get("identity_projection:" + USER_ID), "verified");

  const reused = await ensureSupabaseApplicationIdentity(stagingEnv, verifiedUser, fetchImpl);
  assert.deepEqual(reused, { enabled: true, userId: USER_ID, reused: true });
  assert.equal(calls.length, 3);
});

test("a missing projection marker causes reconciliation, and D1 marker failures fail closed", async () => {
  const missing = createD1Mock();
  let calls = 0;
  const result = await ensureSupabaseApplicationIdentity({ ...env, DB: missing.DB }, {
    id: USER_ID,
    name: "New User",
    accountType: "student",
    emailVerified: false,
  }, async () => {
    calls += 1;
    return response({ user_id: USER_ID });
  });
  assert.deepEqual(result, { enabled: true, userId: USER_ID, reused: false });
  assert.equal(calls, 1);

  const broken = createD1Mock({ fail: true });
  await assert.rejects(
    reconcileSupabaseApplicationIdentity({ ...env, DB: broken.DB }, {
      id: USER_ID,
      name: "New User",
      accountType: "student",
      emailVerified: false,
    }, async () => response({ user_id: USER_ID })),
    /BETTER_AUTH_IDENTITY_PROJECTION_MARK_FAILED/,
    "the Worker must never claim a projection is reusable unless D1 confirms its marker",
  );
});

test("D1 bootstrap cleanup failure prevents the auth session projection from being treated as complete", async () => {
  const d1 = createD1Mock({ fail: true });
  await assert.rejects(
    reconcileSupabaseApplicationIdentity({ ...env, DB: d1.DB }, {
      id: USER_ID,
      name: "Profile One",
      accountType: "student",
      birthDate: "2009-02-03",
    }, async () => response({ user_id: USER_ID, account_type: "student" })),
    /BETTER_AUTH_PROFILE_BOOTSTRAP_CLEANUP_FAILED/,
  );
  assert.equal(d1.calls.length, 1);
});

test("missing server secret and unsafe provisioning target fail closed", async () => {
  await assert.rejects(
    reconcileSupabaseApplicationIdentity({
      ...env,
      SUPABASE_PROVISIONING_API_KEY: "",
      SUPABASE_SERVICE_ROLE_KEY: "",
    }, { id: USER_ID }, async () => response({ user_id: USER_ID })),
    /SUPABASE_PROVISIONING_CONFIGURATION_MISSING/,
  );
  await assert.rejects(
    reconcileSupabaseApplicationIdentity({
      ...env,
      SUPABASE_PROVISIONING_URL: "http://127.0.0.1:54321",
    }, { id: USER_ID }, async () => response({ user_id: USER_ID })),
    /SUPABASE_PROVISIONING_URL_NOT_ALLOWED/,
  );
  await assert.rejects(
    reconcileSupabaseApplicationIdentity({
      ...env,
      SUPABASE_PROVISIONING_URL: "https://mvdczyitbkxkldjughor.supabase.co",
    }, { id: USER_ID }, async () => response({ user_id: USER_ID })),
    /SUPABASE_PROVISIONING_URL_NOT_ALLOWED/,
  );
});

test("provisioning never falls back to the production Admin bridge URL", async () => {
  let called = false;
  await assert.rejects(
    reconcileSupabaseApplicationIdentity({
      ...env,
      SUPABASE_PROVISIONING_URL: "",
    }, { id: USER_ID }, async () => {
      called = true;
      return response({ user_id: USER_ID });
    }),
    /SUPABASE_PROVISIONING_CONFIGURATION_MISSING/,
  );
  assert.equal(called, false);
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


test("trusted phone verification sends only the normalized SHA-256 identity hash to the server-only RPC", async () => {
  const calls = [];
  const result = await completeSupabasePhoneVerification(env, {
    userId: USER_ID,
    verifiedAt: "2026-11-07T00:00:00.000Z",
    phoneHash: "d".repeat(64),
    providerSubject: "987654321",
    phoneDigitsCount: 13,
  }, async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body), headers: init.headers });
    return response(true);
  });
  assert.deepEqual(result, { enabled: true, userId: USER_ID, alreadyVerified: false });
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.startsWith("https://ydamszdfsxqisanazdkb.supabase.co/"));
  assert.ok(calls[0].url.endsWith("/better_auth_complete_phone_verification"));
  assert.equal(calls[0].headers.Authorization, "Bearer " + SERVICE_KEY);
  assert.deepEqual(calls[0].body, {
    p_user_id: USER_ID,
    p_verified_at: "2026-11-07T00:00:00.000Z",
    p_phone_hash: "d".repeat(64),
    p_provider: "telegram",
    p_provider_subject: "987654321",
    p_phone_digits_count: 13,
  });
  assert.equal(JSON.stringify(calls[0].body).includes("+628"), false);
});

test("phone verification retries are treated as idempotent without exposing provider details", async () => {
  const result = await completeSupabasePhoneVerification(env, {
    userId: USER_ID,
    verifiedAt: "2026-11-07T00:00:00.000Z",
    phoneHash: "e".repeat(64),
    providerSubject: "123456789",
    phoneDigitsCount: 12,
  }, async () => response(false));
  assert.deepEqual(result, { enabled: true, userId: USER_ID, alreadyVerified: true });
});

test("malformed phone verification payloads are rejected before any Supabase request", async () => {
  let called = false;
  const fetchImpl = async () => {
    called = true;
    return response(true);
  };
  for (const input of [
    { userId: "not-a-uuid", verifiedAt: "2026-11-07T00:00:00.000Z", phoneHash: "a".repeat(64), providerSubject: "12345678", phoneDigitsCount: 12 },
    { userId: USER_ID, verifiedAt: "invalid", phoneHash: "a".repeat(64), providerSubject: "12345678", phoneDigitsCount: 12 },
    { userId: USER_ID, verifiedAt: "2026-11-07T00:00:00.000Z", phoneHash: "bad", providerSubject: "12345678", phoneDigitsCount: 12 },
    { userId: USER_ID, verifiedAt: "2026-11-07T00:00:00.000Z", phoneHash: "a".repeat(64), providerSubject: "abc", phoneDigitsCount: 12 },
    { userId: USER_ID, verifiedAt: "2026-11-07T00:00:00.000Z", phoneHash: "a".repeat(64), providerSubject: "12345678", phoneDigitsCount: 7 },
  ]) {
    await assert.rejects(completeSupabasePhoneVerification(env, input, fetchImpl), /PHONE_VERIFICATION_INPUT_INVALID/);
  }
  assert.equal(called, false);
});

test("phone verification rejects unconfigured Supabase provisioning and unexpected RPC output", async () => {
  await assert.rejects(completeSupabasePhoneVerification({
    ...env,
    SUPABASE_PROVISIONING_ENABLED: "false",
  }, {
    userId: USER_ID,
    verifiedAt: "2026-11-07T00:00:00.000Z",
    phoneHash: "a".repeat(64),
    providerSubject: "12345678",
    phoneDigitsCount: 12,
  }), /SUPABASE_PROVISIONING_DISABLED/);

  await assert.rejects(completeSupabasePhoneVerification(env, {
    userId: USER_ID,
    verifiedAt: "2026-11-07T00:00:00.000Z",
    phoneHash: "a".repeat(64),
    providerSubject: "12345678",
    phoneDigitsCount: 12,
  }, async () => response({ verified: true })), /PHONE_VERIFICATION_RESPONSE_INVALID/);
});

test("phone status is read only for the Worker-authenticated UUID through the service-only RPC", async () => {
  const calls = [];
  const result = await getSupabasePhoneVerificationStatus(env, USER_ID, async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body), headers: init.headers });
    return response(true);
  });

  assert.deepEqual(result, { enabled: true, userId: USER_ID, verified: true });
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.startsWith("https://ydamszdfsxqisanazdkb.supabase.co/"));
  assert.ok(calls[0].url.endsWith("/better_auth_get_phone_verification_status"));
  assert.equal(calls[0].headers.Authorization, "Bearer " + SERVICE_KEY);
  assert.deepEqual(calls[0].body, { p_user_id: USER_ID });
  assert.equal(JSON.stringify(calls[0].body).includes("+628"), false);
});

test("phone status rejects invalid IDs, disabled provisioning and non-boolean RPC output", async () => {
  let called = false;
  const fetchImpl = async () => {
    called = true;
    return response(true);
  };

  await assert.rejects(getSupabasePhoneVerificationStatus(env, "not-a-uuid", fetchImpl), /BETTER_AUTH_USER_ID_INVALID/);
  await assert.rejects(getSupabasePhoneVerificationStatus({
    ...env,
    SUPABASE_PROVISIONING_ENABLED: "false",
  }, USER_ID, fetchImpl), /SUPABASE_PROVISIONING_DISABLED/);
  await assert.rejects(getSupabasePhoneVerificationStatus(env, USER_ID, async () => response({ verified: true })), /PHONE_VERIFICATION_STATUS_RESPONSE_INVALID/);
  assert.equal(called, false);
});
