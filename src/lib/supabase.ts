import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from './env';

let _client: SupabaseClient | null = null;
const blockedRpcRequests = new Set<string>();
const PERSISTED_BLOCKS_KEY = 'syka.rpc-circuit-breaker.v2';
const PERSISTED_BLOCK_TTL_MS = 24 * 60 * 60 * 1000;

type PersistedBlock = { failedAt: number };
type PersistedBlocks = Record<string, PersistedBlock>;

function loadPersistedBlocks(): PersistedBlocks {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(PERSISTED_BLOCKS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as PersistedBlocks;
    const now = Date.now();
    const valid = Object.fromEntries(Object.entries(parsed).filter(([, value]) => value && now - Number(value.failedAt) < PERSISTED_BLOCK_TTL_MS));
    if (Object.keys(valid).length !== Object.keys(parsed).length) window.localStorage.setItem(PERSISTED_BLOCKS_KEY, JSON.stringify(valid));
    return valid;
  } catch {
    return {};
  }
}

function persistBlockedRequest(key: string) {
  if (typeof window === 'undefined') return;
  try {
    const blocks = loadPersistedBlocks();
    blocks[key] = { failedAt: Date.now() };
    window.localStorage.setItem(PERSISTED_BLOCKS_KEY, JSON.stringify(blocks));
  } catch {
    // Browser storage may be unavailable; in-memory blocking still applies.
  }
}

function isPersistentlyBlocked(key: string) {
  return Boolean(loadPersistedBlocks()[key]);
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

function stableRpcKey(rpcName: string, args: any[]) {
  try {
    return `${rpcName}:${JSON.stringify(args)}`;
  } catch {
    return `${rpcName}:__unserializable__`;
  }
}

function blockedRpcError(rpcName: string) {
  const error = new Error(`Request RPC "${rpcName}" yang sama sebelumnya gagal. Permintaan identik diblokir sampai halaman dimuat ulang atau payload berubah.`);
  (error as Error & { code?: string }).code = 'BACKEND_RPC_BLOCKED';
  return error;
}

function markBlocked(key: string) {
  blockedRpcRequests.add(key);
  persistBlockedRequest(key);
}

function guardedRpc(client: SupabaseClient, rpcName: string, ...args: any[]) {
  const key = stableRpcKey(rpcName, args);
  if (blockedRpcRequests.has(key) || isPersistentlyBlocked(key)) {
    blockedRpcRequests.add(key);
    return Promise.resolve({ data: null, error: blockedRpcError(rpcName) });
  }

  return Promise.resolve((client as any).rpc(rpcName, ...args)).then((result: any) => {
    if (result?.error) markBlocked(key);
    return result;
  }).catch((error: unknown) => {
    markBlocked(key);
    return { data: null, error };
  });
}

export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const client = initClient();
    if (prop === 'rpc') return (rpcName: string, ...args: any[]) => guardedRpc(client, rpcName, ...args);
    const value = (client as any)[prop];
    return typeof value === 'function' ? value.bind(client) : value;
  },
});
