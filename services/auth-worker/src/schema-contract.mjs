const REQUIRED_BETTER_AUTH_MODELS = [
  "user",
  "session",
  "account",
  "verification",
  "jwks",
  "rateLimit",
  "oauthClient",
  "oauthResource",
  "oauthClientResource",
  "oauthAccessToken",
  "oauthRefreshToken",
  "oauthConsent",
  "oauthClientAssertion",
];

/** @param {string} value @returns {string} */
function normalizeModelName(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Return Better Auth model names absent from a generated SQL/D1 schema.
 * Both Better Auth camelCase names and adapter-generated snake_case names
 * are accepted, but partial/legacy names are never treated as a match.
 */
/** @param {string[]} tableNames @returns {string[]} */
export function getMissingBetterAuthTables(tableNames) {
  const existing = new Set(
    (Array.isArray(tableNames) ? tableNames : []).map(normalizeModelName),
  );

  return REQUIRED_BETTER_AUTH_MODELS.filter(
    (modelName) => !existing.has(normalizeModelName(modelName)),
  );
}
