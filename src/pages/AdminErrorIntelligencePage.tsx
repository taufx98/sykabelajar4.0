import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Activity,
  AlertTriangle,
  Ban,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Clipboard,
  Clock3,
  Cloud,
  Filter,
  History,
  Monitor,
  Radio,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldAlert,
  X,
} from 'lucide-react';
import { startRpcHealthRealtime, stopRpcHealthRealtime, supabase } from '@/lib/supabase';
import { env } from '@/lib/env';
import { buildAiDebuggingContext } from '@/lib/aiDebuggingContext';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';

type LifecycleStatus = 'new' | 'investigating' | 'resolved' | 'ignored';
type TabKey = LifecycleStatus | 'reopened' | 'all';
type Severity = 'critical' | 'warning' | 'info' | string;

type HealthStatus = 'OPEN' | 'BLOCKED' | 'PROBING' | 'RECOVERY_PENDING' | string;
type HealthValue = {
  status?: HealthStatus;
  backend_version?: number;
  error_code?: string | null;
  error_message?: string | null;
  failed_at?: string | null;
  recovered_at?: string | null;
};
type HealthRow = { key: string; value: HealthValue | null; updated_at?: string };
type Incident = HealthValue & {
  rpcName: string;
  key: string;
  updated_at?: string;
  source: 'rpc';
  id: string;
};

type SystemErrorRow = {
  id: string;
  source: string;
  severity: string;
  error_code: string | null;
  error_message: string;
  context: Record<string, unknown> | null;
  user_id: string | null;
  path: string | null;
  fingerprint: string | null;
  occurred_at: string;
  created_at?: string | null;
  resolved_at: string | null;
  status?: LifecycleStatus | string | null;
  occurrence_count?: number | null;
  first_seen_at?: string | null;
  last_seen_at?: string | null;
  acknowledged_at?: string | null;
  acknowledged_by?: string | null;
  resolved_by?: string | null;
  resolution_note?: string | null;
  reopened_from_id?: string | null;
};

type UnifiedEvent = {
  id: string;
  source: string;
  severity: Severity;
  error_code?: string | null;
  error_message: string;
  path?: string | null;
  occurred_at?: string;
  resolved_at?: string | null;
  rpcName?: string;
  key?: string;
  status?: LifecycleStatus;
  backend_version?: number;
  context?: Record<string, unknown> | null;
  occurrence_count: number;
  first_seen_at: string;
  last_seen_at: string;
  acknowledged_at?: string | null;
  acknowledged_by?: string | null;
  resolved_by?: string | null;
  resolution_note?: string | null;
  reopened_from_id?: string | null;
  user_id?: string | null;
  fingerprint?: string | null;
  isRpc?: boolean;
};

type PendingAction = 'new' | 'investigating' | 'resolved' | 'ignored' | 'reopen';
type DiagnosticResult = {
  checked_at: string;
  status: 'fixed' | 'error';
  title: 'Fixed' | 'Error';
  summary: string;
  method: string;
  target: string;
  duration_ms: number;
  details: Record<string, unknown>;
  admin_diagnostic_mode: true;
};

const RPC_HEALTH_PREFIX = '__rpc_health:';
const RPC_RUNTIME_KEY = '__rpc_backend_runtime';
const SENSITIVE_JSON_KEY = /token|authorization|password|secret|api[_-]?key|cookie|set-cookie/i;

function sourceMeta(source: string) {
  if (source === 'cloudinary') return { label: 'Cloudinary', icon: Cloud };
  if (source === 'realtime') return { label: 'Realtime', icon: Radio };
  if (source === 'frontend') return { label: 'Frontend', icon: Monitor };
  if (source === 'edge_function') return { label: 'Edge Function', icon: AlertTriangle };
  if (source === 'rpc') return { label: 'RPC', icon: ShieldAlert };
  return { label: source.replaceAll('_', ' '), icon: AlertTriangle };
}

function lifecycleMeta(status?: LifecycleStatus | string | null, reopened = false) {
  if (reopened) return { label: 'Kambuh', helper: 'Muncul kembali setelah pernah selesai', icon: RotateCcw, tone: 'text-sky-200 bg-sky-500/10 border-sky-500/20', dot: 'bg-sky-300' };
  if (status === 'investigating') return { label: 'Sedang ditangani', helper: 'Sedang dalam proses perbaikan', icon: Activity, tone: 'text-amber-200 bg-amber-500/10 border-amber-500/20', dot: 'bg-amber-300' };
  if (status === 'resolved') return { label: 'Selesai', helper: 'Tidak perlu tindakan saat ini', icon: CheckCircle2, tone: 'text-emerald-200 bg-emerald-500/10 border-emerald-500/20', dot: 'bg-emerald-300' };
  if (status === 'ignored') return { label: 'Diabaikan', helper: 'Tidak masuk antrean penanganan', icon: Ban, tone: 'text-fg-muted bg-white/[0.03] border-surface-border', dot: 'bg-slate-400' };
  return { label: 'Perlu ditangani', helper: 'Menunggu tindakan admin', icon: CircleDot, tone: 'text-red-200 bg-red-500/10 border-red-500/20', dot: 'bg-red-300' };
}

function severityMeta(severity?: Severity) {
  if (severity === 'critical') return { label: 'Kritis', tone: 'text-red-200 bg-red-500/10 border-red-500/20' };
  if (severity === 'warning') return { label: 'Peringatan', tone: 'text-amber-200 bg-amber-500/10 border-amber-500/20' };
  return { label: 'Info', tone: 'text-fg-muted bg-white/[0.03] border-surface-border' };
}

function normalizeStatus(item: SystemErrorRow): LifecycleStatus {
  if (item.status === 'investigating' || item.status === 'resolved' || item.status === 'ignored' || item.status === 'new') return item.status;
  return item.resolved_at ? 'resolved' : 'new';
}

function formatDate(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
}

