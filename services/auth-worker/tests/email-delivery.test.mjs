import test from "node:test";
import assert from "node:assert/strict";
import { deliverAuthEmail } from "../src/email-delivery.mjs";

const message = {
  to: "student@example.com",
  subject: "Verifikasi akun SYKABELAJAR",
  text: "Buka tautan verifikasi yang aman.",
  action: "verify-email",
};

test("Resend uses the fixed API endpoint and keeps its API key server-side", async () => {
  let captured;
  await deliverAuthEmail({
    AUTH_EMAIL_PROVIDER: "resend",
    AUTH_EMAIL_FROM: "SYKABELAJAR <noreply@sykabelajar.my.id>",
    RESEND_API_KEY: "re_test_only_secret",
  }, message, async (url, init) => {
    captured = { url: String(url), init };
    return new Response(JSON.stringify({ id: "email-test-id" }), { status: 200 });
  });

  assert.equal(captured.url, "https://api.resend.com/emails");
  assert.equal(captured.init.method, "POST");
  assert.equal(captured.init.headers.Authorization, "Bearer re_test_only_secret");
  assert.equal(captured.init.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(captured.init.body), {
    from: "SYKABELAJAR <noreply@sykabelajar.my.id>",
    to: ["student@example.com"],
    subject: "Verifikasi akun SYKABELAJAR",
    text: "Buka tautan verifikasi yang aman.",
  });
});

test("Resend refuses to send when its secret or verified sender is missing", async () => {
  let called = false;
  await assert.rejects(
    deliverAuthEmail({
      AUTH_EMAIL_PROVIDER: "resend",
      AUTH_EMAIL_FROM: "noreply@sykabelajar.my.id",
    }, message, async () => {
      called = true;
      return new Response(null, { status: 200 });
    }),
    { message: "AUTH_EMAIL_DELIVERY_NOT_CONFIGURED" },
  );
  assert.equal(called, false);
});

test("Resend provider failures are sanitized", async () => {
  await assert.rejects(
    deliverAuthEmail({
      AUTH_EMAIL_PROVIDER: "resend",
      AUTH_EMAIL_FROM: "noreply@sykabelajar.my.id",
      RESEND_API_KEY: "re_test_only_secret",
    }, message, async () => new Response("private provider details", { status: 429 })),
    { message: "AUTH_EMAIL_DELIVERY_FAILED" },
  );
});

test("the existing authenticated webhook contract remains supported by default", async () => {
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

test("unknown email providers fail closed", async () => {
  await assert.rejects(
    deliverAuthEmail({
      AUTH_EMAIL_PROVIDER: "unknown",
      AUTH_EMAIL_FROM: "noreply@example.test",
    }, message, async () => new Response(null, { status: 200 })),
    { message: "AUTH_EMAIL_PROVIDER_UNSUPPORTED" },
  );
});

test("remote webhook endpoints must use HTTPS", async () => {
  await assert.rejects(
    deliverAuthEmail({
      AUTH_EMAIL_PROVIDER: "webhook",
      AUTH_EMAIL_FROM: "noreply@example.test",
      AUTH_EMAIL_WEBHOOK_URL: "http://mail.example.com/send",
      AUTH_EMAIL_WEBHOOK_TOKEN: "test-webhook-secret",
    }, message, async () => new Response(null, { status: 202 })),
    { message: "AUTH_EMAIL_ENDPOINT_MUST_USE_HTTPS" },
  );
});
