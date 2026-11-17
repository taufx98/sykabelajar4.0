import assert from "node:assert/strict";
import test from "node:test";
import { safeAuthRuntimeErrorCode } from "../src/auth-runtime-error.mjs";

test("safeAuthRuntimeErrorCode exposes only reviewed authentication failure codes", () => {
  assert.equal(
    safeAuthRuntimeErrorCode(new Error("AUTH_EMAIL_DELIVERY_STATUS_UNKNOWN")),
    "AUTH_EMAIL_DELIVERY_STATUS_UNKNOWN",
  );
  assert.equal(
    safeAuthRuntimeErrorCode(new Error("APPLICATION_IDENTITY_NOT_READY")),
    "APPLICATION_IDENTITY_NOT_READY",
  );
  assert.equal(
    safeAuthRuntimeErrorCode(new Error("D1_ERROR: no such table: secret_table")),
    null,
  );
  assert.equal(
    safeAuthRuntimeErrorCode(new Error("https://internal.example/token")),
    null,
  );
  assert.equal(safeAuthRuntimeErrorCode("AUTH_EMAIL_DELIVERY_STATUS_UNKNOWN"), null);
});
