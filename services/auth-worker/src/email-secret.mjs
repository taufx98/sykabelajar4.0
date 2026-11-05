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
    throw new Error("AUTH_EMAIL_ENCRYPTION_KEY_NOT_CONFIGURED");
  }
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(masterKey));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

/**
 * Encrypts a provider token with AES-256-GCM.
 * The returned envelope contains a fresh random IV and authenticated ciphertext.
 * @param {string} masterKey
 * @param {string} plaintext
 * @returns {Promise<string>}
 */
export async function encryptEmailSecret(masterKey, plaintext) {
  if (typeof plaintext !== "string" || !plaintext.trim()) {
    throw new Error("AUTH_EMAIL_SECRET_REQUIRED");
  }
  const key = await deriveEncryptionKey(masterKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(plaintext),
  );
  return "v1." + base64UrlEncode(iv) + "." + base64UrlEncode(new Uint8Array(ciphertext));
}

/**
 * Decrypts only authenticated v1 AES-GCM envelopes.
 * Provider secrets are never included in thrown error messages.
 * @param {string} masterKey
 * @param {string} envelope
 * @returns {Promise<string>}
 */
export async function decryptEmailSecret(masterKey, envelope) {
  if (typeof envelope !== "string") throw new Error("AUTH_EMAIL_SECRET_INVALID");
  const parts = envelope.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") throw new Error("AUTH_EMAIL_SECRET_INVALID");
  const key = await deriveEncryptionKey(masterKey);
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64UrlDecode(parts[1]) },
      key,
      base64UrlDecode(parts[2]),
    );
    return decoder.decode(plaintext);
  } catch {
    throw new Error("AUTH_EMAIL_SECRET_DECRYPT_FAILED");
  }
}
