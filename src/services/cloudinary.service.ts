import { supabase } from '@/lib/supabase';
import { env } from '@/lib/env';

export interface CloudinaryUploadResult {
  public_id: string;
  secure_url: string;
  width?: number;
  height?: number;
  version?: number;
  resource_type?: string;
}

function assertFile(file: File, maxBytes = 10 * 1024 * 1024) {
  if (!file) throw new Error('File wajib dipilih.');
  if (file.size > maxBytes) throw new Error(`Ukuran file maksimal ${Math.round(maxBytes / 1024 / 1024)}MB.`);
}

export interface UploadImageOptions {
  folder?: string;
  /** When provided, Cloudinary will replace the existing asset at this public_id */
  publicId?: string;
}

/**
 * Upload image to Cloudinary.
 * - If `publicId` is given, the asset is replaced in-place (saves storage).
 * - `folder` is ignored when `publicId` is provided.
 */
export async function uploadImage(file: File, folderOrOptions?: string | UploadImageOptions): Promise<CloudinaryUploadResult> {
  if (!file.type.startsWith('image/')) throw new Error('File harus berupa gambar');
  assertFile(file, 5 * 1024 * 1024);
  const opts: UploadImageOptions = typeof folderOrOptions === 'string' ? { folder: folderOrOptions } : (folderOrOptions ?? {});
  // Direct upload to Cloudinary (no Edge Function needed)
  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', env.cloudinaryUploadPreset);
  if (opts.publicId) {
    // Replace existing asset — pass full path as public_id (no folder param needed)
    formData.append('public_id', opts.publicId);
  } else if (opts.folder) {
    formData.append('folder', opts.folder);
  }
  const cloudName = env.cloudinaryCloudName;
  const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, { method: 'POST', body: formData });
  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    throw new Error(`Cloudinary upload gagal (${response.status}): ${errBody}`);
  }
  return response.json() as Promise<CloudinaryUploadResult>;
}export async function uploadRawFile(file: File, folder?: string): Promise<CloudinaryUploadResult> {
  assertFile(file, 10 * 1024 * 1024);
  const cloudName = env.cloudinaryCloudName;
  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', env.cloudinaryUploadPreset);
  if (folder) formData.append('folder', folder);
  const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/raw/upload`, { method: 'POST', body: formData });
  if (!response.ok) throw new Error(`Cloudinary file upload gagal (${response.status})`);
  return response.json() as Promise<CloudinaryUploadResult>;
}

/**
 * Upload profile/cover image for a user.
 * Uses a single folder per user named after their username.
 * Filenames are fixed (profile / cover) so Cloudinary replaces on re-upload.
 */
export async function uploadProfileImage(file: File, kind: 'profile' | 'cover', username: string, existingPublicId?: string | null): Promise<CloudinaryUploadResult> {
  const publicId = existingPublicId || `sykabelajar/${username}/${kind}`;
  return uploadImage(file, { publicId });
}
export function versionedCloudinaryUrl(url?: string | null, version?: string | number | null): string | undefined { if (!url) return undefined; if (!version) return url; return `${String(url).split('?')[0]}?v=${encodeURIComponent(String(version))}`; }
export async function deleteImage(publicId: string, resourceType = 'image'): Promise<boolean> { if (!publicId) return false; const { error } = await supabase.functions.invoke('cloudinary-delete-profile', { body: { public_id: publicId, resource_type: resourceType } }); if (error) { console.warn('[SykaBelajar] Cloudinary delete skipped', error.message); return false; } return true; }
