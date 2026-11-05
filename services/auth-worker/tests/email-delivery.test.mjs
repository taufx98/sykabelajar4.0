import test from "node:test";
import assert from "node:assert/strict";
import { deliverAuthEmail } from "../src/email-delivery.mjs";

const message = {
  to: "student@example.com",
  subject: "Verifikasi akun SYKABELAJAR",
  text: "Buka tautan verifikasi yang aman.",
  action: "verify-email",
};

test("the local authenticated webhook contract sends the expected payload", async () => {
  let captured;
  await deliverAuthEmail({
    AUTH_EMAIL_FROM: "noreply@example.test",
    AUTH_EMAIL_WEBHOOK_URL: "http://127.0.0.1:8788/send",
    AUTH_EMAIL_WEBHOOK_TOKEN: "test-webhook-secret",
  }, message, async (url, init) => {
    captured = { url: String(url), init };
    return new Response(null, { status: 202 });
  });

  assert.equal(captured.url, "http://127.0.0.1:8788/send");
  assert.equal(captured.init.headers.Authorization, "Bearer test-webhook-secret");
  assert.deepEqual(JSON.parse(captured.init.body), {
    from: "noreply@example.test",
    to: "student@example.com",
    subject: "Verifikasi akun SYKABELAJAR",
    text: "Buka tautan verifikasi yang aman.",
    category: "verify-email",
  });
});

test("webhook fallback fails closed when its configuration is incomplete", async () => {
  let called = false;
  await assert.rejects(
    deliverAuthEmail({ AUTH_EMAIL_FROM: "noreply@example.test" }, message, async () => {
      called = true;
      return new Response(null, { status: 202 });
    }),
    { message: "AUTH_EMAIL_DELIVERY_NOT_CONFIGURED" },
  );
  assert.equal(called, false);
});

test("remote webhook endpoints must use HTTPS", async () => {
  await assert.rejects(
    deliverAuthEmail({
      AUTH_EMAIL_FROM: "noreply@example.test",
      AUTH_EMAIL_WEBHOOK_URL: "http://mail.example.com/send",
      AUTH_EMAIL_WEBHOOK_TOKEN: "test-webhook-secret",
    }, message, async () => new Response(null, { status: 202 })),
    { message: "AUTH_EMAIL_ENDPOINT_MUST_USE_HTTPS" },
  );
});

test("webhook provider failures are sanitized", async () => {
  await assert.rejects(
    deliverAuthEmail({
      AUTH_EMAIL_FROM: "noreply@example.test",
      AUTH_EMAIL_WEBHOOK_URL: "https://mail.example.test/send",
      AUTH_EMAIL_WEBHOOK_TOKEN: "test-webhook-secret",
    }, message, async () => new Response("private provider details", { status: 429 })),
    { message: "AUTH_EMAIL_DELIVERY_FAILED" },
  );
});
