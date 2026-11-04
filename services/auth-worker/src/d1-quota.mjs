const DAILY_READ_LIMIT = "exceeded d1's free tier daily row read limit";
const DAILY_WRITE_LIMIT = "exceeded d1's free tier daily row write limit";

function collectErrorMessages(value, seen = new Set(), depth = 0) {
  if (depth > 5 || value == null) return [];
  if (typeof value === "string") return [value];
  if (typeof value !== "object" || seen.has(value)) return [];
  seen.add(value);

  const messages = [];
  if (typeof value.message === "string") messages.push(value.message);
  if (typeof value.code === "string") messages.push(value.code);
  if (value.cause !== undefined) {
    messages.push(...collectErrorMessages(value.cause, seen, depth + 1));
  }
  if (Array.isArray(value.errors)) {
    for (const item of value.errors) {
      messages.push(...collectErrorMessages(item, seen, depth + 1));
    }
  }
  return messages;
}

/**
 * Returns the exhausted D1 resource, or null for unrelated failures.
 * Only Cloudflare's documented daily Free-tier quota messages are matched.
 */
export function classifyD1FreeQuotaError(error) {
  const message = collectErrorMessages(error).join("\n").toLowerCase();
  if (message.includes(DAILY_READ_LIMIT)) return "ROWS_READ";
  if (message.includes(DAILY_WRITE_LIMIT)) return "ROWS_WRITTEN";
  return null;
}

/**
 * Builds a safe, user-facing response for a known D1 daily quota error.
 * Does not reveal raw provider errors or credentials.
 */
export function createD1QuotaResponse(error, now = new Date()) {
  const exhausted = classifyD1FreeQuotaError(error);
  if (!exhausted) return null;

  const resetAt = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0, 0, 0, 0,
  ));
  const retryAfter = Math.max(1, Math.ceil((resetAt.getTime() - now.getTime()) / 1000));

  return new Response(JSON.stringify({
    error: "AUTH_TEMPORARILY_UNAVAILABLE",
    code: `D1_FREE_TIER_${exhausted}_LIMIT_REACHED`,
    message: "Layanan login sedang mencapai batas penggunaan harian. Sesi yang masih aktif tetap dapat digunakan sampai token kedaluwarsa. Silakan coba lagi setelah pukul 07.00 WIB.",
    retry_at_utc: resetAt.toISOString(),
  }), {
    status: 503,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Retry-After": String(retryAfter),
      "X-Auth-Availability": "degraded",
    },
  });
}
