const EXPECTED_PRODUCTION = Object.freeze({
  issuerOrigin: "https://auth-prod.sykabelajar.my.id",
  appOrigin: "https://sykabelajar.my.id",
  supabaseOrigin: "https://mvdczyitbkxkldjughor.supabase.co",
});
const BOOTSTRAP_MARKER = "production_first_account_bootstrap";
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

/** @param {Request} request @param {number} maxBytes @returns {Promise<{ok:true,value:unknown}|{ok:false,tooLarge:boolean}>} */
async function parseLimitedJson(request, maxBytes) {
  const reader = request.body?.getReader();
  if (!reader) return { ok: false, tooLarge: false };
  /** @type {Uint8Array[]} */
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return { ok: false, tooLarge: true };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, tooLarge: false };
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    return { ok: false, tooLarge: false };
  }
}


/** @param {unknown} value @returns {string} */
function nonEmpty(value) {
  return typeof value === "string" ? value.trim() : "";
}

/** @param {string} value @returns {boolean} */
function validEmail(value) {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/** @param {Request} request @param {string} configuredToken @returns {Promise<boolean>} */
async function matchesBootstrapToken(request, configuredToken) {
  const supplied = request.headers.get("authorization") ?? "";
  if (!configuredToken || configuredToken.length < 32 ||
      !/^Bearer [A-Za-z0-9._~-]{32,512}$/.test(supplied)) return false;
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
    env.SUPABASE_PROVISIONING_ENABLED === "true";
}

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
      (SELECT COUNT(*) FROM auth_worker_internal_config WHERE key = ?1) AS bootstrap_markers,
      (SELECT email_verification_required FROM auth_runtime_settings WHERE id = 1) AS email_verification_required,
      (SELECT COUNT(*) FROM auth_email_provider_accounts
       WHERE provider = 'sendpulse' AND enabled = 1) AS active_sendpulse_accounts
  `).bind(BOOTSTRAP_MARKER).first();
}

/**
 * One-time owner-operated creation of the very first Production Better Auth account.
 * The public Worker configuration remains signup-disabled; only this internal
 * authenticated route constructs a transient auth instance that enables email
 * signup for one server-side API call. Email verification and Supabase
 * provisioning remain mandatory.
 *
 * @param {Request} request
 * @param {import("./env").AuthWorkerEnv} env
 * @param {{createAuth:()=>Promise<{api:{signUpEmail:(args:{body:{name:string,email:string,password:string}})=>Promise<unknown>}}>|{api:{signUpEmail:(args:{body:{name:string,email:string,password:string}})=>Promise<unknown>}}}} dependencies
 */
export async function handleProductionFirstAccountBootstrap(request, env, dependencies) {
  if (request.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  if (request.headers.has("origin")) return json({ ok: false, error: "ORIGIN_NOT_ALLOWED" }, 403);

  const length = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(length) && length > 8192) return json({ ok: false, error: "REQUEST_TOO_LARGE" }, 413);
  const parsedBody = await parseLimitedJson(request, 8192);
  if (!parsedBody.ok) {
    return json(
      { ok: false, error: parsedBody.tooLarge ? "REQUEST_TOO_LARGE" : "INVALID_REQUEST_BODY" },
      parsedBody.tooLarge ? 413 : 400,
    );
  }

  if (!isPinnedClosedProduction(env)) return json({ ok: false, error: "BOOTSTRAP_NOT_AVAILABLE" }, 404);
  if (!(await matchesBootstrapToken(request, env.AUTH_FIRST_ACCOUNT_BOOTSTRAP_TOKEN ?? ""))) {
    return json({ ok: false, error: "BOOTSTRAP_AUTH_FAILED" }, 401);
  }

  const provisioningApiKey = nonEmpty(env.SUPABASE_PROVISIONING_API_KEY);
  const legacyServiceRoleKey = nonEmpty(env.SUPABASE_SERVICE_ROLE_KEY);
  if (provisioningApiKey && legacyServiceRoleKey) {
    return json({ ok: false, error: "PRODUCTION_PROVISIONING_KEY_BINDINGS_CONFLICT" }, 503);
  }
  const apiKey = provisioningApiKey || legacyServiceRoleKey;
  if (!apiKey || apiKey.startsWith("sb_publishable_")) {
    return json({ ok: false, error: "PRODUCTION_PROVISIONING_CREDENTIAL_NOT_READY" }, 503);
  }
  const pinnedOwnerEmail = nonEmpty(env.AUTH_FIRST_ACCOUNT_EMAIL).toLowerCase();
  if (!validEmail(pinnedOwnerEmail)) {
    return json({ ok: false, error: "PRODUCTION_FIRST_ACCOUNT_EMAIL_NOT_CONFIGURED" }, 503);
  }

  const body = parsedBody.value;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ ok: false, error: "INVALID_REQUEST_BODY" }, 400);
  }
  if (Object.keys(body).some((key) => !["name", "email", "password"].includes(key))) {
    return json({ ok: false, error: "INVALID_REQUEST_BODY" }, 422);
  }

  const name = nonEmpty(body.name);
  const email = nonEmpty(body.email).toLowerCase();
  const password = typeof body.password === "string" ? body.password : "";
  if (!name || name.length > 120 || /[\u0000-\u001f\u007f]/.test(name)) {
    return json({ ok: false, error: "INVALID_OWNER_NAME" }, 422);
  }
  if (!validEmail(email)) return json({ ok: false, error: "INVALID_OWNER_EMAIL" }, 422);
  if (email !== pinnedOwnerEmail) {
    return json({ ok: false, error: "OWNER_EMAIL_NOT_ALLOWED" }, 403);
  }
  if (password.length < 12 || password.length > 128) {
    return json({ ok: false, error: "INVALID_OWNER_PASSWORD_LENGTH" }, 422);
  }

  let state;
  try { state = await readBootstrapState(env.DB); } catch {
    return json({ ok: false, error: "BOOTSTRAP_STATE_UNAVAILABLE" }, 503);
  }
  const emptyFields = [
    "users", "accounts", "sessions", "verifications",
    "access_tokens", "refresh_tokens", "bootstrap_markers",
  ];
  if (!state || emptyFields.some((field) => Number(state[field]) !== 0)) {
    return json({ ok: false, error: "BOOTSTRAP_ALREADY_CONSUMED_OR_IDENTITY_EXISTS" }, 409);
  }
  if (Number(state.email_verification_required) !== 1 ||
      Number(state.active_sendpulse_accounts) < 1) {
    return json({ ok: false, error: "PRODUCTION_EMAIL_NOT_READY" }, 503);
  }

  // Consume the D1 marker BEFORE account creation. If Better Auth or the email
  // provider returns an ambiguous error after a partial create, the endpoint
  // cannot be replayed blindly. Owner must inspect D1 before any manual recovery.
  try {
    const result = await env.DB.prepare(`
      INSERT INTO auth_worker_internal_config (key, value)
      SELECT ?1, 'consumed'
      WHERE NOT EXISTS (SELECT 1 FROM auth_worker_internal_config WHERE key = ?1)
        AND (SELECT COUNT(*) FROM "user") = 0
        AND (SELECT COUNT(*) FROM "account") = 0
        AND (SELECT COUNT(*) FROM "session") = 0
        AND (SELECT COUNT(*) FROM "verification") = 0
        AND (SELECT COUNT(*) FROM oauthAccessToken) = 0
        AND (SELECT COUNT(*) FROM oauthRefreshToken) = 0
        AND (SELECT email_verification_required FROM auth_runtime_settings WHERE id = 1) = 1
        AND EXISTS (
          SELECT 1 FROM auth_email_provider_accounts
          WHERE provider = 'sendpulse' AND enabled = 1
        )
    `).bind(BOOTSTRAP_MARKER).run();
    if (Number(result?.meta?.changes ?? 0) !== 1) {
      return json({ ok: false, error: "BOOTSTRAP_ALREADY_CONSUMED_OR_IDENTITY_EXISTS" }, 409);
    }
  } catch {
    return json({ ok: false, error: "BOOTSTRAP_MARKER_WRITE_FAILED" }, 503);
  }

  try {
    const auth = await dependencies.createAuth();
    await auth.api.signUpEmail({ body: { name, email, password } });
  } catch {
    // Never return Better Auth/provider exceptions, the email or password.
    // Marker stays consumed to prevent replay after an ambiguous partial write.
    return json({
      ok: false,
      error: "FIRST_ACCOUNT_CREATE_OR_VERIFICATION_DELIVERY_UNCONFIRMED",
      manualInspectionRequired: true,
    }, 503);
  }

  let createdUser;
  try {
    createdUser = await env.DB.prepare(`
      SELECT id, email, emailVerified,
        (SELECT COUNT(*) FROM "session") AS sessions
      FROM "user"
      WHERE lower(email) = ?1
      LIMIT 2
    `).bind(email).first();
  } catch {
    return json({ ok: false, error: "FIRST_ACCOUNT_POSTFLIGHT_UNAVAILABLE", manualInspectionRequired: true }, 503);
  }

  if (!createdUser || typeof createdUser.id !== "string" ||
      createdUser.email !== email ||
      (createdUser.emailVerified !== 0 && createdUser.emailVerified !== false && createdUser.emailVerified !== null) ||
      Number(createdUser.sessions) !== 0) {
    return json({
      ok: false,
      error: "FIRST_ACCOUNT_POSTFLIGHT_MISMATCH",
      manualInspectionRequired: true,
    }, 503);
  }

  return json({
    ok: true,
    verificationRequestAccepted: true,
    emailVerificationRequired: true,
    publicSignupStillDisabled: true,
    provisioningStillEnabled: true,
    oneTimeBootstrapConsumed: true,
  }, 202);
}
