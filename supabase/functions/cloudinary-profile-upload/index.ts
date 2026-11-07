import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { requireBetterAuthUser } from "../_shared/better-auth-user.ts";

const encoder = new TextEncoder();

async function sha256Hex(input: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(input));
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error("SERVER_NOT_CONFIGURED");
  return value;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

  const identity = await requireBetterAuthUser(req);
  if (!identity.ok) return json({ error: identity.error }, identity.status);

  try {
    const cloudName = requiredEnv("CLOUDINARY_CLOUD_NAME");
    const apiKey = requiredEnv("CLOUDINARY_API_KEY");
    const apiSecret = requiredEnv("CLOUDINARY_API_SECRET");

    const body = await req.formData();
    const file = body.get("file");
    const kind = String(body.get("kind") ?? "profile");

    if (!(file instanceof File)) return json({ error: "IMAGE_FILE_REQUIRED" }, 400);
    if (!file.type.startsWith("image/")) return json({ error: "IMAGE_FILE_REQUIRED" }, 415);
    if (file.size > 5 * 1024 * 1024) return json({ error: "IMAGE_TOO_LARGE" }, 413);
    if (kind !== "profile" && kind !== "cover") return json({ error: "INVALID_IMAGE_KIND" }, 400);

    // Identity comes only from the cryptographically verified Better Auth JWT.
    const publicId = kind === "profile"
      ? `profile_pictures/user_${identity.userId}`
      : `profile_covers/user_${identity.userId}`;
    const timestamp = Math.floor(Date.now() / 1000);
    const transformation = kind === "profile"
      ? "c_fill,g_face,w_400,h_400"
      : "c_fill,g_auto,w_1600,h_600";
    const signaturePayload =
      `folder=sykabelajar/users&invalidate=true&overwrite=true&public_id=${publicId}&timestamp=${timestamp}&transformation=${transformation}${apiSecret}`;
    const signature = await sha256Hex(signaturePayload);

    const uploadData = new FormData();
    uploadData.append("file", file, file.name);
    uploadData.append("api_key", apiKey);
    uploadData.append("timestamp", String(timestamp));
    uploadData.append("public_id", publicId);
    uploadData.append("overwrite", "true");
    uploadData.append("invalidate", "true");
    uploadData.append("transformation", transformation);
    uploadData.append("signature", signature);

    const cloudinaryResponse = await fetch(
      `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/upload`,
      { method: "POST", body: uploadData, redirect: "error", signal: AbortSignal.timeout(15000) },
    );
    const result = await cloudinaryResponse.json().catch(() => null);
    if (!cloudinaryResponse.ok || !result) return json({ error: "CLOUDINARY_UPLOAD_FAILED" }, 502);

    return json({
      public_id: result.public_id,
      secure_url: result.secure_url,
      width: result.width,
      height: result.height,
      version: result.version,
      resource_type: result.resource_type,
      asset_id: result.asset_id,
      user_id: identity.userId,
      kind,
    });
  } catch {
    return json({ error: "CLOUDINARY_UPLOAD_FAILED" }, 502);
  }
});
