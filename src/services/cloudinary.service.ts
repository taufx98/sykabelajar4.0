import { supabase } from '@/lib/supabase';
import { env } from '@/lib/env';

// ─── Types ───────────────────────────────────────────────────────────────

export interface CloudinaryUploadResult {
  public_id: string;
  secure_url: string;
  width?: number;
  height?: number;
  version?: number;
  resource_type?: string;
}

interface CloudinarySignedParams {
  signature: string;
  timestamp: number;
  api_key: string;
  cloud_name: string;
  preset: string;
}

export interface UploadImageOptions {
  folder?: string;
  /** When provided, Cloudinary will replace the existing asset at this public_id */
  publicId?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function assertFile(file: File, maxBytes = 10 * 1024 * 1024) {
  if (!file) throw new Error('File wajib dipilih.');
  if (file.size > maxBytes) throw new Error(`Ukuran file maksimal ${Math.round(maxBytes / 1024 / 1024)}MB.`);
}

/** Get upload signature from Supabase Edge Function (for signed/preset uploads). */
async function getCloudinarySignature(publicId: string): Promise<CloudinarySignedParams> {
  const { data, error } = await supabase.functions.invoke('get-cloudinary-signature', {
    body: { public_id: publicId },
  });
  if (error) throw new Error(`Gagal mendapatkan signature upload: ${error.message}`);
  return data as CloudinarySignedParams;
}

// ─── Signed Upload: Profile & Cover (via Edge Function) ──────────────────
// Uses preset "sykabelajar_profile" (Signed, Overwrite=True)
// public_id format: "avatar_{userId}" or "cover_{userId}"

/**
 * Upload profile or cover image using the **signed** Cloudinary preset.
 * The signature is fetched from a Supabase Edge Function so the API secret
 * never leaves the server.  Overwrite is enabled on this preset, so the
 * existing asset is replaced in-place.
 */
export async function uploadProfileImage(
  file: File,
  kind: 'profile' | 'cover',
  userId: string,
): Promise<CloudinaryUploadResult> {
  if (!file.type.startsWith('image/')) throw new Error('File harus berupa gambar');
  assertFile(file, 5 * 1024 * 1024);

  const publicId = kind === 'profile' ? `avatar_${userId}` : `cover_${userId}`;

  // 1. Fetch signed parameters from Edge Function
  const signed = await getCloudinarySignature(publicId);

  // 2. Upload directly to Cloudinary with signature
  const formData = new FormData();
  formData.append('file', file);
  formData.append('public_id', publicId);
  formData.append('timestamp', String(signed.timestamp));
  formData.append('api_key', signed.api_key);
  formData.append('signature', signed.signature);
  formData.append('upload_preset', signed.preset);

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${signed.cloud_name}/image/upload`,
    { method: 'POST', body: formData },
  );

  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    throw new Error(`Cloudinary signed upload gagal (${response.status}): ${errBody}`);
  }

  return response.json() as Promise<CloudinaryUploadResult>;
}

// ─── Unsigned Upload: General / Post / Document (direct from frontend) ───
// Uses preset "sykabelajar_preset" (Unsigned, Overwrite=False)

/**
 * Upload general image (post cover, canvas, etc.) using the **unsigned** Cloudinary preset.
 * Called directly from the frontend — no Edge Function needed.
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
  formData.append('upload_preset', env.cloudinaryUploadPreset); // "sykabelajar_preset" (unsigned)

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

/**
 * Upload raw file (non-image) using the unsigned preset.
 */
export async function uploadRawFile(
  file: File,
  folder?: string,
): Promise<CloudinaryUploadResult> {
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

// ─── Utilities ───────────────────────────────────────────────────────────

export function versionedCloudinaryUrl(
  url?: string | null,
  version?: string | number | null,
): string | undefined {
  if (!url) return undefined;
  if (!version) return url;
  return `${String(url).split('?')[0]}?v=${encodeURIComponent(String(version))}`;
}

export async function deleteImage(
  publicId: string,
  resourceType = 'image',
): Promise<boolean> {
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
