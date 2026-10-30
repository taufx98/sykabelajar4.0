import { supabase } from '@/lib/supabase';
import { env } from '@/lib/env';
import { reportSystemError } from '@/lib/errorIntelligence';

export interface CloudinaryUploadResult { public_id: string; secure_url: string; width?: number; height?: number; version?: number; resource_type?: string; }
export interface UploadImageOptions { folder?: string; publicId?: string; }

function assertFile(file: File, maxBytes = 10 * 1024 * 1024) { if (!file) throw new Error('File wajib dipilih.'); if (file.size > maxBytes) throw new Error(`Ukuran file maksimal ${Math.round(maxBytes / 1024 / 1024)}MB.`); }
async function readFailure(response: Response) { const body = await response.text().catch(() => ''); return new Error(`Cloudinary upload gagal (${response.status}): ${body}`); }
function reportUploadError(source: 'cloudinary' | 'edge_function', error: unknown, context: Record<string, unknown>) { reportSystemError({ source, error, severity: 'error', context }); }

export async function uploadImage(file: File, folderOrOptions?: string | UploadImageOptions): Promise<CloudinaryUploadResult> {
  if (!file.type.startsWith('image/')) throw new Error('File harus berupa gambar'); assertFile(file, 5 * 1024 * 1024);
  const opts = typeof folderOrOptions === 'string' ? { folder: folderOrOptions } : (folderOrOptions ?? {});
  const formData = new FormData(); formData.append('file', file); formData.append('upload_preset', env.cloudinaryUploadPreset);
  if (opts.publicId) formData.append('public_id', opts.publicId); else if (opts.folder) formData.append('folder', opts.folder);
  try { const response = await fetch(`https://api.cloudinary.com/v1_1/${env.cloudinaryCloudName}/image/upload`, { method: 'POST', body: formData }); if (!response.ok) throw await readFailure(response); return response.json() as Promise<CloudinaryUploadResult>; }
  catch (error) { reportUploadError('cloudinary', error, { operation: 'unsigned_image_upload', file_type: file.type, file_size: file.size }); throw error; }
}

export async function uploadPaymentProof(file: File): Promise<CloudinaryUploadResult> { if (!file.type.startsWith('image/')) throw new Error('Bukti pembayaran harus berupa gambar.'); return uploadImage(file, { folder: 'sykabelajar/payment-proofs' }); }

export async function uploadProfileImageSigned(file: File, publicId: string): Promise<CloudinaryUploadResult> {
  if (!file.type.startsWith('image/')) throw new Error('File harus berupa gambar'); assertFile(file, 5 * 1024 * 1024);
  try {
    const { data: sessionData } = await supabase.auth.getSession(); const token = sessionData?.session?.access_token;
    if (!token) throw new Error('Anda harus login untuk mengunggah foto profil.');
    const signatureResponse = await fetch(`${env.edgeFunctionUrl}/get-cloudinary-signature`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ public_id: publicId }) });
    if (!signatureResponse.ok) { const errText = await signatureResponse.text().catch(() => ''); const error = new Error(`Gagal mendapatkan signature upload (${signatureResponse.status}): ${errText}`); reportUploadError('edge_function', error, { function: 'get-cloudinary-signature', status: signatureResponse.status }); throw error; }
    const signed = await signatureResponse.json();
    if (!signed?.api_key || !signed?.cloud_name || !signed?.signature || !signed?.timestamp) { const error = new Error('Respons signature Cloudinary tidak lengkap.'); reportUploadError('edge_function', error, { function: 'get-cloudinary-signature', invalid_response: true }); throw error; }
    const formData = new FormData(); formData.append('file', file); formData.append('api_key', signed.api_key); formData.append('timestamp', String(signed.timestamp)); formData.append('signature', signed.signature); formData.append('upload_preset', signed.upload_preset); formData.append('public_id', signed.public_id);
    const response = await fetch(`https://api.cloudinary.com/v1_1/${signed.cloud_name}/image/upload`, { method: 'POST', body: formData });
    if (!response.ok) { const body = await response.text().catch(() => ''); const error = new Error(`Cloudinary signed upload gagal (${response.status}): ${body}`); reportUploadError('cloudinary', error, { operation: 'signed_profile_upload', status: response.status, public_id: publicId, cloud_name: signed.cloud_name }); throw error; }
    return response.json() as Promise<CloudinaryUploadResult>;
  } catch (error) { reportUploadError('cloudinary', error, { operation: 'signed_profile_upload', public_id: publicId }); throw error; }
}

