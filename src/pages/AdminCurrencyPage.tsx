import { toast } from '@/lib/toast';
import { useEffect, useState, useCallback } from 'react';
import {
  ArrowLeft, Coins, TrendingUp, TrendingDown, Search, Clock,
  History, User as UserIcon, Plus, Minus, AlertCircle, CheckCircle2,
  RefreshCw, ShieldCheck,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';
import {
  searchUsersForCurrency,
  adjustUserCurrency,
  getUserCurrencyLogs,
  getAllCurrencyLogs,
  type UserCurrencyInfo,
  type CurrencyAdjustmentLog,
  type CurrencyType,
} from '@/services/adminCurrency.service';

type Tab = 'adjust' | 'history';

export function AdminCurrencyPage() {
  const [tab, setTab] = useState<Tab>('adjust');
  const [searchQuery, setSearchQuery] = useState('');
  const [users, setUsers] = useState<UserCurrencyInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);

  // Selected user state
  const [selectedUser, setSelectedUser] = useState<UserCurrencyInfo | null>(null);

  // Adjustment form state
  const [currencyType, setCurrencyType] = useState<CurrencyType>('xp');
  const [delta, setDelta] = useState<string>('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // User-specific logs
  const [userLogs, setUserLogs] = useState<CurrencyAdjustmentLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

  // Global logs
  const [allLogs, setAllLogs] = useState<CurrencyAdjustmentLog[]>([]);
  const [loadingAllLogs, setLoadingAllLogs] = useState(false);

  // Initial load: show recent users
  const loadUsers = useCallback(async (query = '') => {
    setSearching(true);
    try {
      const results = await searchUsersForCurrency(query, 30);
      setUsers(results);
    } catch (err: any) {
      console.error('[AdminCurrency] search failed', err);
      toast.error(err?.message ?? 'Gagal mencari pengguna.');
    } finally {
      setSearching(false);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadUsers('');
  }, [loadUsers]);

  // Search debounced
  useEffect(() => {
    if (!searchQuery.trim()) {
      void loadUsers('');
      return;
    }
    const timer = setTimeout(() => void loadUsers(searchQuery), 350);
    return () => clearTimeout(timer);
  }, [searchQuery, loadUsers]);

  // Load user-specific logs when a user is selected
  useEffect(() => {
    if (!selectedUser) { setUserLogs([]); return; }
    let on = true;
    setLoadingLogs(true);
    getUserCurrencyLogs(selectedUser.id, 30)
      .then((logs) => { if (on) setUserLogs(logs); })
      .catch((err) => { console.warn('[AdminCurrency] user logs failed', err); if (on) setUserLogs([]); })
      .finally(() => { if (on) setLoadingLogs(false); });
    return () => { on = false; };
  }, [selectedUser]);

  // Load all logs when switching to history tab
  useEffect(() => {
    if (tab !== 'history') return;
    let on = true;
    setLoadingAllLogs(true);
    getAllCurrencyLogs(100)
      .then((logs) => { if (on) setAllLogs(logs); })
      .catch((err) => { console.warn('[AdminCurrency] all logs failed', err); if (on) setAllLogs([]); })
      .finally(() => { if (on) setLoadingAllLogs(false); });
    return () => { on = false; };
  }, [tab]);

  // Submit adjustment
  const handleSubmit = async () => {
    if (!selectedUser || !delta.trim() || !reason.trim()) return;

    const amount = parseInt(delta, 10);
    if (isNaN(amount) || amount === 0) {
      toast.error('Jumlah harus berupa angka bulat bukan nol.');
      return;
    }

    setSubmitting(true);
    try {
      const log = await adjustUserCurrency(selectedUser.id, currencyType, amount, reason.trim());
      toast.success(`${currencyType === 'xp' ? 'XP' : 'Coin EDU'} berhasil diubah!`);

      // Update local state to reflect new balance
      setSelectedUser((prev) => {
        if (!prev) return prev;
        if (currencyType === 'xp') {
          return { ...prev, total_xp: log.balance_after };
        }
        return { ...prev, edu_coin: log.balance_after };
      });

      // Refresh user in the list
      setUsers((prev) =>
        prev.map((u) => {
          if (u.id !== selectedUser.id) return u;
          if (currencyType === 'xp') return { ...u, total_xp: log.balance_after };
          return { ...u, edu_coin: log.balance_after };
        })
      );

      // Prepend log
      setUserLogs((prev) => [log, ...prev]);
      setAllLogs((prev) => [log, ...prev]);

      // Reset form
      setDelta('');
      setReason('');
    } catch (err: any) {
      console.error('[AdminCurrency] adjust failed', err);
      toast.error(err?.message ?? 'Gagal mengubah currency.');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Render ──
  return (
    <div className="min-h-screen surface-bg text-fg-secondary">
      {/* ═══ HEADER ═══ */}
      <div className="sticky top-0 z-30 glass border-b surface-border">
        <div className="px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              to="/admin"
              className="p-2 rounded-lg hover:bg-surface-elevated/50 text-slate-400 hover:text-fg text-xs transition"
            >
              <ArrowLeft size={18} />
            </Link>
            <div>
              <p className="text-[10px] text-accent font-semibold uppercase tracking-wide">SYKABELAJAR</p>
              <h1 className="font-display font-bold text-base text-white leading-tight">
                Kelola XP & Coin EDU
              </h1>
            </div>
          </div>
          <Badge color="moss">ADMIN</Badge>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-4 pb-2">
          {([
            { key: 'adjust' as const, label: 'Atur Currency', icon: Coins },
            { key: 'history' as const, label: 'Riwayat', icon: History },
          ]).map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-all duration-200 ${
                tab === key
                  ? 'bg-moss-500/15 text-accent shadow-sm shadow-moss-500/10'
                  : 'text-slate-500 hover:bg-surface-elevated/50 hover:text-fg-secondary active:scale-95'
              }`}
            >
              <Icon size={15} />
              {label}
            </button>
          ))}
        </div>
      </div>

      <section className="p-4 md:p-6 max-w-6xl mx-auto space-y-5">
        {/* ═══ TAB: ADJUST ═══ */}
        {tab === 'adjust' && (
          <>
            {/* Security notice */}
            <Card className="p-4 border-amber-500/15 bg-amber-500/[0.04]">
              <div className="flex items-start gap-3">
                <ShieldCheck size={18} className="text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs text-amber-300 font-semibold">Mode Admin</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Semua perubahan tercatat di audit log dan hanya dapat dilakukan oleh admin.
                    Saldo tidak boleh menjadi negatif.
                  </p>
                </div>
              </div>
            </Card>

            {/* Search bar */}
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                className="input pl-9"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cari nama atau username pengguna..."
              />
              {searching && (
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500">
                  Mencari...
                </span>
              )}
            </div>

            {/* Selected user card + adjustment form */}
            {selectedUser && (
              <AdjustmentPanel
                user={selectedUser}
                currencyType={currencyType}
                setCurrencyType={setCurrencyType}
                delta={delta}
                setDelta={setDelta}
                reason={reason}
                setReason={setReason}
                submitting={submitting}
                onSubmit={handleSubmit}
                onCancel={() => setSelectedUser(null)}
                userLogs={userLogs}
                loadingLogs={loadingLogs}
              />
            )}

            {/* User list */}
            {!selectedUser && (
              <div className="space-y-2">
                {loading && (
                  <Card className="p-8 text-center text-sm text-slate-500">Memuat pengguna...</Card>
                )}

                {!loading && users.length === 0 && (
                  <Card className="p-8 text-center text-sm text-slate-500">
                    Pengguna tidak ditemukan.
                  </Card>
                )}

                {!loading &&
                  users.map((u) => (
                    <button
                      key={u.id}
                      onClick={() => {
                        setSelectedUser(u);
                        setCurrencyType('xp');
                        setDelta('');
                        setReason('');
                      }}
                      className="w-full text-left group"
                    >
                      <div className="flex items-center gap-3 p-4 rounded-xl surface-card-bg border surface-border hover:border-moss-500/20 hover:surface-elevated transition-all duration-200 cursor-pointer active:scale-[0.99]">
                        <Avatar
                          name={u.full_name || u.username || 'U'}
                          id={u.id}
                          size={42}
                          src={u.avatar_url || undefined}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-fg group-hover:text-accent transition truncate">
                            {u.full_name || u.username || 'Pengguna'}
                          </p>
                          <p className="text-[11px] text-slate-500 truncate">
                            @{u.username || '—'} · {u.institution || '—'}
                          </p>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <div className="text-right">
                            <p className="text-[10px] text-amber-400 font-medium">XP</p>
                            <p className="text-xs font-semibold text-fg tabular-nums">
                              {Number(u.total_xp).toLocaleString('id-ID')}
                            </p>
                          </div>
                          <div className="w-px h-6 bg-white/5" />
                          <div className="text-right">
                            <p className="text-[10px] text-purple-400 font-medium">Coin</p>
                            <p className="text-xs font-semibold text-fg tabular-nums">
                              {Number(u.edu_coin).toLocaleString('id-ID')}
                            </p>
                          </div>
                        </div>
                      </div>
                    </button>
                  ))}
              </div>
            )}
          </>
        )}

        {/* ═══ TAB: HISTORY ═══ */}
        {tab === 'history' && (
          <>
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-display text-lg font-bold text-fg">Riwayat Penyesuaian</h2>
                <p className="text-[11px] text-slate-500 mt-0.5">Semua aktivitas admin terhadap currency pengguna.</p>
              </div>
              <Button
                size="sm"
                variant="outline"
                icon={<RefreshCw size={14} />}
                onClick={() => {
                  setLoadingAllLogs(true);
                  getAllCurrencyLogs(100)
                    .then(setAllLogs)
                    .catch((err) => toast.error(err?.message ?? 'Gagal memuat'))
                    .finally(() => setLoadingAllLogs(false));
                }}
              >
                Refresh
              </Button>
            </div>

            {loadingAllLogs && (
              <Card className="p-8 text-center text-sm text-slate-500">Memuat riwayat...</Card>
            )}

            {!loadingAllLogs && allLogs.length === 0 && (
              <Card className="p-8 text-center text-sm text-slate-500">Belum ada riwayat penyesuaian.</Card>
            )}

            {!loadingAllLogs && allLogs.length > 0 && (
              <div className="space-y-1.5">
                {allLogs.map((log) => (
                  <LogEntry key={log.id} log={log} />
                ))}
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

// ═══════════════════════════════════════════════
// Adjustment Panel — shown when a user is selected
// ═══════════════════════════════════════════════
function AdjustmentPanel({
  user,
  currencyType,
  setCurrencyType,
  delta,
  setDelta,
  reason,
  setReason,
  submitting,
  onSubmit,
  onCancel,
  userLogs,
  loadingLogs,
}: {
  user: UserCurrencyInfo;
  currencyType: CurrencyType;
  setCurrencyType: (v: CurrencyType) => void;
  delta: string;
  setDelta: (v: string) => void;
  reason: string;
  setReason: (v: string) => void;
  submitting: boolean;
  onSubmit: () => void;
  onCancel: () => void;
  userLogs: CurrencyAdjustmentLog[];
  loadingLogs: boolean;
}) {
  const amount = parseInt(delta, 10);
  const isInvalid = isNaN(amount) || amount === 0;
  const wouldGoNegative =
    !isInvalid &&
    currencyType === 'xp' &&
    amount < 0 &&
    Math.abs(amount) > user.total_xp;
  const wouldGoNegativeCoin =
    !isInvalid &&
    currencyType === 'edu_coin' &&
    amount < 0 &&
    Math.abs(amount) > user.edu_coin;

  const currentBalance = currencyType === 'xp' ? user.total_xp : user.edu_coin;
  const newBalance = isInvalid ? currentBalance : currentBalance + amount;

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Back button + User info */}
      <Card className="p-4">
        <div className="flex items-center gap-4">
          <button
            onClick={onCancel}
            className="p-2 rounded-lg hover:bg-surface-elevated/50 text-slate-400 hover:text-fg transition"
          >
            <ArrowLeft size={16} />
          </button>
          <Avatar
            name={user.full_name || user.username || 'U'}
            id={user.id}
            size={48}
            src={user.avatar_url || undefined}
          />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-fg truncate">
              {user.full_name || user.username || 'Pengguna'}
            </p>
            <p className="text-[11px] text-slate-500 truncate">
              @{user.username || '—'} · {user.institution || '—'}
            </p>
          </div>
          <div className="flex gap-4 shrink-0">
            <div className="text-center">
              <p className="text-[10px] text-amber-400 font-medium uppercase">Total XP</p>
              <p className="text-lg font-bold text-fg tabular-nums">
                {Number(user.total_xp).toLocaleString('id-ID')}
              </p>
            </div>
            <div className="w-px h-10 bg-white/5 self-center" />
            <div className="text-center">
              <p className="text-[10px] text-purple-400 font-medium uppercase">Coin EDU</p>
              <p className="text-lg font-bold text-fg tabular-nums">
                {Number(user.edu_coin).toLocaleString('id-ID')}
              </p>
            </div>
          </div>
        </div>
      </Card>

      {/* Adjustment Form */}
      <Card className="p-5">
        <h3 className="text-sm font-semibold text-fg mb-4 flex items-center gap-2">
          <Coins size={16} className="text-accent" />
          Penyesuaian Currency
        </h3>

        {/* Currency Type Toggle */}
        <div className="mb-4">
          <label className="text-xs text-slate-400 font-medium mb-2 block">Jenis Currency</label>
          <div className="flex gap-2">
            {([
              { value: 'xp' as const, label: 'XP', color: 'amber', icon: TrendingUp },
              { value: 'edu_coin' as const, label: 'Coin EDU', color: 'purple', icon: Coins },
            ]).map(({ value, label, color, icon: Icon }) => (
              <button
                key={value}
                onClick={() => setCurrencyType(value)}
                className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200 border ${
                  currencyType === value
                    ? color === 'amber'
                      ? 'border-amber-500/30 bg-amber-500/10 text-amber-300 shadow-sm shadow-amber-500/10'
                      : 'border-purple-500/30 bg-purple-500/10 text-purple-300 shadow-sm shadow-purple-500/10'
                    : 'surface-border surface-elevated text-slate-500 hover:text-fg-secondary'
                }`}
              >
                <Icon size={16} />
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Current balance display */}
        <div className={`mb-4 p-3 rounded-xl border ${
          currencyType === 'xp'
            ? 'border-amber-500/15 bg-amber-500/[0.04]'
            : 'border-purple-500/15 bg-purple-500/[0.04]'
        }`}>
          <p className="text-[11px] text-slate-400">Saldo saat ini</p>
          <p className="text-xl font-bold text-fg tabular-nums mt-0.5">
            {Number(currentBalance).toLocaleString('id-ID')}
            <span className="text-xs text-slate-500 font-normal ml-1.5">
              {currencyType === 'xp' ? 'XP' : 'EDU'}
            </span>
          </p>
        </div>

        {/* Amount input */}
        <div className="mb-4">
          <label className="text-xs text-slate-400 font-medium mb-2 block">Jumlah (delta)</label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                type="number"
                className="input pl-9 text-lg font-semibold tabular-nums"
                value={delta}
                onChange={(e) => setDelta(e.target.value)}
                placeholder="0"
                min={-999999}
                max={999999}
                disabled={submitting}
              />
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">
                {amount >= 0 ? <Plus size={15} /> : <Minus size={15} />}
              </span>
            </div>
            <div className="flex gap-1">
              {[
                { val: 10, label: '+10' },
                { val: 50, label: '+50' },
                { val: 100, label: '+100' },
                { val: 500, label: '+500' },
              ].map(({ val, label }) => (
                <button
                  key={val}
                  onClick={() => setDelta(String(val))}
                  className="px-2.5 py-2 rounded-lg text-[11px] font-medium bg-moss-500/10 text-accent hover:bg-moss-500/20 transition active:scale-95"
                  disabled={submitting}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Negative amount warning buttons */}
          <div className="flex gap-1 mt-2">
            {[
              { val: -10, label: '-10' },
              { val: -50, label: '-50' },
              { val: -100, label: '-100' },
              { val: -500, label: '-500' },
            ].map(({ val, label }) => (
              <button
                key={val}
                onClick={() => setDelta(String(val))}
                className="px-2.5 py-2 rounded-lg text-[11px] font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 transition active:scale-95"
                disabled={submitting}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Warnings */}
          {wouldGoNegative && (
            <p className="text-[11px] text-red-400 mt-2 flex items-center gap-1">
              <AlertCircle size={12} />
              XP tidak cukup. Saldo saat ini: {user.total_xp.toLocaleString('id-ID')}
            </p>
          )}
          {wouldGoNegativeCoin && (
            <p className="text-[11px] text-red-400 mt-2 flex items-center gap-1">
              <AlertCircle size={12} />
              Coin EDU tidak cukup. Saldo saat ini: {user.edu_coin.toLocaleString('id-ID')}
            </p>
          )}
        </div>

        {/* Preview new balance */}
        {!isInvalid && (
          <div className={`mb-4 p-3 rounded-xl border transition-all ${
            newBalance < 0
              ? 'border-red-500/20 bg-red-500/[0.04]'
              : 'border-moss-500/20 bg-moss-500/[0.04]'
          }`}>
            <p className="text-[11px] text-slate-400">Saldo setelah perubahan</p>
            <p className={`text-lg font-bold tabular-nums mt-0.5 ${
              newBalance < 0 ? 'text-red-400' : 'text-accent'
            }`}>
              {newBalance.toLocaleString('id-ID')}
              <span className="text-xs text-slate-500 font-normal ml-1.5">
                {currencyType === 'xp' ? 'XP' : 'EDU'}
              </span>
              {amount !== 0 && (
                <span className={`text-xs font-normal ml-2 ${
                  amount > 0 ? 'text-green-400' : 'text-red-400'
                }`}>
                  {amount > 0 ? '+' : ''}{amount.toLocaleString('id-ID')}
                </span>
              )}
            </p>
          </div>
        )}

        {/* Reason input */}
        <div className="mb-5">
          <label className="text-xs text-slate-400 font-medium mb-2 block">Alasan / Keterangan</label>
          <input
            className="input"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Contoh: Bonus lomba juara 1, Koreksi kesalahan, dll."
            disabled={submitting}
            maxLength={200}
          />
          <p className="text-[10px] text-slate-600 mt-1">{reason.length}/200</p>
        </div>

        {/* Action buttons */}
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={onCancel}
            disabled={submitting}
          >
            Batal
          </Button>
          <Button
            onClick={onSubmit}
            loading={submitting}
            disabled={isInvalid || !reason.trim() || wouldGoNegative || wouldGoNegativeCoin}
            icon={
              amount >= 0
                ? <CheckCircle2 size={15} />
                : <AlertCircle size={15} />
            }
          >
            {amount >= 0 ? 'Tambahkan' : 'Kurangkan'}{' '}
            {currencyType === 'xp' ? 'XP' : 'Coin EDU'}
          </Button>
        </div>
      </Card>

      {/* User's recent adjustment logs */}
      <Card className="p-5">
        <h3 className="text-sm font-semibold text-fg mb-4 flex items-center gap-2">
          <Clock size={16} className="text-accent" />
          Riwayat Pengguna Ini
        </h3>

        {loadingLogs && (
          <p className="text-xs text-slate-500 text-center py-4">Memuat riwayat...</p>
        )}

        {!loadingLogs && userLogs.length === 0 && (
          <p className="text-xs text-slate-500 text-center py-4">Belum ada riwayat penyesuaian untuk pengguna ini.</p>
        )}

        {!loadingLogs && userLogs.length > 0 && (
          <div className="space-y-1.5">
            {userLogs.map((log) => (
              <LogEntry key={log.id} log={log} />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════
// LogEntry — single row in the audit log
// ═══════════════════════════════════════════════
function LogEntry({ log }: { log: CurrencyAdjustmentLog }) {
  const isXp = log.currency_type === 'xp';
  const isPositive = log.delta >= 0;
  const timeStr = new Date(log.created_at).toLocaleString('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.02] border surface-border transition hover:bg-white/[0.04]">
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
        isPositive
          ? 'bg-green-500/10 text-green-400'
          : 'bg-red-500/10 text-red-400'
      }`}>
        {isPositive ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-fg truncate">
          {isXp ? 'XP' : 'Coin EDU'}
          {log.target_username ? (
            <span className="text-slate-500"> → @{log.target_username}</span>
          ) : null}
        </p>
        <p className="text-[11px] text-slate-500 truncate">{log.reason}</p>
      </div>
      <div className="text-right shrink-0">
        <p className={`text-sm font-bold tabular-nums ${isPositive ? 'text-green-400' : 'text-red-400'}`}>
          {isPositive ? '+' : ''}{log.delta.toLocaleString('id-ID')}
        </p>
        <p className="text-[10px] text-slate-600 tabular-nums">
          {log.balance_before.toLocaleString('id-ID')} → {log.balance_after.toLocaleString('id-ID')}
        </p>
      </div>
      <p className="text-[10px] text-slate-600 shrink-0 hidden sm:block w-28 text-right">{timeStr}</p>
    </div>
  );
}
