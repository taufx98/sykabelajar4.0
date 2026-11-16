/** @param {string} value @param {string} label @returns {string} */
function requireHttpsCallback(value, label) {
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
    parsed.pathname !== "/auth/oidc/callback" ||
    parsed.username ||
    parsed.password ||
    parsed.hash ||
    parsed.search ||
    parsed.origin + parsed.pathname !== value
  ) {
    throw new Error(label + "_MUST_BE_EXACT_HTTPS_CALLBACK");
  }
  return parsed.toString();
}

/** @param {string} value @param {string} label @returns {string} */
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
 * Production always accepts its canonical website callback.
 * Staging may explicitly add its exact callback URL; the browser dev origin
 * (including localhost) is intentionally not used to derive OAuth redirects.
 * @param {string} appOrigin
 * @param {string | undefined} stagingCallbackUrl
 * @returns {string[]}
 */
export function getApprovedOAuthCallbackUrls(appOrigin, stagingCallbackUrl) {
  const productionOrigin = requireHttpsOrigin(appOrigin, "APP_ORIGIN");
  const productionCallback = new URL("/auth/oidc/callback", productionOrigin).toString();
  const callbacks = [productionCallback];
  if (stagingCallbackUrl !== undefined && stagingCallbackUrl !== null && stagingCallbackUrl !== "") {
    const stagingCallback = requireHttpsCallback(stagingCallbackUrl, "OAUTH_STAGING_CALLBACK_URL");
    if (stagingCallback === productionCallback) {
      throw new Error("OAUTH_STAGING_CALLBACK_URL_MUST_DIFFER_FROM_PRODUCTION");
    }
    callbacks.push(stagingCallback);
  }
  return callbacks;
}
