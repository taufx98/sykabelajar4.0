/** @param {string} value @returns {string | null} */
const normalizeOrigin = (value) => {
  try {
    const parsed = new URL(value);
    if (parsed.origin === "null" || parsed.username || parsed.password) return null;
    if (parsed.pathname !== "/" || parsed.search || parsed.hash) return null;
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
};

/** @param {string | null} origin @param {string[]} allowedOrigins */
export function isAllowedOrigin(origin, allowedOrigins) {
  if (typeof origin !== "string") return false;
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;
  return allowedOrigins.some((entry) => normalizeOrigin(entry) === normalized);
}

/** @param {Request} request @param {string[]} allowedOrigins @returns {Headers | null} */
export function createCorsHeaders(request, allowedOrigins) {
  const origin = request.headers.get("Origin");
  if (!isAllowedOrigin(origin, allowedOrigins)) return null;

  return new Headers({
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Requested-With",
    "Access-Control-Max-Age": "600",
    "Vary": "Origin",
  });
}

/** @param {unknown} expected @param {unknown} supplied */
export function timingSafeEqualString(expected, supplied) {
  if (typeof expected !== "string" || typeof supplied !== "string") return false;
  const encoder = new TextEncoder();
  const left = encoder.encode(expected);
  const right = encoder.encode(supplied);
  const maxLength = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < maxLength; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

/** @param {Response} response @param {Headers | null} [corsHeaders] @returns {Response} */
export function applyResponseHeaders(response, corsHeaders = null) {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Strict-Transport-Security", "max-age=31536000");

  if (corsHeaders) {
    const names = [
      "Access-Control-Allow-Origin",
      "Access-Control-Allow-Credentials",
      "Access-Control-Allow-Methods",
      "Access-Control-Allow-Headers",
      "Access-Control-Max-Age",
      "Vary",
    ];
    for (const name of names) {
      const value = corsHeaders.get(name);
      if (!value) continue;
      if (name.toLowerCase() === "vary") {
        const existing = headers.get("Vary");
        headers.set("Vary", existing ? existing + ", " + value : value);
      } else {
        headers.set(name, value);
      }
    }
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
