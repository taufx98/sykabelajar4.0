import { resolveSupabaseEnvironment } from './supabaseEnvironment.mjs';

function requirePublicEnv(name: string): string {
  const value = import.meta.env[name];
  if (!value || !value.trim()) {
    throw new Error(`[SykaBelajar] Missing required environment variable: ${name}`);
  }
  return value.trim();
}

const runtimeHostname = typeof window !== 'undefined' ? window.location.hostname : '';
const supabaseEnvironment = resolveSupabaseEnvironment(
  runtimeHostname,
  import.meta.env as unknown as Record<string, string | undefined>,
);
const supabaseUrl = supabaseEnvironment.supabaseUrl;

export const env = {
  supabaseUrl,
  supabasePublishableKey: supabaseEnvironment.supabasePublishableKey,
  cloudinaryCloudName: requirePublicEnv('VITE_CLOUDINARY_CLOUD_NAME'),
  /** Unsigned preset for direct client uploads. */
  cloudinaryUploadPreset: requirePublicEnv('VITE_CLOUDINARY_UPLOAD_PRESET'),
  /** Signed-upload preset name used by the profile/cover upload flow. */
  cloudinaryProfilePreset: requirePublicEnv('VITE_CLOUDINARY_PROFILE_PRESET'),
  /** Optional override; otherwise derived from the active Supabase project URL. */
  edgeFunctionUrl: supabaseEnvironment.isBetterAuthStaging
    ? `${supabaseUrl}/functions/v1`
    : import.meta.env.VITE_EDGE_FUNCTION_URL?.trim() || `${supabaseUrl.replace(/\/$/, '')}/functions/v1`,
} as const;
