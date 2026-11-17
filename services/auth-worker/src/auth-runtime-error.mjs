const SAFE_AUTH_RUNTIME_ERROR_CODES = new Set([
  "AUTH_EMAIL_DELIVERY_STATUS_UNKNOWN",
  "AUTH_EMAIL_DELIVERY_FAILED",
  "AUTH_EMAIL_ALL_PROVIDERS_EXHAUSTED",
  "AUTH_EMAIL_PROVIDER_QUOTA_REACHED",
  "AUTH_EMAIL_PROVIDER_CREDENTIAL_UNAVAILABLE",
  "AUTH_EMAIL_ENCRYPTION_KEY_NOT_CONFIGURED",
  "APPLICATION_IDENTITY_NOT_READY",
]);

/**
 * Return only reviewed, non-secret runtime codes. Never return arbitrary
 * exception text, SQL messages, URLs, user data or credential material.
 * @param {unknown} error
 * @returns {string | null}
 */
export function safeAuthRuntimeErrorCode(error) {
  if (!(error instanceof Error)) return null;
  return SAFE_AUTH_RUNTIME_ERROR_CODES.has(error.message) ? error.message : null;
}
