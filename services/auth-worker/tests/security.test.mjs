import test from "node:test";
import assert from "node:assert/strict";
import {
  createCorsHeaders,
  isAllowedOrigin,
  timingSafeEqualString,
} from "../src/security.mjs";

test("allows only the exact configured HTTPS origin", () => {
  const allowlist = ["https://sykabelajar.my.id"];
  assert.equal(isAllowedOrigin("https://sykabelajar.my.id", allowlist), true);
  assert.equal(isAllowedOrigin("https://www.sykabelajar.my.id", allowlist), false);
  assert.equal(isAllowedOrigin("https://sykabelajar.my.id.evil.example", allowlist), false);
  assert.equal(isAllowedOrigin("http://sykabelajar.my.id", allowlist), false);
  assert.equal(isAllowedOrigin("null", allowlist), false);
});

test("rejects origins containing paths, credentials, or malformed URLs", () => {
  const allowlist = ["https://sykabelajar.my.id"];
  assert.equal(isAllowedOrigin("https://sykabelajar.my.id/path", allowlist), false);
  assert.equal(isAllowedOrigin("https://user@sykabelajar.my.id", allowlist), false);
  assert.equal(isAllowedOrigin("not-a-url", allowlist), false);
  assert.equal(isAllowedOrigin(null, allowlist), false);
});

test("CORS allows credentials only for an exact allowlisted origin", () => {
  const allowedRequest = new Request("https://auth.example.test/api/auth/get-session", {
    headers: { Origin: "https://sykabelajar.my.id" },
  });
  const allowed = createCorsHeaders(allowedRequest, ["https://sykabelajar.my.id"]);
  assert.equal(allowed.get("Access-Control-Allow-Origin"), "https://sykabelajar.my.id");
  assert.equal(allowed.get("Access-Control-Allow-Credentials"), "true");
  assert.notEqual(allowed.get("Access-Control-Allow-Origin"), "*");

  const rejectedRequest = new Request("https://auth.example.test/api/auth/get-session", {
    headers: { Origin: "https://attacker.example" },
  });
  assert.equal(createCorsHeaders(rejectedRequest, ["https://sykabelajar.my.id"]), null);
});

test("development localhost is allowed only when explicitly listed", () => {
  assert.equal(isAllowedOrigin("http://localhost:5173", ["https://sykabelajar.my.id"]), false);
  assert.equal(isAllowedOrigin("http://localhost:5173", ["http://localhost:5173"]), true);
});

test("bootstrap secret comparison accepts exact value and rejects wrong/empty values", () => {
  assert.equal(timingSafeEqualString("a".repeat(32), "a".repeat(32)), true);
  assert.equal(timingSafeEqualString("a".repeat(32), "a".repeat(31) + "b"), false);
  assert.equal(timingSafeEqualString("secret", ""), false);
  assert.equal(timingSafeEqualString("secret", null), false);
});
