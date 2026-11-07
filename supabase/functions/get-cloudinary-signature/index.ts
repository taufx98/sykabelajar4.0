import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { requireBetterAuthUser } from "../_shared/better-auth-user.ts";
import { isOwnedCloudinaryPublicId } from "../_shared/cloudinary-ownership.mjs";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  try {
    const identity = await requireBetterAuthUser(req);
    if (!identity.ok) {
      return new Response(JSON.stringify({ error: identity.error }), {
        status: identity.status,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }
    const { userId } = identity;
    const supabase = identity.supabase;
    if (!supabase) {
      return new Response(JSON.stringify({ error: "AUTH_SUPABASE_CONTEXT_UNAVAILABLE" }), {
        status: 503,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const publicId = typeof body.public_id === 'string' ? body.public_id.trim() : '';
    if (!publicId) return new Response(JSON.stringify({ error: "public_id is required" }), { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });

    // Resolve ownership using the caller-scoped client and the UUID returned
    // by Supabase's verified Auth endpoint. Never trust a username or owner ID
    // supplied by the browser, and never use service_role for these lookups.
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("username")
      .eq("id", userId)
      .maybeSingle();
    if (profileError || !profile) {
      return new Response(JSON.stringify({ error: "PROFILE_NOT_FOUND" }), { status: 403, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
    }

    let ownedOrganizers: Array<{ id: string; slug: string }> = [];
    if (publicId.startsWith("sykabelajar/organizers/")) {
      const { data, error } = await supabase
        .from("organizers")
        .select("id,slug")
        .eq("owner_user_id", userId);
      if (error) {
        return new Response(JSON.stringify({ error: "ORGANIZER_OWNERSHIP_CHECK_FAILED" }), { status: 403, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
      }
      ownedOrganizers = (data ?? []) as Array<{ id: string; slug: string }>;
    }

    if (!isOwnedCloudinaryPublicId(publicId, { userId, username: profile.username, ownedOrganizers })) {
      return new Response(JSON.stringify({ error: "CLOUDINARY_PUBLIC_ID_NOT_OWNED" }), { status: 403, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
    }

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
