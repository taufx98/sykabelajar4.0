import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
type Provider = "MIDTRANS" | "XENITHPAY";
type Env = "sandbox" | "production";
type Row = Record<string, any>;

function response(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: corsHeaders }); }
function obj(value: unknown): Row { return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {}; }
function str(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function isEnv(value: unknown): value is Env { return value === "sandbox" || value === "production"; }
function equalMoney(a: unknown, b: unknown) { return Math.round(Number(a) * 100) === Math.round(Number(b) * 100); }
async function hmacBase64(secret: string, value: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
  return btoa(String.fromCharCode(...bytes));
}
function legacyMidtransKey(environment: Env) {
  const legacyEnv: Env = Deno.env.get("MIDTRANS_ENV") === "production" ? "production" : "sandbox";
  return environment === legacyEnv ? Deno.env.get("MIDTRANS_SERVER_KEY") ?? "" : "";
}
function providerCredentials(provider: Provider, row: Row, environment: Env) {
  const allSecrets = obj(row.secret_config);
  const secrets = obj(allSecrets[environment]);
  return { secrets, publicConfig: obj(obj(row.public_config)[environment]) };
}
function paymentOutput(provider: Provider, result: Row) {
  const raw = obj(result.data ?? result);
  return {
    ok: true,
    provider,
    token: str(result.token) || str(raw.token) || null,
    redirect_url: str(result.redirect_url) || str(result.redirectUrl) || str(raw.redirect_url) || str(raw.redirectUrl) || str(raw.paymentUrl) || str(raw.payment_url) || str(raw.checkoutUrl) || str(raw.checkout_url) || null,
    provider_reference: str(raw.id) || str(result.id) || null,
    payment_code: str(raw.paymentCode) || str(raw.payment_code) || str(raw.virtualAccountNumber) || str(raw.virtual_account_number) || null,
    payment_code_type: str(raw.paymentCodeType) || str(raw.payment_code_type) || str(raw.bankName) || str(raw.bank_name) || null,
    expires_at: str(raw.expiresAt) || str(raw.expires_at) || null,
    details: raw,
  };
}
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return response({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authorization = req.headers.get("Authorization");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return response({ ok: false, error: "SERVER_NOT_CONFIGURED" }, 503);
  if (!authorization?.startsWith("Bearer ")) return response({ ok: false, error: "AUTH_REQUIRED" }, 401);
  const body = await req.json().catch(() => null);
  const orderId = str(obj(body).order_id);
  if (!orderId) return response({ ok: false, error: "ORDER_ID_REQUIRED" }, 422);

  const authClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
  const { data: authData, error: authError } = await authClient.auth.getUser();
  if (authError || !authData.user) return response({ ok: false, error: "AUTH_REQUIRED" }, 401);
  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { data: order, error: orderError } = await admin.from("orders")
    .select("id,user_id,total,currency,status,contact_name,contact_email,contact_whatsapp,contact_note")
    .eq("id", orderId).maybeSingle();
  if (orderError) return response({ ok: false, error: "ORDER_LOOKUP_FAILED" }, 500);
  if (!order || order.user_id !== authData.user.id) return response({ ok: false, error: "ORDER_NOT_FOUND" }, 404);
  if (!["PENDING", "PENDING_PAYMENT"].includes(String(order.status))) return response({ ok: false, error: "ORDER_NOT_PAYABLE" }, 409);
  const amount = Number(order.total);
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isInteger(amount)) return response({ ok: false, error: "INVALID_ORDER_AMOUNT" }, 422);

  const { data: state, error: stateError } = await admin.from("payment_gateway_state")
    .select("active_provider,automatic_payments_enabled").eq("id", true).maybeSingle();
  if (stateError) return response({ ok: false, error: "PAYMENT_ROUTING_UNAVAILABLE" }, 500);
  if (!state || state.automatic_payments_enabled !== true) return response({ ok: false, error: "AUTOMATIC_PAYMENTS_DISABLED", message: "Pembayaran otomatis sedang dinonaktifkan. Silakan pilih metode manual atau hubungi admin." }, 409);
  const provider = String(state.active_provider);
  if (provider === "MANUAL") return response({ ok: false, error: "MANUAL_PAYMENT_SELECTED", message: "Metode pembayaran global saat ini manual." }, 409);
  if (provider !== "MIDTRANS" && provider !== "XENITHPAY") return response({ ok: false, error: "UNSUPPORTED_PAYMENT_PROVIDER" }, 503);

  const { data: providerRow, error: providerError } = await admin.from("payment_gateway_configs")
    .select("provider,is_enabled,environment,public_config,secret_config").eq("provider", provider).maybeSingle();
  if (providerError) return response({ ok: false, error: "PAYMENT_PROVIDER_LOOKUP_FAILED" }, 500);
  const envFromConfig = isEnv(providerRow?.environment) ? providerRow.environment : (provider === "MIDTRANS" && Deno.env.get("MIDTRANS_ENV") === "production" ? "production" : "sandbox");
  const legacyKey = provider === "MIDTRANS" ? legacyMidtransKey(envFromConfig) : "";
  const enabled = providerRow?.is_enabled === true || (provider === "MIDTRANS" && !providerRow && Boolean(legacyKey));
  if (!enabled) return response({ ok: false, error: "PAYMENT_PROVIDER_DISABLED", message: "Provider pembayaran belum diaktifkan oleh admin." }, 409);

  const { data: existing, error: existingError } = await admin.from("payment_intents")
    .select("id,provider,provider_reference,amount,status,raw_meta").eq("order_id", order.id).maybeSingle();
  if (existingError) return response({ ok: false, error: "PAYMENT_INTENT_LOOKUP_FAILED" }, 500);
  if (existing) {
    if (String(existing.provider) !== provider) return response({ ok: false, error: "PAYMENT_PROVIDER_LOCKED", message: "Pesanan ini sudah dimulai menggunakan provider lain. Selesaikan atau batalkan transaksi sebelumnya sebelum mengganti metode." }, 409);
    if (!equalMoney(existing.amount, amount)) return response({ ok: false, error: "PAYMENT_AMOUNT_CHANGED", message: "Total pesanan berubah setelah sesi pembayaran dibuat. Hubungi admin untuk melanjutkan." }, 409);
    const meta = obj(existing.raw_meta);
    const cached = obj(meta.checkout);
    if (String(existing.status).toUpperCase() === "PENDING" && (cached.redirect_url || cached.token || cached.payment_code || cached.details)) {
      return response({ ...cached, ok: true, provider, reused: true });
    }
    if (String(existing.status).toUpperCase() === "PAID") return response({ ok: false, error: "ORDER_ALREADY_PAID" }, 409);
    if (["CANCELLED", "EXPIRED", "FAILED", "REFUNDED"].includes(String(existing.status).toUpperCase())) {
      return response({ ok: false, error: "PAYMENT_SESSION_CLOSED", message: "Sesi pembayaran sebelumnya sudah ditutup. Buat pesanan baru agar dapat membayar kembali." }, 409);
    }
  }

  const { secrets, publicConfig } = providerCredentials(provider as Provider, obj(providerRow), envFromConfig);
  let result: Row;
  if (provider === "MIDTRANS") {
    const serverKey = str(secrets.server_key) || legacyKey;
    if (!serverKey) return response({ ok: false, error: "MIDTRANS_NOT_CONFIGURED", message: "Server Key Midtrans untuk environment ini belum dikonfigurasi." }, 503);
    const endpoint = envFromConfig === "production" ? "https://app.midtrans.com/snap/v1/transactions" : "https://app.sandbox.midtrans.com/snap/v1/transactions";
    const customerDetails = {
      first_name: str(order.contact_name).slice(0, 50) || "Pengguna SYKABELAJAR",
      email: str(order.contact_email).slice(0, 100) || str(authData.user.email).slice(0, 100) || undefined,
      phone: str(order.contact_whatsapp).slice(0, 20) || undefined,
    };
    const midtransResponse = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Basic ${btoa(`${serverKey}:`)}` },
      body: JSON.stringify({
        transaction_details: { order_id: String(order.id), gross_amount: amount },
        customer_details: customerDetails,
        callbacks: { finish: str(publicConfig.return_url) || "https://sykabelajar.my.id/organizer/plan" },
      }),
    });
    result = await midtransResponse.json().catch(() => ({}));
    if (!midtransResponse.ok) {
      return response({ ok: false, error: "MIDTRANS_CREATE_FAILED", message: "Midtrans menolak pembuatan sesi pembayaran. Periksa credential, nominal, atau environment.", details: { status: midtransResponse.status, code: result.error_messages ?? result.status_message ?? null } }, 502);
    }
  } else {
    const apiKey = str(secrets.api_key);
    const apiSecret = str(secrets.api_secret);
    const paymentMethod = str(publicConfig.payment_method);
    const paymentChannel = str(publicConfig.payment_channel);
    if (!apiKey || !apiSecret || !paymentMethod || !paymentChannel) return response({ ok: false, error: "XENITHPAY_NOT_CONFIGURED", message: "API Key, API Secret, Payment Method, dan Payment Channel XenithPay wajib diisi untuk environment ini." }, 503);
    const { data: profile } = await admin.from("profiles").select("full_name,whatsapp").eq("id", order.user_id).maybeSingle();
    const customerName = (str(order.contact_name) || str(profile?.full_name) || "Pengguna SYKABELAJAR").slice(0, 100);
    const validCustomerName = customerName.length >= 5 ? customerName : "Pengguna SYKABELAJAR";
    const path = "/v1/payins";
    const callbackUrl = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/payment-gateway-webhook`;
    const requestBody = {
      initiatedAmount: amount,
      currency: str(order.currency) || "IDR",
      paymentMethod,
      paymentChannel,
      referenceCode: String(order.id),
      customerReference: String(order.user_id),
      customerName: validCustomerName,
      description: `Pembayaran SYKABELAJAR ${String(order.id).slice(0, 8)}`,
      callbackUrl,
      redirectUrl: str(publicConfig.return_url) || "https://sykabelajar.my.id/organizer/plan",
    };
    const rawBody = JSON.stringify(requestBody);
    const timestamp = new Date().toISOString();
    const signature = await hmacBase64(apiSecret, `POST\n${path}\n${timestamp}\n${rawBody}`);
    const endpoint = envFromConfig === "production" ? "https://openapi.xenithpay.com" : "https://openapi.sandbox.xenithpay.com";
    const xenithResponse = await fetch(`${endpoint}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Xenith-Api-Key": apiKey,
        "Xenith-Request-Timestamp": timestamp,
        "Xenith-Request-Signature": signature,
        "X-Idempotency-Key": `syka-order-${order.id}`.slice(0, 100),
      },
      body: rawBody,
    });
    result = await xenithResponse.json().catch(() => ({}));
    if (!xenithResponse.ok) {
      return response({ ok: false, error: "XENITHPAY_CREATE_FAILED", message: "XenithPay menolak pembuatan transaksi. Periksa credential, payment channel, dan batas nominal.", details: { status: xenithResponse.status, code: obj(result).code ?? obj(result.data).code ?? null } }, 502);
    }
  }

  const checkout = paymentOutput(provider as Provider, result);
  if (!checkout.redirect_url && !checkout.token && !checkout.payment_code && !checkout.provider_reference) {
    return response({ ok: false, error: "PAYMENT_RESPONSE_INCOMPLETE", message: "Provider merespons, tetapi detail pembayaran belum dapat dibaca. Periksa transaksi provider sebelum mencoba ulang." }, 502);
  }
  const providerReference = checkout.provider_reference || checkout.token || checkout.redirect_url;
  const rawMeta = { environment: envFromConfig, checkout, provider_response: result };
  const { error: intentError } = await admin.from("payment_intents").upsert({
    order_id: order.id,
    provider,
    provider_reference: providerReference ?? null,
    amount,
    status: "PENDING",
    raw_meta: rawMeta,
    updated_at: new Date().toISOString(),
  }, { onConflict: "order_id" });
  if (intentError) return response({ ok: false, error: "PAYMENT_INTENT_SAVE_FAILED", message: "Sesi dibuat oleh provider tetapi gagal direkam. Jangan buat pesanan pembayaran baru; hubungi admin dan sertakan ID pesanan." }, 500);
  return response(checkout);
});
