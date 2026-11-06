import test from "node:test";
import assert from "node:assert/strict";
import { decryptEmailSecret, encryptEmailSecret } from "../src/email-secret.mjs";

const masterKey = "local-test-only-master-key-with-at-least-32-characters";

test("ZeptoMail Send Mail Token is encrypted and can be decrypted", async () => {
  const token = "test-agent-send-mail-token-do-not-log";
  const envelope = await encryptEmailSecret(masterKey, token);
  assert.match(envelope, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.equal(envelope.includes(token), false);
  assert.equal(await decryptEmailSecret(masterKey, envelope), token);
});

test("each encryption uses a fresh random IV", async () => {
  const first = await encryptEmailSecret(masterKey, "same-token");
  const second = await encryptEmailSecret(masterKey, "same-token");
  assert.notEqual(first, second);
});

test("wrong key and tampered ciphertext fail without exposing plaintext", async () => {
  const envelope = await encryptEmailSecret(masterKey, "sensitive-token-value");
  await assert.rejects(
    decryptEmailSecret("another-master-key-with-at-least-32-characters", envelope),
    { message: "AUTH_EMAIL_SECRET_DECRYPT_FAILED" },
  );
  const parts = envelope.split(".");
  // Change a character in the middle so base64url unused trailing bits cannot
  // decode to the same byte sequence and make this tamper test pass by accident.
  const tamperIndex = Math.floor(parts[2].length / 2);
  const replacement = parts[2][tamperIndex] === "A" ? "B" : "A";
  parts[2] = parts[2].slice(0, tamperIndex) + replacement + parts[2].slice(tamperIndex + 1);
  await assert.rejects(
    decryptEmailSecret(masterKey, parts.join(".")),
    { message: "AUTH_EMAIL_SECRET_DECRYPT_FAILED" },
  );
});

test("short encryption keys and unsupported envelopes are rejected", async () => {
  await assert.rejects(encryptEmailSecret("short", "token"), { message: "AUTH_EMAIL_ENCRYPTION_KEY_NOT_CONFIGURED" });
  await assert.rejects(decryptEmailSecret(masterKey, "legacy-plaintext-token"), { message: "AUTH_EMAIL_SECRET_INVALID" });
});
