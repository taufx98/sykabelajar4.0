import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function readEnv(name: string): string {
  const value = Deno.env.get(name)?.trim() ?? "";
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1).trim();
    }
  }
  return value;
}

function json(data: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing authorization" }, 401);

    const supabase = createClient(
      readEnv("SUPABASE_URL"),
      readEnv("SUPABASE_ANON_KEY"),
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const publicId = typeof body.public_id === "string" ? body.public_id.trim() : "";
    if (!publicId) return json({ error: "public_id is required" }, 400);

    const apiSecret = readEnv("CLOUDINARY_API_SECRET");
    const apiKey = readEnv("CLOUDINARY_API_KEY");
    const cloudName = readEnv("CLOUDINARY_CLOUD_NAME");
    const profilePreset = readEnv("CLOUDINARY_PROFILE_PRESET") || "sykabelajar_profile";

    if (!apiSecret || !apiKey || !cloudName) {
      console.error("Cloudinary signing configuration incomplete", {
        has_api_secret: Boolean(apiSecret),
        has_api_key: Boolean(apiKey),
        has_cloud_name: Boolean(cloudName),
      });
      return json({ error: "Cloudinary server configuration incomplete" }, 500);
    }

    if (!/^\d+$/.test(apiKey)) {
      console.error("Cloudinary API key format is invalid; expected numeric API key", {
        api_key_length: apiKey.length,
        cloud_name: cloudName,
      });
      return json({ error: "Cloudinary API key configuration is invalid" }, 500);
    }

    const timestamp = Math.round(Date.now() / 1000);
    const paramsToSign = `public_id=${publicId}&timestamp=${timestamp}&upload_preset=${profilePreset}`;
    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest(
      "SHA-1",
      encoder.encode(paramsToSign + apiSecret),
    );
    const signature = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    return json({
      signature,
      timestamp,
      api_key: apiKey,
      cloud_name: cloudName,
      upload_preset: profilePreset,
      public_id: publicId,
    }, 200);
  } catch (error) {
    console.error("Cloudinary signature generation failed", error);
    return json({ error: "Internal server error" }, 500);
  }
});
