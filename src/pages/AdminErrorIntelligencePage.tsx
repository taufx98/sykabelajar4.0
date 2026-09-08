import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Clock3, RefreshCw, Search, ShieldAlert, X, AlertTriangle, Cloud, Radio, Monitor } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';

type HealthStatus = 'OPEN' | 'BLOCKED' | 'PROBING' | 'RECOVERY_PENDING' | string;
type HealthValue = { status?: HealthStatus; backend_version?: number; error_code?: string | null; error_message?: string | null; failed_at?: string | null; recovered_at?: string | null };
type HealthRow = { key: string; value: HealthValue | null; updated_at?: string };
type Incident = HealthValue & { rpcName: string; key: string; updated_at?: string; source: 'rpc'; id: string };
type SystemErrorRow = { id: string; source: string; severity: string; error_code: string | null; error_message: string; context: Record<string, unknown> | null; user_id: string | null; path: string | null; fingerprint: string | null; occurred_at: string; resolved_at: string | null };
type UnifiedEvent = {
  id: string;
  source: string;
  severity: string;
  error_code?: string | null;
  error_message: string;
  path?: string | null;
  occurred_at: string;
  resolved_at?: string | null;
  rpcName?: string;
  key?: string;
  status?: string;
  backend_version?: number;
  context?: Record<string, unknown> | null;
};

const RPC_HEALTH_PREFIX = '__rpc_health:';
const RPC_RUNTIME_KEY = '__rpc_backend_runtime';

function sourceMeta(source: string) {
  if (source === 'cloudinary') return { label: 'Cloudinary', icon: Cloud };
  if (source === 'realtime') return { label: 'Realtime', icon: Radio };
  if (source === 'frontend') return { label: 'Frontend', icon: Monitor };
  if (source === 'edge_function') return { label: 'Edge Function', icon: AlertTriangle };
  if (source === 'rpc') return { label: 'RPC', icon: ShieldAlert };
  return { label: source.replaceAll('_', ' '), icon: AlertTriangle };
}

function severityTone(severity?: string) {
  if (severity === 'critical') return 'text-red-200 bg-red-500/20 border-red-500/30';
  if (severity === 'warning') return 'text-amber-200 bg-amber-500/10 border-amber-500/20';
  return 'text-red-300 bg-red-500/10 border-red-500/20';
}

