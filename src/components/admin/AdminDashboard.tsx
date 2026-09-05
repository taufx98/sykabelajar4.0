import { useEffect, useMemo, useState } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Activity, AlertTriangle, CheckCircle2, Clock3, DollarSign, RefreshCw, Trophy, Users, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

type Period = 'daily' | 'weekly' | 'monthly' | 'yearly';
type Metric = 'users' | 'competitions' | 'revenue' | 'awards';
type HealthStatus = 'OPEN' | 'BLOCKED' | 'PROBING' | 'RECOVERY_PENDING' | string;

type HealthRow = {
  key: string;
  value: {
    status?: HealthStatus;
    backend_version?: number;
    error_code?: string | null;
    error_message?: string | null;
    failed_at?: string | null;
  } | null;
};

type Incident = NonNullable<HealthRow['value']> & { rpcName: string };

const RPC_HEALTH_PREFIX = '__rpc_health:';
const RPC_RUNTIME_KEY = '__rpc_backend_runtime';

const PERIOD_LABELS: Record<Period, string> = {
  daily: '30 hari',
  weekly: '12 minggu',
  monthly: '12 bulan',
  yearly: '5 tahun',
};

const METRIC_LABELS: Record<Metric, string> = {
  users: 'Pengguna baru',
  competitions: 'Lomba dibuat',
  revenue: 'Pendapatan',
  awards: 'Penghargaan',
};

function startDateForPeriod(period: Period) {
  const date = new Date();
  if (period === 'daily') date.setDate(date.getDate() - 30);
  if (period === 'weekly') date.setDate(date.getDate() - 84);
  if (period === 'monthly') date.setMonth(date.getMonth() - 12);
  if (period === 'yearly') date.setFullYear(date.getFullYear() - 5);
  return date;
}

function bucketKey(date: Date, period: Period) {
  if (period === 'daily') return date.toISOString().slice(0, 10);
  if (period === 'weekly') {
    const d = new Date(date);
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    return d.toISOString().slice(0, 10);
  }
  if (period === 'monthly') return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  return String(date.getFullYear());
}

function bucketLabel(key: string, period: Period) {
  if (period === 'yearly') return key;
  if (period === 'monthly') {
    const [year, month] = key.split('-').map(Number);
    return new Date(year, month - 1, 1).toLocaleDateString('id-ID', { month: 'short', year: '2-digit' });
  }
  return new Date(`${key}T00:00:00`).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
}

function buildSeries(items: Array<{ created_at?: string; total?: number }>, period: Period, valueMode: 'count' | 'revenue') {
  const start = startDateForPeriod(period);
  const groups = new Map<string, number>();
  for (const item of items) {
    if (!item.created_at) continue;
    const date = new Date(item.created_at);
    if (Number.isNaN(date.getTime()) || date < start) continue;
    const key = bucketKey(date, period);
    groups.set(key, (groups.get(key) ?? 0) + (valueMode === 'revenue' ? Number(item.total ?? 0) : 1));
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => ({ name: bucketLabel(key, period), value }));
}

function formatNumber(value: number) {
  return value.toLocaleString('id-ID');
}

function formatCurrency(value: number) {
  if (value >= 1_000_000_000) return `Rp ${(value / 1_000_000_000).toFixed(1)} M`;
  if (value >= 1_000_000) return `Rp ${(value / 1_000_000).toFixed(1)} jt`;
  if (value >= 1_000) return `Rp ${(value / 1_000).toFixed(1)} rb`;
  return `Rp ${value.toLocaleString('id-ID')}`;
}

