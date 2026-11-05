import type { AuthWorkerEnv } from "./env";
import { decryptEmailSecret, encryptEmailSecret } from "./email-secret.mjs";
import { isAllowedOrigin } from "./security.mjs";
import { sendZeptoMail } from "./zeptomail.mjs";

type SupabaseAdminUser = { id: string; email: string };
type EmailAccountRow = {
  id: string;
  label: string;
  sender_address: string;
  sender_name: string;
  bounce_address: string | null;
  send_mail_token_ciphertext: string;
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string;
};
type PublicEmailAccount = {
  id: string;
  label: string;
  senderAddress: string;
  senderName: string;
  bounceAddress: string | null;
  tokenConfigured: boolean;
  createdAt: string;
  updatedAt: string;
  active: boolean;
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function nonEmpty(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function validEmail(value: string): boolean {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function normalizeSendMailToken(value: string): string {
  return value.replace(/^Zoho-enczapikey\s+/i, "").trim();
}

function supabaseBaseUrl(env: AuthWorkerEnv): string | null {
  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) return null;
  try {
    const url = new URL(env.SUPABASE_URL);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol !== "https:" && !(local && url.protocol === "http:")) return null;
    if (url.username || url.password || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

async function requireActiveAdmin(request: Request, env: AuthWorkerEnv): Promise<
  { user: SupabaseAdminUser } | { response: Response }
> {
  const origin = request.headers.get("Origin");
  const allowedOrigins = [env.APP_ORIGIN, ...(env.DEV_APP_ORIGIN ? [env.DEV_APP_ORIGIN] : [])];
  if (!isAllowedOrigin(origin, allowedOrigins)) {
    return { response: json({ ok: false, error: "ORIGIN_NOT_ALLOWED" }, 403) };
  }

  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return { response: json({ ok: false, error: "AUTH_REQUIRED" }, 401) };
  }
  const accessToken = authorization.slice("Bearer ".length).trim();
  if (!accessToken || accessToken.length > 8192) {
    return { response: json({ ok: false, error: "AUTH_REQUIRED" }, 401) };
  }

  const baseUrl = supabaseBaseUrl(env);
  if (!baseUrl) {
    return { response: json({ ok: false, error: "ADMIN_AUTH_NOT_CONFIGURED" }, 503) };
  }

  let authResponse: Response;
  try {
    authResponse = await fetch(baseUrl + "/auth/v1/user", {
      headers: {
        apikey: env.SUPABASE_PUBLISHABLE_KEY!,
        Authorization: "Bearer " + accessToken,
      },
    });
  } catch {
    return { response: json({ ok: false, error: "ADMIN_AUTH_UNAVAILABLE" }, 503) };
  }
  if (!authResponse.ok) {
    return { response: json({ ok: false, error: "AUTH_REQUIRED" }, 401) };
  }

  const user = await authResponse.json().catch(() => null) as Record<string, unknown> | null;
  const userId = nonEmpty(user?.id);
  const email = nonEmpty(user?.email);
  if (!userId || !validEmail(email)) {
    return { response: json({ ok: false, error: "AUTH_REQUIRED" }, 401) };
  }

  let roleResponse: Response;
  try {
    roleResponse = await fetch(baseUrl + "/rest/v1/rpc/is_active_admin", {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_PUBLISHABLE_KEY!,
        Authorization: "Bearer " + accessToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_uid: userId }),
    });
  } catch {
    return { response: json({ ok: false, error: "ADMIN_CHECK_UNAVAILABLE" }, 503) };
  }
  if (!roleResponse.ok) {
    return { response: json({ ok: false, error: "ADMIN_CHECK_FAILED" }, 503) };
  }
  const isAdmin = await roleResponse.json().catch(() => false);
  if (isAdmin !== true) {
    return { response: json({ ok: false, error: "ADMIN_REQUIRED" }, 403) };
  }
  return { user: { id: userId, email } };
}

async function listSettings(env: AuthWorkerEnv): Promise<Response> {
  const [settings, accounts] = await Promise.all([
    env.DB.prepare(
      "SELECT active_account_id FROM auth_email_settings WHERE id = 1",
    ).first<{ active_account_id: string | null }>(),
    env.DB.prepare(
      "SELECT id, label, sender_address, sender_name, bounce_address, " +
      "CASE WHEN length(send_mail_token_ciphertext) > 0 THEN 1 ELSE 0 END AS token_configured, " +
      "created_at, updated_at FROM auth_email_accounts ORDER BY updated_at DESC, label ASC",
    ).all<{
      id: string;
      label: string;
      sender_address: string;
      sender_name: string;
      bounce_address: string | null;
      token_configured: number;
      created_at: string;
      updated_at: string;
    }>(),
  ]);

  const activeAccountId = settings?.active_account_id ?? null;
  const safeAccounts: PublicEmailAccount[] = (accounts.results ?? []).map((row) => ({
    id: row.id,
    label: row.label,
    senderAddress: row.sender_address,
    senderName: row.sender_name,
    bounceAddress: row.bounce_address,
    tokenConfigured: row.token_configured === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    active: row.id === activeAccountId,
  }));
  return json({ ok: true, activeAccountId, accounts: safeAccounts });
}

async function saveAccount(
  body: Record<string, unknown>,
  user: SupabaseAdminUser,
  env: AuthWorkerEnv,
): Promise<Response> {
  const id = nonEmpty(body.id) || crypto.randomUUID();
  const label = nonEmpty(body.label);
  const senderAddress = nonEmpty(body.senderAddress).toLowerCase();
  const senderName = nonEmpty(body.senderName) || "SYKABELAJAR";
  const bounceAddress = nonEmpty(body.bounceAddress);
  const submittedToken = normalizeSendMailToken(nonEmpty(body.sendMailToken));

  if (!label || label.length > 80) return json({ ok: false, error: "INVALID_ACCOUNT_LABEL" }, 422);
  if (!validEmail(senderAddress)) return json({ ok: false, error: "INVALID_SENDER_ADDRESS" }, 422);
  if (senderName.length > 120) return json({ ok: false, error: "INVALID_SENDER_NAME" }, 422);
  if (bounceAddress && !validEmail(bounceAddress)) return json({ ok: false, error: "INVALID_BOUNCE_ADDRESS" }, 422);
  if (submittedToken && (submittedToken.length < 16 || submittedToken.length > 4096)) {
    return json({ ok: false, error: "INVALID_SEND_MAIL_TOKEN" }, 422);
  }

  const existing = await env.DB.prepare(
    "SELECT id, send_mail_token_ciphertext FROM auth_email_accounts WHERE id = ?1",
  ).bind(id).first<{ id: string; send_mail_token_ciphertext: string }>();

  if (body.id && !existing) return json({ ok: false, error: "EMAIL_ACCOUNT_NOT_FOUND" }, 404);
  if (!existing && !submittedToken) return json({ ok: false, error: "SEND_MAIL_TOKEN_REQUIRED" }, 422);
  if (!env.AUTH_EMAIL_ENCRYPTION_KEY || env.AUTH_EMAIL_ENCRYPTION_KEY.length < 32) {
    return json({ ok: false, error: "EMAIL_ENCRYPTION_NOT_CONFIGURED" }, 503);
  }

  let tokenCiphertext = existing?.send_mail_token_ciphertext ?? "";
  if (submittedToken) {
    try {
      tokenCiphertext = await encryptEmailSecret(env.AUTH_EMAIL_ENCRYPTION_KEY, submittedToken);
    } catch {
      return json({ ok: false, error: "EMAIL_SECRET_ENCRYPTION_FAILED" }, 503);
    }
  }

  const now = new Date().toISOString();
  const createdBy = existing ? user.id : user.id;
  const { success } = await env.DB.prepare(
    "INSERT INTO auth_email_accounts " +
    "(id, label, sender_address, sender_name, bounce_address, send_mail_token_ciphertext, created_at, updated_at, created_by, updated_by) " +
    "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, ?8, ?8) " +
    "ON CONFLICT(id) DO UPDATE SET label = excluded.label, sender_address = excluded.sender_address, " +
    "sender_name = excluded.sender_name, bounce_address = excluded.bounce_address, " +
    "send_mail_token_ciphertext = excluded.send_mail_token_ciphertext, updated_at = excluded.updated_at, updated_by = excluded.updated_by",
  ).bind(id, label, senderAddress, senderName, bounceAddress || null, tokenCiphertext, now, createdBy).run();

  if (!success) return json({ ok: false, error: "EMAIL_ACCOUNT_SAVE_FAILED" }, 500);
  return listSettings(env);
}

async function activateAccount(body: Record<string, unknown>, user: SupabaseAdminUser, env: AuthWorkerEnv): Promise<Response> {
  const id = nonEmpty(body.id);
  if (!id) return json({ ok: false, error: "EMAIL_ACCOUNT_REQUIRED" }, 422);
  const exists = await env.DB.prepare(
    "SELECT id FROM auth_email_accounts WHERE id = ?1",
  ).bind(id).first<{ id: string }>();
  if (!exists) return json({ ok: false, error: "EMAIL_ACCOUNT_NOT_FOUND" }, 404);

  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    "UPDATE auth_email_settings SET active_account_id = ?1, updated_at = ?2, updated_by = ?3 WHERE id = 1",
  ).bind(id, now, user.id).run();
  if (!result.success) return json({ ok: false, error: "EMAIL_ACCOUNT_ACTIVATE_FAILED" }, 500);
  return listSettings(env);
}

