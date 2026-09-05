import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from './env';

let _client: SupabaseClient | null = null;
let rpcHealthReady: Promise<void> | null = null;
let rpcHealthChannel: ReturnType<SupabaseClient['channel']> | null = null;

const RPC_HEALTH_PREFIX = '__rpc_health:';
const RPC_RUNTIME_KEY = '__rpc_backend_runtime';
const RPC_HEALTH_STORAGE_KEY = 'syka.rpc-health.v3';

type RpcHealthStatus = 'OPEN' | 'BLOCKED' | 'PROBING' | 'RECOVERY_PENDING';
type RpcHealthState = {
  status: RpcHealthStatus;
  backend_version: number;
  error_code?: string | null;
  error_message?: string | null;
  failed_at?: string | null;
};
type RpcHealthCache = Record<string, RpcHealthState>;
type RpcErrorWithCode = Error & { code?: string; status?: number; details?: string; hint?: string };

let runtimeVersion = 1;
const rpcHealthCache: RpcHealthCache = {};
const probeOwners = new Set<string>();
const probeClaimsInFlight = new Map<string, Promise<boolean>>();
const failureReportsInFlight = new Set<string>();

function clearLegacyCircuitBreakerStorage() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem('syka.rpc-circuit-breaker.v2');
    window.localStorage.removeItem(RPC_HEALTH_STORAGE_KEY);
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

function isGlobalServerError(error: unknown) {
  const normalized = normalizeRpcError(error);
  const code = String(normalized.code ?? '');
  const status = Number(normalized.status ?? 0);

  if (status >= 500) return true;
  return /^(08|42|53|54|57|58|XX)/.test(code);
}

function blockedRpcError(rpcName: string, state?: RpcHealthState) {
  const suffix = state?.error_code || state?.error_message
    ? ` Error terakhir: ${state.error_code ?? 'SERVER_ERROR'}${state.error_message ? ` — ${state.error_message}` : ''}`
    : '';
  const error = new Error(
    `Fitur "${rpcName}" sementara ditahan karena backend mengalami error. Request tidak dikirim ulang agar tidak membebani backend.${suffix}`
  ) as RpcErrorWithCode;
  error.code = 'BACKEND_RPC_BLOCKED';
  return error;
}

function applyHealthRow(key: string, value: unknown) {
  if (key === RPC_RUNTIME_KEY) {
    const next = Number((value as { version?: number } | null)?.version ?? runtimeVersion);
    if (Number.isFinite(next) && next > runtimeVersion) {
      runtimeVersion = next;
      for (const [rpcName, state] of Object.entries(rpcHealthCache)) {
        if (state.status === 'BLOCKED' && state.backend_version < runtimeVersion) {
          rpcHealthCache[rpcName] = { ...state, status: 'RECOVERY_PENDING' };
        }
      }
    }
    return;
  }

  if (!key.startsWith(RPC_HEALTH_PREFIX)) return;
  const rpcName = key.slice(RPC_HEALTH_PREFIX.length);
  if (!rpcName || !value || typeof value !== 'object') return;
  const row = value as Partial<RpcHealthState>;
  const backendVersion = Number(row.backend_version ?? runtimeVersion);
  rpcHealthCache[rpcName] = {
    status: (row.status as RpcHealthStatus) ?? 'OPEN',
    backend_version: Number.isFinite(backendVersion) ? backendVersion : runtimeVersion,
    error_code: row.error_code ?? null,
    error_message: row.error_message ?? null,
    failed_at: row.failed_at ?? null,
  };

  if (rpcHealthCache[rpcName].status === 'OPEN') {
    probeOwners.delete(rpcName);
    probeClaimsInFlight.delete(rpcName);
  }
}

async function initializeRpcHealthInternal() {
  const client = initClient();
  clearLegacyCircuitBreakerStorage();

  const { data, error } = await client
    .from('global_settings')
    .select('key,value')
    .or(`key.eq.${RPC_RUNTIME_KEY},key.like.${RPC_HEALTH_PREFIX}%`);

  if (!error) {
    for (const row of data ?? []) applyHealthRow(row.key, row.value);
  }

  if (!rpcHealthChannel) {
    rpcHealthChannel = client
      .channel('syka-global-rpc-health')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'global_settings' }, (payload) => {
        const row = (payload.new ?? payload.old) as { key?: string; value?: unknown } | undefined;
        if (row?.key) applyHealthRow(row.key, row.value);
      })
      .subscribe();
  }
}

