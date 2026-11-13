/** @param {string} value @param {string} label */
function requireHttpsOrigin(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(label + "_REQUIRED");
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(label + "_INVALID");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.origin !== value.replace(/\/$/, "") ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(label + "_MUST_BE_HTTPS_ORIGIN");
  }
  return parsed.origin;
}

/**
 * Staging includes its own callback plus the production callback for its
 * existing first-party PKCE test client. Production omits DEV_APP_ORIGIN, so
 * its allowlist contains only the canonical production callback.
 */
/** @param {string} appOrigin @param {string | undefined} devAppOrigin @returns {string[]} */
export function getApprovedOAuthCallbackUrls(appOrigin, devAppOrigin) {
  const productionOrigin = requireHttpsOrigin(appOrigin, "APP_ORIGIN");
  const callbacks = [new URL("/auth/oidc/callback", productionOrigin).toString()];
  if (devAppOrigin !== undefined && devAppOrigin !== null && devAppOrigin !== "") {
    const stagingOrigin = requireHttpsOrigin(devAppOrigin, "DEV_APP_ORIGIN");
    if (stagingOrigin === productionOrigin) {
      throw new Error("DEV_APP_ORIGIN_MUST_DIFFER_FROM_APP_ORIGIN");
    }
    callbacks.push(new URL("/auth/oidc/callback", stagingOrigin).toString());
  }
  return callbacks;
}
