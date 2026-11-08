const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** @param {Uint8Array} bytes */
function base64UrlEncode(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

/** @param {string} value */
function base64UrlDecode(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

/** @param {string} masterKey */
async function deriveEncryptionKey(masterKey) {
  if (typeof masterKey !== "string" || masterKey.trim().length < 32) {
    throw new Error("AUTH_PROVIDER_ENCRYPTION_KEY_NOT_CONFIGURED");
  }
  // Domain separation keeps this key distinct from the email-secret vault.
  const material = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode("sykabelajar:oauth-provider:v1:" + masterKey),
  );
  return crypto.subtle.importKey("raw", material, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

/**
 * @param {string} masterKey
 * @param {string} plaintext
 * @returns {Promise<string>}
 */
export async function encryptSocialProviderSecret(masterKey, plaintext) {
  if (typeof plaintext !== "string" || !plaintext.trim()) {
    throw new Error("AUTH_PROVIDER_SECRET_REQUIRED");
  }
  const key = await deriveEncryptionKey(masterKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(plaintext),
  );
  return "oauth-v1." + base64UrlEncode(iv) + "." + base64UrlEncode(new Uint8Array(ciphertext));
}

/**
 * @param {string} masterKey
 * @param {string} envelope
 * @returns {Promise<string>}
 */
export async function decryptSocialProviderSecret(masterKey, envelope) {
  if (typeof envelope !== "string") throw new Error("AUTH_PROVIDER_SECRET_INVALID");
  const parts = envelope.split(".");
  if (parts.length !== 3 || parts[0] !== "oauth-v1") {
    throw new Error("AUTH_PROVIDER_SECRET_INVALID");
  }
  const key = await deriveEncryptionKey(masterKey);
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64UrlDecode(parts[1]) },
      key,
      base64UrlDecode(parts[2]),
    );
    return decoder.decode(plaintext);
  } catch {
    throw new Error("AUTH_PROVIDER_SECRET_DECRYPT_FAILED");
  }
}
