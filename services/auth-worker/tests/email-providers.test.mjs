import assert from "node:assert/strict";
import test from "node:test";
import { EmailProviderDeliveryError, normalizeCustomHttpConfig, sendEmailWithProvider } from "../src/email-providers.mjs";

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
  assert.equal(
    Buffer.from(body.email.html, "base64").toString("utf8"),
    "<!doctype html><html><body><div>Isi tes</div></body></html>",
  );
  assert.equal(result.messageId, "sendpulse-id-1");
  assert.equal(captured.init.body.includes("sendpulse-static-test-key-123456"), false);
});

test("SendPulse HTML alternative is UTF-8 safe and escapes message content", async () => {
  const contentText = "Baris 1\n<kode> & “tes” ✅";
  let captured;
  await sendEmailWithProvider(
    "sendpulse",
    { apiKey: "sendpulse-static-test-key-123456" },
    account,
    { ...message, text: contentText },
    async (_url, init) => {
      captured = init;
      return new Response(JSON.stringify({ result: true, id: "sendpulse-id-unicode" }), { status: 200 });
    },
  );
  const body = JSON.parse(captured.body);
  assert.equal(body.email.text, contentText);
  assert.equal(
    Buffer.from(body.email.html, "base64").toString("utf8"),
    "<!doctype html><html><body><div>Baris 1<br>&lt;kode&gt; &amp; “tes” ✅</div></body></html>",
  );
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

test("ambiguous network, timeout and 5xx failures are diagnostic and never fail over", async () => {
  await assert.rejects(
    sendEmailWithProvider("resend", { apiKey: "re_test_api_key_1234567890" }, account, message, async () => new Response("internal error", { status: 503 })),
    (error) => error instanceof EmailProviderDeliveryError && error.allowFailover === false && error.code === "EMAIL_PROVIDER_HTTP_5XX",
  );
  await assert.rejects(
    sendEmailWithProvider("resend", { apiKey: "re_test_api_key_1234567890" }, account, message, async () => { throw new Error("private transport data"); }),
    (error) => error instanceof EmailProviderDeliveryError && error.code === "EMAIL_PROVIDER_NETWORK_ERROR" && !String(error.message).includes("private"),
  );
  const timeout = new Error("timeout details must not escape");
  timeout.name = "TimeoutError";
  await assert.rejects(
    sendEmailWithProvider("sendpulse", { apiKey: "sendpulse-static-test-key-123456" }, account, message, async (_url, init) => {
      assert.ok(init.signal);
      throw timeout;
    }),
    (error) => error instanceof EmailProviderDeliveryError && error.code === "EMAIL_PROVIDER_TIMEOUT" && !String(error.message).includes("details"),
  );
  await assert.rejects(
    sendEmailWithProvider("sendpulse", { apiKey: "sendpulse-static-test-key-123456" }, account, message, async () => {
      const response = new Response("{}", { status: 200 });
      response.text = async () => { throw new Error("private response body"); };
      return response;
    }),
    (error) => error instanceof EmailProviderDeliveryError && error.code === "EMAIL_PROVIDER_RESPONSE_READ_FAILED",
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


test("Custom HTTP provider sends configurable JSON with supported substitutions and API-key auth", async () => {
  const credentials = normalizeCustomHttpConfig({
    endpointUrl: "https://api.mailvendor.com/v1/send",
    authMode: "api_key",
    authHeaderName: "X-API-Key",
    apiKey: "custom-provider-api-key-123456",
    extraHeadersJson: "{\"X-Workspace\":\"sykabelajar\"}",
    payloadTemplateJson: JSON.stringify({
      sender: { email: "{{from.email}}", name: "{{from.name}}" },
      recipients: ["{{to}}"],
      subject: "{{subject}}",
      content: "{{text}}",
      category: "{{action}}",
    }),
  });
  let captured;
  const result = await sendEmailWithProvider("custom_http", credentials, account, message, async (url, init) => {
    captured = { url: String(url), init };
    return new Response(JSON.stringify({ success: true, messageId: "custom-id-1" }), { status: 202 });
  });
  assert.equal(captured.url, "https://api.mailvendor.com/v1/send");
  assert.equal(captured.init.method, "POST");
  assert.equal(captured.init.redirect, "error");
  assert.equal(captured.init.headers["X-API-Key"], "custom-provider-api-key-123456");
  assert.equal(captured.init.headers["X-Workspace"], "sykabelajar");
  const body = JSON.parse(captured.init.body);
  assert.equal(body.sender.email, account.senderAddress);
  assert.equal(body.recipients[0], message.to);
  assert.equal(body.subject, message.subject);
  assert.equal(body.content, message.text);
  assert.equal(body.category, message.action);
  assert.equal(result.messageId, "custom-id-1");
  assert.equal(captured.init.body.includes("custom-provider-api-key-123456"), false);
});

test("Custom HTTP endpoint rejects local, IP-literal, HTTP and redirected destinations", async () => {
  for (const endpointUrl of [
    "http://api.vendor.com/send",
    "https://127.0.0.1/send",
    "https://localhost/send",
    "https://mail.internal/send",
    "https://api.vendor.com:8443/send",
    "https://user:pass@api.vendor.com/send",
  ]) {
    assert.throws(() => normalizeCustomHttpConfig({
      endpointUrl, authMode: "none",
    }), { message: "EMAIL_CUSTOM_ENDPOINT_INVALID" });
  }
  const credentials = normalizeCustomHttpConfig({
    endpointUrl: "https://api.vendor.com/send",
    authMode: "none",
  });
  await assert.rejects(
    sendEmailWithProvider("custom_http", credentials, account, message, async () =>
      new Response(null, { status: 302, headers: { location: "https://attacker.example/collect" } })),
    (error) => error instanceof EmailProviderDeliveryError && error.code === "EMAIL_PROVIDER_REJECTED_MESSAGE",
  );
});

test("Custom HTTP adapter rejects header injection and unsupported payload placeholders", () => {
  assert.throws(() => normalizeCustomHttpConfig({
    endpointUrl: "https://api.vendor.com/send",
    authMode: "api_key",
    authHeaderName: "Authorization",
    apiKey: "custom-provider-api-key-123456",
  }), { message: "EMAIL_CUSTOM_AUTH_INVALID" });
  assert.throws(() => normalizeCustomHttpConfig({
    endpointUrl: "https://api.vendor.com/send",
    authMode: "none",
    extraHeadersJson: "{\"Authorization\":\"Bearer secret\"}",
  }), { message: "EMAIL_CUSTOM_HEADERS_INVALID" });
  assert.throws(() => normalizeCustomHttpConfig({
    endpointUrl: "https://api.vendor.com/send",
    authMode: "none",
    payloadTemplateJson: "{\"to\":\"{{to}}\",\"subject\":\"{{subject}}\",\"text\":\"{{text}}\",\"apiKey\":\"{{secret}}\"}",
  }), { message: "EMAIL_CUSTOM_PAYLOAD_INVALID" });
});

test("Custom HTTP auth supports Bearer and Basic without placing credentials in the payload", async () => {
  const cases = [
    {
      config: { endpointUrl: "https://api.vendor.com/send", authMode: "bearer", apiKey: "custom-bearer-token-123456" },
      header: "Bearer custom-bearer-token-123456",
    },
    {
      config: { endpointUrl: "https://api.vendor.com/send", authMode: "basic", username: "api-user", password: "basic-password-123" },
      header: "Basic " + Buffer.from("api-user:basic-password-123").toString("base64"),
    },
  ];
  for (const item of cases) {
    let captured;
    await sendEmailWithProvider("custom_http", normalizeCustomHttpConfig(item.config), account, message, async (_url, init) => {
      captured = init;
      return new Response("{}", { status: 200 });
    });
    assert.equal(captured.headers.authorization, item.header);
    assert.equal(captured.body.includes(item.header), false);
  }
});
