const publicConfig = {
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL || 'https://jrfogwueytiddnanetth.supabase.co',
  supabasePublishableKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_H3zjdAEE-ItQ08YRj8MieQ_kNMcsAHa',
  cloudinaryCloudName: import.meta.env.VITE_CLOUDINARY_CLOUD_NAME || 'sykabelajar',
  /** Unsigned preset — direct client upload for general files, canvas, posts */
  cloudinaryUploadPreset: import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET || 'sykabelajar_preset',
  /** Signed preset — server-side upload for profile & cover images (overwrite=TRUE) */
  cloudinaryProfilePreset: import.meta.env.VITE_CLOUDINARY_PROFILE_PRESET || 'sykabelajar_profile',
  /** Edge Function base URL (for signed upload signatures) */
  edgeFunctionUrl: import.meta.env.VITE_EDGE_FUNCTION_URL || 'https://jrfogwueytiddnanetth.supabase.co/functions/v1',
} as const;

export const env = publicConfig;
