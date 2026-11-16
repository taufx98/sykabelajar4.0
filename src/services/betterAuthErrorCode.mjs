const EMAIL_VERIFICATION_ERRORS = new Set([
  "EMAIL_VERIFICATION_REQUIRED",
  "EMAIL_NOT_VERIFIED",
  "EMAIL_NOT_CONFIRMED",
]);

/**
 * Normalize Better Auth errors for the login UI without exposing arbitrary
 * server messages. Keep the actionable email-verification reason even when
 * Better Auth wraps it in the generic HTTP/API code FORBIDDEN.
 */
export function safeBetterAuthErrorCode(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return "AUTH_REQUEST_FAILED";
  }

  for (const key of ["message", "error", "code"]) {
    const value = body[key];
    if (typeof value === "string" && EMAIL_VERIFICATION_ERRORS.has(value)) {
      return value;
    }
  }

  for (const key of ["code", "error", "message"]) {
    const value = body[key];
    if (typeof value === "string" && /^[A-Z0-9_]{2,80}$/.test(value)) {
      return value;
    }
  }

  return "AUTH_REQUEST_FAILED";
}


const SOCIAL_ACCOUNT_LINK_ERRORS = new Set([
  "account_not_linked",
  "account_already_linked_to_different_user",
  "unable_to_link_account",
  "oauth_link_error",
  "signup_disabled",
]);

const SOCIAL_CANCELLED_ERRORS = new Set([
  "access_denied",
  "user_cancelled",
  "user_canceled",
]);

/** Normalize OAuth callback errors without exposing provider/server descriptions. */
export function getSocialAuthErrorCategory(value) {
  if (typeof value !== "string") return "failed";
  const code = value.trim().toLowerCase();
  if (SOCIAL_ACCOUNT_LINK_ERRORS.has(code)) return "account_not_linked";
  if (SOCIAL_CANCELLED_ERRORS.has(code)) return "cancelled";
  return "failed";
}
