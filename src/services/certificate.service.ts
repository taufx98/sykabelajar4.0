import { supabase } from '@/lib/supabase';
import { uploadRawFile, type CloudinaryUploadResult } from '@/services/cloudinary.service';

export async function issueCertificateForAward(awardId: string) {
  const { data, error } = await supabase.rpc('issue_certificate_for_award', { p_award_id: awardId });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

export async function getPublicCertificate(code: string) {
  const { data, error } = await supabase.from('certificate_verifications').select('certificate_id,verification_code,status,public_name,competition_title,achievement_title,issued_at,revoked_at').eq('verification_code', code).maybeSingle();
  if (error) throw error;
  return data;
}

export async function persistCertificateAssetByCode(code: string, file: File, revision = 1): Promise<CloudinaryUploadResult> {
  const verification = await getPublicCertificate(code);
  if (!verification?.certificate_id) throw new Error('Certificate verification code tidak ditemukan.');
  const asset = await uploadRawFile(file, `sykabelajar/certificates/${verification.certificate_id}/rev-${revision}`);
  const { error } = await supabase.rpc('create_certificate_asset', {
    p_certificate_id: verification.certificate_id,
    p_public_id: asset.public_id,
    p_secure_url: asset.secure_url,
    p_width: asset.width ?? null,
    p_height: asset.height ?? null,
    p_version: asset.version ?? null,
    p_resource_type: asset.resource_type ?? 'raw',
    p_asset_kind: 'certificate',
    p_config: { format: file.type || 'application/octet-stream', file_name: file.name },
  });
  if (error) throw error;
  return asset;
}

export async function listCertificateAssets(certificateId: string) {
  const { data, error } = await supabase.from('certificate_assets').select('*').eq('certificate_id', certificateId).order('revision', { ascending: false }).order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}
