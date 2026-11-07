import assert from "node:assert/strict";
import test from "node:test";
import { sendBrevoEmail } from "../src/brevo.mjs";

const account = {
  apiKey: "xkeysib-test-api-key-never-real",
  senderAddress: "noreply@sykabelajar.my.id",
  senderName: "SYKABELAJAR",
};
const message = {
  to: "admin@example.test",
  subject: "Tes email SYKABELAJAR",
  text: "Ini pesan uji.",
  action: "verify-email",
};

test("Brevo sends transactional mail through the official API with API-key authentication", async () => {
  let captured;
  const result = await sendBrevoEmail(account, message, async (url, init) => {
    captured = { url: String(url), init };
    return new Response(JSON.stringify({ messageId: "<brevo-message-123>" }), { status: 201 });
  });

  assert.equal(captured.url, "https://api.brevo.com/v3/smtp/email");
  assert.equal(captured.init.method, "POST");
  assert.equal(captured.init.headers["api-key"], account.apiKey);
  assert.equal(captured.init.headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(captured.init.body), {
    sender: { name: account.senderName, email: account.senderAddress },
    to: [{ email: message.to }],
    subject: message.subject,
    textContent: message.text,
    tags: ["sykabelajar-auth", "verify-email"],
  });
  assert.equal(JSON.stringify(captured.init.body).includes(account.apiKey), false);
  assert.equal(result.messageId, "<brevo-message-123>");
});

test("Brevo authentication and provider failures are mapped to safe errors", async () => {
  await assert.rejects(
    sendBrevoEmail(account, message, async () => new Response("private provider details", { status: 401 })),
    { message: "BREVO_AUTH_FAILED" },
  );
  await assert.rejects(
    sendBrevoEmail(account, message, async () => new Response("private provider details", { status: 403 })),
    { message: "BREVO_AUTH_FAILED" },
  );
  await assert.rejects(
    sendBrevoEmail(account, message, async () => new Response("private provider details", { status: 429 })),
    { message: "BREVO_SEND_FAILED" },
  );
});

test("Brevo network failures are sanitized", async () => {
  await assert.rejects(
    sendBrevoEmail(account, message, async () => { throw new Error("sensitive network detail"); }),
    { message: "BREVO_CONNECTION_FAILED" },
  );
});

test("Brevo rejects incomplete configuration before making a network request", async () => {
  let called = false;
  await assert.rejects(
    sendBrevoEmail({ ...account, apiKey: "" }, message, async () => {
      called = true;
      return new Response(null, { status: 201 });
    }),
    { message: "BREVO_CONFIGURATION_INCOMPLETE" },
  );
  assert.equal(called, false);
});