export async function uploadRawFile(file: File, folder?: string): Promise<CloudinaryUploadResult> {
  assertFile(file, 10 * 1024 * 1024); const formData = new FormData(); formData.append('file', file); formData.append('upload_preset', env.cloudinaryUploadPreset); if (folder) formData.append('folder', folder);
  try { const response = await fetch(`https://api.cloudinary.com/v1_1/${env.cloudinaryCloudName}/raw/upload`, { method: 'POST', body: formData }); if (!response.ok) throw await readFailure(response); return response.json() as Promise<CloudinaryUploadResult>; }
  catch (error) { reportUploadError('cloudinary', error, { operation: 'raw_upload', file_size: file.size }); throw error; }
}

export async function uploadProfileImage(file: File, kind: 'profile' | 'cover', username: string, existingPublicId?: string | null): Promise<CloudinaryUploadResult> { return uploadProfileImageSigned(file, existingPublicId || `sykabelajar/${username}/${kind}`); }

function optimizeCloudinaryResourceUrl(url: string | null | undefined, resourceType: 'image' | 'video', width?: number, version?: string | number | null): string | undefined {
  if (!url) return undefined;

  const value = String(url);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return value;
  }

  if (!parsed.hostname.toLowerCase().endsWith('.cloudinary.com')) return value;

  const marker = `/${resourceType}/upload/`;
  const markerIndex = parsed.pathname.indexOf(marker);
  if (markerIndex < 0) return value;

  const normalizedWidth = Number.isFinite(width) && Number(width) > 0
    ? Math.round(Number(width))
    : undefined;
  const suffix = parsed.pathname.slice(markerIndex + marker.length);
  const segments = suffix.split('/');
  const firstSegment = segments[0] ?? '';
  const firstSegmentTokens = firstSegment.split(',');
  const isExistingTransformation = firstSegmentTokens.length > 0
    && firstSegmentTokens.every((token) => /^(?:a|b|c|d|e|f|g|h|l|o|p|q|r|s|t|u|w|x|ar|bg|bo|br|cs|dpr|du|fl|fn|if|ki|pg|so|sp|vc)_[^,]+$/i.test(token));

  if (isExistingTransformation) {
    const tokens = firstSegmentTokens.filter((token) => !normalizedWidth || !/^w_/i.test(token));
    if (!tokens.some((token) => /^f_/i.test(token))) tokens.unshift('f_auto');
    if (!tokens.some((token) => /^q_/i.test(token))) tokens.push('q_auto');
    if (normalizedWidth) tokens.push(`w_${normalizedWidth}`);
    segments[0] = tokens.join(',');
  } else {
    segments.unshift([
      'f_auto',
      'q_auto',
      ...(normalizedWidth ? [`w_${normalizedWidth}`] : []),
    ].join(','));
  }

  parsed.pathname = `${parsed.pathname.slice(0, markerIndex + marker.length)}${segments.join('/')}`;
  if (version != null && String(version)) parsed.searchParams.set('v', String(version));
  return parsed.toString();
}

export function optimizedCloudinaryUrl(url?: string | null, options: { width?: number; version?: string | number | null } = {}): string | undefined {
  return optimizeCloudinaryResourceUrl(url, 'image', options.width, options.version);
}

export function optimizedCloudinaryVideoUrl(url?: string | null, options: { width?: number } = {}): string | undefined {
  return optimizeCloudinaryResourceUrl(url, 'video', options.width);
}

export function versionedCloudinaryUrl(url?: string | null, version?: string | number | null): string | undefined {
  return optimizedCloudinaryUrl(url, { version });
}
export async function deleteImage(publicId: string, resourceType = 'image'): Promise<boolean> { if (!publicId) return false; const { error } = await supabase.functions.invoke('cloudinary-delete-profile', { body: { public_id: publicId, resource_type: resourceType } }); if (error) { reportUploadError('edge_function', error, { function: 'cloudinary-delete-profile' }); return false; } return true; }
