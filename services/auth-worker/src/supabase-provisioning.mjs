/** @typedef {import("./env").AuthWorkerEnv} AuthWorkerEnv */

const PROVISION_RPC = "better_auth_provision_user";
const VERIFY_EMAIL_RPC = "better_auth_complete_email_verification";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,39}$/;
const ACCOUNT_TYPES = new Set(["student", "teacher", "organizer"]);
const EDUCATION_LEVELS = new Set(["sd", "smp", "sma", "alumni"]);

/** @param {AuthWorkerEnv} env */
export function isSupabaseProvisioningEnabled(env) {
  return env.SUPABASE_PROVISIONING_ENABLED === "true";
}

/** @param {AuthWorkerEnv} env */
function requireProvisioningConfig(env) {
  if (!isSupabaseProvisioningEnabled(env)) {
    throw new Error("SUPABASE_PROVISIONING_DISABLED");
  }

  const urlValue = typeof env.SUPABASE_URL === "string" ? env.SUPABASE_URL.trim() : "";
  const serviceKey = typeof env.SUPABASE_SERVICE_ROLE_KEY === "string"
    ? env.SUPABASE_SERVICE_ROLE_KEY.trim()
    : "";

  if (!urlValue || !serviceKey) {
    throw new Error("SUPABASE_PROVISIONING_CONFIGURATION_MISSING");
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
    url.hash
  ) {
    throw new Error("SUPABASE_PROVISIONING_URL_NOT_ALLOWED");
  }

  return { baseUrl: url.origin, serviceKey };
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
    if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(suppliedBirthDate)) {
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
  const { baseUrl, serviceKey } = requireProvisioningConfig(env);
  const endpoint = new URL(`/rest/v1/rpc/${rpcName}`, baseUrl);

  let response;
  try {
    response = await fetchImpl(endpoint.toString(), {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
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
