import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { requireBetterAuthUser } from "../_shared/better-auth-user.ts";

const encoder = new TextEncoder();

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

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error("CLOUDINARY_DELETE_NOT_CONFIGURED");
  return value;
}

async function sha1Hex(input: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-1", encoder.encode(input));
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function signParams(params: Record<string, string>, secret: string): Promise<string> {
  const base = Object.entries(params)
    .filter(([, value]) => value !== "")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  return sha1Hex(base + secret);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

  const identity = await requireBetterAuthUser(req);
  if (!identity.ok) return json({ error: identity.error }, identity.status);

  const body = await req.json().catch(() => null) as {
    public_id?: string;
    resource_type?: string;
    type?: string;
  } | null;
  const publicId = body?.public_id?.trim() ?? "";
  if (!publicId) return json({ error: "PUBLIC_ID_REQUIRED" }, 422);

  const owned = new Set([
    `profile_pictures/user_${identity.userId}`,
    `profile_covers/user_${identity.userId}`,
  ]);
  if (!owned.has(publicId)) return json({ error: "FORBIDDEN_PUBLIC_ID" }, 403);

  const resourceType = body?.resource_type ?? "image";
  if (typeof resourceType !== "string" || !["image", "video", "raw"].includes(resourceType)) {
    return json({ error: "INVALID_RESOURCE_TYPE" }, 400);
  }
  const deliveryType = body?.type ?? "upload";
  if (typeof deliveryType !== "string" || deliveryType !== "upload") {
    return json({ error: "INVALID_DELIVERY_TYPE" }, 400);
  }

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
  const form = new URLSearchParams({ ...params, api_key: apiKey, signature });

  try {
    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/${resourceType}/destroy`,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: form,
        redirect: "error",
        signal: AbortSignal.timeout(8000),
      },
    );
    const result = await response.json().catch(() => null);
    if (!response.ok) return json({ error: "CLOUDINARY_DELETE_FAILED" }, 502);
    return json(result ?? { result: "ok" });
  } catch {
    return json({ error: "CLOUDINARY_DELETE_UNAVAILABLE" }, 502);
  }
});
