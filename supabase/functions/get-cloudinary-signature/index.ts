import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "Missing authorization" }), { status: 401, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });

    const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "", { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });

    const body = await req.json().catch(() => ({}));
    const publicId = typeof body.public_id === 'string' ? body.public_id.trim() : '';
    if (!publicId) return new Response(JSON.stringify({ error: "public_id is required" }), { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });

    const apiSecret = Deno.env.get("CLOUDINARY_API_SECRET")?.trim();
    const apiKey = Deno.env.get("CLOUDINARY_API_KEY")?.trim();
    const cloudName = Deno.env.get("CLOUDINARY_CLOUD_NAME")?.trim();
    const profilePreset = Deno.env.get("CLOUDINARY_PROFILE_PRESET")?.trim() || "sykabelajar_profile";

    if (!apiSecret || !apiKey || !cloudName) {
      console.error("Cloudinary signing configuration incomplete", { has_api_secret: Boolean(apiSecret), has_api_key: Boolean(apiKey), has_cloud_name: Boolean(cloudName) });
      return new Response(JSON.stringify({ error: "Cloudinary server configuration incomplete" }), { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
    }

    if (!/^\d+$/.test(apiKey)) {
      console.error("Cloudinary API key format is invalid; expected numeric API key", { api_key_length: apiKey.length, cloud_name: cloudName });
      return new Response(JSON.stringify({ error: "Cloudinary API key configuration is invalid" }), { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
    }

    const timestamp = Math.round(Date.now() / 1000);
    const paramsToSign = `public_id=${publicId}&timestamp=${timestamp}&upload_preset=${profilePreset}`;
    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest("SHA-1", encoder.encode(paramsToSign + apiSecret));
    const signature = Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("");

    return new Response(JSON.stringify({ signature, timestamp, api_key: apiKey, cloud_name: cloudName, upload_preset: profilePreset, public_id: publicId }), { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("Cloudinary signature generation failed", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
  }
});
