import assert from "node:assert/strict";
import test from "node:test";
import { EmailProviderDeliveryError, sendEmailWithProvider } from "../src/email-providers.mjs";

const account = { senderAddress: "noreply@sykabelajar.my.id", senderName: "SYKABELAJAR" };
const message = { to: "admin@example.test", subject: "Tes SYKABELAJAR", text: "Isi tes", action: "verify-email" };

test("SendPulse uses the official SMTP REST endpoint and Bearer static API key", async () => {
  let captured;
  const result = await sendEmailWithProvider("sendpulse", { apiKey: "sendpulse-static-test-key-123456" }, account, message, async (url, init) => {
    captured = { url: String(url), init };
    return new Response(JSON.stringify({ result: true, id: "sendpulse-id-1" }), { status: 200 });
  });
  assert.equal(captured.url, "https://api.sendpulse.com/smtp/emails");
  assert.equal(captured.init.headers.authorization, "Bearer sendpulse-static-test-key-123456");
  const body = JSON.parse(captured.init.body);
  assert.equal(body.email.from.email, account.senderAddress);
  assert.deepEqual(body.email.to, [{ name: "", email: message.to }]);
  assert.equal(body.email.text, message.text);
  assert.equal(result.messageId, "sendpulse-id-1");
  assert.equal(captured.init.body.includes("sendpulse-static-test-key-123456"), false);
});

test("Brevo sends transactional messages using the API key header", async () => {
  let captured;
  await sendEmailWithProvider("brevo", { apiKey: "brevo-api-key-test-123456" }, account, message, async (url, init) => {
    captured = { url: String(url), init };
    return new Response(JSON.stringify({ messageId: "brevo-id-1" }), { status: 201 });
  });
  assert.equal(captured.url, "https://api.brevo.com/v3/smtp/email");
  assert.equal(captured.init.headers["api-key"], "brevo-api-key-test-123456");
  assert.deepEqual(JSON.parse(captured.init.body).to, [{ email: message.to }]);
});

test("Mailjet uses v3.1 with public/private Basic authentication", async () => {
  let captured;
  await sendEmailWithProvider("mailjet", { apiKey: "mailjet-public-key", apiSecret: "mailjet-private-secret" }, account, message, async (url, init) => {
    captured = { url: String(url), init };
    return new Response(JSON.stringify({ Messages: [{ Status: "success", To: [{ MessageID: 12345 }] }] }), { status: 200 });
  });
  assert.equal(captured.url, "https://api.mailjet.com/v3.1/send");
  assert.equal(captured.init.headers.authorization, "Basic " + Buffer.from("mailjet-public-key:mailjet-private-secret").toString("base64"));
  assert.equal(JSON.parse(captured.init.body).Messages[0].TextPart, message.text);
});

test("Mailtrap uses the transactional sending endpoint and Bearer token", async () => {
  let captured;
  const result = await sendEmailWithProvider("mailtrap", { apiToken: "mailtrap-api-token-test-123456" }, account, message, async (url, init) => {
    captured = { url: String(url), init };
    return new Response(JSON.stringify({ success: true, message_ids: ["mailtrap-id-1"] }), { status: 200 });
  });
  assert.equal(captured.url, "https://send.api.mailtrap.io/api/send");
  assert.equal(captured.init.headers.authorization, "Bearer mailtrap-api-token-test-123456");
  assert.deepEqual(JSON.parse(captured.init.body).to, [{ email: message.to }]);
  assert.equal(result.messageId, "mailtrap-id-1");
});

test("Resend uses its email API and Bearer API key", async () => {
  let captured;
  const result = await sendEmailWithProvider("resend", { apiKey: "re_test_api_key_1234567890" }, account, message, async (url, init) => {
    captured = { url: String(url), init };
    return new Response(JSON.stringify({ id: "resend-id-1" }), { status: 200 });
  });
  assert.equal(captured.url, "https://api.resend.com/emails");
  assert.equal(captured.init.headers.authorization, "Bearer re_test_api_key_1234567890");
  assert.deepEqual(JSON.parse(captured.init.body).to, [message.to]);
  assert.equal(result.messageId, "resend-id-1");
});

test("explicit quota and credential rejections are safe failover signals", async () => {
  for (const status of [402, 429]) {
    await assert.rejects(
      sendEmailWithProvider("resend", { apiKey: "re_test_api_key_1234567890" }, account, message, async () => new Response("rate limit exceeded", { status })),
      (error) => error instanceof EmailProviderDeliveryError && error.allowFailover === true,
    );
  }
  await assert.rejects(
    sendEmailWithProvider("resend", { apiKey: "re_test_api_key_1234567890" }, account, message, async () => new Response("unauthorized", { status: 401 })),
    (error) => error instanceof EmailProviderDeliveryError && error.code === "EMAIL_PROVIDER_CREDENTIAL_REJECTED" && error.allowFailover === true,
  );
});

test("ambiguous network and 5xx failures never trigger cross-provider retry", async () => {
  await assert.rejects(
    sendEmailWithProvider("resend", { apiKey: "re_test_api_key_1234567890" }, account, message, async () => new Response("internal error", { status: 503 })),
    (error) => error instanceof EmailProviderDeliveryError && error.allowFailover === false && error.code === "EMAIL_DELIVERY_STATUS_UNKNOWN",
  );
  await assert.rejects(
    sendEmailWithProvider("resend", { apiKey: "re_test_api_key_1234567890" }, account, message, async () => { throw new Error("private transport data"); }),
    (error) => error instanceof EmailProviderDeliveryError && error.code === "EMAIL_DELIVERY_STATUS_UNKNOWN" && !String(error.message).includes("private"),
  );
});

test("incomplete credentials or sender fail before outbound network requests", async () => {
  let called = false;
  await assert.rejects(
    sendEmailWithProvider("mailjet", { apiKey: "public-only-key" }, account, message, async () => {
      called = true;
      return new Response(null, { status: 200 });
    }),
    { message: "EMAIL_PROVIDER_CONFIGURATION_INCOMPLETE" },
  );
  assert.equal(called, false);
});
