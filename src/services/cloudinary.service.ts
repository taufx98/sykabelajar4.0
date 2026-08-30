import { supabase } from '@/lib/supabase';
import { env } from '@/lib/env';

// ── Types ──────────────────────────────────────────────────────

export interface CloudinaryUploadResult {
  public_id: string;
  secure_url: string;
  width?: number;
  height?: number;
  version?: number;
  resource_type?: string;
}

export interface UploadImageOptions {
  folder?: string;
  /** When provided, Cloudinary will replace the existing asset at this public_id */
  publicId?: string;
}

// ── Internal helpers ───────────────────────────────────────────

function assertFile(file: File, maxBytes = 10 * 1024 * 1024) {
  if (!file) throw new Error('File wajib dipilih.');
  if (file.size > maxBytes) throw new Error(`Ukuran file maksimal ${Math.round(maxBytes / 1024 / 1024)}MB.`);
}

// ── Unsigned upload (general / canvas / posts) ─────────────────
// Uses the public "sykabelajar_preset" — no server round-trip needed.
// Overwrite=FALSE, Unique Filename=FALSE on the preset side.

/**
 * Direct client-side upload to Cloudinary using the unsigned preset.
 * Use for general files, canvas, posts, documents — NOT for profile/cover.
 */
export async function uploadImage(
  file: File,
  folderOrOptions?: string | UploadImageOptions,
): Promise<CloudinaryUploadResult> {
  if (!file.type.startsWith('image/')) throw new Error('File harus berupa gambar');
  assertFile(file, 5 * 1024 * 1024);

  const opts: UploadImageOptions =
    typeof folderOrOptions === 'string' ? { folder: folderOrOptions } : (folderOrOptions ?? {});

  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', env.cloudinaryUploadPreset); // unsigned preset

  if (opts.publicId) {
    formData.append('public_id', opts.publicId);
  } else if (opts.folder) {
    formData.append('folder', opts.folder);
  }

  const cloudName = env.cloudinaryCloudName;
  const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    throw new Error(`Cloudinary upload gagal (${response.status}): ${errBody}`);
  }
  return response.json() as Promise<CloudinaryUploadResult>;
}

// ── Signed upload (profile / cover) ────────────────────────────
// 1. Call Edge Function → get signature + timestamp + api_key
// 2. Upload to Cloudinary with signed payload + "sykabelajar_profile" preset
// The preset has overwrite=TRUE, so re-uploading replaces the old asset in-place.

/**
 * Upload a profile or cover image via Cloudinary's signed upload.
 *
 * Flow:
 *   1. Fetches a one-time signature from the Supabase Edge Function.
 *   2. Uploads the file to Cloudinary with the "sykabelajar_profile" preset
 *      (overwrite=TRUE, so the old asset is replaced).
 *   3. Returns the Cloudinary response.
 */
export async function uploadProfileImageSigned(
  file: File,
  publicId: string,
): Promise<CloudinaryUploadResult> {
  if (!file.type.startsWith('image/')) throw new Error('File harus berupa gambar');
  assertFile(file, 5 * 1024 * 1024);

  // ── Step 1: Get signature from Edge Function ─────────────────
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;

  if (!token) {
    throw new Error('Anda harus login untuk mengunggah foto profil.');
  }

  const signatureResponse = await fetch(`${env.edgeFunctionUrl}/get-cloudinary-signature`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ public_id: publicId }),
  });

  if (!signatureResponse.ok) {
    const errText = await signatureResponse.text().catch(() => '');
    throw new Error(`Gagal mendapatkan signature upload (${signatureResponse.status}): ${errText}`);
  }

  const signed = await signatureResponse.json();

  // ── Step 2: Upload to Cloudinary with the signed payload ─────
  const formData = new FormData();
  formData.append('file', file);
  formData.append('api_key', signed.api_key);
  formData.append('timestamp', String(signed.timestamp));
  formData.append('signature', signed.signature);
  formData.append('upload_preset', signed.upload_preset);
  formData.append('public_id', signed.public_id);

  const cloudName = signed.cloud_name;
  const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    throw new Error(`Cloudinary signed upload gagal (${response.status}): ${errBody}`);
  }

  return response.json() as Promise<CloudinaryUploadResult>;
}

// ── Raw file upload (unsigned, general documents) ──────────────

export async function uploadRawFile(file: File, folder?: string): Promise<CloudinaryUploadResult> {
  assertFile(file, 10 * 1024 * 1024);
  const cloudName = env.cloudinaryCloudName;
  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', env.cloudinaryUploadPreset);
  if (folder) formData.append('folder', folder);
  const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/raw/upload`, {
    method: 'POST',
    body: formData,
  });
  if (!response.ok) throw new Error(`Cloudinary file upload gagal (${response.status})`);
  return response.json() as Promise<CloudinaryUploadResult>;
}

// ── High-level helpers ─────────────────────────────────────────

/**
 * Upload a profile or cover image for a user.
 * Uses the signed upload path (Edge Function → Cloudinary with overwrite preset).
 * Falls back to creating the public_id from username if no existing ID is provided.
 */
export async function uploadProfileImage(
  file: File,
  kind: 'profile' | 'cover',
  username: string,
  existingPublicId?: string | null,
): Promise<CloudinaryUploadResult> {
  const publicId = existingPublicId || `sykabelajar/${username}/${kind}`;
  return uploadProfileImageSigned(file, publicId);
}

/**
 * Append a cache-busting version query to a Cloudinary URL.
 */
export function versionedCloudinaryUrl(
  url?: string | null,
  version?: string | number | null,
): string | undefined {
  if (!url) return undefined;
  if (!version) return url;
  return `${String(url).split('?')[0]}?v=${encodeURIComponent(String(version))}`;
}

/**
 * Delete an image from Cloudinary via Edge Function.
 */
export async function deleteImage(publicId: string, resourceType = 'image'): Promise<boolean> {
  if (!publicId) return false;
  const { error } = await supabase.functions.invoke('cloudinary-delete-profile', {
    body: { public_id: publicId, resource_type: resourceType },
  });
  if (error) {
    console.warn('[SykaBelajar] Cloudinary delete skipped', error.message);
    return false;
  }
  return true;
}
