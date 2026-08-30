/**
 * Environment configuration for Sykabelajar.id
 *
 * Cloudinary presets (configured in Cloudinary Dashboard):
 *   1. "sykabelajar_profile" — Signed preset for profile/cover images.
 *      Overwrite: TRUE. Signature generated server-side via Edge Function.
 *   2. "sykabelajar_preset" — Unsigned preset for general uploads (posts, docs, etc.)
 *      Overwrite: FALSE. Direct upload from frontend.
 */
const publicConfig = {
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL || 'https://jrfogwueytiddnanetth.supabase.co',
  supabasePublishableKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_H3zjdAEE-ItQ08YRj8MieQ_kNMcsAHa',
  cloudinaryCloudName: import.meta.env.VITE_CLOUDINARY_CLOUD_NAME || 'sykabelajar',
  /** Unsigned preset — general uploads (posts, documents, twibbon, payment proofs) */
  cloudinaryUploadPreset: import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET || 'sykabelajar_preset',
} as const;

export const env = publicConfig;
