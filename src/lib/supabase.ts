import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// These MUST match your Supabase project settings
const SUPABASE_URL = 'https://jrfogwueytiddnanetth.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_H3zjdAEE-ItQ08YRj8MieQ_kNMcsAHa';

let _client: SupabaseClient | null = null;

function initClient(): SupabaseClient {
  if (_client) return _client;

  console.log('[SykaBelajar] Initializing Supabase client...');
  console.log('[SykaBelajar] URL:', SUPABASE_URL);
  console.log('[SykaBelajar] Key length:', SUPABASE_ANON_KEY?.length || 0);

  _client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
    },
  });

  return _client;
}

// Lazy proxy — always delegates to initialized client
export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop, _receiver) {
    const client = initClient();
    const value = (client as any)[prop];
    if (typeof value === 'function') {
      return value.bind(client);
    }
    return value;
  },
});
