/** @typedef {import("./env").AuthWorkerEnv} AuthWorkerEnv */

const PROVISION_RPC = "better_auth_provision_user";
const VERIFY_EMAIL_RPC = "better_auth_complete_email_verification";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,39}$/;
const ACCOUNT_TYPES = new Set(["student", "teacher", "organizer"]);
const EDUCATION_LEVELS = new Set(["sd", "smp", "sma", "alumni"]);
// This branch may provision only into the isolated Free Stage 3 Supabase project.
// The legacy SUPABASE_URL remains bound to production for the pre-cutover admin bridge.
const STAGING_PROVISIONING_ORIGIN = "https://ydamszdfsxqisanazdkb.supabase.co";

/** @param {AuthWorkerEnv} env */
export function isSupabaseProvisioningEnabled(env) {
  return env.SUPABASE_PROVISIONING_ENABLED === "true";
}

/** @param {AuthWorkerEnv} env */
function requireProvisioningConfig(env) {
  if (!isSupabaseProvisioningEnabled(env)) {
    throw new Error("SUPABASE_PROVISIONING_DISABLED");
  }

  const urlValue = typeof env.SUPABASE_PROVISIONING_URL === "string"
    ? env.SUPABASE_PROVISIONING_URL.trim()
    : "";
  const provisioningApiKey = typeof env.SUPABASE_PROVISIONING_API_KEY === "string"
    ? env.SUPABASE_PROVISIONING_API_KEY.trim()
    : "";
  const legacyServiceRoleKey = typeof env.SUPABASE_SERVICE_ROLE_KEY === "string"
    ? env.SUPABASE_SERVICE_ROLE_KEY.trim()
    : "";

  if (provisioningApiKey && legacyServiceRoleKey && provisioningApiKey !== legacyServiceRoleKey) {
    throw new Error("SUPABASE_PROVISIONING_KEY_BINDINGS_CONFLICT");
  }
  const provisioningKey = provisioningApiKey || legacyServiceRoleKey;

  if (!urlValue || !provisioningKey) {
    throw new Error("SUPABASE_PROVISIONING_CONFIGURATION_MISSING");
  }
  // A publishable key is never a server-side provisioning credential.
  if (provisioningKey.startsWith("sb_publishable_")) {
    throw new Error("SUPABASE_PROVISIONING_SECRET_KEY_REQUIRED");
  }

  let url;
  try {
    url = new URL(urlValue);
  } catch {
    throw new Error("SUPABASE_PROVISIONING_URL_INVALID");
  }

  // The Worker only talks to the configured Supabase project host. This is
  // deliberately not an arbitrary URL/fetch proxy.
  if (
    url.protocol !== "https:" ||
    !/^[a-z0-9-]+\.supabase\.co$/i.test(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.origin !== STAGING_PROVISIONING_ORIGIN
  ) {
    throw new Error("SUPABASE_PROVISIONING_URL_NOT_ALLOWED");
  }

  return { baseUrl: url.origin, provisioningKey };
}

/**
 * Validate and normalize registration attributes before Better Auth writes the
 * user row. The allowed business registration types are deliberately separate
 * from Postgres JWT role=authenticated and cannot include admin.
 *
 * @param {Record<string, unknown>} input
 * @returns {{ accountType: string, username: string | null, referralCode: string | null, birthDate: string | null, institution: string | null, grade: string | null, subjects: string | null }}
 */
export function normalizeBetterAuthRegistration(input) {
  const suppliedType = typeof input.accountType === "string"
    ? input.accountType.trim().toLowerCase()
    : "student";
  if (!ACCOUNT_TYPES.has(suppliedType)) {
    throw new Error("BETTER_AUTH_ACCOUNT_TYPE_NOT_ALLOWED");
  }

  if (input.username !== undefined && input.username !== null && typeof input.username !== "string") {
    throw new Error("BETTER_AUTH_USERNAME_INVALID");
  }
  const suppliedUsername = typeof input.username === "string"
    ? input.username.trim().toLowerCase()
    : "";
  if (suppliedUsername && !USERNAME_PATTERN.test(suppliedUsername)) {
    throw new Error("BETTER_AUTH_USERNAME_INVALID");
  }

  if (input.referralCode !== undefined && input.referralCode !== null && typeof input.referralCode !== "string") {
    throw new Error("BETTER_AUTH_REFERRAL_CODE_INVALID");
  }
  const suppliedReferralCode = typeof input.referralCode === "string"
    ? input.referralCode.trim()
    : "";
  if (suppliedReferralCode.length > 80) {
    throw new Error("BETTER_AUTH_REFERRAL_CODE_INVALID");
  }

  if (input.birthDate !== undefined && input.birthDate !== null && typeof input.birthDate !== "string") {
    throw new Error("BETTER_AUTH_BIRTH_DATE_INVALID");
  }
  const suppliedBirthDate = typeof input.birthDate === "string" ? input.birthDate.trim() : "";
  if (suppliedBirthDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(suppliedBirthDate)) {
      throw new Error("BETTER_AUTH_BIRTH_DATE_INVALID");
    }
    const parsedDate = new Date(suppliedBirthDate + "T00:00:00.000Z");
    if (!Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== suppliedBirthDate) {
      throw new Error("BETTER_AUTH_BIRTH_DATE_INVALID");
    }
  }

  for (const field of ["institution", "grade", "subjects"]) {
    if (input[field] !== undefined && input[field] !== null && typeof input[field] !== "string") {
      throw new Error("BETTER_AUTH_" + field.replace(/[A-Z]/g, (letter) => "_" + letter).toUpperCase() + "_INVALID");
    }
  }
  const institution = typeof input.institution === "string" ? input.institution.trim() : "";
  const grade = typeof input.grade === "string" ? input.grade.trim().toLowerCase() : "";
  const subjects = typeof input.subjects === "string" ? input.subjects.trim() : "";
  if (institution.length > 200 || subjects.length > 2000) {
    throw new Error("BETTER_AUTH_PROFILE_FIELD_TOO_LONG");
  }
  if (grade && !EDUCATION_LEVELS.has(grade)) {
    throw new Error("BETTER_AUTH_GRADE_INVALID");
  }

  return {
    accountType: suppliedType,
    username: suppliedUsername || null,
    referralCode: suppliedReferralCode || null,
    birthDate: suppliedBirthDate || null,
    institution: institution || null,
    grade: grade || null,
    subjects: subjects || null,
  };
}

