import assert from "node:assert/strict";
import { appendFileSync, writeFileSync } from "node:fs";

const apiUrl = (process.env.STAGE5_API_URL ?? "").replace(/\/+$/, "");
const anonKey = process.env.STAGE5_ANON_KEY ?? "";
const fixturePath = process.env.STAGE5_FIXTURE_FILE ?? "";
const password = "Stage5-Edge-Local-Only-2026!";

assert.ok(apiUrl, "STAGE5_API_URL is required");
assert.ok(anonKey, "STAGE5_ANON_KEY is required");
assert.ok(fixturePath, "STAGE5_FIXTURE_FILE is required");

async function signUp(email, fullName, username) {
  const response = await fetch(apiUrl + "/auth/v1/signup", {
    method: "POST",
    headers: {
      apikey: anonKey,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      email,
      password,
      data: { full_name: fullName, username },
    }),
  });
  const body = await response.json().catch(() => ({}));
  const id = body.id ?? body.user?.id;
  assert.equal(
    response.status,
    200,
    "local Auth signup failed for " + email + ": " +
      (body.msg ?? body.message ?? body.error_description ?? body.error ?? response.status),
  );
  assert.match(String(id ?? ""), /^[0-9a-f-]{36}$/i);
  return id;
}

const userAId = await signUp(
  "stage5-edge-user-a@example.test",
  "Stage 5 User A",
  "stage5_user_a",
);
const userBId = await signUp(
  "stage5-edge-user-b@example.test",
  "Stage 5 User B",
  "stage5_user_b",
);

const fixture = { userAId, userBId };
writeFileSync(fixturePath, JSON.stringify(fixture, null, 2) + "\n");

if (process.env.GITHUB_ENV) {
  appendFileSync(
    process.env.GITHUB_ENV,
    "STAGE5_USER_A_ID=" + userAId + "\n" +
      "STAGE5_USER_B_ID=" + userBId + "\n",
  );
}
console.log("Created two synthetic users through the disposable local Auth signup endpoint.");
