const TARGET_SUPABASE_URL = 'https://mvdczyitbkxkldjughor.supabase.co';
const LEGACY_SUPABASE_HOST = 'jrfogwueytiddnanetth.supabase.co';

const required = [
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_PUBLISHABLE_KEY',
  'VITE_CLOUDINARY_CLOUD_NAME',
  'VITE_CLOUDINARY_UPLOAD_PRESET',
  'VITE_CLOUDINARY_PROFILE_PRESET',
];

const missing = required.filter((name) => !process.env[name]?.trim());
if (missing.length > 0) {
  console.error(`[SykaBelajar] Missing build environment variable(s): ${missing.join(', ')}`);
  process.exit(1);
}

const supabaseUrl = process.env.VITE_SUPABASE_URL.trim().replace(/\/$/, '');
if (supabaseUrl !== TARGET_SUPABASE_URL) {
  console.error(`[SykaBelajar] BLOCKED: VITE_SUPABASE_URL must target ${TARGET_SUPABASE_URL}.`);
  console.error(`[SykaBelajar] Received: ${supabaseUrl}`);
  process.exit(1);
}

const edgeFunctionUrl = (process.env.VITE_EDGE_FUNCTION_URL ?? '').trim();
if (edgeFunctionUrl.includes(LEGACY_SUPABASE_HOST)) {
  console.error('[SykaBelajar] BLOCKED: VITE_EDGE_FUNCTION_URL still points to the legacy Supabase project.');
  console.error('[SykaBelajar] Remove/update the legacy value before building production.');
  process.exit(1);
}

for (const [name, value] of Object.entries(process.env)) {
  if (name.startsWith('VITE_') && typeof value === 'string' && value.includes(LEGACY_SUPABASE_HOST)) {
    console.error(`[SykaBelajar] BLOCKED: ${name} contains the legacy Supabase hostname.`);
    process.exit(1);
  }
}

console.log(`[SykaBelajar] Build environment verified: ${TARGET_SUPABASE_URL}`);
