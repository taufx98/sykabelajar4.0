import assert from "node:assert/strict";
import test from "node:test";
import { confirmSessionAfterSignIn } from "../../src/services/authSessionConfirmation.mjs";

test("returns an immediately available session without extra reads", async () => {
  const expected = { user: { id: "user-a" } };
  let reads = 0;
  const session = await confirmSessionAfterSignIn(async () => {
    reads += 1;
    return expected;
  }, { retryDelaysMs: [0, 0] });
  assert.equal(session, expected);
  assert.equal(reads, 1);
});

test("rechecks the safe session GET when the cookie is not visible on the first read", async () => {
  const expected = { user: { id: "user-a" } };
  let reads = 0;
  const session = await confirmSessionAfterSignIn(async () => {
    reads += 1;
    return reads === 1 ? null : expected;
  }, { retryDelaysMs: [0, 0] });
  assert.equal(session, expected);
  assert.equal(reads, 2);
});

test("retries transient Worker failures after successful credential submission", async () => {
  const expected = { user: { id: "user-a" } };
  let reads = 0;
  const session = await confirmSessionAfterSignIn(async () => {
    reads += 1;
    if (reads === 1) {
      const error = new Error("AUTH_WORKER_UNAVAILABLE");
      error.status = 503;
      error.code = "AUTH_WORKER_UNAVAILABLE";
      throw error;
    }
    return expected;
  }, { retryDelaysMs: [0] });
  assert.equal(session, expected);
  assert.equal(reads, 2);
});

test("does not retry definitive authentication or verification rejections", async () => {
  let reads = 0;
  const rejection = Object.assign(new Error("EMAIL_VERIFICATION_REQUIRED"), {
    status: 403,
    code: "EMAIL_VERIFICATION_REQUIRED",
  });
  await assert.rejects(
    confirmSessionAfterSignIn(async () => {
      reads += 1;
      throw rejection;
    }, { retryDelaysMs: [0, 0] }),
    (error) => error === rejection,
  );
  assert.equal(reads, 1);
});

test("reports an explicit session-confirmation failure after bounded anonymous reads", async () => {
  let reads = 0;
  await assert.rejects(
    confirmSessionAfterSignIn(async () => {
      reads += 1;
      return null;
    }, { retryDelaysMs: [0, 0] }),
    /AUTH_SESSION_CONFIRMATION_FAILED/,
  );
  assert.equal(reads, 3);
});

console.log("Post-sign-in session confirmation contract passed: only safe session reads are retried.");
