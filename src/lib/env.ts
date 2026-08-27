const publicConfig = {
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL || 'https://jrfogwueytiddnanetth.supabase.co',
  supabasePublishableKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_H3zjdAEE-ItQ08YRj8MieQ_kNMcsAHa',
  cloudinaryCloudName: import.meta.env.VITE_CLOUDINARY_CLOUD_NAME || 'sykabelajar',
  cloudinaryUploadPreset: import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET || 'sykabelajar_preset',
} as const;

export const env = publicConfig;
