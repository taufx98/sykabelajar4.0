import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

type Provider = "MIDTRANS" | "XENITHPAY";
type Environment = "sandbox" | "production";
type AnyRecord = Record<string, any>;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}
function isProvider(value: unknown): value is Provider {
  return value === "MIDTRANS" || value === "XENITHPAY";
}
function isEnvironment(value: unknown): value is Environment {
  return value === "sandbox" || value === "production";
}
function record(value: unknown): AnyRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as AnyRecord : {};
}
function nonEmpty(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
function mergeSecrets(existing: AnyRecord, submitted: AnyRecord, provider: Provider, environment: Environment) {
  const next = { ...existing };
  const currentEnv = { ...record(next[environment]) };
  if (submitted.clearCredentials === true) {
    for (const key of provider === "MIDTRANS" ? ["server_key", "client_key"] : ["api_key", "api_secret", "webhook_secret"]) delete currentEnv[key];
  } else {
    const keys = provider === "MIDTRANS"
      ? [["serverKey", "server_key"], ["clientKey", "client_key"]]
      : [["apiKey", "api_key"], ["apiSecret", "api_secret"], ["webhookSecret", "webhook_secret"]];
    for (const [from, to] of keys) {
      const value = nonEmpty(submitted[from]);
      if (value) currentEnv[to] = value;
    }
  }
  next[environment] = currentEnv;
  return next;
}
function mergePublicConfig(existing: AnyRecord, submitted: AnyRecord, provider: Provider, environment: Environment) {
  const next = { ...existing };
  const currentEnv = { ...record(next[environment]) };
  if (provider === "XENITHPAY") {
    const paymentMethod = nonEmpty(submitted.paymentMethod);
    const paymentChannel = nonEmpty(submitted.paymentChannel);
    if (paymentMethod) currentEnv.payment_method = paymentMethod;
    if (paymentChannel) currentEnv.payment_channel = paymentChannel;
  }
  const returnUrl = nonEmpty(submitted.returnUrl);
  if (returnUrl) currentEnv.return_url = returnUrl;
  next[environment] = currentEnv;
  return next;
}
function legacyMidtransSecret(environment: Environment) {
  const legacyEnvironment = Deno.env.get("MIDTRANS_ENV") === "production" ? "production" : "sandbox";
  return environment === legacyEnvironment ? Deno.env.get("MIDTRANS_SERVER_KEY") ?? "" : "";
}
function isConfigured(provider: Provider, environment: Environment, secrets: AnyRecord, publicConfig: AnyRecord) {
  const cfg = record(secrets[environment]);
  const publicEnv = record(publicConfig[environment]);
  if (provider === "MIDTRANS") {
    return Boolean(nonEmpty(cfg.server_key) || legacyMidtransSecret(environment));
  }
  return Boolean(nonEmpty(cfg.api_key) && nonEmpty(cfg.api_secret) && nonEmpty(cfg.webhook_secret)
    && nonEmpty(publicEnv.payment_method) && nonEmpty(publicEnv.payment_channel));
}
function providerSummary(provider: Provider, row: AnyRecord | undefined) {
  const secrets = record(row?.secret_config);
  const publicConfig = record(row?.public_config);
  const envDefault: Environment = provider === "MIDTRANS" && Deno.env.get("MIDTRANS_ENV") === "production" ? "production" : "sandbox";
  const environment: Environment = isEnvironment(row?.environment) ? row!.environment : envDefault;
  const enabled = typeof row?.is_enabled === "boolean"
    ? row.is_enabled
    : provider === "MIDTRANS" && Boolean(legacyMidtransSecret(envDefault));
  const environments: AnyRecord = {};
  for (const env of ["sandbox", "production"] as Environment[]) {
    const secretEnv = record(secrets[env]);
    const publicEnv = record(publicConfig[env]);
    environments[env] = {
      configured: isConfigured(provider, env, secrets, publicConfig),
      serverKeyConfigured: provider === "MIDTRANS" && Boolean(nonEmpty(secretEnv.server_key) || legacyMidtransSecret(env)),
      clientKeyConfigured: provider === "MIDTRANS" && Boolean(nonEmpty(secretEnv.client_key) || (env === envDefault && Boolean(Deno.env.get("MIDTRANS_CLIENT_KEY")))),
      apiKeyConfigured: provider === "XENITHPAY" && Boolean(nonEmpty(secretEnv.api_key)),
      apiSecretConfigured: provider === "XENITHPAY" && Boolean(nonEmpty(secretEnv.api_secret)),
      webhookSecretConfigured: provider === "XENITHPAY" && Boolean(nonEmpty(secretEnv.webhook_secret)),
      paymentMethod: nonEmpty(publicEnv.payment_method) || "VIRTUAL_ACCOUNT",
      paymentChannel: nonEmpty(publicEnv.payment_channel) || "BCA.VA",
      returnUrl: nonEmpty(publicEnv.return_url) || "https://sykabelajar.my.id/organizer/plan",
    };
  }
  return { provider, enabled, environment, environments };
}
async function hmacBase64(secret: string, payload: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authorization = req.headers.get("Authorization");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return json({ ok: false, error: "SERVER_NOT_CONFIGURED" }, 503);
  if (!authorization?.startsWith("Bearer ")) return json({ ok: false, error: "AUTH_REQUIRED" }, 401);

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return json({ ok: false, error: "INVALID_JSON" }, 400);
  const action = nonEmpty(body.action) || "get";

  const authClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
  const { data: userData, error: userError } = await authClient.auth.getUser();
  if (userError || !userData.user) return json({ ok: false, error: "AUTH_REQUIRED" }, 401);

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { data: isAdmin, error: adminError } = await admin.rpc("is_active_admin", { p_uid: userData.user.id });
  if (adminError || isAdmin !== true) return json({ ok: false, error: "ADMIN_REQUIRED" }, 403);

  const [stateResult, configResult] = await Promise.all([
    admin.from("payment_gateway_state").select("active_provider,automatic_payments_enabled").eq("id", true).maybeSingle(),
    admin.from("payment_gateway_configs").select("provider,is_enabled,environment,public_config,secret_config").in("provider", ["MIDTRANS", "XENITHPAY"]),
  ]);
  if (stateResult.error || configResult.error) return json({ ok: false, error: "PAYMENT_SETTINGS_READ_FAILED" }, 500);
  const configRows = new Map<string, AnyRecord>((configResult.data ?? []).map((row: AnyRecord) => [String(row.provider), row]));
  const safeProviders = {
    MIDTRANS: providerSummary("MIDTRANS", configRows.get("MIDTRANS")),
    XENITHPAY: providerSummary("XENITHPAY", configRows.get("XENITHPAY")),
  };
  const activeProvider = ["MANUAL", "MIDTRANS", "XENITHPAY"].includes(String(stateResult.data?.active_provider))
    ? String(stateResult.data?.active_provider) : "MIDTRANS";
  const automaticPaymentsEnabled = stateResult.data?.automatic_payments_enabled !== false;
  const webhookUrl = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/payment-gateway-webhook`;

  if (action === "get") {
    return json({ ok: true, settings: { activeProvider, automaticPaymentsEnabled, webhookUrl, providers: safeProviders } });
  }
  if (action === "public") {
    const provider = activeProvider === "MANUAL" ? null : (safeProviders as AnyRecord)[activeProvider];
    return json({ ok: true, activeProvider, automaticPaymentsEnabled, checkoutEnabled: Boolean(automaticPaymentsEnabled && provider?.enabled && provider?.environments?.[provider.environment]?.configured), providerName: activeProvider === "XENITHPAY" ? "XenithPay" : activeProvider === "MIDTRANS" ? "Midtrans" : "Manual" });
  }

  if (action === "save") {
    const inputSettings = record(body.settings);
    const requestedActive = inputSettings.activeProvider;
    if (!["MANUAL", "MIDTRANS", "XENITHPAY"].includes(String(requestedActive))) return json({ ok: false, error: "INVALID_ACTIVE_PROVIDER" }, 422);
    const requestedAutomatic = inputSettings.automaticPaymentsEnabled === true && requestedActive !== "MANUAL";
    const submittedProviders = record(inputSettings.providers);
    const savedRows: AnyRecord[] = [];

    for (const provider of ["MIDTRANS", "XENITHPAY"] as Provider[]) {
      const submitted = record(submittedProviders[provider]);
      const current = configRows.get(provider);
      const enabled = submitted.enabled === true;
      const environment = isEnvironment(submitted.environment) ? submitted.environment : "sandbox";
      const submittedEnv = record(record(submitted.environments)[environment]);
      const nextSecrets = mergeSecrets(record(current?.secret_config), submittedEnv, provider, environment);
      const nextPublic = mergePublicConfig(record(current?.public_config), submittedEnv, provider, environment);
      const { error } = await admin.from("payment_gateway_configs").upsert({
        provider,
        is_enabled: enabled,
        environment,
        secret_config: nextSecrets,
        public_config: nextPublic,
        updated_by: userData.user.id,
        updated_at: new Date().toISOString(),
      }, { onConflict: "provider" });
      if (error) return json({ ok: false, error: "PAYMENT_SETTINGS_SAVE_FAILED", provider }, 500);
      savedRows.push({ provider, is_enabled: enabled, environment, secret_config: nextSecrets, public_config: nextPublic });
    }

    const chosen = requestedActive === "MANUAL" ? null : savedRows.find((row) => row.provider === requestedActive);
    if (requestedAutomatic && (!chosen || chosen.is_enabled !== true || !isConfigured(requestedActive as Provider, chosen.environment as Environment, record(chosen.secret_config), record(chosen.public_config)))) {
      return json({ ok: false, error: "ACTIVE_PROVIDER_NOT_CONFIGURED", message: "Provider aktif harus diaktifkan dan kredensial untuk environment yang dipilih harus lengkap." }, 422);
    }

    const { error: stateError } = await admin.from("payment_gateway_state").upsert({
      id: true,
      active_provider: requestedActive,
      automatic_payments_enabled: requestedAutomatic,
      updated_by: userData.user.id,
      updated_at: new Date().toISOString(),
    }, { onConflict: "id" });
    if (stateError) return json({ ok: false, error: "PAYMENT_SETTINGS_STATE_SAVE_FAILED" }, 500);

    const { data: nextState } = await admin.from("payment_gateway_state").select("active_provider,automatic_payments_enabled").eq("id", true).single();
    const { data: nextConfigRows } = await admin.from("payment_gateway_configs").select("provider,is_enabled,environment,public_config,secret_config").in("provider", ["MIDTRANS", "XENITHPAY"]);
    const nextByProvider = new Map<string, AnyRecord>((nextConfigRows ?? []).map((row: AnyRecord) => [String(row.provider), row]));
    return json({ ok: true, settings: { activeProvider: nextState?.active_provider ?? "MIDTRANS", automaticPaymentsEnabled: nextState?.automatic_payments_enabled !== false, webhookUrl, providers: { MIDTRANS: providerSummary("MIDTRANS", nextByProvider.get("MIDTRANS")), XENITHPAY: providerSummary("XENITHPAY", nextByProvider.get("XENITHPAY")) } } });
  }

  if (action === "test") {
    const provider = body.provider;
    const environment = isEnvironment(body.environment) ? body.environment : "sandbox";
    if (!isProvider(provider)) return json({ ok: false, error: "INVALID_PROVIDER" }, 422);
    const submittedEnv = record(record(record(body.providers)[provider]).environments && record(record(body.providers)[provider]).environments[environment]);
    const current = configRows.get(provider);
    const secrets = mergeSecrets(record(current?.secret_config), submittedEnv, provider, environment);
    const publicConfig = mergePublicConfig(record(current?.public_config), submittedEnv, provider, environment);
    const secretEnv = record(secrets[environment]);
    if (!isConfigured(provider, environment, secrets, publicConfig)) return json({ ok: false, error: "CREDENTIALS_INCOMPLETE", message: "Lengkapi kredensial dan konfigurasi environment ini sebelum menguji koneksi." }, 422);
    try {
      if (provider === "MIDTRANS") {
        const key = nonEmpty(secretEnv.server_key) || legacyMidtransSecret(environment);
        const endpoint = environment === "production" ? "https://api.midtrans.com" : "https://api.sandbox.midtrans.com";
        const response = await fetch(`${endpoint}/v2/SYKABELAJAR-CONNECTION-CHECK/status`, {
          headers: { Authorization: `Basic ${btoa(`${key}:`)}` },
        });
        if (response.status === 401 || response.status === 403) return json({ ok: false, error: "MIDTRANS_AUTH_FAILED", message: "Midtrans menolak kredensial. Periksa Server Key dan environment." }, 422);
        return json({ ok: true, message: "Koneksi Midtrans merespons. Order pemeriksaan tidak dibuat." });
      }
      const apiKey = nonEmpty(secretEnv.api_key);
      const apiSecret = nonEmpty(secretEnv.api_secret);
      const timestamp = new Date().toISOString();
      const path = "/v1/payins?limit=1";
      const signature = await hmacBase64(apiSecret, `GET\n${path}\n${timestamp}\n`);
      const endpoint = environment === "production" ? "https://openapi.xenithpay.com" : "https://openapi.sandbox.xenithpay.com";
      const response = await fetch(`${endpoint}${path}`, { headers: { "Xenith-Api-Key": apiKey, "Xenith-Request-Timestamp": timestamp, "Xenith-Request-Signature": signature } });
      if (response.status === 401 || response.status === 403) return json({ ok: false, error: "XENITH_AUTH_FAILED", message: "XenithPay menolak kredensial atau API Key belum memiliki izin baca Pay In." }, 422);
      if (!response.ok) return json({ ok: false, error: "XENITH_CONNECTION_FAILED", message: `XenithPay merespons HTTP ${response.status}. Periksa konfigurasi dan izin API Key.` }, 502);
      return json({ ok: true, message: "Koneksi XenithPay berhasil diverifikasi." });
    } catch {
      return json({ ok: false, error: "GATEWAY_CONNECTION_FAILED", message: "Tidak dapat menghubungi gateway. Periksa koneksi dan coba lagi." }, 502);
    }
  }

  return json({ ok: false, error: "UNKNOWN_ACTION" }, 400);
});
