import assert from "node:assert/strict";

const apiUrl = (process.env.STAGE5_API_URL ?? "").replace(/\/+$/, "");
const anonKey = process.env.STAGE5_ANON_KEY ?? "";
const functionsUrl = apiUrl + "/functions/v1";
const password = "Stage5-Edge-Local-Only-2026!";

assert.ok(apiUrl, "STAGE5_API_URL is required");
assert.ok(anonKey, "STAGE5_ANON_KEY is required");

const fixtureSql = await (await import("node:fs/promises")).readFile(
  new URL("./stage5-edge-two-user-fixtures.sql", import.meta.url), "utf8",
);
assert.equal((fixtureSql.match(/'00000000-0000-0000-0000-000000000000'/g) ?? []).length, 2,
  "both synthetic accounts must use the local Supabase Auth instance id");
assert.doesNotMatch(fixtureSql, /\n\s+NULL,\s*\n\s*'[ab]{8}-/,
  "the disposable Auth instance id must not be NULL");
assert.match(fixtureSql, /confirmation_token = ''[\s\S]*?recovery_token = ''[\s\S]*?email_change_token_new = ''[\s\S]*?email_change = ''/);
assert.match(fixtureSql, /email_change_token_current = ''[\s\S]*?reauthentication_token = ''[\s\S]*?phone_change = ''[\s\S]*?phone_change_token = ''/);

const users = {
  a: {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    email: "stage5-edge-user-a@example.test",
    username: "stage5_user_a",
  },
  b: {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    email: "stage5-edge-user-b@example.test",
    username: "stage5_user_b",
  },
};
const orderA = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const orderB = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

async function signIn(user) {
  const response = await fetch(apiUrl + "/auth/v1/token?grant_type=password", {
    method: "POST",
    headers: {
      apikey: anonKey,
      "content-type": "application/json",
    },
    body: JSON.stringify({ email: user.email, password }),
  });
  const body = await response.json().catch(() => ({}));
  assert.equal(response.status, 200,
    "local Auth sign-in failed for " + user.email + ": " +
    (body.error_description ?? body.msg ?? response.status));
  assert.equal(body.user?.id, user.id, "Auth must return the seeded test UUID");
  assert.equal(typeof body.access_token, "string");
  return body.access_token;
}

async function invoke(functionName, token, body) {
  const response = await fetch(functionsUrl + "/" + functionName, {
    method: "POST",
    headers: {
      apikey: anonKey,
      authorization: "Bearer " + token,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

async function invokeUpload(functionName, token) {
  const form = new FormData();
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lX8AAAAASUVORK5CYII=",
    "base64",
  );
  form.append("file", new Blob([png], { type: "image/png" }), "stage5-probe.png");
  form.append("user_id", users.b.id);
  form.append("kind", "not-a-valid-upload-kind");

  const response = await fetch(functionsUrl + "/" + functionName, {
    method: "POST",
    headers: {
      apikey: anonKey,
      authorization: "Bearer " + token,
    },
    body: form,
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

const tokenA = await signIn(users.a);
const tokenB = await signIn(users.b);

// Cloudinary signature: user A can sign their canonical asset, not user B's.
const ownSignature = await invoke("get-cloudinary-signature", tokenA, {
  public_id: "sykabelajar/" + users.a.username + "/profile",
});
assert.equal(ownSignature.status, 200,
  "owner signature should succeed: " + JSON.stringify(ownSignature.body));
assert.equal(ownSignature.body.public_id, "sykabelajar/" + users.a.username + "/profile");
assert.equal(typeof ownSignature.body.signature, "string");

const foreignSignature = await invoke("get-cloudinary-signature", tokenA, {
  public_id: "sykabelajar/" + users.b.username + "/profile",
});
assert.equal(foreignSignature.status, 403);
assert.equal(foreignSignature.body.error, "CLOUDINARY_PUBLIC_ID_NOT_OWNED");

// Both legacy UUID and current username deletion namespaces must be isolated.
for (const item of [
  ["cloudinary-delete-asset", "profile_pictures/user_" + users.b.id],
  ["cloudinary-delete-asset-v2", "profile_pictures/user_" + users.b.id],
  ["cloudinary-delete-profile", "sykabelajar/" + users.b.username + "/profile"],
]) {
  const result = await invoke(item[0], tokenA, { public_id: item[1] });
  assert.equal(result.status, 403, item[0] + " must deny another user's asset");
  assert.equal(result.body.error, "FORBIDDEN_PUBLIC_ID");
}

// Upload handlers derive the Cloudinary public_id from the verified caller
// UUID. A supplied second-user ID must not become the asset owner. Invalid kind
// stops before any outbound provider call so this test remains provider-free.
for (const functionName of ["cloudinary-profile-upload", "cloudinary-profile-upload-v2"]) {
  const result = await invokeUpload(functionName, tokenA);
  assert.equal(result.status, 400, functionName + " must authenticate before validating upload details");
  assert.equal(result.body.error, "INVALID_IMAGE_KIND");
}

// Only user B is an active admin. User A's valid signed-in JWT is insufficient.
const deniedAdmin = await invoke("payment-gateway-admin", tokenA, { action: "get" });
assert.equal(deniedAdmin.status, 403);
assert.equal(deniedAdmin.body.error, "ADMIN_REQUIRED");

const allowedAdmin = await invoke("payment-gateway-admin", tokenB, { action: "get" });
assert.equal(allowedAdmin.status, 200,
  "active admin should read settings: " + JSON.stringify(allowedAdmin.body));
assert.equal(allowedAdmin.body.ok, true);

// An order belonging to user B is invisible to user A in both payment handlers.
const foreignCreate = await invoke("payment-gateway-create", tokenA, { order_id: orderB });
assert.equal(foreignCreate.status, 404);
assert.equal(foreignCreate.body.error, "ORDER_NOT_FOUND");

const ownCreate = await invoke("payment-gateway-create", tokenA, { order_id: orderA });
assert.equal(ownCreate.status, 409);
assert.equal(ownCreate.body.error, "AUTOMATIC_PAYMENTS_DISABLED");

const foreignReconcile = await invoke("payment-gateway-reconcile", tokenA, { order_id: orderB });
assert.equal(foreignReconcile.status, 404);
assert.equal(foreignReconcile.body.error, "ORDER_NOT_FOUND");

const ownReconcile = await invoke("payment-gateway-reconcile", tokenA, { order_id: orderA });
assert.equal(ownReconcile.status, 200);
assert.equal(ownReconcile.body.reason, "PROVIDER_RECONCILIATION_UNSUPPORTED");

console.log("Stage 5 local Edge integration passed: two distinct Auth UUIDs, Cloudinary owner isolation, admin authorization, and payment-order IDOR checks across nine business handlers.");
