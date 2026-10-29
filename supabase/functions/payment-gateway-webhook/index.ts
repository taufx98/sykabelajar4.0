import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, x-xenith-timestamp, x-xenith-signature", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json" };
type Row = Record<string, any>;
type Provider = "MIDTRANS" | "XENITHPAY";
type Env = "sandbox" | "production";
function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: corsHeaders }); }
function obj(value: unknown): Row { return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {}; }
function str(value: unknown) { return typeof value === "string" || typeof value === "number" ? String(value).trim() : ""; }
function isEnv(value: unknown): value is Env { return value === "sandbox" || value === "production"; }
function constantTimeEqual(a: string, b: string) { if (a.length !== b.length) return false; let result = 0; for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i); return result === 0; }
async function sha512(value: string) { const bytes = new Uint8Array(await crypto.subtle.digest("SHA-512", new TextEncoder().encode(value))); return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join(""); }
async function hmacBase64(secret: string, value: string) { const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value))); return btoa(String.fromCharCode(...bytes)); }
function legacyMidtransKey(environment: Env) { const legacyEnv: Env = Deno.env.get("MIDTRANS_ENV") === "production" ? "production" : "sandbox"; return environment === legacyEnv ? Deno.env.get("MIDTRANS_SERVER_KEY") ?? "" : ""; }
function normalizeAmount(value: unknown) { const amount = Number(value); return Number.isFinite(amount) ? Math.round(amount * 100) : null; }
function mapStatus(provider: Provider, rawStatus: string, fraudStatus = ""): "PAID" | "CANCELLED" | "PENDING" {
  const status = rawStatus.toUpperCase();
  if (provider === "MIDTRANS") {
    if (status === "SETTLEMENT") return "PAID";
    if (status === "CAPTURE" && fraudStatus.toLowerCase() === "accept") return "PAID";
    if (["CANCEL", "CANCELLED", "DENY", "DENIED", "EXPIRE", "EXPIRED", "FAIL", "FAILED"].includes(status)) return "CANCELLED";
    return "PENDING";
  }
  if (["SUCCESS", "SUCCEEDED", "PAID", "SETTLED", "COMPLETED"].includes(status)) return "PAID";
  if (["FAILED", "FAIL", "EXPIRED", "CANCELLED", "CANCELED", "REJECTED"].includes(status)) return "CANCELLED";
  return "PENDING";
}
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json({ ok: false, error: "SERVER_NOT_CONFIGURED" }, 503);
  const rawBody = await req.text();
  let payload: Row;
  try { payload = JSON.parse(rawBody); } catch { return json({ ok: false, error: "INVALID_JSON" }, 400); }

  const path = new URL(req.url).pathname;
  const looksMidtrans = Boolean(payload.order_id && payload.signature_key);
  const incomingEventType = str(payload.eventType || payload.event_type || payload.type).toLowerCase();
  const incomingData = obj(payload.data);
  const incomingReferenceCode = str(incomingData.referenceCode || incomingData.reference_code || payload.referenceCode || payload.reference_code);
  // XenithPay also sends signed maintenance events that do not belong to an order.
  // Acknowledge those without attempting to resolve a payment intent, avoiding 24-hour retries.
  if (!looksMidtrans && incomingEventType.startsWith("maintenance.") && !incomingReferenceCode) {
    return json({ ok: true, ignored: true, reason: "NON_TRANSACTION_EVENT", event_type: incomingEventType });
  }
  let provider: Provider;
  let orderId = "";
  let providerEventId = "";
  let rawStatus = "";
  let fraudStatus = "";
  let reportedAmount: unknown = null;
  let status: "PAID" | "CANCELLED" | "PENDING" = "PENDING";
  let intent: Row | null = null;

  const admin = createClient(supabaseUrl, serviceRoleKey);
  if (looksMidtrans) {
    provider = "MIDTRANS";
    orderId = str(payload.order_id);
    rawStatus = str(payload.transaction_status);
    fraudStatus = str(payload.fraud_status);
    reportedAmount = payload.gross_amount;
    const { data, error } = await admin.from("payment_intents").select("id,order_id,provider,provider_reference,amount,status,raw_meta").eq("order_id", orderId).maybeSingle();
    if (error) return json({ ok: false, error: "PAYMENT_INTENT_LOOKUP_FAILED" }, 500);
    if (!data || data.provider !== provider) return json({ ok: false, error: "PAYMENT_INTENT_NOT_FOUND" }, 404);
    intent = data as Row;
    const environment: Env = isEnv(obj(intent.raw_meta).environment) ? obj(intent.raw_meta).environment : (Deno.env.get("MIDTRANS_ENV") === "production" ? "production" : "sandbox");
    const { data: providerRow, error: configError } = await admin.from("payment_gateway_configs").select("secret_config").eq("provider", provider).maybeSingle();
    if (configError) return json({ ok: false, error: "PROVIDER_CONFIG_LOOKUP_FAILED" }, 500);
    const savedSecret = str(obj(obj(providerRow?.secret_config)[environment]).server_key);
    const serverKey = savedSecret || legacyMidtransKey(environment);
    if (!serverKey) return json({ ok: false, error: "PROVIDER_SECRET_MISSING" }, 503);
    const expected = await sha512(str(payload.order_id) + str(payload.status_code) + str(payload.gross_amount) + serverKey);
    if (!constantTimeEqual(expected, str(payload.signature_key).toLowerCase())) return json({ ok: false, error: "INVALID_SIGNATURE" }, 401);
    if (normalizeAmount(reportedAmount) === null || normalizeAmount(reportedAmount) !== normalizeAmount(intent.amount)) return json({ ok: false, error: "AMOUNT_MISMATCH" }, 422);
    providerEventId = `MIDTRANS:${str(payload.transaction_id) || orderId}:${rawStatus.toUpperCase()}:${str(payload.status_code)}`;
    status = mapStatus(provider, rawStatus, fraudStatus);
  } else {
    provider = "XENITHPAY";
    const timestamp = str(req.headers.get("X-Xenith-Timestamp"));
    const supplied = str(req.headers.get("X-Xenith-Signature"));
    if (!timestamp || !supplied) return json({ ok: false, error: "SIGNATURE_REQUIRED" }, 401);
    const parsedTimestamp = Date.parse(timestamp);
    if (!Number.isFinite(parsedTimestamp) || Math.abs(Date.now() - parsedTimestamp) > 5 * 60 * 1000) return json({ ok: false, error: "STALE_WEBHOOK" }, 401);
    const data = obj(payload.data);
    orderId = str(data.referenceCode || data.reference_code || payload.referenceCode || payload.reference_code);
    rawStatus = str(data.status || payload.status || payload.eventType);
    reportedAmount = data.initiatedAmount ?? data.amount ?? data.paidAmount ?? payload.amount;
    const referenceId = str(data.id || payload.id);
    const { data: byOrder, error: orderLookupError } = orderId
      ? await admin.from("payment_intents").select("id,order_id,provider,provider_reference,amount,status,raw_meta").eq("order_id", orderId).maybeSingle()
      : { data: null, error: null };
    if (orderLookupError) return json({ ok: false, error: "PAYMENT_INTENT_LOOKUP_FAILED" }, 500);
    let found = byOrder as Row | null;
    if (!found && referenceId) {
      const { data, error } = await admin.from("payment_intents").select("id,order_id,provider,provider_reference,amount,status,raw_meta").eq("provider_reference", referenceId).eq("provider", provider).maybeSingle();
      if (error) return json({ ok: false, error: "PAYMENT_INTENT_LOOKUP_FAILED" }, 500);
      found = data as Row | null;
      if (found) orderId = str(found.order_id);
    }
    if (!found || found.provider !== provider) return json({ ok: false, error: "PAYMENT_INTENT_NOT_FOUND" }, 404);
    intent = found;
    const environment: Env = isEnv(obj(intent.raw_meta).environment) ? obj(intent.raw_meta).environment : "sandbox";
    const { data: providerRow, error: configError } = await admin.from("payment_gateway_configs").select("secret_config").eq("provider", provider).maybeSingle();
    if (configError) return json({ ok: false, error: "PROVIDER_CONFIG_LOOKUP_FAILED" }, 500);
    const webhookSecret = str(obj(obj(providerRow?.secret_config)[environment]).webhook_secret);
    if (!webhookSecret) return json({ ok: false, error: "WEBHOOK_SECRET_MISSING" }, 503);
    const signaturePayload = `POST\\n${path}\\n${rawBody}\\n${timestamp}`;
    const expected = await hmacBase64(webhookSecret, signaturePayload);
    if (!constantTimeEqual(expected, supplied)) return json({ ok: false, error: "INVALID_SIGNATURE" }, 401);
    const normalizedReportedAmount = normalizeAmount(reportedAmount);
    const expectedAmount = normalizeAmount(intent.amount);
    if (reportedAmount !== null && reportedAmount !== undefined && (normalizedReportedAmount === null || normalizedReportedAmount !== expectedAmount)) {
      return json({ ok: false, error: "AMOUNT_MISMATCH" }, 422);
    }
    const eventType = str(payload.eventType || payload.event_type || payload.type);
    providerEventId = `XENITHPAY:${referenceId || orderId}:${rawStatus.toUpperCase()}:${eventType}`;
    status = mapStatus(provider, rawStatus);
    // Fail closed: never fulfill an order from a "paid" webhook without a verifiable matching amount.
    if (status === "PAID" && (normalizedReportedAmount === null || normalizedReportedAmount !== expectedAmount)) {
      return json({ ok: false, error: "AMOUNT_MISMATCH" }, 422);
    }
  }

  if (!intent) return json({ ok: false, error: "PAYMENT_INTENT_NOT_FOUND" }, 404);
  const currentIntentStatus = String(intent.status).toUpperCase();
  if (currentIntentStatus === "PAID" && status !== "PAID") {
    return json({ ok: true, ignored: true, reason: "PAID_IS_TERMINAL", provider, order_id: orderId, status: currentIntentStatus });
  }
  if (status === "PAID" && ["CANCELLED", "EXPIRED", "FAILED", "REFUNDED"].includes(currentIntentStatus)) {
    return json({ ok: false, error: "PAYMENT_INTENT_ALREADY_CLOSED" }, 409);
  }
  if (status === "PAID") {
    // One atomic server-side operation updates the intent/order and fulfills the purchased product.
    // If fulfillment fails, the transaction rolls back so the provider can retry the webhook safely.
    const { error: fulfillmentError } = await admin.rpc("process_payment_gateway_success", {
      p_order_id: orderId,
      p_provider: provider,
      p_payment_intent_id: intent.id,
    });
    if (fulfillmentError) {
      return json({ ok: false, error: "PAYMENT_FULFILLMENT_FAILED", message: "Pembayaran sudah terverifikasi oleh provider tetapi proses aktivasi belum selesai. Webhook dapat dicoba ulang.", detail: fulfillmentError.message }, 500);
    }
  } else if (status === "CANCELLED") {
    const { error: intentUpdateError } = await admin.from("payment_intents")
      .update({ status: "CANCELLED", updated_at: new Date().toISOString() })
      .eq("id", intent.id)
      .neq("status", "PAID");
    if (intentUpdateError) return json({ ok: false, error: "PAYMENT_INTENT_UPDATE_FAILED" }, 500);
    const { error: orderUpdateError } = await admin.from("orders")
      .update({ status: "CANCELLED", updated_at: new Date().toISOString() })
      .eq("id", orderId)
      .eq("status", "PENDING_PAYMENT");
    if (orderUpdateError) return json({ ok: false, error: "ORDER_UPDATE_FAILED" }, 500);
  }
  const { error: eventError } = await admin.from("payment_events").insert({
    payment_intent_id: intent.id,
    provider,
    provider_event_id: providerEventId,
    status,
    payload,
  });
  if (eventError && !String(eventError.code ?? "").includes("23505")) return json({ ok: false, error: "PAYMENT_EVENT_SAVE_FAILED" }, 500);
  return json({ ok: true, duplicate: Boolean(eventError), provider, order_id: orderId, status });
});
