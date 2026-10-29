import "jsr:@supabase/functions-js/edge-runtime.d.ts";

/**
 * Backward-compatible endpoint. Historical frontend code may still call the old
 * Midtrans function name, but provider selection is now made only by the global
 * payment gateway service. Do not read or use MIDTRANS_SERVER_KEY here.
 */
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response(JSON.stringify({ ok: false, error: "METHOD_NOT_ALLOWED" }), { status: 405, headers: corsHeaders });

  const authorization = req.headers.get("Authorization");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!authorization?.startsWith("Bearer ")) return new Response(JSON.stringify({ ok: false, error: "AUTH_REQUIRED" }), { status: 401, headers: corsHeaders });
  if (!supabaseUrl || !anonKey) return new Response(JSON.stringify({ ok: false, error: "SERVER_NOT_CONFIGURED" }), { status: 503, headers: corsHeaders });

  const body = await req.json().catch(() => null);
  const orderId = body && typeof body.order_id === "string" ? body.order_id.trim() : "";
  if (!orderId) return new Response(JSON.stringify({ ok: false, error: "ORDER_ID_REQUIRED" }), { status: 422, headers: corsHeaders });

  const response = await fetch(`${supabaseUrl.replace(/\/$/, "")}/functions/v1/payment-gateway-create`, {
    method: "POST",
    headers: {
      "Authorization": authorization,
      "apikey": anonKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ order_id: orderId }),
  });
  const payload = await response.text();
  return new Response(payload, {
    status: response.status,
    headers: {
      ...corsHeaders,
      "Content-Type": response.headers.get("Content-Type") || "application/json",
    },
  });
});
