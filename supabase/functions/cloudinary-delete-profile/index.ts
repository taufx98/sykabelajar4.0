import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { requireApplicationUser } from "../_shared/require-application-user.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
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

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

  const identity = await requireApplicationUser(request);
  if (!identity.ok) return json({ error: identity.error }, identity.status);

  const userId = identity.userId;
  if (!UUID_PATTERN.test(userId)) return json({ error: "INVALID_USER" }, 401);

  const body = await request.json().catch(() => null) as {
    public_id?: unknown;
    resource_type?: unknown;
  } | null;

  const publicId = typeof body?.public_id === "string" ? body.public_id.trim() : "";
  if (!publicId) return json({ error: "PUBLIC_ID_REQUIRED" }, 422);

  // Only exact legacy profile/cover IDs are deletable here. Never accept a
  // body-supplied owner UUID or arbitrary Cloudinary folder.
  const allowedPublicIds = new Set([
    `profile_pictures/user_${userId}`,
    `profile_covers/user_${userId}`,
  ]);
  if (!allowedPublicIds.has(publicId)) return json({ error: "FORBIDDEN_PUBLIC_ID" }, 403);

  const resourceType = typeof body?.resource_type === "string" ? body.resource_type : "image";
  if (resourceType !== "image") return json({ error: "INVALID_RESOURCE_TYPE" }, 400);

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
  const signature = await sha1Hex(`public_id=${publicId}&timestamp=${timestamp}${apiSecret}`);
  const form = new URLSearchParams({
    public_id: publicId,
    timestamp,
    api_key: apiKey,
    signature,
  });

  let providerResponse: Response;
  try {
    providerResponse = await fetch(
      `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/destroy`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form,
        redirect: "error",
        signal: AbortSignal.timeout(8000),
      },
    );
  } catch {
    return json({ error: "CLOUDINARY_DELETE_UNAVAILABLE" }, 502);
  }

  const result = await providerResponse.json().catch(() => null);
  if (!providerResponse.ok) return json({ error: "CLOUDINARY_DELETE_FAILED" }, 502);
  return json(result ?? { result: "ok" });
});
