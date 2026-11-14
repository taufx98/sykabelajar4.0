/**
 * Resolve a browser redirect to a same-origin application path.
 *
 * @param {unknown} value
 * @param {string} origin
 * @returns {string}
 */
export function resolveSafeInternalRedirect(value, origin) {
  const fallback = "/home";
  if (typeof value !== "string") return fallback;
  const candidate = value.trim();
  if (!candidate.startsWith("/") || candidate.startsWith("//")) return fallback;

  try {
    const expectedOrigin = new URL(origin).origin;
    if (!expectedOrigin || (new URL(origin).protocol !== "https:" && new URL(origin).protocol !== "http:")) {
      return fallback;
    }
    const resolved = new URL(candidate, expectedOrigin);
    if (
      resolved.origin !== expectedOrigin ||
      resolved.username ||
      resolved.password ||
      (resolved.protocol !== "https:" && resolved.protocol !== "http:")
    ) {
      return fallback;
    }
    return resolved.pathname + resolved.search + resolved.hash;
  } catch {
    return fallback;
  }
}
