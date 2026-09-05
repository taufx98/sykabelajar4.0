import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from './env';

let _client: SupabaseClient | null = null;

const RPC_RETRY_DELAY_MS = 250;

type RpcErrorWithCode = Error & { code?: string; details?: string; hint?: string };

function clearRpcCircuitBreakerStorage() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem('syka.rpc-circuit-breaker.v2');
  } catch {
    // Browser storage may be unavailable.
  }
}

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

function normalizeRpcError(error: unknown): RpcErrorWithCode {
  if (error instanceof Error) return error as RpcErrorWithCode;
  return new Error(typeof error === 'string' ? error : 'Request RPC gagal.') as RpcErrorWithCode;
}

function isRetryableRpcError(error: unknown) {
  const normalized = normalizeRpcError(error);
  const code = String(normalized.code ?? '');
  const message = normalized.message.toLowerCase();

  return code === 'BACKEND_RPC_BLOCKED'
    || message.includes('permintaan identik diblokir')
    || message.includes('failed to fetch')
    || message.includes('network request failed');
}

async function callRpcWithRecovery(client: SupabaseClient, rpcName: string, ...args: any[]) {
  clearRpcCircuitBreakerStorage();

  let result: any;
  try {
    result = await (client as any).rpc(rpcName, ...args);
  } catch (error) {
    result = { data: null, error };
  }

  if (!result?.error) return result;
  if (!isRetryableRpcError(result.error)) return result;

  // A previous frontend circuit-breaker entry can be stale after a backend/RPC
  // change. Give the backend one fresh attempt without requiring a page reload.
  if (typeof window !== 'undefined') {
    await new Promise((resolve) => window.setTimeout(resolve, RPC_RETRY_DELAY_MS));
  }

  try {
    return await (client as any).rpc(rpcName, ...args);
  } catch (error) {
    return { data: null, error };
  }
}

export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const client = initClient();
    if (prop === 'rpc') {
      return (rpcName: string, ...args: any[]) => callRpcWithRecovery(client, rpcName, ...args);
    }
    const value = (client as any)[prop];
    return typeof value === 'function' ? value.bind(client) : value;
  },
});
