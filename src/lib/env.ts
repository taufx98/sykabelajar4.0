function requirePublicEnv(name: string): string {
  const value = import.meta.env[name];
  if (!value || !value.trim()) {
    throw new Error(`[SykaBelajar] Missing required environment variable: ${name}`);
  }
  return value.trim();
}

const supabaseUrl = requirePublicEnv('VITE_SUPABASE_URL');

export const env = {
  supabaseUrl,
  supabasePublishableKey: requirePublicEnv('VITE_SUPABASE_PUBLISHABLE_KEY'),
  cloudinaryCloudName: requirePublicEnv('VITE_CLOUDINARY_CLOUD_NAME'),
  /** Unsigned preset for direct client uploads. */
  cloudinaryUploadPreset: requirePublicEnv('VITE_CLOUDINARY_UPLOAD_PRESET'),
  /** Signed-upload preset name used by the profile/cover upload flow. */
  cloudinaryProfilePreset: requirePublicEnv('VITE_CLOUDINARY_PROFILE_PRESET'),
  /** Optional override; otherwise derived from the Supabase project URL. */
  edgeFunctionUrl:
    import.meta.env.VITE_EDGE_FUNCTION_URL?.trim() || `${supabaseUrl.replace(/\/$/, '')}/functions/v1`,
} as const;