function statusMeta(status?: string) {
  if (status === 'BLOCKED') return { label: 'Blocked', icon: ShieldAlert, tone: 'text-red-300 bg-red-500/10 border-red-500/20' };
  if (status === 'PROBING') return { label: 'Probing', icon: RefreshCw, tone: 'text-amber-300 bg-amber-500/10 border-amber-500/20' };
  if (status === 'RECOVERY_PENDING') return { label: 'Recovery', icon: Clock3, tone: 'text-amber-300 bg-amber-500/10 border-amber-500/20' };
  return { label: 'Healthy', icon: CheckCircle2, tone: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20' };
}

function formatDate(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
}

export function AdminErrorIntelligencePage() {
  const [rows, setRows] = useState<HealthRow[]>([]);
  const [systemErrors, setSystemErrors] = useState<SystemErrorRow[]>([]);
  const [runtimeVersion, setRuntimeVersion] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [selected, setSelected] = useState<UnifiedEvent | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [{ data: healthData, error: healthError }, { data: errorData, error: errorLoadError }] = await Promise.all([
        supabase.from('global_settings').select('key,value,updated_at').or(`key.eq.${RPC_RUNTIME_KEY},key.like.${RPC_HEALTH_PREFIX}%`).order('updated_at', { ascending: false }),
        supabase.from('system_error_events').select('id,source,severity,error_code,error_message,context,user_id,path,fingerprint,occurred_at,resolved_at').order('occurred_at', { ascending: false }).limit(200),
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
    }
  };

  useEffect(() => {
    void load();
    const healthChannel = supabase.channel('admin-error-intelligence-health').on('postgres_changes', { event: '*', schema: 'public', table: 'global_settings' }, () => void load()).subscribe();
    const errorChannel = supabase.channel('admin-error-intelligence-events').on('postgres_changes', { event: '*', schema: 'public', table: 'system_error_events' }, () => void load()).subscribe();
    return () => { void supabase.removeChannel(healthChannel); void supabase.removeChannel(errorChannel); };
  }, []);

  const rpcIncidents = useMemo<Incident[]>(() => rows
    .filter((row) => row.key.startsWith(RPC_HEALTH_PREFIX))
    .map((row) => ({ id: row.key, rpcName: row.key.slice(RPC_HEALTH_PREFIX.length), key: row.key, source: 'rpc' as const, ...(row.value ?? {}), updated_at: row.updated_at }))
    .sort((a, b) => String(b.failed_at ?? b.updated_at ?? '').localeCompare(String(a.failed_at ?? a.updated_at ?? ''))), [rows]);

  const unifiedEvents = useMemo<UnifiedEvent[]>(() => {
    const rpcEvents = rpcIncidents.map((item) => ({ ...item, error_message: item.error_message || 'RPC incident aktif.', occurred_at: item.failed_at ?? item.updated_at ?? new Date(0).toISOString(), resolved_at: item.recovered_at ?? (item.status === 'OPEN' ? item.recovered_at : null) }));
    const external = systemErrors.map((item) => ({ id: item.id, source: item.source, severity: item.severity, error_code: item.error_code, error_message: item.error_message, path: item.path, occurred_at: item.occurred_at, resolved_at: item.resolved_at, context: item.context }));
    return [...external, ...rpcEvents].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  }, [rpcIncidents, systemErrors]);

  const filtered = useMemo(() => unifiedEvents.filter((item) => {
    const text = `${item.source} ${item.rpcName ?? ''} ${item.error_code ?? ''} ${item.error_message} ${item.path ?? ''}`.toLowerCase();
    return (sourceFilter === 'all' || item.source === sourceFilter) && text.includes(query.toLowerCase());
  }), [unifiedEvents, query, sourceFilter]);

  const activeCount = systemErrors.filter((item) => !item.resolved_at).length + rpcIncidents.filter((item) => item.status !== 'OPEN').length;
  const criticalCount = systemErrors.filter((item) => item.severity === 'critical' && !item.resolved_at).length;
  const sourceCount = new Set(systemErrors.map((item) => item.source)).size + (rpcIncidents.length ? 1 : 0);

  if (loading) return <div className="space-y-4"><div className="grid grid-cols-2 md:grid-cols-4 gap-3">{[1,2,3,4].map((item) => <div key={item} className="h-24 rounded-2xl surface-elevated animate-pulse" />)}</div><div className="h-72 rounded-2xl surface-elevated animate-pulse" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-accent">System Monitoring</p>
          <h2 className="text-xl font-bold text-fg">Error Intelligence</h2>
          <p className="mt-1 max-w-3xl text-sm text-fg-muted">Pusat pemantauan error aplikasi, layanan eksternal, Realtime, Edge Function, dan RPC.</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-fg-muted"><span>Backend v{runtimeVersion ?? '—'}</span><Button variant="ghost" size="sm" onClick={() => void load()} icon={<RefreshCw size={14}/>}>Refresh</Button></div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3"><Stat label="Incident aktif" value={activeCount} tone="text-red-300" /><Stat label="Critical" value={criticalCount} tone="text-red-200" /><Stat label="Sumber error" value={sourceCount} tone="text-amber-300" /><Stat label="Total event" value={unifiedEvents.length} tone="text-fg" /></div>
      <Card className="p-4"><div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"><div className="relative min-w-0 flex-1 lg:max-w-xl"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" /><input className="input w-full pl-9" placeholder="Cari sumber, kode, pesan, atau halaman..." value={query} onChange={(event) => setQuery(event.target.value)} /></div><div className="flex flex-wrap gap-1.5">{(['all', 'cloudinary', 'realtime', 'frontend', 'edge_function', 'rpc'] as const).map((value) => <button key={value} type="button" onClick={() => setSourceFilter(value)} className={`rounded-xl border px-3 py-2 text-xs font-semibold transition ${sourceFilter === value ? 'border-accent/20 bg-accent-muted-strong text-accent' : 'border-surface-border text-fg-muted hover:text-fg'}`}>{value === 'all' ? 'Semua' : sourceMeta(value).label}</button>)}</div></div></Card>
      <Card className="overflow-hidden"><div className="border-b surface-border px-4 py-3"><div className="flex items-center justify-between"><div><h3 className="text-sm font-semibold text-fg">Unified Error Events</h3><p className="text-xs text-fg-muted mt-0.5">Error baru muncul otomatis melalui registry realtime.</p></div><Badge color={activeCount ? 'red' : 'moss'}>{activeCount} aktif</Badge></div></div>{!filtered.length ? <div className="p-10 text-center"><CheckCircle2 className="mx-auto text-emerald-300" size={28}/><p className="mt-2 text-sm font-semibold text-fg">Tidak ada error yang cocok</p><p className="mt-1 text-xs text-fg-muted">Sistem tidak menemukan event sesuai filter saat ini.</p></div> : <div className="divide-y surface-border">{filtered.map((item) => { const meta = sourceMeta(item.source); const Icon = meta.icon; const isRpc = item.source === 'rpc'; const tone = isRpc ? statusMeta(item.status).tone : severityTone(item.severity); return <button key={item.id} type="button" onClick={() => setSelected(item)} className="w-full px-4 py-4 text-left transition hover:bg-white/[0.03]"><div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${tone}`}><Icon size={11}/>{meta.label}</span>{isRpc ? <span className="font-mono text-sm font-semibold text-fg break-all">{item.rpcName}</span> : null}{item.error_code && <span className="rounded-full border border-surface-border px-2 py-0.5 text-[10px] font-mono text-fg-muted">{item.error_code}</span>}</div><p className="mt-1 line-clamp-2 text-xs text-fg-muted">{item.error_message || 'Tidak ada pesan error.'}</p>{item.path && <p className="mt-1 truncate text-[10px] text-fg-muted">{item.path}</p>}</div><div className="shrink-0 text-right text-[11px] text-fg-muted"><p>{formatDate(item.occurred_at)}</p><p className="mt-0.5">{item.resolved_at ? 'Resolved' : 'Aktif'}</p></div></div></button>; })}</div>}</Card>
      {selected && <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4" onClick={() => setSelected(null)}><div className="w-full max-w-2xl" onClick={(event) => event.stopPropagation()}><Card className="overflow-hidden"><div className="flex items-start justify-between gap-4 border-b surface-border p-5"><div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-accent">Incident detail</p><h3 className="mt-1 text-base font-bold text-fg">{sourceMeta(selected.source).label}{selected.rpcName ? ` · ${selected.rpcName}` : ''}</h3></div><button type="button" onClick={() => setSelected(null)} className="rounded-lg p-1.5 text-fg-muted hover:bg-white/5 hover:text-fg"><X size={17}/></button></div><div className="space-y-4 p-5"><div className="flex flex-wrap gap-2"><Badge>{selected.error_code ?? selected.severity}</Badge>{selected.resolved_at ? <Badge color="moss">Resolved</Badge> : <Badge color="red">Aktif</Badge>}</div><div><p className="text-[11px] font-semibold text-fg-muted">Pesan error</p><pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded-xl border border-surface-border bg-black/10 p-3 text-xs text-fg-secondary">{selected.error_message || '—'}</pre></div><div className="grid gap-3 sm:grid-cols-2"><Detail label="Sumber" value={sourceMeta(selected.source).label} /><Detail label="Waktu" value={formatDate(selected.occurred_at)} /><Detail label="Halaman" value={selected.path ?? '—'} /><Detail label="Status" value={selected.resolved_at ? 'Resolved' : 'Aktif'} /></div>{selected.context && <div><p className="text-[11px] font-semibold text-fg-muted">Context</p><pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded-xl border border-surface-border bg-black/10 p-3 text-[11px] text-fg-secondary">{JSON.stringify(selected.context, null, 2)}</pre></div>}</div></Card></div></div>}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) { return <Card className="p-4"><p className="text-xs text-fg-muted">{label}</p><p className={`mt-1 text-2xl font-bold ${tone}`}>{value.toLocaleString('id-ID')}</p></Card>; }
function Detail({ label, value }: { label: string; value: string }) { return <div className="rounded-xl border border-surface-border p-3"><p className="text-[10px] uppercase tracking-wide text-fg-muted">{label}</p><p className="mt-1 break-all text-xs font-medium text-fg">{value}</p></div>; }