export function initializeRpcHealth() {
  if (!rpcHealthReady) {
    rpcHealthReady = initializeRpcHealthInternal().catch(() => {
      // Health control must never prevent normal app startup.
    });
  }
  return rpcHealthReady;
}

async function reportRpcFailure(client: SupabaseClient, rpcName: string, error: unknown) {
  if (failureReportsInFlight.has(rpcName)) return;
  failureReportsInFlight.add(rpcName);

  const normalized = normalizeRpcError(error);
  try {
    const existing = rpcHealthCache[rpcName];
    if (existing?.status === 'BLOCKED' && existing.backend_version === runtimeVersion) return;

    const result = await (client as any).rpc('report_rpc_failure', {
      p_rpc_name: rpcName,
      p_error_code: normalized.code ?? null,
      p_error_message: normalized.message ?? null,
    });

    if (!result?.error && result?.data) applyHealthRow(`${RPC_HEALTH_PREFIX}${rpcName}`, result.data);
  } finally {
    failureReportsInFlight.delete(rpcName);
  }
}

async function claimRecovery(client: SupabaseClient, rpcName: string) {
  if (probeOwners.has(rpcName)) return true;
  if (probeClaimsInFlight.has(rpcName)) return probeClaimsInFlight.get(rpcName) as Promise<boolean>;

  const request = (async () => {
    try {
      const result = await (client as any).rpc('claim_rpc_recovery', { p_rpc_name: rpcName });
      const claimed = Boolean(result?.data) && !result?.error;
      if (claimed) probeOwners.add(rpcName);
      return claimed;
    } catch {
      return false;
    } finally {
      probeClaimsInFlight.delete(rpcName);
    }
  })();

  probeClaimsInFlight.set(rpcName, request);
  return request;
}

async function markRpcHealthy(client: SupabaseClient, rpcName: string) {
  try {
    await (client as any).rpc('mark_rpc_healthy', { p_rpc_name: rpcName });
  } finally {
    probeOwners.delete(rpcName);
  }
}

async function callRpcWithSmartCircuitBreaker(client: SupabaseClient, rpcName: string, ...args: any[]) {
  await initializeRpcHealth();

  const state = rpcHealthCache[rpcName];
  if (state?.status === 'BLOCKED' && state.backend_version >= runtimeVersion) {
    return { data: null, error: blockedRpcError(rpcName, state) };
  }

  let probing = probeOwners.has(rpcName);
  if (state?.status === 'RECOVERY_PENDING' || (state?.status === 'BLOCKED' && state.backend_version < runtimeVersion)) {
    const claimed = await claimRecovery(client, rpcName);
    if (!claimed && !probeOwners.has(rpcName)) {
      return { data: null, error: blockedRpcError(rpcName, state) };
    }
    probing = true;
  } else if (state?.status === 'PROBING' && !probeOwners.has(rpcName)) {
    return { data: null, error: blockedRpcError(rpcName, state) };
  }

  let result: any;
  try {
    result = await (client as any).rpc(rpcName, ...args);
  } catch (error) {
    result = { data: null, error };
  }

  if (!result?.error) {
    if (probing) {
      await markRpcHealthy(client, rpcName);
      applyHealthRow(`${RPC_HEALTH_PREFIX}${rpcName}`, { status: 'OPEN', backend_version: runtimeVersion });
    }
    return result;
  }

  if (isGlobalServerError(result.error)) {
    const normalized = normalizeRpcError(result.error);
    rpcHealthCache[rpcName] = {
      status: 'BLOCKED',
      backend_version: runtimeVersion,
      error_code: normalized.code ?? null,
      error_message: normalized.message ?? null,
      failed_at: new Date().toISOString(),
    };
    await reportRpcFailure(client, rpcName, result.error);
    probeOwners.delete(rpcName);
    return result;
  }

  if (probing) {
    await markRpcHealthy(client, rpcName);
    applyHealthRow(`${RPC_HEALTH_PREFIX}${rpcName}`, { status: 'OPEN', backend_version: runtimeVersion });
  }

  return result;
}

export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const client = initClient();
    if (prop === 'rpc') {
      return (rpcName: string, ...args: any[]) => callRpcWithSmartCircuitBreaker(client, rpcName, ...args);
    }
    const value = (client as any)[prop];
    return typeof value === 'function' ? value.bind(client) : value;
  },
});
