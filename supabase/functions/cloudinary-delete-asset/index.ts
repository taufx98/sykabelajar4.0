import { isOwnedCloudinaryPublicId } from "../_shared/cloudinary-ownership.mjs";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RESOURCE_TYPES = new Set(["image"]);
const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, x-client-info, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
  "cache-control": "no-store",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "content-type": "application/json" },
  });
}

function requiredEnv(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error("CLOUDINARY_DELETE_NOT_CONFIGURED");
  return value;
}

async function sha1Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function signParams(params: Record<string, string>, secret: string) {
  const payload = Object.entries(params)
    .filter(([key, value]) => key !== "file" && key !== "api_key" && key !== "resource_type" && key !== "cloud_name" && key !== "signature" && value !== "")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => key + "=" + value)
    .join("&");
  return sha1Hex(payload + secret);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

  const authorization = request.headers.get("authorization") ?? "";
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!bearer) return json({ error: "AUTH_REQUIRED" }, 401);

  const supabaseUrl = requiredEnv("SUPABASE_URL").replace(/\/+$/, "");
  const publishableKey =
    Deno.env.get("SUPABASE_ANON_KEY")?.trim() ??
    Deno.env.get("SUPABASE_PUBLISHABLE_KEY")?.trim() ??
    "";
  if (!publishableKey) return json({ error: "AUTH_CONFIGURATION_MISSING" }, 503);

  // This deployed endpoint remains on the legacy Supabase Auth verifier until
  // Stage 2/4 cutover. Never trust a body-supplied user ID.
  let authResponse: Response;
  try {
    authResponse = await fetch(supabaseUrl + "/auth/v1/user", {
      headers: { apikey: publishableKey, Authorization: "Bearer " + bearer },
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    return json({ error: "AUTH_VERIFICATION_UNAVAILABLE" }, 503);
  }
  if (!authResponse.ok) return json({ error: "INVALID_SESSION" }, 401);

  const authUser = await authResponse.json().catch(() => null);
  const userId = typeof authUser?.id === "string" ? authUser.id : "";
  if (!UUID_PATTERN.test(userId)) return json({ error: "INVALID_USER" }, 401);

  const body = await request.json().catch(() => null);
  const publicId = typeof body?.public_id === "string" ? body.public_id.trim() : "";
  if (!publicId) return json({ error: "PUBLIC_ID_REQUIRED" }, 422);
  if (!isOwnedCloudinaryPublicId(publicId, { userId })) {
    return json({ error: "FORBIDDEN_PUBLIC_ID" }, 403);
  }

  const resourceType = typeof body?.resource_type === "string" ? body.resource_type : "image";
  if (!RESOURCE_TYPES.has(resourceType)) return json({ error: "INVALID_RESOURCE_TYPE" }, 400);
  const deliveryType = typeof body?.type === "string" ? body.type : "upload";
  if (deliveryType !== "upload") return json({ error: "INVALID_DELIVERY_TYPE" }, 400);

  let apiKey: string;
  let apiSecret: string;
  let cloudName: string;
  try {
    apiKey = requiredEnv("CLOUDINARY_API_KEY");
    apiSecret = requiredEnv("CLOUDINARY_API_SECRET");
    cloudName = requiredEnv("CLOUDINARY_CLOUD_NAME");
  } catch {
    return json({ error: "CLOUDINARY_DELETE_NOT_CONFIGURED" }, 503);
  }

  const timestamp = String(Math.floor(Date.now() / 1000));
  const params = { public_id: publicId, timestamp, type: deliveryType };
  const signature = await signParams(params, apiSecret);
  const form = new URLSearchParams({
    public_id: publicId,
    timestamp,
    type: deliveryType,
    api_key: apiKey,
    signature,
  });

  let cloudinaryResponse: Response;
  try {
    cloudinaryResponse = await fetch(
      `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/${resourceType}/destroy`,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: form,
        redirect: "error",
        signal: AbortSignal.timeout(8000),
      },
    );
  } catch {
    return json({ error: "CLOUDINARY_DELETE_UNAVAILABLE" }, 502);
  }

  const result = await cloudinaryResponse.json().catch(() => null);
  if (!cloudinaryResponse.ok) return json({ error: "CLOUDINARY_DELETE_FAILED" }, 502);
  return json(result ?? { result: "ok" });
});
