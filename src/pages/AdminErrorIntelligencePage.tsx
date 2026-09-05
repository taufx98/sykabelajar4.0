import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Clock3, RefreshCw, Search, ShieldAlert, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';

type HealthStatus = 'OPEN' | 'BLOCKED' | 'PROBING' | 'RECOVERY_PENDING' | string;
type HealthValue = { status?: HealthStatus; backend_version?: number; error_code?: string | null; error_message?: string | null; failed_at?: string | null; recovered_at?: string | null };
type HealthRow = { key: string; value: HealthValue | null; updated_at?: string };
type Incident = HealthValue & { rpcName: string; key: string; updated_at?: string };

const RPC_HEALTH_PREFIX = '__rpc_health:';
const RPC_RUNTIME_KEY = '__rpc_backend_runtime';

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
  const [runtimeVersion, setRuntimeVersion] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'healthy'>('active');
  const [selected, setSelected] = useState<Incident | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('global_settings')
        .select('key,value,updated_at')
        .or(`key.eq.${RPC_RUNTIME_KEY},key.like.${RPC_HEALTH_PREFIX}%`)
        .order('updated_at', { ascending: false });
      if (error) throw error;
      setRows((data ?? []) as HealthRow[]);
      const runtime = (data ?? []).find((row) => row.key === RPC_RUNTIME_KEY) as HealthRow | undefined;
      const version = Number(runtime?.value && typeof runtime.value === 'object' ? (runtime.value as any).version : NaN);
      setRuntimeVersion(Number.isFinite(version) ? version : null);
    } catch (error) {
      console.error('Error Intelligence load failed', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    const channel = supabase.channel('admin-error-intelligence-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'global_settings' }, () => void load())
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, []);

  const incidents = useMemo<Incident[]>(() => rows
    .filter((row) => row.key.startsWith(RPC_HEALTH_PREFIX))
    .map((row) => ({ rpcName: row.key.slice(RPC_HEALTH_PREFIX.length), key: row.key, ...(row.value ?? {}), updated_at: row.updated_at }))
    .sort((a, b) => String(b.failed_at ?? b.updated_at ?? '').localeCompare(String(a.failed_at ?? a.updated_at ?? ''))), [rows]);

  const filtered = useMemo(() => incidents.filter((item) => {
    const matchesSearch = `${item.rpcName} ${item.error_code ?? ''} ${item.error_message ?? ''}`.toLowerCase().includes(query.toLowerCase());
    const matchesStatus = statusFilter === 'all' || (statusFilter === 'active' ? item.status !== 'OPEN' : item.status === 'OPEN');
    return matchesSearch && matchesStatus;
  }), [incidents, query, statusFilter]);

  const activeCount = incidents.filter((item) => item.status !== 'OPEN').length;
  const healthyCount = incidents.filter((item) => item.status === 'OPEN').length;
  const blockedCount = incidents.filter((item) => item.status === 'BLOCKED').length;

  if (loading) {
    return <div className="space-y-4"><div className="grid grid-cols-2 md:grid-cols-4 gap-3">{[1,2,3,4].map((item) => <div key={item} className="h-24 rounded-2xl surface-elevated animate-pulse" />)}</div><div className="h-72 rounded-2xl surface-elevated animate-pulse" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-accent">System Monitoring</p>
          <h2 className="text-xl font-bold text-fg">Error Intelligence</h2>
          <p className="mt-1 max-w-2xl text-sm text-fg-muted">Pusat monitoring error RPC, incident aktif, dan status circuit breaker platform.</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-fg-muted"><span>Backend v{runtimeVersion ?? '—'}</span><Button variant="ghost" size="sm" onClick={() => void load()} icon={<RefreshCw size={14}/>}>Refresh</Button></div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Incident aktif" value={activeCount} tone="text-red-300" />
        <Stat label="Blocked" value={blockedCount} tone="text-red-300" />
        <Stat label="Healthy" value={healthyCount} tone="text-emerald-300" />
        <Stat label="Total monitored" value={incidents.length} tone="text-fg" />
      </div>

      <Card className="p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative min-w-0 flex-1 lg:max-w-xl">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" />
            <input className="input w-full pl-9" placeholder="Cari RPC, kode error, atau pesan..." value={query} onChange={(event) => setQuery(event.target.value)} />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {([['active', 'Aktif'], ['all', 'Semua'], ['healthy', 'Healthy']] as const).map(([value, label]) => <button key={value} type="button" onClick={() => setStatusFilter(value)} className={`rounded-xl border px-3 py-2 text-xs font-semibold transition ${statusFilter === value ? 'border-accent/20 bg-accent-muted-strong text-accent' : 'border-surface-border text-fg-muted hover:text-fg'}`}>{label}</button>)}
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b surface-border px-4 py-3"><div className="flex items-center justify-between"><div><h3 className="text-sm font-semibold text-fg">RPC Health & Incidents</h3><p className="text-xs text-fg-muted mt-0.5">Realtime dari health registry Error Intelligence.</p></div><Badge color={activeCount ? 'red' : 'moss'}>{activeCount} aktif</Badge></div></div>
        {!filtered.length ? <div className="p-10 text-center"><CheckCircle2 className="mx-auto text-emerald-300" size={28}/><p className="mt-2 text-sm font-semibold text-fg">Tidak ada incident yang cocok</p><p className="mt-1 text-xs text-fg-muted">Sistem tidak menemukan error sesuai filter saat ini.</p></div> : <div className="divide-y surface-border">{filtered.map((item) => { const meta = statusMeta(item.status); const Icon = meta.icon; return <button key={item.key} type="button" onClick={() => setSelected(item)} className="w-full px-4 py-4 text-left transition hover:bg-white/[0.03]"><div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="font-mono text-sm font-semibold text-fg break-all">{item.rpcName}</span><span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${meta.tone}`}><Icon size={11}/>{meta.label}</span>{item.error_code && <span className="rounded-full border border-surface-border px-2 py-0.5 text-[10px] font-mono text-fg-muted">{item.error_code}</span>}</div><p className="mt-1 line-clamp-2 text-xs text-fg-muted">{item.error_message || 'Tidak ada pesan error.'}</p></div><div className="shrink-0 text-right text-[11px] text-fg-muted"><p>Gagal: {formatDate(item.failed_at)}</p><p className="mt-0.5">Update: {formatDate(item.updated_at)}</p></div></div></button>; })}</div>}
      </Card>

      {selected && <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4" onClick={() => setSelected(null)}><div className="w-full max-w-2xl" onClick={(event) => event.stopPropagation()}><Card className="overflow-hidden"><div className="flex items-start justify-between gap-4 border-b surface-border p-5"><div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-accent">Incident detail</p><h3 className="mt-1 font-mono text-base font-bold text-fg break-all">{selected.rpcName}</h3></div><button type="button" onClick={() => setSelected(null)} className="rounded-lg p-1.5 text-fg-muted hover:bg-white/5 hover:text-fg"><X size={17}/></button></div><div className="space-y-4 p-5"><div className="flex flex-wrap gap-2"><Badge color={selected.status === 'BLOCKED' ? 'red' : selected.status === 'PROBING' ? 'warn' : 'moss'}>{statusMeta(selected.status).label}</Badge>{selected.error_code && <Badge>{selected.error_code}</Badge>}</div><div><p className="text-[11px] font-semibold text-fg-muted">Error message</p><pre className="mt-1 whitespace-pre-wrap rounded-xl border border-surface-border bg-black/10 p-3 text-xs text-fg-secondary">{selected.error_message || '—'}</pre></div><div className="grid gap-3 sm:grid-cols-2"><Detail label="Waktu gagal" value={formatDate(selected.failed_at)} /><Detail label="Backend version" value={String(selected.backend_version ?? runtimeVersion ?? '—')} /><Detail label="Status key" value={selected.key} /><Detail label="Recovery" value={formatDate(selected.recovered_at)} /></div></div></Card></div></div>}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) { return <Card className="p-4"><p className="text-xs text-fg-muted">{label}</p><p className={`mt-1 text-2xl font-bold ${tone}`}>{value.toLocaleString('id-ID')}</p></Card>; }
function Detail({ label, value }: { label: string; value: string }) { return <div className="rounded-xl border border-surface-border p-3"><p className="text-[10px] uppercase tracking-wide text-fg-muted">{label}</p><p className="mt-1 break-all text-xs font-medium text-fg">{value}</p></div>; }
