import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

type Row = Record<string, unknown>;
type Env = "sandbox" | "production";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}
function obj(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}
function str(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}
function isEnv(value: unknown): value is Env {
  return value === "sandbox" || value === "production";
}
async function hmacBase64(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
  return btoa(String.fromCharCode(...bytes));
}
function moneyMatches(value: unknown, expected: number) {
  const amount = Number(value);
  return Number.isFinite(amount) && Math.round(amount * 100) === Math.round(expected * 100);
}
function currencyMatches(value: unknown, expected: string) {
  return str(value).toUpperCase() === expected.toUpperCase();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authorization = req.headers.get("Authorization");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json({ ok: false, error: "SERVER_NOT_CONFIGURED" }, 503);
  }
  if (!authorization?.startsWith("Bearer ")) return json({ ok: false, error: "AUTH_REQUIRED" }, 401);

  const body = obj(await req.json().catch(() => null));
  const orderId = str(body.order_id);
  const transactionId = str(body.transaction_id);
  if (!orderId) return json({ ok: false, error: "ORDER_ID_REQUIRED" }, 422);
  // Restrict caller-supplied transaction IDs to the provider's documented identifier format.
  if (transactionId && !/^payin-[A-Za-z0-9-]+$/.test(transactionId)) {
    return json({ ok: false, error: "INVALID_TRANSACTION_ID" }, 422);
  }

  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
  });
  const { data: authData, error: authError } = await authClient.auth.getUser();
  if (authError || !authData.user) return json({ ok: false, error: "AUTH_REQUIRED" }, 401);

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const [{ data: order, error: orderError }, { data: intent, error: intentError }] = await Promise.all([
    admin.from("orders")
      .select("id,user_id,status,total,currency,payment_provider")
      .eq("id", orderId)
      .eq("user_id", authData.user.id)
      .maybeSingle(),
    admin.from("payment_intents")
      .select("id,order_id,provider,provider_reference,amount,status,raw_meta")
      .eq("order_id", orderId)
      .maybeSingle(),
  ]);

  if (orderError || intentError) return json({ ok: false, error: "ORDER_LOOKUP_FAILED" }, 500);
  if (!order || !intent || order.user_id !== authData.user.id) return json({ ok: false, error: "ORDER_NOT_FOUND" }, 404);

  const orderStatus = str(order.status).toUpperCase();
  const intentStatus = str(intent.status).toUpperCase();
  const provider = str(intent.provider).toUpperCase();
  if (orderStatus === "PAID" && intentStatus === "PAID") {
    return json({ ok: true, status: "PAID", order_id: orderId, already_paid: true });
  }
  if (orderStatus !== "PENDING_PAYMENT" || !["PENDING", "PROCESSING"].includes(intentStatus)) {
    return json({ ok: true, status: orderStatus, order_id: orderId, verified: false });
  }
  if (provider !== "XENITHPAY" || str(order.payment_provider).toUpperCase() !== "XENITHPAY") {
    return json({ ok: true, status: "PENDING", order_id: orderId, reason: "PROVIDER_RECONCILIATION_UNSUPPORTED" });
  }
  if (!moneyMatches(intent.amount, Number(order.total))) {
    return json({ ok: false, error: "LOCAL_AMOUNT_MISMATCH" }, 409);
  }

  const environment: Env = isEnv(obj(intent.raw_meta).environment) ? obj(intent.raw_meta).environment as Env : "sandbox";
  const { data: configRow, error: configError } = await admin
    .from("payment_gateway_configs")
    .select("secret_config")
    .eq("provider", "XENITHPAY")
    .maybeSingle();
  if (configError) return json({ ok: false, error: "PROVIDER_CONFIG_LOOKUP_FAILED" }, 500);

  const secrets = obj(obj(configRow?.secret_config)[environment]);
  const apiKey = str(secrets.api_key);
  const apiSecret = str(secrets.api_secret);
  if (!apiKey || !apiSecret) return json({ ok: false, error: "PROVIDER_CREDENTIALS_MISSING" }, 503);

  const query = new URLSearchParams();
  query.set("transactionTypes", "PAY_IN,PAYMENT_LINK");
  query.set("referenceCode", orderId);
  if (transactionId) query.set("id", transactionId);
  query.set("limit", "100");
  query.set("sortOrder", "desc");
  const uri = "/v1/transactions?" + query.toString();
  const timestamp = new Date().toISOString();
  const signature = await hmacBase64(apiSecret, "GET\n" + uri + "\n" + timestamp + "\n");
  const endpoint = environment === "production"
    ? "https://openapi.xenithpay.com"
    : "https://openapi.sandbox.xenithpay.com";

  let providerResponse: Response;
  try {
    providerResponse = await fetch(endpoint + uri, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "Xenith-Api-Key": apiKey,
        "Xenith-Request-Timestamp": timestamp,
        "Xenith-Request-Signature": signature,
      },
    });
  } catch {
    return json({ ok: true, status: "PENDING", order_id: orderId, reason: "PROVIDER_STATUS_UNAVAILABLE" });
  }

  const providerPayload = obj(await providerResponse.json().catch(() => ({})));
  if (providerResponse.status === 403) {
    return json({ ok: true, status: "PENDING", order_id: orderId, reason: "PROVIDER_STATUS_PERMISSION_REQUIRED" });
  }
  if (!providerResponse.ok) {
    return json({ ok: true, status: "PENDING", order_id: orderId, reason: "PROVIDER_STATUS_UNAVAILABLE" });
  }

  const records = Array.isArray(providerPayload.data) ? providerPayload.data.map(obj) : [];
  const matching = records.find((row) => {
    const recordId = str(row.id);
    const transactionType = str(row.transactionType).toUpperCase();
    const status = str(row.status).toUpperCase();
    const referenceCode = str(row.referenceCode);
    const initiatedAmount = obj(row.initiatedAmount);
    const amount = initiatedAmount.value ?? row.amount;
    const currency = initiatedAmount.currency ?? row.currency;
    const validSuccess = (transactionType === "PAY_IN" && status === "SUCCESS")
      || (transactionType === "PAYMENT_LINK" && status === "COMPLETED");
    return (!transactionId || recordId === transactionId)
      && referenceCode === orderId
      && validSuccess
      && moneyMatches(amount, Number(order.total))
      && currencyMatches(currency, str(order.currency) || "IDR");
  });

  if (!matching) {
    return json({ ok: true, status: "PENDING", order_id: orderId, verified: false });
  }

  // Only provider-authenticated transaction data can trigger fulfillment; the browser return URL is not proof.
  const { error: fulfillmentError } = await admin.rpc("process_payment_gateway_success", {
    p_order_id: orderId,
    p_provider: "XENITHPAY",
    p_payment_intent_id: intent.id,
  });
  if (fulfillmentError) {
    const { data: refreshedOrder } = await admin.from("orders").select("status").eq("id", orderId).maybeSingle();
    const { data: refreshedIntent } = await admin.from("payment_intents").select("status").eq("id", intent.id).maybeSingle();
    if (str(refreshedOrder?.status).toUpperCase() !== "PAID" || str(refreshedIntent?.status).toUpperCase() !== "PAID") {
      return json({ ok: false, error: "PAYMENT_FULFILLMENT_FAILED" }, 500);
    }
  }

  const eventId = "XENITHPAY:RECONCILE:" + str(matching.id) + ":" + str(matching.status).toUpperCase();
  const { error: eventError } = await admin.from("payment_events").insert({
    payment_intent_id: intent.id,
    provider: "XENITHPAY",
    provider_event_id: eventId,
    status: "PAID",
    payload: { source: "server_reconciliation", transaction: matching },
  });
  if (eventError && !String(obj(eventError).code ?? "").includes("23505")) {
    // Fulfillment has already been committed. Return the verified payment state and leave event repair to operations.
  }

  return json({ ok: true, status: "PAID", order_id: orderId, verified: true });
});
