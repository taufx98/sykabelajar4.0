import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { requireBetterAuthUser } from "../_shared/better-auth-user.ts";

const encoder = new TextEncoder();
const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, x-client-info, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
  "cache-control": "no-store",
};

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error("SERVER_NOT_CONFIGURED");
  return value;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "content-type": "application/json" },
  });
}

async function sha1Hex(input: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-1", encoder.encode(input));
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

  const identity = await requireBetterAuthUser(req);
  if (!identity.ok) return json({ error: identity.error }, identity.status);

  const body = await req.json().catch(() => null) as {
    public_id?: string;
    resource_type?: string;
  } | null;
  const publicId = body?.public_id?.trim() ?? "";
  const owned = new Set([
    `profile_pictures/user_${identity.userId}`,
    `profile_covers/user_${identity.userId}`,
  ]);
  if (!publicId || !owned.has(publicId)) return json({ error: "FORBIDDEN_PUBLIC_ID" }, 403);

  const resource = body?.resource_type ?? "image";
  if (typeof resource !== "string" || !["image", "video", "raw"].includes(resource)) {
    return json({ error: "INVALID_RESOURCE_TYPE" }, 400);
  }

  try {
    const apiKey = requiredEnv("CLOUDINARY_API_KEY");
    const secret = requiredEnv("CLOUDINARY_API_SECRET");
    const cloudName = requiredEnv("CLOUDINARY_CLOUD_NAME");
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = await sha1Hex(`public_id=${publicId}&timestamp=${timestamp}${secret}`);
    const form = new URLSearchParams({ public_id: publicId, timestamp, api_key: apiKey, signature });

    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/${resource}/destroy`,
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
