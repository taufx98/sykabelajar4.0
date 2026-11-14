import assert from "node:assert/strict";
import test from "node:test";
import {
  decryptSocialProviderSecret,
  encryptSocialProviderSecret,
} from "../src/social-provider-secret.mjs";

const masterKey = "local-test-only-oauth-provider-encryption-key-32-characters";

test("OAuth client secret is encrypted using a namespaced AES-GCM envelope", async () => {
  const secret = "oauth-client-secret-that-must-never-be-returned";
  const envelope = await encryptSocialProviderSecret(masterKey, secret);
  assert.match(envelope, /^oauth-v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.equal(envelope.includes(secret), false);
  assert.equal(await decryptSocialProviderSecret(masterKey, envelope), secret);
});

test("the OAuth vault uses fresh IVs and is cryptographically separate from the email vault", async () => {
  const first = await encryptSocialProviderSecret(masterKey, "same-secret");
  const second = await encryptSocialProviderSecret(masterKey, "same-secret");
  assert.notEqual(first, second);
  await assert.rejects(
    decryptSocialProviderSecret(
      "different-email-encryption-root-which-is-not-the-oauth-key",
      first,
    ),
    { message: "AUTH_PROVIDER_SECRET_DECRYPT_FAILED" },
  );
});

test("missing keys, malformed envelopes and tampered ciphertext fail closed", async () => {
  await assert.rejects(
    encryptSocialProviderSecret("short", "secret"),
    { message: "AUTH_PROVIDER_ENCRYPTION_KEY_NOT_CONFIGURED" },
  );
  await assert.rejects(
    decryptSocialProviderSecret(masterKey, "plaintext-secret"),
    { message: "AUTH_PROVIDER_SECRET_INVALID" },
  );
  const envelope = await encryptSocialProviderSecret(masterKey, "secret-value");
  const parts = envelope.split(".");
  const index = Math.floor(parts[2].length / 2);
  parts[2] = parts[2].slice(0, index) + (parts[2][index] === "A" ? "B" : "A") + parts[2].slice(index + 1);
  await assert.rejects(
    decryptSocialProviderSecret(masterKey, parts.join(".")),
    { message: "AUTH_PROVIDER_SECRET_DECRYPT_FAILED" },
  );
});