function formatRelative(value?: string | null) {
  if (!value) return '—';
  const ms = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 'baru saja';
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return 'baru saja';
  if (minutes < 60) return `${minutes} menit lalu`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} jam lalu`;
  return `${Math.floor(hours / 24)} hari lalu`;
}

function tabLabel(tab: TabKey) {
  if (tab === 'new') return 'Perlu ditangani';
  if (tab === 'investigating') return 'Sedang ditangani';
  if (tab === 'reopened') return 'Kambuh';
  if (tab === 'resolved') return 'Selesai';
  if (tab === 'ignored') return 'Diabaikan';
  return 'Semua';
}

function isActiveRpc(item: Incident) { return item.status !== 'OPEN'; }

function cleanForExport(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[MAX_DEPTH]';
  if (Array.isArray(value)) return value.map((item) => cleanForExport(item, depth + 1));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, SENSITIVE_JSON_KEY.test(key) ? '[REDACTED]' : cleanForExport(item, depth + 1)]));
}

function contextString(context: Record<string, unknown> | null | undefined, keys: string[]) {
  if (!context) return null;
  for (const key of keys) {
    const value = context[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function isHttpHealthy(status: number) {
  return status >= 200 && status < 400;
}

async function probeRealtime(item: UnifiedEvent): Promise<DiagnosticResult> {
  const started = performance.now();
  const originalChannelName = contextString(item.context, ['channel', 'channel_name']) || item.key || `syka-global-rpc-health`;
  const channelName = `syka-admin-diagnostic-${originalChannelName.replace(/[^a-zA-Z0-9:_-]/g, '_')}-${Date.now()}`;
  const table = contextString(item.context, ['table', 'table_name']) || 'global_settings';
  const channel = supabase
    .channel(channelName)
    .on('postgres_changes', { event: '*', schema: 'public', table }, () => undefined);

  const result = await new Promise<{ status: string; error?: string }>((resolve) => {
    let settled = false;
    const finish = (payload: { status: string; error?: string }) => {
      if (settled) return;
      settled = true;
      resolve(payload);
    };
    const timer = window.setTimeout(() => finish({ status: 'TIMED_OUT', error: 'Channel tidak berhasil subscribe dalam batas waktu diagnostic.' }), 6000);
    channel.subscribe((status, error) => {
      if (status === 'SUBSCRIBED') {
        window.clearTimeout(timer);
        finish({ status });
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        window.clearTimeout(timer);
        finish({ status, error: error instanceof Error ? error.message : String(error ?? '') });
      }
    });
  });
  await supabase.removeChannel(channel);
  const duration = Math.round(performance.now() - started);
  const fixed = result.status === 'SUBSCRIBED';
  return {
    checked_at: new Date().toISOString(),
    status: fixed ? 'fixed' : 'error',
    title: fixed ? 'Fixed' : 'Error',
    summary: fixed ? 'Channel Realtime berhasil terhubung kembali.' : 'Channel Realtime masih gagal terhubung.',
    method: 'realtime_channel_subscribe',
    target: originalChannelName,
    duration_ms: duration,
    details: { channel: originalChannelName, diagnostic_channel: channelName, table, subscribe_status: result.status, subscribe_error: result.error || null },
    admin_diagnostic_mode: true,
  };
}

async function probeCloudinary(): Promise<DiagnosticResult> {
  const started = performance.now();
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error('Sesi admin tidak tersedia untuk diagnostic Cloudinary.');
  const publicId = `sykabelajar-admin-diagnostic-${Date.now()}`;
  const response = await fetch(`${env.edgeFunctionUrl}/get-cloudinary-signature`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ public_id: publicId }),
  });
  const bodyText = await response.text();
  const duration = Math.round(performance.now() - started);
  let body: Record<string, unknown> = {};
  try { body = JSON.parse(bodyText) as Record<string, unknown>; } catch {}
  const fixed = response.ok && Boolean(body.signature) && Boolean(body.api_key) && Boolean(body.cloud_name);
  return {
    checked_at: new Date().toISOString(),
    status: fixed ? 'fixed' : 'error',
    title: fixed ? 'Fixed' : 'Error',
    summary: fixed ? 'Signature Cloudinary berhasil dibuat; konfigurasi backend dapat digunakan.' : `Signature Cloudinary masih gagal (${response.status}).`,
    method: 'cloudinary_signature_probe',
    target: 'get-cloudinary-signature',
    duration_ms: duration,
    details: { http_status: response.status, response_ok: response.ok, public_id: publicId, response_keys: Object.keys(body), response_message: typeof body.error === 'string' ? body.error : null },
    admin_diagnostic_mode: true,
  };
}

async function probeEdgeFunction(item: UnifiedEvent): Promise<DiagnosticResult> {
  const started = performance.now();
  const functionName = contextString(item.context, ['functionName', 'function_name', 'function']) || item.error_code || null;
  if (!functionName) throw new Error('Nama Edge Function tidak tersedia pada context incident.');
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  const response = await fetch(`${env.edgeFunctionUrl}/${encodeURIComponent(functionName)}`, { method: 'HEAD', headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const duration = Math.round(performance.now() - started);
  const fixed = isHttpHealthy(response.status) || response.status === 405;
  return {
    checked_at: new Date().toISOString(),
    status: fixed ? 'fixed' : 'error',
    title: fixed ? 'Fixed' : 'Error',
    summary: fixed ? 'Endpoint Edge Function dapat dijangkau dari mode diagnostic admin.' : `Endpoint Edge Function masih mengembalikan HTTP ${response.status}.`,
    method: 'edge_function_reachability_probe',
    target: functionName,
    duration_ms: duration,
    details: { http_status: response.status, response_ok: response.ok, method: 'HEAD' },
    admin_diagnostic_mode: true,
  };
}

async function probeRpc(item: UnifiedEvent): Promise<DiagnosticResult> {
  const started = performance.now();
  const rpcName = item.rpcName || contextString(item.context, ['rpcName', 'rpc_name']);
  if (!rpcName) throw new Error('Nama RPC tidak tersedia pada incident.');
  const { data, error } = await supabase
    .from('global_settings')
    .select('key,value,updated_at')
    .eq('key', `${RPC_HEALTH_PREFIX}${rpcName}`)
    .maybeSingle();
  const duration = Math.round(performance.now() - started);
  const state = (data?.value && typeof data.value === 'object' ? data.value as HealthValue : null);
  const blocked = error || state?.status === 'BLOCKED';
  const fixed = !blocked && (!state || state.status === 'OPEN');
  return {
    checked_at: new Date().toISOString(),
    status: fixed ? 'fixed' : 'error',
    title: fixed ? 'Fixed' : 'Error',
    summary: fixed ? 'Health state RPC menunjukkan backend sudah tidak memblokir request.' : 'Health state RPC masih menunjukkan masalah atau tidak dapat dibaca.',
    method: 'rpc_health_state_probe',
    target: rpcName,
    duration_ms: duration,
    details: { rpc_name: rpcName, health_key_found: Boolean(data), health_status: state?.status ?? null, backend_version: state?.backend_version ?? null, read_error: error?.message ?? null },
    admin_diagnostic_mode: true,
  };
}

async function probeHttp(item: UnifiedEvent): Promise<DiagnosticResult> {
  const started = performance.now();
  const target = item.path || (typeof window !== 'undefined' ? window.location.pathname : '/');
  const url = typeof window !== 'undefined' ? new URL(target, window.location.origin).toString() : target;
  const response = await fetch(url, { method: 'GET', cache: 'no-store', credentials: 'include' });
  const duration = Math.round(performance.now() - started);
  const fixed = isHttpHealthy(response.status);
  return {
    checked_at: new Date().toISOString(),
    status: fixed ? 'fixed' : 'error',
    title: fixed ? 'Fixed' : 'Error',
    summary: fixed ? 'Target dapat dijangkau kembali dari browser admin.' : `Target masih mengembalikan HTTP ${response.status}.`,
    method: 'http_reachability_probe',
    target: url,
    duration_ms: duration,
    details: { http_status: response.status, response_ok: response.ok },
    admin_diagnostic_mode: true,
  };
}

async function runDiagnosticCheck(item: UnifiedEvent): Promise<DiagnosticResult> {
  if (item.source === 'realtime') return probeRealtime(item);
  if (item.source === 'cloudinary') return probeCloudinary();
  if (item.source === 'edge_function') return probeEdgeFunction(item);
  if (item.source === 'rpc') return probeRpc(item);
  return probeHttp(item);
}

function buildTechnicalPayload(item: UnifiedEvent, diagnostic?: DiagnosticResult | null) {
  return {
    schema_version: 'sykabelajar.error-intelligence.v1',
    generated_at: new Date().toISOString(),
    incident: {
      id: item.id,
      lifecycle_status: item.status ?? (item.isRpc ? 'new' : null),
      source: item.source,
      severity: item.severity,
      error_code: item.error_code ?? null,
      error_message: item.error_message,
      fingerprint: item.fingerprint ?? null,
      occurrence_count: item.occurrence_count,
      first_seen_at: item.first_seen_at,
      last_seen_at: item.last_seen_at,
      occurred_at: item.occurred_at ?? item.first_seen_at,
      resolved_at: item.resolved_at ?? null,
      acknowledged_at: item.acknowledged_at ?? null,
      acknowledged_by: item.acknowledged_by ?? null,
      resolved_by: item.resolved_by ?? null,
      resolution_note: item.resolution_note ?? null,
      reopened_from_id: item.reopened_from_id ?? null,
    },
    location: {
      path: item.path ?? null,
      url: typeof window !== 'undefined' ? window.location.href : null,
      referrer: typeof document !== 'undefined' ? document.referrer || null : null,
    },
    target: {
      rpc_name: item.rpcName ?? contextString(item.context, ['rpcName', 'rpc_name']),
      channel: contextString(item.context, ['channel', 'channel_name']),
      function_name: contextString(item.context, ['functionName', 'function_name', 'function']),
      provider: contextString(item.context, ['provider']),
    },
    runtime: {
      backend_version: item.backend_version ?? null,
      online: typeof navigator !== 'undefined' ? navigator.onLine : null,
      user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
      language: typeof navigator !== 'undefined' ? navigator.language : null,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      viewport: typeof window !== 'undefined' ? { width: window.innerWidth, height: window.innerHeight, device_pixel_ratio: window.devicePixelRatio } : null,
    },
    diagnostic: diagnostic ?? null,
    context: cleanForExport(item.context ?? {}),
    admin_diagnostic_mode: true,
    note: 'Diagnostic admin menguji target secara terisolasi tanpa melewati autentikasi atau RLS backend.',
  };
}

export function AdminErrorIntelligencePage() {
  const [rows, setRows] = useState<HealthRow[]>([]);
  const [systemErrors, setSystemErrors] = useState<SystemErrorRow[]>([]);
  const [runtimeVersion, setRuntimeVersion] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [severityFilter, setSeverityFilter] = useState('all');
  const [periodFilter, setPeriodFilter] = useState('all');
  const [tab, setTab] = useState<TabKey>('new');
  const [selected, setSelected] = useState<UnifiedEvent | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [actionNote, setActionNote] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [diagnosticResult, setDiagnosticResult] = useState<DiagnosticResult | null>(null);
  const [diagnosticBusy, setDiagnosticBusy] = useState(false);
  const [diagnosticError, setDiagnosticError] = useState<string | null>(null);
  const [technicalOpen, setTechnicalOpen] = useState(true);
  const [copied, setCopied] = useState(false);
  const [aiCopied, setAiCopied] = useState(false);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = async (background = false) => {
    if (background) setRefreshing(true); else setLoading(true);
    try {
      const [{ data: healthData, error: healthError }, { data: errorData, error: errorLoadError }] = await Promise.all([
        supabase.from('global_settings').select('key,value,updated_at').or(`key.eq.${RPC_RUNTIME_KEY},key.like.${RPC_HEALTH_PREFIX}%`).order('updated_at', { ascending: false }),
        supabase.from('system_error_events').select('id,source,severity,error_code,error_message,context,user_id,path,fingerprint,occurred_at,created_at,resolved_at,status,occurrence_count,first_seen_at,last_seen_at,acknowledged_at,acknowledged_by,resolved_by,resolution_note,reopened_from_id').order('last_seen_at', { ascending: false }).limit(200),
      ]);
      if (healthError) throw healthError;
      if (errorLoadError) throw errorLoadError;
      setRows((healthData ?? []) as HealthRow[]);
      setSystemErrors((errorData ?? []) as SystemErrorRow[]);
      const runtime = (healthData ?? []).find((row) => row.key === RPC_RUNTIME_KEY) as HealthRow | undefined;
      const version = Number(runtime?.value && typeof runtime.value === 'object' ? (runtime.value as { version?: number }).version : NaN);
      setRuntimeVersion(Number.isFinite(version) ? version : null);
    } catch (error) {
      console.error('Error Intelligence load failed', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const scheduleReload = () => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => void load(true), 350);
  };

  useEffect(() => {
    void startRpcHealthRealtime();
    void load();
    const healthChannel = supabase.channel('admin-error-intelligence-health').on('postgres_changes', { event: '*', schema: 'public', table: 'global_settings' }, scheduleReload).subscribe();
    const errorChannel = supabase.channel('admin-error-intelligence-events').on('postgres_changes', { event: '*', schema: 'public', table: 'system_error_events' }, scheduleReload).subscribe();
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      stopRpcHealthRealtime();
      void supabase.removeChannel(healthChannel);
      void supabase.removeChannel(errorChannel);
    };
  }, []);

  const rpcIncidents = useMemo<Incident[]>(() => rows.filter((row) => row.key.startsWith(RPC_HEALTH_PREFIX)).map((row) => ({ id: row.key, rpcName: row.key.slice(RPC_HEALTH_PREFIX.length), key: row.key, source: 'rpc' as const, ...(row.value ?? {}), updated_at: row.updated_at })).sort((a, b) => String(b.failed_at ?? b.updated_at ?? '').localeCompare(String(a.failed_at ?? a.updated_at ?? ''))), [rows]);

  const unifiedEvents = useMemo<UnifiedEvent[]>(() => {
    const rpcEvents: UnifiedEvent[] = rpcIncidents.map((item) => ({
      id: item.id,
      source: 'rpc',
      severity: item.status === 'BLOCKED' ? 'critical' : item.status === 'PROBING' || item.status === 'RECOVERY_PENDING' ? 'warning' : 'info',
      error_code: item.error_code,
      error_message: item.error_message || 'Ada pemeriksaan layanan yang membutuhkan perhatian.',
      occurred_at: item.failed_at ?? item.updated_at ?? new Date(0).toISOString(),
      resolved_at: item.status === 'OPEN' ? item.recovered_at ?? null : null,
      rpcName: item.rpcName,
      key: item.key,
      backend_version: item.backend_version,
      occurrence_count: 1,
      first_seen_at: item.failed_at ?? item.updated_at ?? new Date(0).toISOString(),
      last_seen_at: item.failed_at ?? item.updated_at ?? new Date(0).toISOString(),
      isRpc: true,
    }));
    const external: UnifiedEvent[] = systemErrors.map((item) => ({
      id: item.id,
      source: item.source,
      severity: item.severity,
      error_code: item.error_code,
      error_message: item.error_message,
      path: item.path,
      occurred_at: item.occurred_at,
      resolved_at: item.resolved_at,
      status: normalizeStatus(item),
      context: item.context,
      occurrence_count: Math.max(1, Number(item.occurrence_count ?? 1)),
      first_seen_at: item.first_seen_at ?? item.occurred_at,
      last_seen_at: item.last_seen_at ?? item.occurred_at,
      acknowledged_at: item.acknowledged_at,
      acknowledged_by: item.acknowledged_by,
      resolved_by: item.resolved_by,
      resolution_note: item.resolution_note,
      reopened_from_id: item.reopened_from_id,
      user_id: item.user_id,
      fingerprint: item.fingerprint,
      isRpc: false,
    }));
    return [...external, ...rpcEvents].sort((a, b) => b.last_seen_at.localeCompare(a.last_seen_at));
  }, [rpcIncidents, systemErrors]);

  const counts = useMemo(() => {
    const external = systemErrors.map((item) => ({ status: normalizeStatus(item), reopened: Boolean(item.reopened_from_id) }));
    return {
      newCount: external.filter((item) => item.status === 'new' && !item.reopened).length + rpcIncidents.filter(isActiveRpc).length,
      investigatingCount: external.filter((item) => item.status === 'investigating').length,
      resolvedCount: external.filter((item) => item.status === 'resolved').length,
      reopenedCount: external.filter((item) => item.reopened && item.status !== 'resolved' && item.status !== 'ignored').length,
      ignoredCount: external.filter((item) => item.status === 'ignored').length,
    };
  }, [rpcIncidents, systemErrors]);

  const filtered = useMemo(() => {
    const now = Date.now();
    return unifiedEvents.filter((item) => {
      const reopened = Boolean(item.reopened_from_id);
      const matchesTab = tab === 'all' ? true : tab === 'reopened' ? reopened && !item.isRpc && item.status !== 'resolved' && item.status !== 'ignored' : item.status === tab;
      const matchesSource = sourceFilter === 'all' || item.source === sourceFilter;
      const matchesSeverity = severityFilter === 'all' || item.severity === severityFilter;
      const text = `${item.source} ${item.rpcName ?? ''} ${item.error_code ?? ''} ${item.error_message} ${item.path ?? ''}`.toLowerCase();
      const matchesQuery = text.includes(query.trim().toLowerCase());
      const age = now - new Date(item.last_seen_at).getTime();
      const matchesPeriod = periodFilter === 'all' || (periodFilter === '24h' && age <= 24 * 60 * 60 * 1000) || (periodFilter === '7d' && age <= 7 * 24 * 60 * 60 * 1000) || (periodFilter === '30d' && age <= 30 * 24 * 60 * 60 * 1000);
      return matchesTab && matchesSource && matchesSeverity && matchesQuery && matchesPeriod;
    });
  }, [unifiedEvents, tab, sourceFilter, severityFilter, periodFilter, query]);

  const criticalActiveCount = unifiedEvents.filter((item) => {
    if (item.isRpc) return isActiveRpc(rpcIncidents.find((incident) => incident.id === item.id) ?? { status: 'OPEN' } as Incident);
    return item.severity === 'critical' && item.status !== 'resolved' && item.status !== 'ignored';
  }).length;

  const selectIncident = (item: UnifiedEvent) => {
    setSelected(item);
    setPendingAction(null);
    setActionNote('');
    setActionError(null);
    setDiagnosticResult(null);
    setDiagnosticError(null);
    setCopied(false);
    setAiCopied(false);
    setTechnicalOpen(true);
  };

  const executeStatusUpdate = async (status: LifecycleStatus) => {
    if (!selected || selected.isRpc) return;
    setActionBusy(true);
    setActionError(null);
    const { error } = await supabase.rpc('admin_update_system_error_status', { p_id: selected.id, p_status: status, p_resolution_note: actionNote.trim() || null });
    if (error) {
      setActionError(error.message || 'Perubahan status gagal disimpan.');
      setActionBusy(false);
      return;
    }
    setActionBusy(false);
    setPendingAction(null);
    setActionNote('');
    setSelected(null);
    await load(true);
  };

  const executeReopen = async () => {
    if (!selected || selected.isRpc) return;
    setActionBusy(true);
    setActionError(null);
    const { error } = await supabase.rpc('reopen_system_error_incident', { p_id: selected.id, p_note: actionNote.trim() || null });
    if (error) {
      setActionError(error.message || 'Insiden baru gagal dibuat.');
      setActionBusy(false);
      return;
    }
    setActionBusy(false);
    setPendingAction(null);
    setActionNote('');
    setSelected(null);
    setTab('reopened');
    await load(true);
  };

  const startFix = () => {
    if (!selected || selected.isRpc) return;
    void executeStatusUpdate('investigating');
  };

  const runCheck = async () => {
    if (!selected) return;
    setDiagnosticBusy(true);
    setDiagnosticError(null);
    try {
      const result = await runDiagnosticCheck(selected);
      setDiagnosticResult(result);
      if (result.status === 'error') {
        await supabase.rpc('report_system_error', {
          p_source: selected.source,
          p_error_code: selected.error_code ?? null,
          p_error_message: result.summary,
          p_severity: selected.severity === 'critical' ? 'critical' : 'error',
          p_context: { ...((selected.context ?? {}) as Record<string, unknown>), admin_diagnostic: true, diagnostic: result.details },
          p_path: selected.path ?? null,
          p_fingerprint: selected.fingerprint ?? `${selected.source}|${selected.error_code ?? ''}|${selected.error_message}`.slice(0, 128),
        });
      }
      await load(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setDiagnosticError(message || 'Pengecekan gagal dijalankan.');
      setDiagnosticResult(null);
    } finally {
      setDiagnosticBusy(false);
    }
  };

  const copyTechnicalJson = async () => {
    if (!selected) return;
    const payload = buildTechnicalPayload(selected, diagnosticResult);
    const json = JSON.stringify(payload, null, 2);
    try {
      await navigator.clipboard.writeText(json);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = json;
      textarea.setAttribute('readonly', 'true');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  const copyAiDebuggingContext = async () => {
    if (!selected) return;
    const payload = buildAiDebuggingContext(selected, diagnosticResult);
    const json = JSON.stringify(payload, null, 2);
    try {
      await navigator.clipboard.writeText(json);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = json;
      textarea.setAttribute('readonly', 'true');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    setAiCopied(true);
    window.setTimeout(() => setAiCopied(false), 1600);
  };

  const actionLabel = pendingAction === 'resolved' ? 'Selesaikan incident' : pendingAction === 'ignored' ? 'Abaikan incident' : pendingAction === 'investigating' ? 'Mulai penanganan' : pendingAction === 'new' ? 'Kembalikan ke baru' : 'Konfirmasi';
  const tabs: TabKey[] = ['new', 'investigating', 'reopened', 'resolved', 'ignored', 'all'];
  const tabCounts: Record<TabKey, number> = { new: counts.newCount, investigating: counts.investigatingCount, reopened: counts.reopenedCount, resolved: counts.resolvedCount, ignored: counts.ignoredCount, all: unifiedEvents.length };

  if (loading) return <div className="space-y-4"><div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{[1,2,3,4].map((item) => <div key={item} className="h-28 rounded-2xl surface-elevated animate-pulse" />)}</div><div className="h-20 rounded-2xl surface-elevated animate-pulse" /><div className="h-[28rem] rounded-2xl surface-elevated animate-pulse" /></div>;

  return (
    <div className="space-y-5 pb-8">
      <section className="relative overflow-hidden rounded-3xl border border-surface-border bg-gradient-to-br from-accent/10 via-surface-elevated to-surface-elevated p-5 md:p-6">
        <div className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-accent/10 blur-3xl" />
        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl"><div className="flex items-center gap-2 text-xs font-semibold text-accent"><span className="h-2 w-2 rounded-full bg-emerald-300 shadow-[0_0_0_4px_rgba(110,231,183,0.08)]" /> Pemantauan realtime aktif</div><h2 className="mt-2 text-2xl font-bold tracking-tight text-fg md:text-3xl">Error Intelligence</h2><p className="mt-2 text-sm leading-6 text-fg-muted">Kelola error sebagai incident: lihat yang membutuhkan perhatian, tindak lanjuti, lalu tandai selesai tanpa kehilangan riwayat.</p></div>
          <div className="flex items-center gap-2 text-xs text-fg-muted"><span className="rounded-xl border border-surface-border bg-black/10 px-3 py-2">Runtime v{runtimeVersion ?? '—'}</span><Button variant="ghost" size="sm" onClick={() => void load(true)} icon={<RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />}>Refresh</Button></div>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <KpiCard label="Perlu ditangani" value={counts.newCount} helper="Menunggu tindakan" tone="red" icon={<CircleDot size={18} />} />
        <KpiCard label="Sedang ditangani" value={counts.investigatingCount} helper="Sedang dikerjakan" tone="amber" icon={<Activity size={18} />} />
        <KpiCard label="Selesai" value={counts.resolvedCount} helper="Tersimpan di riwayat" tone="green" icon={<CheckCircle2 size={18} />} />
        <KpiCard label="Kambuh" value={counts.reopenedCount} helper="Muncul kembali" tone="sky" icon={<RotateCcw size={18} />} />
      </div>

      <Card className="overflow-hidden">
        <div className="flex overflow-x-auto border-b surface-border px-2 pt-2 scrollbar-thin">
          {tabs.map((value) => <button key={value} type="button" onClick={() => setTab(value)} className={`group inline-flex shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-xs font-semibold transition md:px-4 ${tab === value ? 'border-accent text-fg' : 'border-transparent text-fg-muted hover:text-fg'}`}>{tabLabel(value)}<span className={`rounded-full px-1.5 py-0.5 text-[10px] ${tab === value ? 'bg-accent-muted-strong text-accent' : 'bg-white/[0.04] text-fg-muted'}`}>{tabCounts[value]}</span></button>)}
        </div>

        <div className="p-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
            <div className="relative min-w-0 flex-1"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" /><input className="input w-full pl-9" placeholder="Cari sumber, kode, pesan, atau halaman..." value={query} onChange={(event) => setQuery(event.target.value)} /></div>
            <div className="flex flex-wrap items-center gap-2"><Filter size={15} className="text-fg-muted" /><select className="input min-w-[9rem]" value={severityFilter} onChange={(event) => setSeverityFilter(event.target.value)}><option value="all">Semua prioritas</option><option value="critical">Kritis</option><option value="warning">Peringatan</option><option value="info">Info</option></select><select className="input min-w-[9rem]" value={periodFilter} onChange={(event) => setPeriodFilter(event.target.value)}><option value="all">Semua waktu</option><option value="24h">24 jam</option><option value="7d">7 hari</option><option value="30d">30 hari</option></select></div>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">{(['all', 'cloudinary', 'realtime', 'frontend', 'edge_function', 'rpc'] as const).map((value) => <button key={value} type="button" onClick={() => setSourceFilter(value)} className={`rounded-xl border px-3 py-1.5 text-[11px] font-semibold transition ${sourceFilter === value ? 'border-accent/20 bg-accent-muted-strong text-accent' : 'border-surface-border text-fg-muted hover:text-fg'}`}>{value === 'all' ? 'Semua sumber' : sourceMeta(value).label}</button>)}</div>
        </div>

        <div className="flex items-center justify-between border-y surface-border bg-black/5 px-4 py-3"><div><p className="text-sm font-semibold text-fg">{tabLabel(tab)}</p><p className="mt-0.5 text-xs text-fg-muted">Satu incident dapat berisi banyak kejadian error yang sama.</p></div><div className="hidden items-center gap-2 text-[11px] text-fg-muted sm:flex"><Clock3 size={13} /> Diperbarui {formatRelative(unifiedEvents[0]?.last_seen_at)}</div></div>
        {!filtered.length ? <EmptyState tab={tab} /> : <div className="divide-y surface-border">{filtered.map((item) => { const reopened = Boolean(item.reopened_from_id); const lifecycle = item.isRpc ? (isActiveRpc(rpcIncidents.find((incident) => incident.id === item.id) ?? ({ status: 'OPEN' } as Incident)) ? lifecycleMeta('new') : lifecycleMeta('resolved')) : lifecycleMeta(item.status, reopened); const severity = severityMeta(item.severity); const meta = sourceMeta(item.source); const Icon = meta.icon; const LifeIcon = lifecycle.icon; return <button key={item.id} type="button" onClick={() => selectIncident(item)} className="group w-full px-4 py-4 text-left transition hover:bg-white/[0.025] focus:outline-none focus-visible:bg-white/[0.04]"><div className="flex gap-3"><span className={`mt-1 h-9 w-1 shrink-0 rounded-full ${lifecycle.dot}`} /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-semibold ${lifecycle.tone}`}><LifeIcon size={11} />{lifecycle.label}</span><span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-semibold ${severity.tone}`}>{severity.label}</span><span className="inline-flex items-center gap-1 rounded-full border border-surface-border px-2 py-1 text-[10px] font-semibold text-fg-muted"><Icon size={11} />{meta.label}</span>{item.error_code && <span className="rounded-full border border-surface-border px-2 py-1 font-mono text-[10px] text-fg-muted">{item.error_code}</span>}{reopened && <span className="rounded-full border border-sky-500/20 bg-sky-500/5 px-2 py-1 text-[10px] font-semibold text-sky-200">Kambuh</span>}</div><div className="mt-2 flex items-start gap-3"><div className="min-w-0 flex-1"><p className="line-clamp-2 text-sm font-semibold leading-5 text-fg">{item.error_message || 'Tidak ada pesan error.'}</p>{item.path && <p className="mt-1 truncate text-xs text-fg-muted">{item.path}</p>}</div><ChevronRight size={17} className="mt-1 shrink-0 text-fg-muted transition group-hover:translate-x-0.5 group-hover:text-fg" /></div><div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-fg-muted"><span className="inline-flex items-center gap-1"><History size={12} /> {item.occurrence_count.toLocaleString('id-ID')} kejadian</span><span>Terakhir {formatDate(item.last_seen_at)}</span><span>Pertama {formatDate(item.first_seen_at)}</span>{item.resolved_at && <span className="text-emerald-300">Selesai {formatDate(item.resolved_at)}</span>}</div></div></div></button>; })}</div>}
      </Card>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]"><Card className="p-4"><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-semibold text-fg">Ringkasan prioritas</p><p className="mt-0.5 text-xs text-fg-muted">Gunakan antrean di atas sebagai sumber utama tindakan.</p></div><span className="rounded-full border border-red-500/20 bg-red-500/5 px-2 py-1 text-[10px] font-semibold text-red-200">{criticalActiveCount} kritis</span></div><div className="mt-4 grid grid-cols-3 gap-3"><MiniMetric label="Perlu ditangani" value={counts.newCount} /><MiniMetric label="Sedang dikerjakan" value={counts.investigatingCount} /><MiniMetric label="Kambuh" value={counts.reopenedCount} /></div></Card><Card className="p-4"><p className="text-sm font-semibold text-fg">Cara kerja</p><div className="mt-3 space-y-3 text-xs leading-5 text-fg-muted"><Step n="1" text="Error masuk sebagai incident baru." /><Step n="2" text="Kejadian berulang dihitung, bukan menambah baris baru." /><Step n="3" text="Admin klik Perbaiki untuk mulai menangani tanpa input tambahan." /><Step n="4" text="Retry/Cek status menjalankan diagnostic admin terhadap target." /><Step n="5" text="Jika muncul lagi setelah selesai, dibuat incident kambuh." /></div></Card></div>

      {selected && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-3 sm:p-5" onClick={() => setSelected(null)}>
          <div className="max-h-[92vh] w-full max-w-5xl overflow-hidden rounded-3xl border border-surface-border bg-surface-elevated shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-4 border-b surface-border p-5 md:p-6">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2"><span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold ${lifecycleMeta(selected.status, Boolean(selected.reopened_from_id)).tone}`}>{(() => { const M = lifecycleMeta(selected.status, Boolean(selected.reopened_from_id)).icon; return <M size={12}/>; })()}{selected.isRpc ? 'Perlu ditangani' : lifecycleMeta(selected.status, Boolean(selected.reopened_from_id)).label}</span><span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${severityMeta(selected.severity).tone}`}>{severityMeta(selected.severity).label}</span><span className="rounded-full border border-surface-border px-2.5 py-1 text-[10px] font-semibold text-fg-muted">{sourceMeta(selected.source).label}</span></div>
                <h3 className="mt-3 break-words text-lg font-bold text-fg md:text-xl">{selected.rpcName ?? selected.error_message ?? 'Incident error'}</h3>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-fg-muted"><span>ID: {selected.id.slice(0, 12)}…</span><span>{formatDate(selected.last_seen_at)}</span></div>
              </div>
              <button type="button" aria-label="Tutup detail incident" onClick={() => setSelected(null)} className="shrink-0 rounded-xl border border-surface-border p-2 text-fg-muted transition hover:bg-white/[0.04] hover:text-fg"><X size={18} /></button>
            </div>

            <div className="max-h-[calc(92vh-108px)] overflow-y-auto p-5 md:p-6">
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_21rem]">
                <div className="space-y-4">
                  <section className="rounded-2xl border border-surface-border bg-black/10 p-4"><div className="flex items-center justify-between gap-3"><p className="text-xs font-semibold text-fg-muted">Pesan error</p><button type="button" className="rounded-lg border border-surface-border p-1.5 text-fg-muted hover:text-fg" title="Salin pesan" onClick={() => void navigator.clipboard.writeText(selected.error_message)}><Clipboard size={14}/></button></div><pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-surface-border bg-black/10 p-3 text-xs leading-5 text-fg-secondary">{selected.error_message || '—'}</pre></section>

                  <section className="grid grid-cols-2 gap-3 sm:grid-cols-4"><InfoTile label="Kejadian" value={selected.occurrence_count.toLocaleString('id-ID')} /><InfoTile label="Pertama terlihat" value={formatDate(selected.first_seen_at)} /><InfoTile label="Terakhir terlihat" value={formatDate(selected.last_seen_at)} /><InfoTile label="Halaman" value={selected.path ?? 'Tidak tersedia'} /></section>

                  <section className="rounded-2xl border border-surface-border bg-black/5 p-4"><div className="flex items-center gap-2"><History size={15} className="text-accent" /><p className="text-sm font-semibold text-fg">Riwayat incident</p></div><div className="mt-4 space-y-0"><TimelineItem title="Pertama terlihat" value={formatDate(selected.first_seen_at)} active />{selected.acknowledged_at && <TimelineItem title="Mulai ditangani" value={formatDate(selected.acknowledged_at)} />}{selected.resolved_at && <TimelineItem title="Ditandai selesai" value={formatDate(selected.resolved_at)} />}{selected.reopened_from_id && <TimelineItem title="Dibuka kembali sebagai incident baru" value="Terhubung dengan incident sebelumnya" last />}{!selected.acknowledged_at && !selected.resolved_at && !selected.reopened_from_id && <p className="text-xs text-fg-muted">Belum ada perubahan lifecycle yang tercatat.</p>}</div></section>

                  {diagnosticResult && <section className={`rounded-2xl border p-4 ${diagnosticResult.status === 'fixed' ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-red-500/20 bg-red-500/5'}`}><div className="flex items-start justify-between gap-3"><div className="flex items-start gap-3"><span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${diagnosticResult.status === 'fixed' ? 'bg-emerald-400/15 text-emerald-300' : 'bg-red-400/15 text-red-300'}`}>{diagnosticResult.status === 'fixed' ? <CheckCircle2 size={17}/> : <AlertTriangle size={17}/>}</span><div><p className={`text-sm font-semibold ${diagnosticResult.status === 'fixed' ? 'text-emerald-200' : 'text-red-200'}`}>Status : {diagnosticResult.title}</p><p className="mt-1 text-xs leading-5 text-fg-muted">{diagnosticResult.summary}</p></div></div><span className="text-[10px] text-fg-muted">{formatDate(diagnosticResult.checked_at)}</span></div><div className="mt-3 grid gap-2 sm:grid-cols-3 text-[11px]"><div className="rounded-xl border border-surface-border bg-black/10 px-3 py-2"><span className="text-fg-muted">Target</span><p className="mt-1 font-medium text-fg truncate" title={diagnosticResult.target}>{diagnosticResult.target}</p></div><div className="rounded-xl border border-surface-border bg-black/10 px-3 py-2"><span className="text-fg-muted">Metode</span><p className="mt-1 font-medium text-fg">{diagnosticResult.method}</p></div><div className="rounded-xl border border-surface-border bg-black/10 px-3 py-2"><span className="text-fg-muted">Durasi</span><p className="mt-1 font-medium text-fg">{diagnosticResult.duration_ms} ms</p></div></div>{diagnosticResult.status === 'error' && <button type="button" onClick={() => void runCheck()} disabled={diagnosticBusy} className="mt-3 inline-flex items-center gap-2 rounded-xl border border-red-500/20 px-3 py-2 text-xs font-semibold text-red-200 hover:bg-red-500/5 disabled:opacity-50"><RefreshCw size={13} className={diagnosticBusy ? 'animate-spin' : ''}/>Coba lagi</button>}</section>}
                  {diagnosticError && <p className="rounded-xl border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-200">{diagnosticError}</p>}

                  {selected.resolution_note && <section className="rounded-2xl border border-emerald-500/15 bg-emerald-500/5 p-4"><p className="text-xs font-semibold text-emerald-200">Catatan penyelesaian</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-fg-secondary">{selected.resolution_note}</p></section>}
                  {selected.reopened_from_id && <section className="rounded-2xl border border-sky-500/15 bg-sky-500/5 p-4"><p className="text-xs font-semibold text-sky-200">Incident ini merupakan kejadian kambuh</p><p className="mt-1 text-xs leading-5 text-fg-muted">Incident sebelumnya tetap disimpan sebagai riwayat. ID internal tidak ditampilkan di antarmuka.</p></section>}

                  <section className="rounded-2xl border border-surface-border bg-black/5 overflow-hidden"><button type="button" onClick={() => setTechnicalOpen((open) => !open)} className="flex w-full items-center justify-between gap-3 p-4 text-left hover:bg-white/[0.02]"><div><p className="text-sm font-semibold text-fg">Detail teknis</p><p className="mt-1 text-xs text-fg-muted">Full Incident Record untuk audit, riwayat, monitoring, dan observability.</p></div><div className="flex items-center gap-2"><button type="button" onClick={(event) => { event.stopPropagation(); void copyTechnicalJson(); }} className="inline-flex items-center gap-2 rounded-xl border border-surface-border px-3 py-2 text-xs font-semibold text-fg-muted hover:bg-white/[0.04] hover:text-fg"><Clipboard size={14}/>{copied ? 'Copied!' : 'Copy Full JSON'}</button><ChevronRight size={17} className={`text-fg-muted transition ${technicalOpen ? 'rotate-90' : ''}`} /></div></button>{technicalOpen && <div className="border-t surface-border p-3 md:p-4"><pre className="max-h-[28rem] overflow-auto rounded-xl border border-surface-border bg-[#07111f] p-4 font-mono text-[11px] leading-5 text-sky-100">{JSON.stringify(buildTechnicalPayload(selected, diagnosticResult), null, 2)}</pre><p className="mt-2 text-[10px] text-fg-muted">Credential fields sensitif otomatis disamarkan.</p></div>}</section>

                  <section className="rounded-2xl border border-accent/20 bg-accent/5 overflow-hidden"><div className="flex items-center justify-between gap-3 p-4"><div><p className="text-sm font-semibold text-fg">AI Debugging Context</p><p className="mt-1 text-xs leading-5 text-fg-muted">Payload terpisah untuk AI/coding agent: fokus pada fakta diagnostik, evidence terverifikasi, target investigasi, dan success criteria.</p></div><button type="button" onClick={() => void copyAiDebuggingContext()} className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-accent/30 bg-accent/10 px-3 py-2 text-xs font-semibold text-accent hover:bg-accent/15"><Clipboard size={14}/>{aiCopied ? 'Copied!' : 'Copy AI JSON'}</button></div><div className="border-t border-accent/10 p-3 md:p-4"><pre className="max-h-[30rem] overflow-auto rounded-xl border border-surface-border bg-[#07111f] p-4 font-mono text-[11px] leading-5 text-sky-100">{JSON.stringify(buildAiDebuggingContext(selected, diagnosticResult), null, 2)}</pre><p className="mt-2 text-[10px] leading-4 text-fg-muted">Metadata lifecycle, fingerprint, user agent, viewport, dan identitas admin tidak dikirim ke AI kecuali dibutuhkan secara diagnostik.</p></div></section>
                </div>

                <aside className="space-y-3">
                  <section className="rounded-2xl border border-surface-border bg-black/10 p-4"><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-semibold text-fg">Tindakan</p><p className="mt-1 text-xs text-fg-muted">Perbaiki atau jalankan pengecekan ulang langsung.</p></div></div><div className="mt-3 space-y-2">{selected.isRpc ? <div className="rounded-xl border border-surface-border bg-white/[0.02] p-3 text-xs leading-5 text-fg-muted">Status RPC dipantau otomatis; gunakan <strong className="text-fg">Retry / Cek status</strong> untuk diagnostic admin.</div> : <>{(selected.status === 'new' || selected.status === undefined) && <Button className="w-full justify-center" onClick={startFix} disabled={actionBusy} icon={<Activity size={14} />}>{actionBusy ? 'Memulai...' : 'Perbaiki'}</Button>}{selected.status === 'investigating' && <Button className="w-full justify-center" onClick={() => void executeStatusUpdate('resolved')} disabled={actionBusy} icon={<CheckCircle2 size={14} />}>{actionBusy ? 'Menyimpan...' : 'Tandai selesai'}</Button>}{(selected.status === 'investigating' || selected.status === 'new') && <Button variant="ghost" className="w-full justify-center" onClick={() => void executeStatusUpdate('ignored')} disabled={actionBusy} icon={<Ban size={14} />}>Abaikan</Button>}{selected.status === 'resolved' && <Button className="w-full justify-center" onClick={() => { setActionNote(''); setActionError(null); setPendingAction('reopen'); }} icon={<RotateCcw size={14} />}>Buka lagi sebagai incident baru</Button>}{selected.status === 'ignored' && <Button variant="ghost" className="w-full justify-center" onClick={() => void executeStatusUpdate('new')} disabled={actionBusy} icon={<CircleDot size={14} />}>Kembalikan ke perlu ditangani</Button>}{selected.status === 'investigating' && <Button variant="ghost" className="w-full justify-center" onClick={() => void executeStatusUpdate('new')} disabled={actionBusy} icon={<RotateCcw size={14} />}>Kembalikan ke baru</Button>}</>}</div>{actionError && <p className="mt-2 rounded-xl border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-200">{actionError}</p>}</section>

                  <section className="rounded-2xl border border-accent/20 bg-accent/5 p-4"><div className="flex items-start gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent"><RefreshCw size={17} className={diagnosticBusy ? 'animate-spin' : ''}/></span><div className="min-w-0"><p className="text-sm font-semibold text-fg">Retry / Cek status</p><p className="mt-1 text-xs leading-5 text-fg-muted">Tes target langsung dari browser admin dengan diagnostic terisolasi. Endpoint sensitif tetap mengikuti autentikasi dan RLS.</p></div></div><Button className="mt-3 w-full justify-center" onClick={() => void runCheck()} disabled={diagnosticBusy} icon={<RefreshCw size={14} className={diagnosticBusy ? 'animate-spin' : ''} />}>{diagnosticBusy ? 'Mengecek target...' : 'Retry / Cek status'}</Button><p className="mt-2 text-[10px] leading-4 text-fg-muted">Diagnostic tidak menjalankan operasi mutasi pengguna.</p></section>

                  <section className="rounded-2xl border border-surface-border bg-black/10 p-4"><p className="text-xs font-semibold text-fg-muted">Ringkasan</p><div className="mt-3 space-y-3"><InfoLine label="Sumber" value={sourceMeta(selected.source).label} /><InfoLine label="Prioritas" value={severityMeta(selected.severity).label} /><InfoLine label="Kejadian" value={`${selected.occurrence_count.toLocaleString('id-ID')} kali`} /><InfoLine label="Terakhir" value={formatRelative(selected.last_seen_at)} />{selected.resolved_at && <InfoLine label="Selesai" value={formatDate(selected.resolved_at)} />}</div></section>
                </aside>
              </div>

              {pendingAction && !selected.isRpc && <section className="mt-4 rounded-2xl border border-accent/20 bg-accent/5 p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold text-fg">{actionLabel}</p><p className="mt-1 text-xs leading-5 text-fg-muted">Catatan hanya digunakan untuk tindakan lifecycle seperti selesai atau abaikan.</p></div><button type="button" onClick={() => setPendingAction(null)} className="rounded-lg p-1.5 text-fg-muted hover:text-fg"><X size={15}/></button></div><textarea className="input mt-3 min-h-24 w-full resize-y" placeholder="Catatan penanganan (opsional)..." value={actionNote} onChange={(event) => setActionNote(event.target.value)} /><div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button variant="ghost" onClick={() => setPendingAction(null)} disabled={actionBusy}>Batal</Button><Button onClick={() => pendingAction === 'reopen' ? void executeReopen() : void executeStatusUpdate(pendingAction as LifecycleStatus)} disabled={actionBusy}>{actionBusy ? 'Menyimpan...' : 'Konfirmasi'}</Button></div></section>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function KpiCard({ label, value, helper, icon, tone }: { label: string; value: number; helper: string; icon: ReactNode; tone: 'red' | 'amber' | 'green' | 'sky' }) {
  const toneMap = { red: 'border-red-500/15 bg-red-500/5 text-red-200', amber: 'border-amber-500/15 bg-amber-500/5 text-amber-200', green: 'border-emerald-500/15 bg-emerald-500/5 text-emerald-200', sky: 'border-sky-500/15 bg-sky-500/5 text-sky-200' };
  return <Card className={`relative overflow-hidden border ${toneMap[tone]} p-4`}><div className="absolute right-3 top-3 opacity-70">{icon}</div><p className="text-xs font-semibold text-fg-muted">{label}</p><p className="mt-2 text-3xl font-bold tracking-tight text-fg">{value.toLocaleString('id-ID')}</p><p className="mt-1 text-[11px] text-fg-muted">{helper}</p></Card>;
}

function MiniMetric({ label, value }: { label: string; value: number }) { return <div className="rounded-xl border border-surface-border bg-black/10 p-3"><p className="text-[11px] text-fg-muted">{label}</p><p className="mt-1 text-lg font-bold text-fg">{value.toLocaleString('id-ID')}</p></div>; }
function Step({ n, text }: { n: string; text: string }) { return <div className="flex gap-2.5"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-muted-strong text-[10px] font-bold text-accent">{n}</span><span>{text}</span></div>; }
function EmptyState({ tab }: { tab: TabKey }) { const calm = tab === 'new' || tab === 'investigating' || tab === 'reopened'; return <div className="p-12 text-center"><div className={`mx-auto flex h-12 w-12 items-center justify-center rounded-2xl ${calm ? 'bg-emerald-500/10 text-emerald-300' : 'bg-white/[0.04] text-fg-muted'}`}><CheckCircle2 size={24} /></div><p className="mt-3 text-sm font-semibold text-fg">{calm ? 'Tidak ada incident yang membutuhkan perhatian.' : 'Belum ada incident di sini.'}</p><p className="mt-1 text-xs text-fg-muted">Pemantauan realtime tetap aktif dan perubahan baru akan muncul otomatis.</p></div>; }
function InfoTile({ label, value }: { label: string; value: string }) { return <div className="min-w-0 rounded-xl border border-surface-border bg-black/10 p-3"><p className="text-[10px] font-semibold uppercase tracking-wide text-fg-muted">{label}</p><p className="mt-1 truncate text-xs font-semibold text-fg" title={value}>{value}</p></div>; }
function InfoLine({ label, value }: { label: string; value: string }) { return <div className="flex items-start justify-between gap-3 text-xs"><span className="text-fg-muted">{label}</span><span className="text-right font-semibold text-fg">{value}</span></div>; }
function TimelineItem({ title, value, active = false, last = false }: { title: string; value: string; active?: boolean; last?: boolean }) { return <div className="relative flex gap-3 pb-4 last:pb-0"><div className="relative flex w-4 shrink-0 justify-center"><span className={`mt-1.5 h-2 w-2 rounded-full ${active ? 'bg-accent' : 'bg-fg-muted'}`} />{!last && <span className="absolute left-1/2 top-4 h-full w-px -translate-x-1/2 bg-surface-border" />}</div><div><p className="text-xs font-semibold text-fg">{title}</p><p className="mt-0.5 text-[11px] text-fg-muted">{value}</p></div></div>; }
