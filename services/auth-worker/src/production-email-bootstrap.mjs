const EXPECTED_PRODUCTION = Object.freeze({
  issuerOrigin: "https://auth-prod.sykabelajar.my.id",
  appOrigin: "https://sykabelajar.my.id",
  supabaseOrigin: "https://mvdczyitbkxkldjughor.supabase.co",
});
const BOOTSTRAP_MARKER = "production_email_bootstrap";
const ACCOUNT_ID = "production-sendpulse-primary";
const encoder = new TextEncoder();

/** @param {unknown} data @param {number} [status] */
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Pragma": "no-cache",
    },
  });
}

/** @param {unknown} value @returns {string} */
function nonEmpty(value) {
  return typeof value === "string" ? value.trim() : "";
}

/** @param {string} value @returns {boolean} */
function validEmail(value) {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function randomOperationId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** @param {Request} request @param {string} configuredToken @returns {Promise<boolean>} */
async function matchesBootstrapToken(request, configuredToken) {
  const supplied = request.headers.get("authorization") ?? "";
  if (!configuredToken || configuredToken.length < 32 || !/^Bearer [A-Za-z0-9._~-]{32,512}$/.test(supplied)) {
    return false;
  }
  const candidate = supplied.slice(7);
  const [expectedDigest, suppliedDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(configuredToken)),
    crypto.subtle.digest("SHA-256", encoder.encode(candidate)),
  ]);
  const expected = new Uint8Array(expectedDigest);
  const actual = new Uint8Array(suppliedDigest);
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected[index] ^ actual[index];
  }
  return difference === 0;
}

/** @param {import("./env").AuthWorkerEnv} env @returns {boolean} */
function isPinnedClosedProduction(env) {
  return env.BETTER_AUTH_URL === EXPECTED_PRODUCTION.issuerOrigin &&
    env.APP_ORIGIN === EXPECTED_PRODUCTION.appOrigin &&
    env.SUPABASE_PROVISIONING_ENV === "production" &&
    env.SUPABASE_PROVISIONING_URL === EXPECTED_PRODUCTION.supabaseOrigin &&
    env.SUPABASE_URL === EXPECTED_PRODUCTION.supabaseOrigin &&
    env.AUTH_EMAIL_PROVIDER === "managed" &&
    env.AUTH_SIGNUP_DISABLED === "true" &&
    env.SUPABASE_PROVISIONING_ENABLED === "false";
}

/**
 * @param {import("./env").AuthWorkerEnv} env
 */
