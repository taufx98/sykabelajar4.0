/**
 * Supabase Edge Function: get-cloudinary-signature
 *
 * Generates a signed upload signature for Cloudinary's "sykabelajar_profile" preset.
 * The API secret stays on the server — the frontend receives only the signature + timestamp.
 *
 * Request body:
 *   { public_id: string }  — the exact public_id to upload to (e.g. "avatar_{userId}")
 *
 * Response:
 *   { signature, timestamp, api_key, cloud_name, folder }
 */
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  try {
    // Authenticate the caller via Supabase JWT
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Verify the JWT
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    // Parse request body
    const { public_id } = await req.json();

    if (!public_id || typeof public_id !== "string") {
      return new Response(
        JSON.stringify({ error: "public_id is required" }),
        { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    // Security: ensure public_id belongs to this user
    // Allowed patterns: avatar_{userId} or cover_{userId}
    const userId = user.id;
    const isValidPublicId =
      public_id === `avatar_${userId}` || public_id === `cover_${userId}`;

    if (!isValidPublicId) {
      return new Response(
        JSON.stringify({ error: "public_id does not match authenticated user" }),
        { status: 403, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    // Cloudinary credentials (set in Supabase Dashboard → Edge Functions → Secrets)
    const cloudName = Deno.env.get("CLOUDINARY_CLOUD_NAME") || "sykabelajar";
    const apiKey = Deno.env.get("CLOUDINARY_API_KEY") || "";
    const apiSecret = Deno.env.get("CLOUDINARY_API_SECRET") || "";

    if (!apiSecret || !apiKey) {
      return new Response(
        JSON.stringify({ error: "Cloudinary credentials not configured on server" }),
        { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    // Generate signature using crypto.subtle (Web Crypto API)
    const timestamp = Math.floor(Date.now() / 1000);
    const presetName = "sykabelajar_profile";

    // Cloudinary signature formula: sha1(sorted_params + api_secret)
    const paramsToSign = `public_id=${public_id}&timestamp=${timestamp}&upload_preset=${presetName}`;

    const encoder = new TextEncoder();
    const keyData = encoder.encode(apiSecret);
    const msgData = encoder.encode(paramsToSign);

    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      keyData,
      { name: "HMAC", hash: "SHA-1" },
      false,
      ["sign"]
    );

    const signatureBuffer = await crypto.subtle.sign("HMAC", cryptoKey, msgData);
    const signatureArray = new Uint8Array(signatureBuffer);
    const signature = Array.from(signatureArray)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    return new Response(
      JSON.stringify({
        signature,
        timestamp,
        api_key: apiKey,
        cloud_name: cloudName,
        preset: presetName,
      }),
      {
        status: 200,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("[get-cloudinary-signature]", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }
});
