const EMAIL_ADMIN_SETTINGS_PATH = "/api/admin/email-settings";

/**
 * Keep the Cloudflare Pages migration preview scoped to the email Admin API.
 * Production does not set EMAIL_ADMIN_PREVIEW_ORIGIN.
 *
 * @param {string} pathname
 * @param {{APP_ORIGIN?:string,DEV_APP_ORIGIN?:string,EMAIL_ADMIN_PREVIEW_ORIGIN?:string}} env
 */
export function getAllowedOriginsForPath(pathname, env) {
  const origins = [env.APP_ORIGIN, env.DEV_APP_ORIGIN].filter(
    (value) => typeof value === "string" && value.length > 0,
  );
  if (pathname === EMAIL_ADMIN_SETTINGS_PATH && env.EMAIL_ADMIN_PREVIEW_ORIGIN) {
    origins.push(env.EMAIL_ADMIN_PREVIEW_ORIGIN);
  }
  return origins;
}

/** @param {{APP_ORIGIN?:string,DEV_APP_ORIGIN?:string,EMAIL_ADMIN_PREVIEW_ORIGIN?:string}} env */
export function getEmailAdminAllowedOrigins(env) {
  return getAllowedOriginsForPath(EMAIL_ADMIN_SETTINGS_PATH, env);
}
