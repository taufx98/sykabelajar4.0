import { useEffect, useState, useMemo } from 'react';
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer
} from 'recharts';
import { supabase } from '@/lib/supabase';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import {
  TrendingUp, Users, Trophy, Coins, DollarSign, BarChart3,
  PieChart as PieChartIcon, Activity, Eye, EyeOff, Calendar,
  ChevronDown, Download, Filter
} from 'lucide-react';

// ── Types ──
type Period = 'daily' | 'weekly' | 'monthly' | 'yearly';
type ChartType = 'line' | 'bar' | 'area' | 'pie';

interface DashboardSection {
  id: string;
  label: string;
  icon: any;
  visible: boolean;
  chartType: ChartType;
}

interface StatData {
  label: string;
  value: number;
  change: number;
  color: string;
  icon: any;
}

const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4'];

// ── Main Component ──
export function AdminDashboard() {
  const [period, setPeriod] = useState<Period>('monthly');
  const [loading, setLoading] = useState(true);
  const [showFilters, setShowFilters] = useState(false);

  // Data states
  const [stats, setStats] = useState<Record<string, number>>({});
  const [competitions, setCompetitions] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [posts, setPosts] = useState<any[]>([]);
  const [awards, setAwards] = useState<any[]>([]);

  // Section visibility
  const [sections, setSections] = useState<DashboardSection[]>([
    { id: 'overview', label: 'Ringkasan', icon: Activity, visible: true, chartType: 'area' },
    { id: 'competitions', label: 'Lomba', icon: Trophy, visible: true, chartType: 'bar' },
    { id: 'users', label: 'Pengguna', icon: Users, visible: true, chartType: 'line' },
    { id: 'revenue', label: 'Pendapatan', icon: DollarSign, visible: true, chartType: 'area' },
    { id: 'xp', label: 'XP & Coin', icon: Coins, visible: true, chartType: 'bar' },
    { id: 'distribution', label: 'Distribusi', icon: PieChartIcon, visible: true, chartType: 'pie' },
    { id: 'activity', label: 'Aktivitas', icon: BarChart3, visible: true, chartType: 'line' },
  ]);

  // Load data
  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [s, c, u, o, p, a] = await Promise.all([
        supabase.rpc('get_platform_stats'),
        supabase.from('competitions').select('*').order('created_at', { ascending: false }),
        supabase.from('profiles').select('id,created_at,account_type,grade,total_xp,edu_coin'),
        supabase.from('orders').select('id,user_id,status,total,created_at').order('created_at', { ascending: false }),
        supabase.from('posts').select('id,created_at,status,competition_id'),
        supabase.from('awards').select('id,created_at,points,competition_id').order('created_at', { ascending: false }).limit(500),
      ]);
      setStats(s.data?.[0] || {});
      setCompetitions(c.data || []);
      setUsers(u.data || []);
      setOrders(o.data || []);
      setPosts(p.data || []);
      setAwards(a.data || []);
    } catch (e) {
      console.error('Dashboard load failed', e);
    } finally {
      setLoading(false);
    }
  };

  // ── Process data by period ──
  const processedData = useMemo(() => {
    const now = new Date();
    const getDateRange = () => {
      const d = new Date(now);
      switch (period) {
        case 'daily': d.setDate(d.getDate() - 30); break;
        case 'weekly': d.setDate(d.getDate() - 12 * 7); break;
        case 'monthly': d.setMonth(d.getMonth() - 12); break;
        case 'yearly': d.setFullYear(d.getFullYear() - 5); break;
      }
      return d;
    };
    const startDate = getDateRange();

    // Helper: group by time bucket
    const groupByTime = (items: any[], dateField = 'created_at') => {
      const groups: Record<string, number> = {};
      items.forEach(item => {
        const d = new Date(item[dateField]);
        if (d < startDate) return;
        let key: string;
        switch (period) {
          case 'daily': key = d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }); break;
          case 'weekly': { const weekStart = new Date(d); weekStart.setDate(d.getDate() - d.getDay()); key = weekStart.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }); break; }
          case 'monthly': key = d.toLocaleDateString('id-ID', { month: 'short', year: '2-digit' }); break;
          case 'yearly': key = String(d.getFullYear()); break;
        }
        groups[key] = (groups[key] || 0) + 1;
      });
      return Object.entries(groups).map(([name, value]) => ({ name, value })).sort((a, b) => a.name.localeCompare(b.name, 'id'));
    };

    // Competitions by period
    const compByPeriod = groupByTime(competitions);

    // Users by period
    const usersByPeriod = groupByTime(users);

    // Users by account type
    const usersByType = [
      { name: 'Pelajar', value: users.filter(u => u.account_type === 'student' || !u.account_type).length },
      { name: 'Guru', value: users.filter(u => u.account_type === 'teacher').length },
      { name: 'Penyelenggara', value: users.filter(u => u.account_type === 'organizer').length },
    ].filter(d => d.value > 0);

    // Users by grade
    const gradeCounts: Record<string, number> = {};
    users.forEach(u => { if (u.grade) gradeCounts[u.grade] = (gradeCounts[u.grade] || 0) + 1; });
    const usersByGrade = Object.entries(gradeCounts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);

    // Revenue by period
    const revenueByPeriod = (() => {
      const groups: Record<string, number> = {};
      orders.filter(o => o.status !== 'CANCELLED').forEach(order => {
        const d = new Date(order.created_at);
        if (d < startDate) return;
        let key: string;
        switch (period) {
          case 'daily': key = d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }); break;
          case 'weekly': { const weekStart = new Date(d); weekStart.setDate(d.getDate() - d.getDay()); key = weekStart.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }); break; }
          case 'monthly': key = d.toLocaleDateString('id-ID', { month: 'short', year: '2-digit' }); break;
          case 'yearly': key = String(d.getFullYear()); break;
        }
        groups[key] = (groups[key] || 0) + Number(order.total || 0);
      });
      return Object.entries(groups).map(([name, value]) => ({ name, value, formatted: `Rp ${value.toLocaleString('id-ID')}` })).sort((a, b) => a.name.localeCompare(b.name, 'id'));
    })();

    // XP & Coin distribution
    const xpDistribution = [
      { name: '0-100', value: users.filter(u => (u.total_xp || 0) <= 100).length },
      { name: '101-500', value: users.filter(u => (u.total_xp || 0) > 100 && (u.total_xp || 0) <= 500).length },
      { name: '501-1000', value: users.filter(u => (u.total_xp || 0) > 500 && (u.total_xp || 0) <= 1000).length },
      { name: '1000+', value: users.filter(u => (u.total_xp || 0) > 1000).length },
    ].filter(d => d.value > 0);

    // Awards by period
    const awardsByPeriod = groupByTime(awards);

    // Cumulative users
    const cumulativeUsers = (() => {
      const sorted = [...users].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      let count = 0;
      const groups: Record<string, number> = {};
      sorted.forEach(u => {
        const d = new Date(u.created_at);
        let key: string;
        switch (period) {
          case 'daily': key = d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }); break;
          case 'weekly': { const weekStart = new Date(d); weekStart.setDate(d.getDate() - d.getDay()); key = weekStart.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }); break; }
          case 'monthly': key = d.toLocaleDateString('id-ID', { month: 'short', year: '2-digit' }); break;
          case 'yearly': key = String(d.getFullYear()); break;
        }
        count++;
        groups[key] = count;
      });
      return Object.entries(groups).map(([name, value]) => ({ name, value })).sort((a, b) => a.name.localeCompare(b.name, 'id'));
    })();

    return {
      compByPeriod, usersByPeriod, usersByType, usersByGrade,
      revenueByPeriod, xpDistribution, awardsByPeriod, cumulativeUsers
    };
  }, [period, competitions, users, orders, awards]);

  // ── Stats cards ──
  const summaryStats: StatData[] = [
    { label: 'Total User', value: stats.total_users || 0, change: usersByPeriodLast?.length || 0, color: 'text-blue-400', icon: Users },
    { label: 'Lomba', value: stats.total_competitions || 0, change: 0, color: 'text-moss-400', icon: Trophy },
    { label: 'Total XP', value: users.reduce((s, u) => s + (u.total_xp || 0), 0), change: 0, color: 'text-amber-400', icon: Coins },
    { label: 'Revenue', value: orders.reduce((s, o) => s + (o.status !== 'CANCELLED' ? Number(o.total || 0) : 0), 0), change: 0, color: 'text-emerald-400', icon: DollarSign },
  ];

  function usersByPeriodLast() { return []; }

  const toggleSection = (id: string) => {
    setSections(prev => prev.map(s => s.id === id ? { ...s, visible: !s.visible } : s));
  };

  const toggleChartType = (id: string) => {
    setSections(prev => prev.map(s => {
      if (s.id !== id) return s;
      const types: ChartType[] = ['line', 'bar', 'area', 'pie'];
      const idx = types.indexOf(s.chartType);
      return { ...s, chartType: types[(idx + 1) % types.length] };
    }));
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-24 rounded-xl bg-ink-800 animate-pulse" />
          ))}
        </div>
        <div className="h-64 rounded-xl bg-ink-800 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* ═══ CONTROLS BAR ═══ */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Period selector */}
        <div className="flex bg-ink-800 rounded-xl p-1">
          {(['daily', 'weekly', 'monthly', 'yearly'] as Period[]).map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                period === p ? 'bg-moss-500/15 text-moss-300' : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {p === 'daily' ? 'Harian' : p === 'weekly' ? 'Mingguan' : p === 'monthly' ? 'Bulanan' : 'Tahunan'}
            </button>
          ))}
        </div>

        {/* Filter toggle */}
        <Button
          size="sm"
          variant="outline"
          icon={<Filter size={14} />}
          onClick={() => setShowFilters(!showFilters)}
        >
          Filter Tampilan
        </Button>
      </div>

      {/* ═══ FILTER PANEL ═══ */}
      {showFilters && (
        <Card className="p-4">
          <p className="text-xs text-slate-400 font-semibold mb-3">Tampilkan/Sembunyikan Section</p>
          <div className="flex flex-wrap gap-2">
            {sections.map(s => (
              <button
                key={s.id}
                onClick={() => toggleSection(s.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition border ${
                  s.visible
                    ? 'border-moss-500/30 bg-moss-500/10 text-moss-300'
                    : 'border-white/5 bg-ink-800 text-slate-500'
                }`}
              >
                {s.visible ? <Eye size={12} /> : <EyeOff size={12} />}
                {s.label}
              </button>
            ))}
          </div>
        </Card>
      )}

      {/* ═══ STAT CARDS ═══ */}
      {sections.find(s => s.id === 'overview')?.visible && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard label="Total User" value={stats.total_users || 0} icon={Users} color="blue" />
          <StatCard label="Lomba Aktif" value={competitions.filter(c => ['LIVE', 'REGISTRATION_OPEN'].includes(c.status)).length} icon={Trophy} color="green" />
          <StatCard label="Total XP" value={users.reduce((s, u) => s + (u.total_xp || 0), 0)} icon={Coins} color="amber" format="number" />
          <StatCard
            label="Revenue"
            value={orders.reduce((s, o) => s + (o.status !== 'CANCELLED' ? Number(o.total || 0) : 0), 0)}
            icon={DollarSign}
            color="emerald"
            format="currency"
          />
        </div>
      )}

      {/* ═══ CHARTS ═══ */}
      <div className="grid lg:grid-cols-2 gap-4">
        {/* Competitions Chart */}
        {sections.find(s => s.id === 'competitions')?.visible && (
          <ChartCard
            title="Lomba per Periode"
            data={processedData.compByPeriod}
            chartType={sections.find(s => s.id === 'competitions')!.chartType}
            color="#10b981"
            onToggleType={() => toggleChartType('competitions')}
            valueType="number"
          />
        )}

        {/* Users Chart */}
        {sections.find(s => s.id === 'users')?.visible && (
          <ChartCard
            title="Pengguna Baru"
            data={processedData.usersByPeriod}
            chartType={sections.find(s => s.id === 'users')!.chartType}
            color="#3b82f6"
            onToggleType={() => toggleChartType('users')}
            valueType="number"
          />
        )}

        {/* Revenue Chart */}
        {sections.find(s => s.id === 'revenue')?.visible && (
          <ChartCard
            title="Pendapatan"
            data={processedData.revenueByPeriod}
            chartType={sections.find(s => s.id === 'revenue')!.chartType}
            color="#f59e0b"
            onToggleType={() => toggleChartType('revenue')}
            valueType="currency"
          />
        )}

        {/* Awards Chart */}
        {sections.find(s => s.id === 'xp')?.visible && (
          <ChartCard
            title="XP & Penghargaan"
            data={processedData.awardsByPeriod}
            chartType={sections.find(s => s.id === 'xp')!.chartType}
            color="#8b5cf6"
            onToggleType={() => toggleChartType('xp')}
            valueType="number"
          />
        )}

        {/* Distribution Pie Charts */}
        {sections.find(s => s.id === 'distribution')?.visible && (
          <Card className="p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-white">Distribusi</h3>
            </div>
            <div className="grid grid-cols-2 gap-4">
              {/* Users by Type */}
              <div>
                <p className="text-[11px] text-slate-500 mb-2">Berdasarkan Jenis</p>
                <ResponsiveContainer width="100%" height={160}>
                  <PieChart>
                    <Pie
                      data={processedData.usersByType}
                      cx="50%" cy="50%"
                      innerRadius={40} outerRadius={65}
                      paddingAngle={3}
                      dataKey="value"
                    >
                      {processedData.usersByType.map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: any) => [`${v} user`, ""]} />
                    <Legend iconSize={8} wrapperStyle={{ fontSize: 10 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              {/* XP Distribution */}
              <div>
                <p className="text-[11px] text-slate-500 mb-2">Distribusi XP</p>
                <ResponsiveContainer width="100%" height={160}>
                  <PieChart>
                    <Pie
                      data={processedData.xpDistribution}
                      cx="50%" cy="50%"
                      innerRadius={40} outerRadius={65}
                      paddingAngle={3}
                      dataKey="value"
                    >
                      {processedData.xpDistribution.map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: any) => [`${v} user`, ""]} />
                    <Legend iconSize={8} wrapperStyle={{ fontSize: 10 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          </Card>
        )}

        {/* Activity: Cumulative Users */}
        {sections.find(s => s.id === 'activity')?.visible && (
          <ChartCard
            title="Kumulatif Pengguna"
            data={processedData.cumulativeUsers}
            chartType="area"
            color="#06b6d4"
            onToggleType={() => toggleChartType('activity')}
            valueType="number"
            showArea
          />
        )}
      </div>

      {/* ═══ DATA TABLES ═══ */}
      <div className="grid lg:grid-cols-2 gap-4">
        {/* Users by Grade Table */}
        {sections.find(s => s.id === 'distribution')?.visible && (
          <Card className="p-4">
            <h3 className="text-sm font-semibold text-white mb-3">User per Jenjang</h3>
            <div className="space-y-2">
              {processedData.usersByGrade.map((g, i) => (
                <div key={g.name} className="flex items-center gap-3">
                  <span className="text-xs text-slate-400 w-12">{g.name}</span>
                  <div className="flex-1 bg-ink-800 rounded-full h-2 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${(g.value / Math.max(...processedData.usersByGrade.map(x => x.value))) * 100}%`,
                        backgroundColor: COLORS[i % COLORS.length],
                      }}
                    />
                  </div>
                  <span className="text-xs text-white font-medium w-8 text-right">{g.value}</span>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Recent Competitions Table */}
        {sections.find(s => s.id === 'competitions')?.visible && (
          <Card className="p-4">
            <h3 className="text-sm font-semibold text-white mb-3">Lomba Terbaru</h3>
            <div className="space-y-2">
              {competitions.slice(0, 5).map(c => (
                <div key={c.id} className="flex items-center gap-3 p-2 rounded-lg bg-ink-800/50">
                  <div className={`w-2 h-2 rounded-full ${
                    c.status === 'LIVE' ? 'bg-green-400 animate-pulse' :
                    c.status === 'REGISTRATION_OPEN' ? 'bg-blue-400' :
                    'bg-slate-500'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-white truncate">{c.title}</p>
                    <p className="text-[10px] text-slate-500">{c.category}</p>
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                    c.status === 'LIVE' ? 'bg-green-500/10 text-green-400' :
                    c.status === 'REGISTRATION_OPEN' ? 'bg-blue-500/10 text-blue-400' :
                    'bg-slate-500/10 text-slate-400'
                  }`}>
                    {c.status}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

// ── Stat Card Component ──
function StatCard({ label, value, icon: Icon, color, format }: {
  label: string; value: number; icon: any; color: string; format?: string;
}) {
  const displayValue = format === 'currency'
    ? `Rp ${value.toLocaleString('id-ID')}`
    : value.toLocaleString('id-ID');

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[11px] text-slate-500">{label}</p>
        <Icon size={16} className={`text-${color}-400`} />
      </div>
      <p className="text-xl font-bold text-white">{displayValue}</p>
    </Card>
  );
}

// ── Chart Card Component ──
function ChartCard({ title, data, chartType, color, onToggleType, valueType, showArea }: {
  title: string; data: any[]; chartType: ChartType; color: string;
  onToggleType: () => void; valueType: 'number' | 'currency'; showArea?: boolean;
}) {
  const formatValue = (v: number) => {
    if (valueType === 'currency') return `Rp ${(v / 1000).toFixed(0)}K`;
    return String(v);
  };

  const renderChart = () => {
    if (data.length === 0) {
      return <p className="text-xs text-slate-500 text-center py-8">Belum ada data</p>;
    }

    switch (chartType) {
      case 'line':
        return (
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#64748b' }} />
              <YAxis tick={{ fontSize: 10, fill: '#64748b' }} tickFormatter={formatValue} />
              <Tooltip
                contentStyle={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }}
                formatter={(v: any) => [valueType === 'currency' ? `Rp ${Number(v).toLocaleString('id-ID')}` : v, ""]}
              />
              <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
            </LineChart>
          </ResponsiveContainer>
        );
      case 'bar':
        return (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#64748b' }} />
              <YAxis tick={{ fontSize: 10, fill: '#64748b' }} tickFormatter={formatValue} />
              <Tooltip
                contentStyle={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }}
                formatter={(v: any) => [valueType === 'currency' ? `Rp ${Number(v).toLocaleString('id-ID')}` : v, ""]}
              />
              <Bar dataKey="value" fill={color} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        );
      case 'area':
      case 'pie':
      default:
        return (
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#64748b' }} />
              <YAxis tick={{ fontSize: 10, fill: '#64748b' }} tickFormatter={formatValue} />
              <Tooltip
                contentStyle={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }}
                formatter={(v: any) => [valueType === 'currency' ? `Rp ${Number(v).toLocaleString('id-ID')}` : v, ""]}
              />
              <Area type="monotone" dataKey="value" stroke={color} fill={color} fillOpacity={0.15} strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        );
    }
  };

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        <button
          onClick={onToggleType}
          className="text-[10px] text-slate-500 hover:text-slate-300 flex items-center gap-1 px-2 py-1 rounded bg-ink-800 transition"
        >
          <BarChart3 size={10} />
          {chartType}
        </button>
      </div>
      {renderChart()}
    </Card>
  );
}
