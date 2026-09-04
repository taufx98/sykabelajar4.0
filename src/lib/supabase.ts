import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from './env';

let _client: SupabaseClient | null = null;
const blockedRpcNames = new Set<string>();

function clearStaleAuthStorage() {
  if (typeof window === 'undefined') return;

  const projectPrefix = `sb-${new URL(env.supabaseUrl).hostname.split('.')[0]}-auth-token`;
  for (const storage of [window.localStorage, window.sessionStorage]) {
    try {
      storage.removeItem(projectPrefix);
    } catch {
      // Storage can be unavailable/restricted; Supabase will handle auth state.
    }
  }
}

async function authAwareFetch(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, init);

  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.includes('/auth/v1/token') && response.status === 400) {
    try {
      const body = await response.clone().json() as { error_code?: string };
      if (body.error_code === 'refresh_token_not_found') clearStaleAuthStorage();
    } catch {
      // Keep the original auth response untouched if it is not JSON.
    }
  }

  return response;
}

function initClient(): SupabaseClient {
  if (_client) return _client;

  _client = createClient(env.supabaseUrl, env.supabasePublishableKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
    },
    global: {
      fetch: authAwareFetch,
    },
  });

  return _client;
}

function blockedRpcError(rpcName: string) {
  const error = new Error(`Backend RPC "${rpcName}" sebelumnya gagal. Permintaan berikutnya diblokir sampai halaman dimuat ulang.`);
  (error as Error & { code?: string }).code = 'BACKEND_RPC_BLOCKED';
  return error;
}

function guardedRpc(client: SupabaseClient, rpcName: string, ...args: any[]) {
  if (blockedRpcNames.has(rpcName)) {
    return Promise.resolve({ data: null, error: blockedRpcError(rpcName) });
  }

  return Promise.resolve((client as any).rpc(rpcName, ...args)).then((result: any) => {
    if (result?.error) blockedRpcNames.add(rpcName);
    return result;
  }).catch((error: unknown) => {
    blockedRpcNames.add(rpcName);
    return { data: null, error };
  });
}

// Lazy proxy — always delegates to initialized client.
export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const client = initClient();
    if (prop === 'rpc') return (rpcName: string, ...args: any[]) => guardedRpc(client, rpcName, ...args);
    const value = (client as any)[prop];
    return typeof value === 'function' ? value.bind(client) : value;
  },
});
