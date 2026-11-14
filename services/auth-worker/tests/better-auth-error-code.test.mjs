import test from "node:test";
import assert from "node:assert/strict";
import { safeBetterAuthErrorCode } from "../../../src/services/betterAuthErrorCode.mjs";

test("preserves the actionable email verification reason wrapped by FORBIDDEN", () => {
  assert.equal(
    safeBetterAuthErrorCode({
      code: "FORBIDDEN",
      message: "EMAIL_VERIFICATION_REQUIRED",
    }),
    "EMAIL_VERIFICATION_REQUIRED",
  );
});

test("recognizes alternate Better Auth email verification codes", () => {
  assert.equal(
    safeBetterAuthErrorCode({ code: "FORBIDDEN", message: "EMAIL_NOT_VERIFIED" }),
    "EMAIL_NOT_VERIFIED",
  );
});

test("preserves unrelated stable Better Auth error codes", () => {
  assert.equal(
    safeBetterAuthErrorCode({ code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid credentials" }),
    "INVALID_EMAIL_OR_PASSWORD",
  );
});

test("does not surface arbitrary server messages", () => {
  assert.equal(
    safeBetterAuthErrorCode({ code: "FORBIDDEN", message: "Database user row missing" }),
    "FORBIDDEN",
  );
  assert.equal(safeBetterAuthErrorCode(null), "AUTH_REQUEST_FAILED");
});
