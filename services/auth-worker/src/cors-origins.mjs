const EMAIL_ADMIN_SETTINGS_PATH = "/api/admin/email-settings";

/**
 * Keep the Cloudflare Pages migration preview scoped to the email Admin API.
 * Production does not set EMAIL_ADMIN_PREVIEW_ORIGIN.
 *
 * @param {string} pathname
 * @param {{APP_ORIGIN?:string,DEV_APP_ORIGIN?:string,EMAIL_ADMIN_PREVIEW_ORIGIN?:string}} env
 */
export function getAllowedOriginsForPath(pathname, env) {
  /** @type {string[]} */
  const origins = [];
  if (typeof env.APP_ORIGIN === "string" && env.APP_ORIGIN.length > 0) {
    origins.push(env.APP_ORIGIN);
  }
  if (typeof env.DEV_APP_ORIGIN === "string" && env.DEV_APP_ORIGIN.length > 0) {
    origins.push(env.DEV_APP_ORIGIN);
  }
  if (pathname === EMAIL_ADMIN_SETTINGS_PATH && typeof env.EMAIL_ADMIN_PREVIEW_ORIGIN === "string" && env.EMAIL_ADMIN_PREVIEW_ORIGIN.length > 0) {
    origins.push(env.EMAIL_ADMIN_PREVIEW_ORIGIN);
  }
  return origins;
}

/** @param {{APP_ORIGIN?:string,DEV_APP_ORIGIN?:string,EMAIL_ADMIN_PREVIEW_ORIGIN?:string}} env */
export function getEmailAdminAllowedOrigins(env) {
  return getAllowedOriginsForPath(EMAIL_ADMIN_SETTINGS_PATH, env);
}