/** @param {Record<string, unknown>} user */
function normalizeUser(user) {
  if (!user || typeof user !== "object") throw new Error("BETTER_AUTH_USER_REQUIRED");

  const userId = typeof user.id === "string" ? user.id.trim() : "";
  if (!UUID_PATTERN.test(userId)) throw new Error("BETTER_AUTH_USER_ID_INVALID");

  const registration = normalizeBetterAuthRegistration(user);
  const fullName = typeof user.name === "string" ? user.name.trim().slice(0, 120) : "";

  return {
    userId,
    ...registration,
    fullName,
    emailVerified: user.emailVerified === true,
  };
}

/**
 * @param {AuthWorkerEnv} env
 * @param {string} rpcName
 * @param {Record<string, unknown>} payload
 * @param {(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>} fetchImpl
 */
async function invokeRpc(env, rpcName, payload, fetchImpl) {
  const { baseUrl, provisioningKey } = requireProvisioningConfig(env);
  const endpoint = new URL(`/rest/v1/rpc/${rpcName}`, baseUrl);

  let response;
  try {
    response = await fetchImpl(endpoint.toString(), {
      method: "POST",
      headers: {
        apikey: provisioningKey,
        // Supabase sb_secret_* keys are opaque API keys, not JWTs. Sending
        // them as Bearer tokens triggers JWT verification and is incorrect.
        // Legacy service_role JWTs still require the Authorization header.
        ...(!provisioningKey.startsWith("sb_secret_")
          ? { Authorization: `Bearer ${provisioningKey}` }
          : {}),
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    // Do not include provider/network error text, URLs or key material.
    throw new Error("SUPABASE_PROVISIONING_UNAVAILABLE");
  }

  if (!response.ok) {
    // Never echo the PostgREST error body: database errors can contain SQL,
    // user data or implementation details.
    throw new Error(
      response.status === 404
        ? "SUPABASE_PROVISIONING_RPC_NOT_INSTALLED"
        : "SUPABASE_PROVISIONING_REJECTED",
    );
  }

  try {
    return await response.json();
  } catch {
    throw new Error("SUPABASE_PROVISIONING_RESPONSE_INVALID");
  }
}

/**
 * Registration-only profile fields are needed to recover if the Postgres
 * projection fails after the D1 user insert. Once the projection commits,
 * remove them from D1; keep accountType/username as stable auth-side mapping
 * metadata so later idempotent session checks cannot accidentally add a
 * default student role to a teacher/organizer account.
 *
 * @param {AuthWorkerEnv} env
 * @param {string} userId
 */
async function clearProfileBootstrapFields(env, userId) {
  try {
    const result = await env.DB.prepare(`
      UPDATE "user"
      SET "referralCode" = NULL,
          "birthDate" = NULL,
          "institution" = NULL,
          "grade" = NULL,
          "subjects" = NULL
      WHERE "id" = ?
    `).bind(userId).run();
    if (!result.success) {
      throw new Error("D1_BOOTSTRAP_CLEANUP_NOT_CONFIRMED");
    }
  } catch {
    throw new Error("BETTER_AUTH_PROFILE_BOOTSTRAP_CLEANUP_FAILED");
  }
}

/**
 * Ensures the application identity exists before a Better Auth session can
 * be created. RPCs are deliberately idempotent because D1 and Postgres cannot
 * participate in a single transaction.
 *
 * @param {AuthWorkerEnv} env
 * @param {Record<string, unknown>} user
 * @param {(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>} [fetchImpl]
 */
export async function reconcileSupabaseApplicationIdentity(env, user, fetchImpl = fetch) {
  if (!isSupabaseProvisioningEnabled(env)) return { enabled: false, userId: null };

  const identity = normalizeUser(user);
  const provisioned = await invokeRpc(env, PROVISION_RPC, {
    p_user_id: identity.userId,
    p_account_type: identity.accountType,
    p_full_name: identity.fullName,
    p_username: identity.username,
    p_birth_date: identity.birthDate,
    p_institution: identity.institution,
    p_grade: identity.grade,
    p_subjects: identity.subjects,
    p_referral_code: identity.referralCode,
    p_email_verified: identity.emailVerified,
  }, fetchImpl);

  if (!provisioned || typeof provisioned !== "object" || provisioned.user_id !== identity.userId) {
    throw new Error("SUPABASE_PROVISIONING_RESPONSE_INVALID");
  }

  if (identity.emailVerified) {
    await invokeRpc(env, VERIFY_EMAIL_RPC, {
      p_user_id: identity.userId,
      p_verified_at: new Date().toISOString(),
    }, fetchImpl);
  }

  // Postgres is now the canonical profile store. Do not retain the signup
  // payload in D1 after a successful, atomic identity/profile projection.
  // Skip the write on later idempotent session checks once those fields are null.
  if (
    identity.referralCode ||
    identity.birthDate ||
    identity.institution ||
    identity.grade ||
    identity.subjects
  ) {
    await clearProfileBootstrapFields(env, identity.userId);
  }

  return { enabled: true, userId: identity.userId };
}

/**
 * Called by Better Auth's afterEmailVerification callback. It also attempts
 * the idempotent provisioning call first, so a failed create.after hook can
 * recover from the verification callback without a shadow auth.users row.
 *
 * @param {AuthWorkerEnv} env
 * @param {Record<string, unknown>} user
 * @param {(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>} [fetchImpl]
 */
export async function completeSupabaseEmailVerification(env, user, fetchImpl = fetch) {
  return reconcileSupabaseApplicationIdentity(env, { ...user, emailVerified: true }, fetchImpl);
}

/**
 * Persist phone ownership only after the Worker verifies Telegram's signed
 * OIDC ID token, exact issuer/audience/nonce, and phone_number_verified=true.
 * The raw phone number never reaches Supabase; only the legacy-compatible
 * SHA-256 hash of international digits is projected.
 *
 * @param {AuthWorkerEnv} env
 * @param {{userId:string,verifiedAt:string,phoneHash:string,providerSubject:string,phoneDigitsCount:number}} input
 * @param {(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>} [fetchImpl]
 */
export async function completeSupabasePhoneVerification(env, input, fetchImpl = fetch) {
  if (!input || typeof input !== "object") {
    throw new Error("PHONE_VERIFICATION_INPUT_INVALID");
  }
  const userId = typeof input.userId === "string" ? input.userId.trim() : "";
  const verifiedAt = typeof input.verifiedAt === "string" ? input.verifiedAt : "";
  const phoneHash = typeof input.phoneHash === "string" ? input.phoneHash : "";
  const providerSubject = typeof input.providerSubject === "string"
    ? input.providerSubject.trim()
    : "";
  const phoneDigitsCount = Number(input.phoneDigitsCount);
  if (
    !UUID_PATTERN.test(userId) ||
    !/^[a-f0-9]{64}$/.test(phoneHash) ||
    !/^[0-9]{1,32}$/.test(providerSubject) ||
    !Number.isInteger(phoneDigitsCount) ||
    phoneDigitsCount < 8 ||
    phoneDigitsCount > 15 ||
    !Number.isFinite(Date.parse(verifiedAt))
  ) {
    throw new Error("PHONE_VERIFICATION_INPUT_INVALID");
  }

  const result = await invokeRpc(env, "better_auth_complete_phone_verification", {
    p_user_id: userId,
    p_verified_at: verifiedAt,
    p_phone_hash: phoneHash,
    p_provider: "telegram",
    p_provider_subject: providerSubject,
    p_phone_digits_count: phoneDigitsCount,
  }, fetchImpl);

  if (result !== true && result !== false) {
    throw new Error("PHONE_VERIFICATION_RESPONSE_INVALID");
  }
  return { enabled: true, userId, alreadyVerified: result === false };
}

/**
 * Return only the current user's verified-phone boolean. The UUID is supplied
 * by the Worker from its authenticated Better Auth session, never by the
 * browser. The underlying Postgres wrapper is executable by service_role only.
 *
 * @param {AuthWorkerEnv} env
 * @param {string} userId
 * @param {(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>} [fetchImpl]
 */
export async function getSupabasePhoneVerificationStatus(env, userId, fetchImpl = fetch) {
  const normalizedUserId = typeof userId === "string" ? userId.trim() : "";
  if (!UUID_PATTERN.test(normalizedUserId)) {
    throw new Error("BETTER_AUTH_USER_ID_INVALID");
  }

  const result = await invokeRpc(env, "better_auth_get_phone_verification_status", {
    p_user_id: normalizedUserId,
  }, fetchImpl);

  if (typeof result !== "boolean") {
    throw new Error("PHONE_VERIFICATION_STATUS_RESPONSE_INVALID");
  }

  return { enabled: true, userId: normalizedUserId, verified: result };
}