async function deleteAccount(body: Record<string, unknown>, env: AuthWorkerEnv): Promise<Response> {
  const id = nonEmpty(body.id);
  if (!id) return json({ ok: false, error: "EMAIL_ACCOUNT_REQUIRED" }, 422);
  const active = await env.DB.prepare(
    "SELECT active_account_id FROM auth_email_settings WHERE id = 1",
  ).first<{ active_account_id: string | null }>();
  if (active?.active_account_id === id) {
    return json({ ok: false, error: "ACTIVE_EMAIL_ACCOUNT_CANNOT_BE_DELETED" }, 409);
  }
  const result = await env.DB.prepare(
    "DELETE FROM auth_email_accounts WHERE id = ?1",
  ).bind(id).run();
  if (!result.success) return json({ ok: false, error: "EMAIL_ACCOUNT_DELETE_FAILED" }, 500);
  return listSettings(env);
}

async function testAccount(
  body: Record<string, unknown>,
  user: SupabaseAdminUser,
  env: AuthWorkerEnv,
): Promise<Response> {
  const id = nonEmpty(body.id);
  if (!id) return json({ ok: false, error: "EMAIL_ACCOUNT_REQUIRED" }, 422);
  if (!env.AUTH_EMAIL_ENCRYPTION_KEY || env.AUTH_EMAIL_ENCRYPTION_KEY.length < 32) {
    return json({ ok: false, error: "EMAIL_ENCRYPTION_NOT_CONFIGURED" }, 503);
  }

  const account = await env.DB.prepare(
    "SELECT id, sender_address, sender_name, bounce_address, send_mail_token_ciphertext " +
    "FROM auth_email_accounts WHERE id = ?1",
  ).bind(id).first<EmailAccountRow>();
  if (!account) return json({ ok: false, error: "EMAIL_ACCOUNT_NOT_FOUND" }, 404);

  const now = Math.floor(Date.now() / 1000);
  const limit = await env.DB.prepare(
    "INSERT INTO auth_email_admin_test_limits (user_id, last_sent_at) VALUES (?1, ?2) " +
    "ON CONFLICT(user_id) DO UPDATE SET last_sent_at = excluded.last_sent_at " +
    "WHERE auth_email_admin_test_limits.last_sent_at <= ?3 RETURNING user_id",
  ).bind(user.id, now, now - 60).first<{ user_id: string }>();
  if (!limit) return json({ ok: false, error: "EMAIL_TEST_RATE_LIMITED" }, 429);

  try {
    const token = await decryptEmailSecret(env.AUTH_EMAIL_ENCRYPTION_KEY, account.send_mail_token_ciphertext);
    const sent = await sendZeptoMail({
      sendMailToken: token,
      senderAddress: account.sender_address,
      senderName: account.sender_name,
      bounceAddress: account.bounce_address,
    }, {
      to: user.email,
      subject: "Tes pengiriman email SYKABELAJAR",
      text: "Ini adalah email tes dari pengaturan email transaksional SYKABELAJAR. Jika Anda menerima pesan ini, koneksi ZeptoMail Agent berhasil.",
    });
    return json({ ok: true, message: "Email tes dikirim ke alamat admin yang sedang masuk.", requestId: sent.requestId });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "ZEPTO_MAIL_AUTH_FAILED") {
      return json({ ok: false, error: "ZEPTO_MAIL_AUTH_FAILED", message: "ZeptoMail menolak Send Mail Token. Periksa token Agent yang dipilih." }, 422);
    }
    if (code === "ZEPTO_MAIL_CONFIGURATION_INCOMPLETE" || code === "AUTH_EMAIL_SECRET_DECRYPT_FAILED") {
      return json({ ok: false, error: "EMAIL_ACCOUNT_CONFIGURATION_INVALID" }, 422);
    }
    return json({ ok: false, error: "ZEPTO_MAIL_TEST_FAILED", message: "ZeptoMail gagal mengirim email tes. Periksa Agent, domain pengirim, dan saldo kredit." }, 502);
  }
}

export async function handleEmailAdminRequest(request: Request, env: AuthWorkerEnv): Promise<Response> {
  if (request.method !== "GET" && request.method !== "POST") {
    return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  }
  const authorization = await requireActiveAdmin(request, env);
  if ("response" in authorization) return authorization.response;
  if (request.method === "GET") return listSettings(env);

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ ok: false, error: "INVALID_JSON" }, 400);
  }
  const record = body as Record<string, unknown>;
  const action = nonEmpty(record.action);
  if (action === "save") return saveAccount(record, authorization.user, env);
  if (action === "activate") return activateAccount(record, authorization.user, env);
  if (action === "delete") return deleteAccount(record, env);
  if (action === "test") return testAccount(record, authorization.user, env);
  return json({ ok: false, error: "UNKNOWN_ACTION" }, 400);
}