function statusMeta(status?: string) {
  if (status === 'BLOCKED') return { label: 'Blocked', icon: AlertTriangle, tone: 'text-red-300 bg-red-500/10 border-red-500/20' };
  if (status === 'PROBING') return { label: 'Probing', icon: RefreshCw, tone: 'text-amber-300 bg-amber-500/10 border-amber-500/20' };
  if (status === 'RECOVERY_PENDING') return { label: 'Recovery', icon: Clock3, tone: 'text-amber-300 bg-amber-500/10 border-amber-500/20' };
  return { label: 'Healthy', icon: CheckCircle2, tone: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20' };
}

export function AdminDashboard() {
  const [period, setPeriod] = useState<Period>('monthly');
  const [metric, setMetric] = useState<Metric>('users');
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [competitions, setCompetitions] = useState<Array<Record<string, any>>>([]);
  const [users, setUsers] = useState<Array<Record<string, any>>>([]);
  const [orders, setOrders] = useState<Array<Record<string, any>>>([]);
  const [awards, setAwards] = useState<Array<Record<string, any>>>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [runtimeVersion, setRuntimeVersion] = useState<number | null>(null);
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const [s, c, u, o, a, health] = await Promise.all([
        supabase.rpc('get_platform_stats'),
        supabase.from('competitions').select('id,created_at,status').order('created_at', { ascending: false }),
        supabase.from('profiles').select('id,created_at,account_type,total_xp,edu_coin').order('created_at', { ascending: false }),
        supabase.from('orders').select('id,status,total,created_at').order('created_at', { ascending: false }),
        supabase.from('awards').select('id,created_at,points').order('created_at', { ascending: false }).limit(500),
        supabase.from('global_settings').select('key,value').or(`key.eq.${RPC_RUNTIME_KEY},key.like.${RPC_HEALTH_PREFIX}%`),
      ]);

      setStats(s.data?.[0] ?? {});
      setCompetitions(c.data ?? []);
      setUsers(u.data ?? []);
      setOrders(o.data ?? []);
      setAwards(a.data ?? []);

      const nextIncidents: Incident[] = [];
      for (const row of (health.data ?? []) as HealthRow[]) {
        if (row.key === RPC_RUNTIME_KEY) {
          const version = Number(row.value && typeof row.value === 'object' ? (row.value as any).version : NaN);
          if (Number.isFinite(version)) setRuntimeVersion(version);
          continue;
        }
        if (!row.key.startsWith(RPC_HEALTH_PREFIX)) continue;
        const value = row.value ?? {};
        if (value.status && value.status !== 'OPEN') {
          nextIncidents.push({ rpcName: row.key.slice(RPC_HEALTH_PREFIX.length), ...value });
        }
      }
      setIncidents(nextIncidents.sort((a, b) => String(b.failed_at ?? '').localeCompare(String(a.failed_at ?? ''))));
    } catch (error) {
      console.error('Admin dashboard load failed', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
    const channel = supabase.channel('admin-dashboard-health')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'global_settings' }, (payload) => {
        const row = (payload.new ?? payload.old) as HealthRow | undefined;
        if (!row?.key) return;
        if (row.key === RPC_RUNTIME_KEY) {
          const version = Number(row.value && typeof row.value === 'object' ? (row.value as any).version : NaN);
          if (Number.isFinite(version)) setRuntimeVersion(version);
          return;
        }
        if (!row.key.startsWith(RPC_HEALTH_PREFIX)) return;
        const value = row.value ?? {};
        const rpcName = row.key.slice(RPC_HEALTH_PREFIX.length);
        setIncidents((current) => {
          const remaining = current.filter((incident) => incident.rpcName !== rpcName);
          if (!value.status || value.status === 'OPEN') return remaining;
          return [...remaining, { rpcName, ...value }].sort((a, b) => String(b.failed_at ?? '').localeCompare(String(a.failed_at ?? '')));
        });
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, []);

  const chartData = useMemo(() => {
    if (metric === 'users') return buildSeries(users, period, 'count');
    if (metric === 'competitions') return buildSeries(competitions, period, 'count');
    if (metric === 'awards') return buildSeries(awards, period, 'count');
    return buildSeries(orders.filter((order) => order.status !== 'CANCELLED'), period, 'revenue');
  }, [metric, period, users, competitions, awards, orders]);

  const totalRevenue = useMemo(() => orders.reduce((sum, order) => sum + (order.status === 'CANCELLED' ? 0 : Number(order.total ?? 0)), 0), [orders]);
  const activeCompetitions = useMemo(() => competitions.filter((competition) => ['LIVE', 'REGISTRATION_OPEN'].includes(String(competition.status))).length, [competitions]);
  const totalXp = useMemo(() => users.reduce((sum, user) => sum + Number(user.total_xp ?? 0), 0), [users]);
  const recentActivity = useMemo(() => {
    const rows = [
      ...users.slice(0, 3).map((item) => ({ type: 'User baru', time: item.created_at, label: 'Pengguna bergabung', icon: Users })),
      ...competitions.slice(0, 3).map((item) => ({ type: 'Lomba', time: item.created_at, label: `Lomba ${item.status === 'PUBLISHED' ? 'dipublikasikan' : 'dibuat'}`, icon: Trophy })),
      ...orders.slice(0, 3).map((item) => ({ type: 'Pesanan', time: item.created_at, label: `Order ${item.status}`, icon: DollarSign })),
    ];
    return rows.filter((row) => row.time).sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()).slice(0, 6);
  }, [users, competitions, orders]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((item) => <div key={item} className="h-20 rounded-xl surface-elevated animate-pulse" />)}
        </div>
        <div className="h-80 rounded-2xl surface-elevated animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-accent">Overview</p>
          <h2 className="text-lg font-semibold tracking-tight text-fg">Ringkasan platform</h2>
        </div>
        <div className="text-[11px] text-fg-muted">Backend v{runtimeVersion ?? '—'}</div>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <Kpi label="Total pengguna" value={formatNumber(Number(stats.total_users ?? users.length))} icon={Users} meta={`${users.length.toLocaleString('id-ID')} data terbaca`} />
        <Kpi label="Lomba aktif" value={formatNumber(activeCompetitions)} icon={Trophy} meta={`${competitions.length.toLocaleString('id-ID')} total lomba`} />
        <Kpi label="Total XP" value={formatNumber(totalXp)} icon={Activity} meta="Akumulasi pengguna" />
        <Kpi label="Revenue" value={formatCurrency(totalRevenue)} icon={DollarSign} meta={`${orders.filter((order) => order.status === 'PAID').length.toLocaleString('id-ID')} pembayaran`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-12">
        <Card className="min-w-0 p-4 lg:col-span-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-[11px] font-medium text-fg-muted">Tren</p>
              <h3 className="text-sm font-semibold text-fg">{METRIC_LABELS[metric]}</h3>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Segmented options={Object.keys(METRIC_LABELS) as Metric[]} value={metric} onChange={setMetric} labels={METRIC_LABELS} />
              <Segmented options={Object.keys(PERIOD_LABELS) as Period[]} value={period} onChange={setPeriod} labels={PERIOD_LABELS} />
            </div>
          </div>
          <div className="mt-3 h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 8, right: 8, left: -14, bottom: 0 }}>
                <defs>
                  <linearGradient id="adminTrend" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="currentColor" stopOpacity={0.28} />
                    <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.08} />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} stroke="currentColor" opacity={0.5} />
                <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} stroke="currentColor" opacity={0.5} tickFormatter={(value) => metric === 'revenue' ? formatCurrency(Number(value)) : formatNumber(Number(value))} />
                <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid rgba(255,255,255,.08)', background: 'rgba(17,24,20,.96)', color: '#fff', fontSize: 12 }} formatter={(value) => [metric === 'revenue' ? formatCurrency(Number(value)) : formatNumber(Number(value)), METRIC_LABELS[metric]]} />
                <Area type="monotone" dataKey="value" stroke="currentColor" strokeWidth={2.5} fill="url(#adminTrend)" className="text-accent" isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <div className="space-y-4 lg:col-span-4">
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[11px] text-fg-muted">System status</p>
                <h3 className="text-sm font-semibold text-fg">Kesehatan layanan</h3>
              </div>
              <span className="flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-[10px] font-semibold text-emerald-300"><span className="h-1.5 w-1.5 rounded-full bg-current" /> Live</span>
            </div>
            <div className="mt-3 space-y-1.5 text-xs">
              <HealthRow label="Database" healthy />
              <HealthRow label="Authentication" healthy />
              <HealthRow label="Realtime" healthy />
              <HealthRow label="RPC monitor" healthy={incidents.length === 0} detail={incidents.length ? `${incidents.length} incident aktif` : 'Semua normal'} />
            </div>
          </Card>

          <Card className={`p-4 ${incidents.length ? 'border-red-500/20' : ''}`}>
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-[11px] text-fg-muted">Production incidents</p>
                <h3 className="text-sm font-semibold text-fg">Error Intelligence</h3>
              </div>
              <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${incidents.length ? 'bg-red-500/10 text-red-300' : 'bg-emerald-500/10 text-emerald-300'}`}>{incidents.length} aktif</span>
            </div>
            <div className="mt-3 space-y-2">
              {incidents.slice(0, 3).map((incident) => {
                const meta = statusMeta(incident.status);
                const Icon = meta.icon;
                return (
                  <button key={incident.rpcName} type="button" onClick={() => setSelectedIncident(incident)} className="w-full rounded-xl border border-white/5 bg-white/[0.02] p-3 text-left transition hover:border-red-500/20 hover:bg-white/[0.04]">
                    <div className="flex items-start gap-2.5">
                      <span className={`mt-0.5 rounded-lg border p-1.5 ${meta.tone}`}><Icon size={13} /></span>
                      <span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-fg">{incident.rpcName}</span><span className="mt-0.5 block truncate text-[10px] text-fg-muted">{incident.error_message || incident.error_code || 'Backend error'}</span></span>
                      <span className="text-[10px] text-fg-muted">›</span>
                    </div>
                  </button>
                );
              })}
              {!incidents.length && <div className="rounded-xl border border-emerald-500/10 bg-emerald-500/5 p-3 text-xs text-emerald-200">Tidak ada incident aktif.</div>}
            </div>
          </Card>
        </div>
      </div>

      <Card className="p-4">
        <div className="flex items-center justify-between gap-3">
          <div><p className="text-[11px] text-fg-muted">Live feed</p><h3 className="text-sm font-semibold text-fg">Aktivitas terbaru</h3></div>
          <Button size="sm" variant="outline" onClick={() => void loadData()} icon={<RefreshCw size={13} />}>Refresh</Button>
        </div>
        <div className="mt-2 divide-y divide-white/5">
          {recentActivity.map((item, index) => { const Icon = item.icon; return <div key={`${item.type}-${item.time}-${index}`} className="flex items-center gap-3 py-2.5"><div className="rounded-lg bg-white/[0.04] p-2 text-accent"><Icon size={13} /></div><div className="min-w-0 flex-1"><p className="text-xs font-medium text-fg">{item.label}</p><p className="text-[10px] text-fg-muted">{item.type}</p></div><span className="text-[10px] text-fg-muted">{new Date(item.time).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span></div>; })}
          {!recentActivity.length && <div className="py-5 text-center text-xs text-fg-muted">Belum ada aktivitas.</div>}
        </div>
      </Card>

      {selectedIncident && <IncidentDrawer incident={selectedIncident} onClose={() => setSelectedIncident(null)} />}
    </div>
  );
}

function Kpi({ label, value, meta, icon: Icon }: { label: string; value: string; meta: string; icon: typeof Users }) {
  return <Card className="min-w-0 p-3"><div className="flex items-center gap-3"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent"><Icon size={15} /></span><div className="min-w-0"><p className="truncate text-[10px] font-medium text-fg-muted">{label}</p><p className="truncate text-base font-bold tracking-tight text-fg">{value}</p><p className="truncate text-[9px] text-fg-muted">{meta}</p></div></div></Card>;
}

function Segmented<T extends string>({ options, value, onChange, labels }: { options: T[]; value: T; onChange: (value: T) => void; labels: Record<T, string> }) {
  return <div className="flex max-w-full overflow-x-auto rounded-lg bg-white/[0.03] p-0.5 no-scrollbar">{options.map((option) => <button key={option} type="button" onClick={() => onChange(option)} className={`whitespace-nowrap rounded-md px-2 py-1 text-[9px] font-semibold transition ${value === option ? 'bg-accent/10 text-accent' : 'text-fg-muted hover:text-fg'}`}>{labels[option]}</button>)}</div>;
}

function HealthRow({ label, healthy, detail }: { label: string; healthy: boolean; detail?: string }) {
  return <div className="flex items-center gap-2 rounded-lg px-2 py-1.5"><span className={`h-1.5 w-1.5 rounded-full ${healthy ? 'bg-emerald-400' : 'bg-red-400'}`} /><span className="text-fg-secondary">{label}</span><span className="ml-auto text-[10px] text-fg-muted">{detail || (healthy ? 'Operational' : 'Attention')}</span></div>;
}

function IncidentDrawer({ incident, onClose }: { incident: Incident; onClose: () => void }) {
  const meta = statusMeta(incident.status);
  const Icon = meta.icon;
  return <div className="fixed inset-0 z-50 bg-black/40" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><aside className="absolute right-0 top-0 h-full w-full max-w-md overflow-y-auto border-l surface-border surface-bg p-5 shadow-2xl"><div className="flex items-start justify-between gap-4"><div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-accent">Error Intelligence</p><h3 className="mt-1 text-base font-bold text-fg">{incident.rpcName}</h3></div><button type="button" onClick={onClose} className="rounded-lg p-2 text-fg-muted hover:bg-white/5 hover:text-fg"><X size={16} /></button></div><div className={`mt-4 flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold ${meta.tone}`}><Icon size={14} /> {meta.label}</div><div className="mt-4 space-y-3"><Detail label="Error code" value={incident.error_code || '—'} /><Detail label="Backend version" value={String(incident.backend_version ?? '—')} /><Detail label="Terjadi" value={incident.failed_at ? new Date(incident.failed_at).toLocaleString('id-ID') : '—'} /><div><p className="text-[10px] font-semibold uppercase tracking-wide text-fg-muted">Pesan error</p><pre className="mt-1 whitespace-pre-wrap break-words rounded-xl border border-white/5 bg-black/20 p-3 text-[11px] leading-5 text-red-200">{incident.error_message || 'Tidak ada pesan error.'}</pre></div></div></aside></div>;
}

function Detail({ label, value }: { label: string; value: string }) { return <div className="flex items-start justify-between gap-4 rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2.5"><span className="text-[10px] text-fg-muted">{label}</span><span className="max-w-[65%] break-words text-right text-[11px] font-medium text-fg">{value}</span></div>; }
