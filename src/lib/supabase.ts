import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from './env';
import { reportSystemError } from './errorIntelligence';

let _client: SupabaseClient | null = null;
let rpcHealthReady: Promise<void> | null = null;
let rpcHealthChannel: ReturnType<SupabaseClient['channel']> | null = null;
let rpcHealthReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let rpcHealthFallbackTimer: ReturnType<typeof setInterval> | null = null;
let rpcHealthRealtimeActive = false;
let rpcHealthReconnectAttempt = 0;
let rpcHealthConsecutiveFailures = 0;
let rpcHealthLastErrorAt = 0;

const RPC_HEALTH_PREFIX = '__rpc_health:';
const RPC_RUNTIME_KEY = '__rpc_backend_runtime';
const ERROR_REPORT_RPC = 'report_system_error';
const RPC_HEALTH_CHANNEL = 'syka-global-rpc-health';
const RPC_HEALTH_RECONNECT_BASE_MS = 2000;
const RPC_HEALTH_RECONNECT_MAX_MS = 30000;
const RPC_HEALTH_FALLBACK_INTERVAL_MS = 60000;
const RPC_HEALTH_ERROR_REPORT_COOLDOWN_MS = 30000;
const RPC_HEALTH_WARNING_AFTER_FAILURES = 2;

type RpcHealthStatus = 'OPEN' | 'BLOCKED' | 'PROBING' | 'RECOVERY_PENDING';
type RpcHealthState = { status: RpcHealthStatus; backend_version: number; error_code?: string | null; error_message?: string | null; failed_at?: string | null };
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
    window.localStorage.removeItem('syka.rpc-health.v3');
  } catch {}
}

function clearStaleAuthStorage() {
  if (typeof window === 'undefined') return;
  const projectPrefix = `sb-${new URL(env.supabaseUrl).hostname.split('.')[0]}-auth-token`;
  for (const storage of [window.localStorage, window.sessionStorage]) {
    try { storage.removeItem(projectPrefix); } catch {}
  }
}

async function authAwareFetch(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, init);
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.includes('/auth/v1/token') && response.status === 400) {
    try {
      const body = await response.clone().json() as { error_code?: string };
      if (body.error_code === 'refresh_token_not_found') clearStaleAuthStorage();
    } catch {}
  }
  return response;
}

