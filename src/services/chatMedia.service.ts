import { env } from '@/lib/env';
import { supabase } from '@/lib/supabase';
import type { CloudinaryUploadResult } from '@/services/cloudinary.service';

const MAX = 2 * 1024 * 1024;
const ALLOWED = new Set(['image/jpeg','image/png','application/pdf']);

export function validateChatFile(file: File) {
  if (file.size > MAX) throw new Error('File chat maksimal 2MB.');
  if (!ALLOWED.has(file.type)) throw new Error('Format chat hanya JPG, PNG, atau PDF.');
}

async function compressImage(file: File): Promise<File> {
  if (file.type === 'application/pdf') return file;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Browser tidak mendukung pemrosesan gambar.');
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob|null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.84));
  if (!blob) throw new Error('Gambar gagal diproses.');
  return new File([blob], `${file.name.replace(/\.[^.]+$/,'')}.jpg`, { type:'image/jpeg', lastModified:Date.now() });
}

export async function uploadChatAttachment(file: File, threadId: string, messageId: string, ownerId: string): Promise<CloudinaryUploadResult & { mime_type:string; size_bytes:number; expires_at:string }> {
  validateChatFile(file);
  const prepared = await compressImage(file);
  if (prepared.size > MAX) throw new Error('Ukuran hasil gambar masih di atas 2MB. Pilih gambar yang lebih kecil.');
  const isPdf = prepared.type === 'application/pdf';
  const form = new FormData();
  form.append('file', prepared);
  form.append('upload_preset', env.cloudinaryUploadPreset);
  form.append('folder', `sykabelajar/chat/${threadId}`);
  const endpoint = `https://api.cloudinary.com/v1_1/${env.cloudinaryCloudName}/${isPdf ? 'raw' : 'image'}/upload`;
  const response = await fetch(endpoint, { method:'POST', body:form });
  if (!response.ok) throw new Error(`Upload chat gagal (${response.status}).`);
  const result = await response.json() as CloudinaryUploadResult;
  const expiresAt = new Date(Date.now()+7*24*60*60*1000).toISOString();
  const { error } = await supabase.from('chat_media').insert({ thread_id:threadId, message_id:messageId, owner_id:ownerId, public_id:result.public_id, secure_url:result.secure_url, resource_type:result.resource_type ?? (isPdf?'raw':'image'), mime_type:prepared.type, size_bytes:prepared.size, expires_at:expiresAt });
  if (error) throw error;
  return { ...result, mime_type:prepared.type, size_bytes:prepared.size, expires_at:expiresAt };
}

export function isImageUrl(text: string) {
  const clean = text.trim().split(/[?#]/)[0].toLowerCase();
  if (clean.endsWith('.gif')) return false;
  return /\.(jpe?g|png|webp|avif)$/i.test(clean);
}

export function isHttpUrl(text: string) {
  try { const u = new URL(text.trim()); return u.protocol === 'http:' || u.protocol === 'https:'; } catch { return false; }
}

export function imageStyle(url: string) {
  if (!isImageUrl(url)) return undefined;
  return { maxWidth:'512px', maxHeight:'512px', width:'auto', height:'auto' } as const;
}
