const PRODUCTION_SUPABASE_URL = 'https://jrfogwueytiddnanetth.supabase.co';
const PRODUCTION_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_H3zjdAEE-ItQ08YRj8MieQ_kNMcsAHa';

function requirePublicEnv(name: string, fallback?: string): string {
  const value = import.meta.env[name]?.trim() || fallback;
  if (!value) {
    throw new Error(`[SykaBelajar] Missing required environment variable: ${name}`);
  }
  return value;
}

// Production must always point to the active SYKABELAJAR 4.0 Supabase project.
// This prevents a stale CI/Vercel environment from silently connecting the app
// to the retired project and bypassing the current chat/spam database logic.
const configuredSupabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const useProductionBackend = !configuredSupabaseUrl || configuredSupabaseUrl !== PRODUCTION_SUPABASE_URL;
const supabaseUrl = useProductionBackend ? PRODUCTION_SUPABASE_URL : configuredSupabaseUrl;
const supabasePublishableKey = useProductionBackend
  ? PRODUCTION_SUPABASE_PUBLISHABLE_KEY
  : requirePublicEnv('VITE_SUPABASE_PUBLISHABLE_KEY', PRODUCTION_SUPABASE_PUBLISHABLE_KEY);

export const env = {
  supabaseUrl,
  supabasePublishableKey,
  cloudinaryCloudName: requirePublicEnv('VITE_CLOUDINARY_CLOUD_NAME'),
  /** Unsigned preset for direct client uploads. */
  cloudinaryUploadPreset: requirePublicEnv('VITE_CLOUDINARY_UPLOAD_PRESET'),
  /** Signed-upload preset name used by the profile/cover upload flow. */
  cloudinaryProfilePreset: requirePublicEnv('VITE_CLOUDINARY_PROFILE_PRESET'),
  /** Optional override; otherwise derived from the active Supabase project URL. */
  edgeFunctionUrl:
    import.meta.env.VITE_EDGE_FUNCTION_URL?.trim() || `${supabaseUrl.replace(/\/$/, '')}/functions/v1`,
} as const;