/** @param {import("./env").AuthWorkerEnv["DB"]} db */
async function readBootstrapState(db) {
  return db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM "user") AS users,
      (SELECT COUNT(*) FROM "account") AS accounts,
      (SELECT COUNT(*) FROM "session") AS sessions,
      (SELECT COUNT(*) FROM "verification") AS verifications,
      (SELECT COUNT(*) FROM oauthAccessToken) AS access_tokens,
      (SELECT COUNT(*) FROM oauthRefreshToken) AS refresh_tokens,
      (SELECT COUNT(*) FROM auth_email_provider_accounts) AS email_accounts,
      (SELECT COUNT(*) FROM auth_worker_internal_config WHERE key = ?1) AS bootstrap_markers,
      (SELECT email_verification_required FROM auth_runtime_settings WHERE id = 1) AS email_verification_required,
      (SELECT auto_failover_enabled FROM auth_email_provider_settings WHERE id = 1) AS auto_failover_enabled
  `).bind(BOOTSTRAP_MARKER).first();
}

/**
 * One-time owner-operated SendPulse bootstrap for the isolated Production Worker.
 * It only adds an encrypted SendPulse account; it never sends a message and
 * never enables signup or Supabase provisioning.
 *
 * @param {Request} request
 * @param {import("./env").AuthWorkerEnv} env
 * @param {{
 *   checkSendPulseConnection?: (credentials:Record<string,string>)=>Promise<{total:number}>,
 *   encryptEmailSecret?: (masterKey:string,plaintext:string)=>Promise<string>
 * }} [dependencies]
 */
export async function handleProductionEmailBootstrap(request, env, dependencies = {}) {
  if (request.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  if (request.headers.has("origin")) return json({ ok: false, error: "ORIGIN_NOT_ALLOWED" }, 403);

  const length = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(length) && length > 8192) {
    return json({ ok: false, error: "REQUEST_TOO_LARGE" }, 413);
  }

  if (!isPinnedClosedProduction(env)) {
    return json({ ok: false, error: "BOOTSTRAP_NOT_AVAILABLE" }, 404);
  }
  if (!(await matchesBootstrapToken(request, env.AUTH_EMAIL_BOOTSTRAP_TOKEN ?? ""))) {
    return json({ ok: false, error: "BOOTSTRAP_AUTH_FAILED" }, 401);
  }
  if (!env.AUTH_EMAIL_ENCRYPTION_KEY || env.AUTH_EMAIL_ENCRYPTION_KEY.length < 32) {
    return json({ ok: false, error: "EMAIL_ENCRYPTION_NOT_CONFIGURED" }, 503);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "INVALID_REQUEST_BODY" }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ ok: false, error: "INVALID_REQUEST_BODY" }, 400);
  }
  const keys = Object.keys(body);
  if (keys.some((key) => !["senderAddress", "senderName", "credentials"].includes(key))) {
    return json({ ok: false, error: "INVALID_REQUEST_BODY" }, 422);
  }

  const senderAddress = nonEmpty(body.senderAddress).toLowerCase();
  const senderName = nonEmpty(body.senderName) || "SYKABELAJAR";
  const credentials = body.credentials && typeof body.credentials === "object" &&
    !Array.isArray(body.credentials) ? body.credentials : {};
  const apiKey = nonEmpty(credentials.apiKey);
  if (!validEmail(senderAddress)) return json({ ok: false, error: "INVALID_SENDER_ADDRESS" }, 422);
  if (!senderName || senderName.length > 120) return json({ ok: false, error: "INVALID_SENDER_NAME" }, 422);
  if (apiKey.length < 16 || apiKey.length > 4096) {
    return json({ ok: false, error: "INVALID_EMAIL_PROVIDER_CREDENTIAL" }, 422);
  }

  let state;
  try {
    state = await readBootstrapState(env.DB);
  } catch {
    return json({ ok: false, error: "BOOTSTRAP_STATE_UNAVAILABLE" }, 503);
  }
  const emptyFields = [
    "users", "accounts", "sessions", "verifications", "access_tokens",
    "refresh_tokens", "email_accounts", "bootstrap_markers",
  ];
  if (!state || emptyFields.some((field) => Number(state[field]) !== 0)) {
    return json({ ok: false, error: "BOOTSTRAP_ALREADY_CONSUMED_OR_IDENTITY_EXISTS" }, 409);
  }
  if (Number(state.email_verification_required) !== 1 || Number(state.auto_failover_enabled) !== 1) {
    return json({ ok: false, error: "PRODUCTION_EMAIL_POLICY_NOT_READY" }, 503);
  }

  let ciphertext;
  try {
    const checker = dependencies.checkSendPulseConnection ??
      (await import("./email-providers.mjs")).checkSendPulseConnection;
    const encrypt = dependencies.encryptEmailSecret ??
      (await import("./email-secret.mjs")).encryptEmailSecret;
    const connection = await checker({ apiKey });
    if (!connection || !Number.isSafeInteger(connection.total)) {
      return json({ ok: false, error: "EMAIL_PROVIDER_RESPONSE_INVALID" }, 503);
    }
    ciphertext = await encrypt(env.AUTH_EMAIL_ENCRYPTION_KEY, JSON.stringify({ apiKey }));
  } catch (error) {
    const structuredError = error && typeof error === "object"
      ? /** @type {{code?: unknown}} */ (error)
      : {};
    const code = typeof structuredError.code === "string" ? structuredError.code : "";
    const status = code === "EMAIL_PROVIDER_CREDENTIAL_REJECTED" ? 422 : 503;
    return json({
      ok: false,
      error: status === 422 ? "EMAIL_PROVIDER_CREDENTIAL_REJECTED" : "EMAIL_PROVIDER_CONNECTION_UNVERIFIED",
    }, status);
  }

  const operationId = randomOperationId();
  const inProgress = "in_progress:" + operationId;
  const now = new Date().toISOString();
  try {
    const results = await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO auth_worker_internal_config (key, value)
        SELECT ?1, ?2
        WHERE NOT EXISTS (SELECT 1 FROM auth_worker_internal_config WHERE key = ?1)
          AND (SELECT COUNT(*) FROM "user") = 0
          AND (SELECT COUNT(*) FROM "account") = 0
          AND (SELECT COUNT(*) FROM "session") = 0
          AND (SELECT COUNT(*) FROM "verification") = 0
          AND (SELECT COUNT(*) FROM oauthAccessToken) = 0
          AND (SELECT COUNT(*) FROM oauthRefreshToken) = 0
          AND (SELECT COUNT(*) FROM auth_email_provider_accounts) = 0
          AND (SELECT email_verification_required FROM auth_runtime_settings WHERE id = 1) = 1
          AND (SELECT auto_failover_enabled FROM auth_email_provider_settings WHERE id = 1) = 1
      `).bind(BOOTSTRAP_MARKER, inProgress),
      env.DB.prepare(`
        INSERT INTO auth_email_provider_accounts (
          id, label, provider, sender_address, sender_name, endpoint_url, auth_mode,
          credentials_ciphertext, enabled, priority,
          quota_hour_limit, quota_day_limit, quota_month_limit,
          created_at, updated_at, created_by, updated_by
        )
        SELECT
          ?1, 'SendPulse Primary', 'sendpulse', ?2, ?3, NULL, NULL,
          ?4, 1, 1, 50, 400, 0, ?5, ?5, 'owner-bootstrap', 'owner-bootstrap'
        WHERE EXISTS (
          SELECT 1 FROM auth_worker_internal_config WHERE key = ?6 AND value = ?7
        )
          AND NOT EXISTS (SELECT 1 FROM auth_email_provider_accounts)
      `).bind(ACCOUNT_ID, senderAddress, senderName, ciphertext, now, BOOTSTRAP_MARKER, inProgress),
      env.DB.prepare(`
        UPDATE auth_worker_internal_config
        SET value = 'consumed'
        WHERE key = ?1 AND value = ?2
          AND EXISTS (
            SELECT 1 FROM auth_email_provider_accounts
            WHERE id = ?3 AND provider = 'sendpulse' AND enabled = 1
          )
      `).bind(BOOTSTRAP_MARKER, inProgress, ACCOUNT_ID),
    ]);

    const changes = results.map((result) => Number(result?.meta?.changes ?? 0));
    if (changes.length !== 3 || changes.some((count) => count !== 1)) {
      return json({ ok: false, error: "BOOTSTRAP_NOT_APPLIED_OR_ALREADY_CONSUMED" }, 409);
    }
  } catch {
    // Batch failures are returned as a stable code. Never log credentials,
    // provider responses, request bodies or ciphertext.
    return json({ ok: false, error: "PRODUCTION_EMAIL_BOOTSTRAP_FAILED" }, 503);
  }

  return json({
    ok: true,
    provider: "SendPulse",
    accountId: ACCOUNT_ID,
    connectionVerified: true,
    verificationEmailSent: false,
    publicSignupStillDisabled: true,
    supabaseProvisioningStillDisabled: true,
    oneTimeBootstrapConsumed: true,
  });
}