function initClient(): SupabaseClient {
  if (_client) return _client;
  _client = createClient(env.supabaseUrl, env.supabasePublishableKey, {
    auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true },
    global: { fetch: authAwareFetch },
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
  return status >= 500 || /^(08|42|53|54|57|58|XX)/.test(code);
}

function isPermanentRealtimeFailure(error?: unknown) {
  const normalized = normalizeRpcError(error);
  const text = `${normalized.message} ${normalized.code ?? ''} ${normalized.status ?? ''} ${normalized.details ?? ''} ${normalized.hint ?? ''}`.toLowerCase();
  return /\b(401|403)\b|unauthorized|forbidden|not authorized|invalid (jwt|token|key)|jwt.*(expired|invalid)|access denied/.test(text);
}

function blockedRpcError(rpcName: string, state?: RpcHealthState) {
  const suffix = state?.error_code || state?.error_message ? ` Error terakhir: ${state.error_code ?? 'SERVER_ERROR'}${state.error_message ? ` — ${state.error_message}` : ''}` : '';
  const error = new Error(`Fitur "${rpcName}" sementara ditahan karena backend mengalami error. Request tidak dikirim ulang agar tidak membebani backend.${suffix}`) as RpcErrorWithCode;
  error.code = 'BACKEND_RPC_BLOCKED';
  return error;
}

function applyHealthRow(key: string, value: unknown) {
  if (key === RPC_RUNTIME_KEY) {
    const next = Number((value as { version?: number } | null)?.version ?? runtimeVersion);
    if (Number.isFinite(next) && next > runtimeVersion) {
      runtimeVersion = next;
      for (const [rpcName, state] of Object.entries(rpcHealthCache)) if (state.status === 'BLOCKED' && state.backend_version < runtimeVersion) rpcHealthCache[rpcName] = { ...state, status: 'RECOVERY_PENDING' };
    }
    return;
  }
  if (!key.startsWith(RPC_HEALTH_PREFIX) || !value || typeof value !== 'object') return;
  const rpcName = key.slice(RPC_HEALTH_PREFIX.length);
  const row = value as Partial<RpcHealthState>;
  const backendVersion = Number(row.backend_version ?? runtimeVersion);
  rpcHealthCache[rpcName] = { status: (row.status as RpcHealthStatus) ?? 'OPEN', backend_version: Number.isFinite(backendVersion) ? backendVersion : runtimeVersion, error_code: row.error_code ?? null, error_message: row.error_message ?? null, failed_at: row.failed_at ?? null };
  if (rpcHealthCache[rpcName].status === 'OPEN') { probeOwners.delete(rpcName); probeClaimsInFlight.delete(rpcName); }
}

async function refreshRpcHealthSnapshot() {
  try {
    const client = initClient();
    const { data, error } = await client.from('global_settings').select('key,value').or(`key.eq.${RPC_RUNTIME_KEY},key.like.${RPC_HEALTH_PREFIX}%`);
    if (!error) for (const row of data ?? []) applyHealthRow(row.key, row.value);
  } catch {
    // Realtime and the periodic snapshot are both best-effort observability paths.
  }
}

function clearRpcHealthReconnectTimer() {
  if (rpcHealthReconnectTimer) {
    clearTimeout(rpcHealthReconnectTimer);
    rpcHealthReconnectTimer = null;
  }
}

function scheduleRpcHealthReconnect() {
  if (!rpcHealthRealtimeActive || rpcHealthReconnectTimer) return;
  const exponentialDelay = Math.min(RPC_HEALTH_RECONNECT_MAX_MS, RPC_HEALTH_RECONNECT_BASE_MS * 2 ** rpcHealthReconnectAttempt);
  const jitter = Math.floor(Math.random() * RPC_HEALTH_RECONNECT_BASE_MS);
  const delay = Math.min(RPC_HEALTH_RECONNECT_MAX_MS, exponentialDelay + jitter);
  rpcHealthReconnectAttempt = Math.min(rpcHealthReconnectAttempt + 1, 5);
  rpcHealthReconnectTimer = setTimeout(() => {
    rpcHealthReconnectTimer = null;
    if (rpcHealthRealtimeActive) subscribeRpcHealthChannel();
  }, delay);
}

function handleRpcHealthChannelFailure(status: string, error?: unknown) {
  if (isPermanentRealtimeFailure(error)) {
    rpcHealthConsecutiveFailures = 0;
    return;
  }

  rpcHealthConsecutiveFailures += 1;
  scheduleRpcHealthReconnect();
  if (rpcHealthConsecutiveFailures < RPC_HEALTH_WARNING_AFTER_FAILURES) return;

  const now = Date.now();
  if (now - rpcHealthLastErrorAt < RPC_HEALTH_ERROR_REPORT_COOLDOWN_MS) return;
  rpcHealthLastErrorAt = now;
  reportSystemError({
    source: 'realtime',
    error: new Error(`RPC health realtime subscription ${status}`),
    severity: 'warning',
    context: { channel: RPC_HEALTH_CHANNEL, status, consecutive_failures: rpcHealthConsecutiveFailures },
  });
}

function subscribeRpcHealthChannel() {
  if (!rpcHealthRealtimeActive) return;
  const client = initClient();
  if (rpcHealthChannel) return;

  rpcHealthChannel = client
    .channel(RPC_HEALTH_CHANNEL)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'global_settings' }, (payload) => {
      const row = (payload.new ?? payload.old) as { key?: string; value?: unknown } | undefined;
      if (row?.key) applyHealthRow(row.key, row.value);
    })
    .subscribe((status, error) => {
      if (status === 'SUBSCRIBED') {
        rpcHealthReconnectAttempt = 0;
        rpcHealthConsecutiveFailures = 0;
        return;
      }

      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        const channel = rpcHealthChannel;
        rpcHealthChannel = null;
        if (channel) void client.removeChannel(channel);
        handleRpcHealthChannelFailure(status, error);
        return;
      }

      if (status === 'CLOSED') {
        const channel = rpcHealthChannel;
        rpcHealthChannel = null;
        if (channel) void client.removeChannel(channel);
        if (!isPermanentRealtimeFailure(error)) scheduleRpcHealthReconnect();
      }
    });
}

function startRpcHealthFallback() {
  if (!rpcHealthRealtimeActive || rpcHealthFallbackTimer) return;
  rpcHealthFallbackTimer = setInterval(() => {
    if (rpcHealthRealtimeActive) void refreshRpcHealthSnapshot();
  }, RPC_HEALTH_FALLBACK_INTERVAL_MS);
}

function stopRpcHealthFallback() {
  if (rpcHealthFallbackTimer) {
    clearInterval(rpcHealthFallbackTimer);
    rpcHealthFallbackTimer = null;
  }
}

async function initializeRpcHealthInternal() {
  clearLegacyCircuitBreakerStorage();
  await refreshRpcHealthSnapshot();
}

export function initializeRpcHealth() {
  if (!rpcHealthReady) rpcHealthReady = initializeRpcHealthInternal().catch(() => {});
  return rpcHealthReady;
}

