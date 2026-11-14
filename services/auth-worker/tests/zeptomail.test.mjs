import test from "node:test";
import assert from "node:assert/strict";
import { sendZeptoMail } from "../src/zeptomail.mjs";

const account = {
  sendMailToken: "agent-send-mail-token-test",
  senderAddress: "noreply@sykabelajar.my.id",
  senderName: "SYKABELAJAR",
  bounceAddress: "bounce@sykabelajar.my.id",
};
const message = {
  to: "admin@example.com",
  subject: "Tes email SYKABELAJAR",
  text: "Ini pesan uji.",
};

test("ZeptoMail uses its official endpoint and Agent-specific authorization header", async () => {
  let captured;
  const result = await sendZeptoMail(account, message, async (url, init) => {
    captured = { url: String(url), init };
    return new Response(JSON.stringify({ request_id: "zepto-request-123" }), { status: 200 });
  });

  assert.equal(captured.url, "https://api.zeptomail.com/v1.1/email");
  assert.equal(captured.init.method, "POST");
  assert.equal(captured.init.headers.Authorization, "Zoho-enczapikey agent-send-mail-token-test");
  assert.equal(captured.init.headers.Accept, "application/json");
  assert.equal(result.requestId, "zepto-request-123");
  const body = JSON.parse(captured.init.body);
  assert.deepEqual(body.from, { address: account.senderAddress, name: account.senderName });
  assert.deepEqual(body.to, [{ email_address: { address: message.to, name: "" } }]);
  assert.equal(body.subject, message.subject);
  assert.equal(body.textbody, message.text);
  assert.equal(body.bounce_address, account.bounceAddress);
  assert.equal(body.track_clicks, false);
  assert.equal(body.track_opens, false);
  assert.equal(captured.init.body.includes(account.sendMailToken), false);
});

test("ZeptoMail accepts a pasted Authorization prefix and omits optional bounce address", async () => {
  let captured;
  await sendZeptoMail({
    ...account,
    sendMailToken: "Zoho-enczapikey pasted-agent-token",
    bounceAddress: "",
  }, message, async (_url, init) => {
    captured = init;
    return new Response(JSON.stringify({ message: "OK" }), { status: 200 });
  });
  assert.equal(captured.headers.Authorization, "Zoho-enczapikey pasted-agent-token");
  assert.equal(Object.hasOwn(JSON.parse(captured.body), "bounce_address"), false);
});

test("ZeptoMail authentication failures are mapped to a safe error", async () => {
  await assert.rejects(
    sendZeptoMail(account, message, async () => new Response("private provider details", { status: 401 })),
    { message: "ZEPTO_MAIL_AUTH_FAILED" },
  );
  await assert.rejects(
    sendZeptoMail(account, message, async () => new Response("private provider details", { status: 403 })),
    { message: "ZEPTO_MAIL_AUTH_FAILED" },
  );
});

test("ZeptoMail network and provider errors never expose provider response bodies", async () => {
  await assert.rejects(
    sendZeptoMail(account, message, async () => new Response("private provider details", { status: 429 })),
    { message: "ZEPTO_MAIL_SEND_FAILED" },
  );
  await assert.rejects(
    sendZeptoMail(account, message, async () => { throw new Error("secret network internals"); }),
    { message: "ZEPTO_MAIL_CONNECTION_FAILED" },
  );
});

test("incomplete sender configuration fails before making a network request", async () => {
  let called = false;
  await assert.rejects(
    sendZeptoMail({ ...account, sendMailToken: "" }, message, async () => {
      called = true;
      return new Response(null, { status: 200 });
    }),
    { message: "ZEPTO_MAIL_CONFIGURATION_INCOMPLETE" },
  );
  assert.equal(called, false);
});
