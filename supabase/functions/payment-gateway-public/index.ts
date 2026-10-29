import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json",
};
type Row = Record<string, any>;
type Env = "sandbox" | "production";
function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: corsHeaders }); }
function obj(value: unknown): Row { return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {}; }
function str(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function legacyMidtransKey(environment: Env) {
  const legacyEnvironment: Env = Deno.env.get("MIDTRANS_ENV") === "production" ? "production" : "sandbox";
  return environment === legacyEnvironment ? Deno.env.get("MIDTRANS_SERVER_KEY") ?? "" : "";
}
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!["GET", "POST"].includes(req.method)) return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return json({ ok: false, error: "SERVER_NOT_CONFIGURED" }, 503);
  const admin = createClient(url, serviceKey);
  const [{ data: state }, { data: configs, error }] = await Promise.all([
    admin.from("payment_gateway_state").select("active_provider,automatic_payments_enabled").eq("id", true).maybeSingle(),
    admin.from("payment_gateway_configs").select("provider,is_enabled,environment,public_config,secret_config").in("provider", ["MIDTRANS", "XENITHPAY"]),
  ]);
  if (error) return json({ ok: false, error: "PAYMENT_SETTINGS_UNAVAILABLE" }, 503);
  const activeProvider = ["MANUAL", "MIDTRANS", "XENITHPAY"].includes(String(state?.active_provider)) ? String(state?.active_provider) : "MANUAL";
  const automaticPaymentsEnabled = state?.automatic_payments_enabled === true;
  const row = (configs ?? []).find((item: Row) => String(item.provider) === activeProvider) as Row | undefined;
  const environment: Env = row?.environment === "production" ? "production" : (activeProvider === "MIDTRANS" && Deno.env.get("MIDTRANS_ENV") === "production" ? "production" : "sandbox");
  const secretEnv = obj(obj(row?.secret_config)[environment]);
  const publicEnv = obj(obj(row?.public_config)[environment]);
  const legacyKey = secretEnv.disable_legacy_midtrans === true ? "" : legacyMidtransKey(environment);
  const legacyMidtrans = activeProvider === "MIDTRANS" && !row && Boolean(legacyKey);
  const configured = activeProvider === "MIDTRANS"
    ? Boolean(str(secretEnv.server_key) || legacyKey)
    : activeProvider === "XENITHPAY"
      ? Boolean(str(secretEnv.api_key) && str(secretEnv.api_secret) && str(secretEnv.webhook_secret) && str(publicEnv.payment_method) && str(publicEnv.payment_channel))
      : false;
  const providerEnabled = row?.is_enabled === true || legacyMidtrans;
  const checkoutEnabled = automaticPaymentsEnabled && activeProvider !== "MANUAL" && providerEnabled && configured;
  return json({
    ok: true,
    activeProvider,
    providerName: activeProvider === "XENITHPAY" ? "XenithPay" : activeProvider === "MIDTRANS" ? "Midtrans" : "Manual / transfer rekening",
    environment,
    automaticPaymentsEnabled,
    checkoutEnabled,
  });
});