export function startRpcHealthRealtime() {
  if (rpcHealthRealtimeActive) return initializeRpcHealth();
  rpcHealthRealtimeActive = true;
  void initializeRpcHealth().then(() => {
    if (!rpcHealthRealtimeActive) return;
    subscribeRpcHealthChannel();
    startRpcHealthFallback();
  });
  return rpcHealthReady;
}

export function stopRpcHealthRealtime() {
  rpcHealthRealtimeActive = false;
  clearRpcHealthReconnectTimer();
  stopRpcHealthFallback();
  const channel = rpcHealthChannel;
  rpcHealthChannel = null;
  if (channel) void initClient().removeChannel(channel);
  rpcHealthReconnectAttempt = 0;
  rpcHealthConsecutiveFailures = 0;
}

async function reportRpcFailure(client: SupabaseClient, rpcName: string, error: unknown) {
  if (failureReportsInFlight.has(rpcName)) return;
  failureReportsInFlight.add(rpcName);
  const normalized = normalizeRpcError(error);
  if (rpcName !== ERROR_REPORT_RPC) reportSystemError({ source: 'rpc', error: normalized, severity: isGlobalServerError(normalized) ? 'critical' : 'error', context: { rpc_name: rpcName } });
  try {
    const existing = rpcHealthCache[rpcName];
    if (existing?.status === 'BLOCKED' && existing.backend_version === runtimeVersion) return;
    const result = await (client as any).rpc('report_rpc_failure', { p_rpc_name: rpcName, p_error_code: normalized.code ?? null, p_error_message: normalized.message ?? null });
    if (!result?.error && result?.data) applyHealthRow(`${RPC_HEALTH_PREFIX}${rpcName}`, result.data);
  } finally { failureReportsInFlight.delete(rpcName); }
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
    } catch { return false; } finally { probeClaimsInFlight.delete(rpcName); }
  })();
  probeClaimsInFlight.set(rpcName, request);
  return request;
}

async function markRpcHealthy(client: SupabaseClient, rpcName: string) {
  try { await (client as any).rpc('mark_rpc_healthy', { p_rpc_name: rpcName }); } finally { probeOwners.delete(rpcName); }
}

async function callRpcWithSmartCircuitBreaker(client: SupabaseClient, rpcName: string, ...args: any[]) {
  await initializeRpcHealth();
  const state = rpcHealthCache[rpcName];
  if (state?.status === 'BLOCKED' && state.backend_version >= runtimeVersion) return { data: null, error: blockedRpcError(rpcName, state) };
  let probing = probeOwners.has(rpcName);
  if (state?.status === 'RECOVERY_PENDING' || (state?.status === 'BLOCKED' && state.backend_version < runtimeVersion)) {
    const claimed = await claimRecovery(client, rpcName);
    if (!claimed && !probeOwners.has(rpcName)) return { data: null, error: blockedRpcError(rpcName, state) };
    probing = true;
  } else if (state?.status === 'PROBING' && !probeOwners.has(rpcName)) return { data: null, error: blockedRpcError(rpcName, state) };

  let result: any;
  try { result = await (client as any).rpc(rpcName, ...args); } catch (error) { result = { data: null, error }; }
  if (!result?.error) {
    if (probing) { await markRpcHealthy(client, rpcName); applyHealthRow(`${RPC_HEALTH_PREFIX}${rpcName}`, { status: 'OPEN', backend_version: runtimeVersion }); }
    return result;
  }
  if (rpcName !== ERROR_REPORT_RPC) reportSystemError({ source: 'rpc', error: result.error, severity: isGlobalServerError(result.error) ? 'critical' : 'error', context: { rpc_name: rpcName } });
  if (isGlobalServerError(result.error)) {
    const normalized = normalizeRpcError(result.error);
    rpcHealthCache[rpcName] = { status: 'BLOCKED', backend_version: runtimeVersion, error_code: normalized.code ?? null, error_message: normalized.message ?? null, failed_at: new Date().toISOString() };
    await reportRpcFailure(client, rpcName, result.error);
    probeOwners.delete(rpcName);
    return result;
  }
  if (probing) { await markRpcHealthy(client, rpcName); applyHealthRow(`${RPC_HEALTH_PREFIX}${rpcName}`, { status: 'OPEN', backend_version: runtimeVersion }); }
  return result;
}

export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const client = initClient();
    if (prop === 'rpc') return (rpcName: string, ...args: any[]) => callRpcWithSmartCircuitBreaker(client, rpcName, ...args);
    const value = (client as any)[prop];
    return typeof value === 'function' ? value.bind(client) : value;
  },
});
