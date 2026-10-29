import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, Copy, CreditCard, Eye, FileClock,
  History, RefreshCw, Search, ShieldCheck, X, XCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { formatRupiah, formatShortDate } from '@/lib/utils';
import { adminReviewManualOrder } from '@/services/commerce.service';
import { supabase } from '@/lib/supabase';
import { useApp } from '@/store/AppContext';

type AdminPaymentOrder = Record<string, any>;
type FilterKey = 'ALL' | 'PENDING' | 'MANUAL_REVIEW' | 'PAID' | 'CANCELLED';
type HistoryItem = {
  id: string;
  kind: 'provider' | 'admin';
  title: string;
  status: string;
  created_at: string;
  provider?: string | null;
  reference?: string | null;
  actor?: string | null;
  reason?: string | null;
};

const PAGE_SIZES = [25, 50, 100];

function orderStatusLabel(status: string) {
  const value = String(status ?? '').toUpperCase();
  if (value === 'PAID') return 'Lunas';
  if (value === 'PROCESSING') return 'Diproses';
  if (value === 'SHIPPED') return 'Dikirim';
  if (value === 'COMPLETED') return 'Selesai';
  if (value === 'CANCELLED' || value === 'CANCELED') return 'Dibatalkan';
  if (value === 'REFUNDED') return 'Dikembalikan';
  if (value === 'PENDING_PAYMENT' || value === 'PENDING') return 'Menunggu pembayaran';
  return value || 'Tidak diketahui';
}

function paymentAmount(order: AdminPaymentOrder) {
  const amount = Number(order.total ?? 0);
  return String(order.currency ?? 'IDR').toUpperCase() === 'IDR'
    ? formatRupiah(amount)
    : amount.toLocaleString('id-ID') + ' ' + String(order.currency ?? '');
}

function firstItem(order: AdminPaymentOrder) {
  return Array.isArray(order.order_items) ? order.order_items[0] : order.order_items;
}

function isGlobalGateway(order: AdminPaymentOrder) {
  return ['GLOBAL', 'MIDTRANS', 'XENITHPAY'].includes(String(order.payment_provider ?? '').toUpperCase())
    || order.payment_method_details?.global_gateway === true;
}

function isPending(order: AdminPaymentOrder) {
  return ['PENDING_PAYMENT', 'PENDING'].includes(String(order.status ?? '').toUpperCase());
}

function isAdminConfirmed(intent: AdminPaymentOrder | null | undefined) {
  return String(intent?.raw_meta?.admin_override?.source ?? '') === 'ADMIN_MANUAL_CONFIRMATION';
}

function intentLabel(intent: AdminPaymentOrder | null | undefined) {
  if (!intent) return 'Belum ada sesi';
  if (isAdminConfirmed(intent)) return 'Dikonfirmasi admin';
  const status = String(intent.status ?? '').toUpperCase();
  if (status === 'PAID') return 'Lunas via gateway';
  if (status === 'PENDING') return 'Menunggu konfirmasi gateway';
  if (status === 'PROCESSING') return 'Sedang diproses gateway';
  return status || 'Status tidak tersedia';
}

function searchSafe(value: string) {
  return value.replace(/[^\p{L}\p{N}@._+\-\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function StatusBadge({ order }: { order: AdminPaymentOrder }) {
  const status = String(order.status ?? '').toUpperCase();
  if (status === 'PAID' && isAdminConfirmed(order.payment_intent)) return <Badge color="info">Selesai oleh admin</Badge>;
  if (['PAID', 'COMPLETED'].includes(status)) return <Badge color="moss">{orderStatusLabel(status)}</Badge>;
  if (isPending(order)) return <Badge color="info">{orderStatusLabel(status)}</Badge>;
  return <Badge>{orderStatusLabel(status)}</Badge>;
}

export function AdminOrderPaymentsPanel() {
  const { toast } = useApp();
  const [orders, setOrders] = useState<AdminPaymentOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [filter, setFilter] = useState<FilterKey>('PENDING');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [totalRows, setTotalRows] = useState(0);
  const [summary, setSummary] = useState({ all: 0, pending: 0, manualReview: 0, paid: 0, cancelled: 0 });
  const [selected, setSelected] = useState<AdminPaymentOrder | null>(null);
  const [historyRows, setHistoryRows] = useState<HistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [busyOrderId, setBusyOrderId] = useState('');
  const [overrideOrder, setOverrideOrder] = useState<AdminPaymentOrder | null>(null);
  const [overrideReason, setOverrideReason] = useState('');
  const [verifiedExternally, setVerifiedExternally] = useState(false);
  const [overrideBusy, setOverrideBusy] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQuery(query.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const escapedSearch = searchSafe(debouncedQuery);
      let searchOrderIds: string[] = [];

      if (escapedSearch && !isUuid(escapedSearch)) {
        const pattern = '%' + escapedSearch + '%';
        const [{ data: itemMatches, error: itemSearchError }, { data: intentMatches, error: intentSearchError }] = await Promise.all([
          supabase.from('order_items').select('order_id').ilike('name', pattern).limit(200),
          supabase.from('payment_intents').select('order_id').ilike('provider_reference', pattern).limit(200),
        ]);
        if (itemSearchError) throw itemSearchError;
        if (intentSearchError) throw intentSearchError;
        searchOrderIds = [...new Set([
          ...(itemMatches ?? []).map((row: any) => String(row.order_id)),
          ...(intentMatches ?? []).map((row: any) => String(row.order_id)),
        ])];
      }

      const selection = 'id,user_id,status,total,currency,created_at,updated_at,payment_method,payment_provider,payment_method_id,payment_proof_url,payment_proof_status,admin_review_note,reviewed_at,contact_name,contact_email,contact_whatsapp,contact_note,contact_fields,order_items(id,name,product_type,product_ref,quantity,unit_price,line_total,metadata)';
      let request = supabase.from('orders').select(selection, { count: 'exact' }).order('created_at', { ascending: false }).order('id', { ascending: false });

      if (filter === 'PENDING') request = request.in('status', ['PENDING_PAYMENT', 'PENDING']);
      if (filter === 'MANUAL_REVIEW') {
        request = request.in('status', ['PENDING_PAYMENT', 'PENDING'])
          .eq('payment_proof_status', 'SUBMITTED')
          .not('payment_provider', 'in', '(GLOBAL,MIDTRANS,XENITHPAY)');
      }
      if (filter === 'PAID') request = request.in('status', ['PAID', 'COMPLETED', 'PROCESSING', 'SHIPPED']);
      if (filter === 'CANCELLED') request = request.in('status', ['CANCELLED', 'CANCELED', 'REFUNDED']);

      if (escapedSearch) {
        if (isUuid(escapedSearch)) {
          request = request.or('id.eq.' + escapedSearch + ',user_id.eq.' + escapedSearch);
        } else {
          const terms = [
            'contact_name.ilike.%' + escapedSearch + '%',
            'contact_email.ilike.%' + escapedSearch + '%',
            'contact_whatsapp.ilike.%' + escapedSearch + '%',
            'payment_method.ilike.%' + escapedSearch + '%',
            'payment_provider.ilike.%' + escapedSearch + '%',
          ];
          if (searchOrderIds.length) terms.push('id.in.(' + searchOrderIds.join(',') + ')');
          request = request.or(terms.join(','));
        }
      }

      const from = (page - 1) * pageSize;
      const [{ data, error, count }, allCount, pendingCount, manualCount, paidCount, cancelledCount] = await Promise.all([
        request.range(from, from + pageSize - 1),
        supabase.from('orders').select('id', { count: 'exact', head: true }),
        supabase.from('orders').select('id', { count: 'exact', head: true }).in('status', ['PENDING_PAYMENT', 'PENDING']),
        supabase.from('orders').select('id', { count: 'exact', head: true }).in('status', ['PENDING_PAYMENT', 'PENDING']).eq('payment_proof_status', 'SUBMITTED').not('payment_provider', 'in', '(GLOBAL,MIDTRANS,XENITHPAY)'),
        supabase.from('orders').select('id', { count: 'exact', head: true }).in('status', ['PAID', 'COMPLETED', 'PROCESSING', 'SHIPPED']),
        supabase.from('orders').select('id', { count: 'exact', head: true }).in('status', ['CANCELLED', 'CANCELED', 'REFUNDED']),
      ]);
      if (error) throw error;

      setTotalRows(count ?? 0);
      setSummary({
        all: allCount.count ?? 0,
        pending: pendingCount.count ?? 0,
        manualReview: manualCount.count ?? 0,
        paid: paidCount.count ?? 0,
        cancelled: cancelledCount.count ?? 0,
      });

      const ids = (data ?? []).map((row: any) => String(row.id));
      let intentRows: any[] = [];
      if (ids.length) {
        const { data: intents, error: intentError } = await supabase
          .from('payment_intents')
          .select('id,order_id,provider,provider_reference,amount,status,raw_meta,created_at,updated_at')
          .in('order_id', ids)
          .order('updated_at', { ascending: false });
        if (intentError) throw intentError;
        intentRows = intents ?? [];
      }

      const intentByOrder = new Map<string, any>();
      for (const intent of intentRows) {
        const id = String(intent.order_id);
        if (!intentByOrder.has(id)) intentByOrder.set(id, intent);
      }
      const paymentMethods = new Map<string, any>();
      const methodIds = [...new Set((data ?? []).map((row: any) => String(row.payment_method_id ?? '')).filter(Boolean))];
      if (methodIds.length) {
        const { data: methodRows, error: methodError } = await supabase.from('organizer_payment_methods').select('id,details').in('id', methodIds);
        if (!methodError) for (const method of methodRows ?? []) paymentMethods.set(String(method.id), method);
      }
      const rows = (data ?? []).map((row: any) => ({
        ...row,
        payment_intent: intentByOrder.get(String(row.id)) ?? null,
        payment_method_details: paymentMethods.get(String(row.payment_method_id ?? ''))?.details ?? null,
      }));
      setOrders(rows);
    } catch (error: any) {
      toast(error?.message || 'Gagal memuat riwayat pembayaran.', 'error');
    } finally {
      setLoading(false);
    }
  }, [debouncedQuery, filter, page, pageSize, toast]);

  useEffect(() => { void load(); }, [load]);

  const openDetails = async (order: AdminPaymentOrder) => {
    setSelected(order);
    setHistoryRows([]);
    setHistoryLoading(true);
    try {
      const [auditResult, eventResult] = await Promise.all([
        supabase.from('audit_logs').select('id,actor_user_id,action,entity_type,entity_id,reason,created_at').eq('entity_type', 'order').eq('entity_id', String(order.id)).order('created_at', { ascending: false }).limit(30),
        order.payment_intent?.id
          ? supabase.from('payment_events').select('id,provider,provider_event_id,status,created_at').eq('payment_intent_id', String(order.payment_intent.id)).order('created_at', { ascending: false }).limit(30)
          : Promise.resolve({ data: [], error: null } as any),
      ]);
      if (auditResult.error) throw auditResult.error;
      if (eventResult.error) throw eventResult.error;
      const audits: HistoryItem[] = (auditResult.data ?? []).map((row: any) => ({
        id: 'audit-' + row.id,
        kind: 'admin',
        title: String(row.action ?? 'Perubahan admin'),
        status: 'ADMIN',
        created_at: String(row.created_at),
        actor: row.actor_user_id == null ? null : String(row.actor_user_id),
        reason: row.reason == null ? null : String(row.reason),
      }));
      const events: HistoryItem[] = (eventResult.data ?? []).map((row: any) => ({
        id: 'event-' + row.id,
        kind: 'provider',
        title: 'Event gateway',
        status: String(row.status ?? 'UNKNOWN'),
        created_at: String(row.created_at),
        provider: row.provider == null ? null : String(row.provider),
        reference: row.provider_event_id == null ? null : String(row.provider_event_id),
      }));
      setHistoryRows([...audits, ...events].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()));
    } catch (error: any) {
      toast(error?.message || 'Riwayat audit pembayaran gagal dimuat.', 'error');
    } finally {
      setHistoryLoading(false);
    }
  };

  const review = async (order: AdminPaymentOrder, decision: 'APPROVE' | 'REJECT') => {
    const id = String(order.id);
    if (!id || busyOrderId) return;
    if (isGlobalGateway(order)) {
      toast('Untuk gateway, gunakan Selesaikan oleh admin hanya setelah transaksi diverifikasi secara independen.', 'error');
      return;
    }
    if (decision === 'APPROVE' && !window.confirm('Setujui bukti pembayaran pesanan #' + id.slice(0, 8) + '? Manfaat produk akan diproses oleh backend.')) return;
    const reason = decision === 'REJECT' ? window.prompt('Tuliskan alasan penolakan bukti pembayaran:') : '';
    if (decision === 'REJECT' && !String(reason ?? '').trim()) return;

    setBusyOrderId(id);
    try {
      await adminReviewManualOrder(id, decision, String(reason ?? ''));
      toast(decision === 'APPROVE' ? 'Pembayaran manual disetujui.' : 'Bukti pembayaran manual ditolak.', 'success');
      setSelected(null);
      await load();
    } catch (error: any) {
      toast(error?.message || 'Keputusan pembayaran gagal disimpan.', 'error');
    } finally {
      setBusyOrderId('');
    }
  };

  const confirmByAdmin = async () => {
    if (!overrideOrder || overrideBusy) return;
    const id = String(overrideOrder.id);
    const reason = overrideReason.trim();
    if (reason.length < 8 || !verifiedExternally) return;

    setOverrideBusy(true);
    try {
      const { error } = await supabase.rpc('admin_force_complete_pending_order', { p_order_id: id, p_reason: reason });
      if (error) throw error;
      toast('Pembayaran dikonfirmasi oleh admin. Status, manfaat pesanan, dan log audit sudah diperbarui.', 'success');
      setOverrideOrder(null);
      setOverrideReason('');
      setVerifiedExternally(false);
      setSelected(null);
      await load();
    } catch (error: any) {
      toast(error?.message || 'Pesanan belum bisa diselesaikan oleh admin.', 'error');
    } finally {
      setOverrideBusy(false);
    }
  };

  const startAdminConfirm = (order: AdminPaymentOrder) => {
    setOverrideOrder(order);
    setOverrideReason('');
    setVerifiedExternally(false);
  };
  const canAdminConfirm = (order: AdminPaymentOrder) => isPending(order) && isGlobalGateway(order);

  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const rangeStart = totalRows === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, totalRows);

  return <section className="overflow-hidden rounded-3xl border border-surface-border bg-surface-elevated/10">
    <div className="border-b border-surface-border p-4 md:p-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-accent">Admin Commerce · Monitoring</p>
          <h2 className="mt-1 text-2xl font-bold text-fg">Pesanan & pembayaran</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-fg-muted">Cari dan tinjau status pembayaran semua pengguna. Daftar dimuat per halaman; riwayat provider dan tindakan admin tersedia pada detail setiap pesanan.</p>
        </div>
        <Button size="sm" variant="outline" disabled={loading} onClick={() => void load()}><RefreshCw size={14} className={loading ? 'mr-1 animate-spin' : 'mr-1'}/> Segarkan data</Button>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 xl:grid-cols-5">
        <button type="button" onClick={() => { setFilter('ALL'); setPage(1); }} className={'rounded-2xl border p-3 text-left transition ' + (filter === 'ALL' ? 'border-accent/40 bg-accent/5' : 'border-surface-border hover:bg-surface-elevated/30')}>
          <p className="text-xs text-fg-muted">Semua transaksi</p><p className="mt-1 text-2xl font-bold tabular-nums text-fg">{summary.all.toLocaleString('id-ID')}</p>
        </button>
        <button type="button" onClick={() => { setFilter('PENDING'); setPage(1); }} className={'rounded-2xl border p-3 text-left transition ' + (filter === 'PENDING' ? 'border-amber-500/40 bg-amber-500/5' : 'border-surface-border hover:bg-surface-elevated/30')}>
          <p className="text-xs text-fg-muted">Menunggu</p><p className="mt-1 text-2xl font-bold tabular-nums text-fg">{summary.pending.toLocaleString('id-ID')}</p>
        </button>
        <button type="button" onClick={() => { setFilter('MANUAL_REVIEW'); setPage(1); }} className={'rounded-2xl border p-3 text-left transition ' + (filter === 'MANUAL_REVIEW' ? 'border-amber-500/40 bg-amber-500/5' : 'border-surface-border hover:bg-surface-elevated/30')}>
          <p className="text-xs text-fg-muted">Perlu tinjauan</p><p className="mt-1 text-2xl font-bold tabular-nums text-fg">{summary.manualReview.toLocaleString('id-ID')}</p>
        </button>
        <button type="button" onClick={() => { setFilter('PAID'); setPage(1); }} className={'rounded-2xl border p-3 text-left transition ' + (filter === 'PAID' ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-surface-border hover:bg-surface-elevated/30')}>
          <p className="text-xs text-fg-muted">Lunas / diproses</p><p className="mt-1 text-2xl font-bold tabular-nums text-fg">{summary.paid.toLocaleString('id-ID')}</p>
        </button>
        <button type="button" onClick={() => { setFilter('CANCELLED'); setPage(1); }} className={'col-span-2 rounded-2xl border p-3 text-left transition sm:col-span-1 ' + (filter === 'CANCELLED' ? 'border-surface-border bg-surface-elevated/40' : 'border-surface-border hover:bg-surface-elevated/30')}>
          <p className="text-xs text-fg-muted">Dibatalkan / refund</p><p className="mt-1 text-2xl font-bold tabular-nums text-fg">{summary.cancelled.toLocaleString('id-ID')}</p>
        </button>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_220px_110px]">
        <label className="relative block">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted"/>
          <input className="input w-full pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nama, email, WhatsApp, produk, referensi, atau UUID lengkap" aria-label="Cari pembayaran"/>
        </label>
        <select className="input w-full" value={filter} onChange={(event) => { setFilter(event.target.value as FilterKey); setPage(1); }} aria-label="Filter status pembayaran">
          <option value="ALL">Semua transaksi</option>
          <option value="PENDING">Menunggu pembayaran</option>
          <option value="MANUAL_REVIEW">Perlu tinjauan manual</option>
          <option value="PAID">Lunas / diproses</option>
          <option value="CANCELLED">Dibatalkan / refund</option>
        </select>
        <select className="input w-full" value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }} aria-label="Jumlah transaksi per halaman">
          {PAGE_SIZES.map((size) => <option key={size} value={size}>{size} / halaman</option>)}
        </select>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-fg-muted">
        <span>{loading ? 'Memuat data…' : rangeStart.toLocaleString('id-ID') + '–' + rangeEnd.toLocaleString('id-ID') + ' dari ' + totalRows.toLocaleString('id-ID') + ' transaksi'}</span>
        {debouncedQuery && <button type="button" className="font-semibold text-accent hover:underline" onClick={() => { setQuery(''); setDebouncedQuery(''); setPage(1); }}>Hapus pencarian</button>}
      </div>
    </div>

    <div className="p-3 sm:p-4">
      {loading && <Card className="mb-3 flex items-center gap-2 p-4 text-sm text-fg-muted"><RefreshCw size={15} className="animate-spin"/> Memuat transaksi dan status terbaru…</Card>}
      {!loading && !orders.length && <Card className="p-10 text-center"><CreditCard size={24} className="mx-auto text-fg-muted"/><p className="mt-3 font-semibold text-fg">Tidak ada transaksi yang cocok</p><p className="mt-1 text-xs text-fg-muted">Ubah filter atau kata pencarian, lalu coba lagi.</p></Card>}

      {orders.length > 0 && <>
        <div className="hidden overflow-x-auto rounded-2xl border border-surface-border md:block">
          <table className="w-full min-w-[980px] border-collapse text-left">
            <thead className="sticky top-0 bg-surface-elevated text-[11px] uppercase tracking-wide text-fg-muted">
              <tr><th className="px-4 py-3 font-semibold">Pesanan / pengguna</th><th className="px-4 py-3 font-semibold">Metode / sesi</th><th className="px-4 py-3 text-right font-semibold">Nominal</th><th className="px-4 py-3 font-semibold">Status</th><th className="px-4 py-3 text-right font-semibold">Aksi</th></tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {orders.map((order) => {
                const item = firstItem(order);
                const id = String(order.id);
                const gateway = isGlobalGateway(order);
                const canReview = isPending(order) && String(order.payment_proof_status ?? '').toUpperCase() === 'SUBMITTED' && !gateway;
                return <tr key={id} className="align-top hover:bg-surface-elevated/20">
                  <td className="max-w-[360px] px-4 py-3">
                    <p className="truncate text-sm font-semibold text-fg">{item?.name || ('Pesanan #' + id.slice(0, 8))}</p>
                    <p className="mt-1 text-xs text-fg-muted">#{id.slice(0, 8)} · {formatShortDate(order.created_at)}</p>
                    <p className="mt-1 truncate text-xs text-fg">{order.contact_name || 'Nama tidak dicatat'}{order.contact_email ? ' · ' + order.contact_email : ''}</p>
                    <p className="mt-1 text-[11px] text-fg-muted">User {String(order.user_id ?? '').slice(0, 8)}{order.contact_whatsapp ? ' · ' + order.contact_whatsapp : ''}</p>
                  </td>
                  <td className="max-w-[240px] px-4 py-3"><p className="text-xs text-fg">{String(order.payment_method ?? 'Metode belum ditentukan')}</p><p className="mt-1 text-[11px] text-fg-muted">{String(order.payment_provider ?? 'Provider tidak dicatat')}</p>{gateway && <p className="mt-1 text-[11px] text-fg-muted">{intentLabel(order.payment_intent)}</p>}{!gateway && <p className="mt-1 text-[11px] text-fg-muted">Bukti: {String(order.payment_proof_status ?? 'NOT_SUBMITTED')}</p>}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-sm font-bold tabular-nums text-fg">{paymentAmount(order)}</td>
                  <td className="px-4 py-3"><StatusBadge order={order}/></td>
                  <td className="px-4 py-3"><div className="flex flex-wrap justify-end gap-1.5">
                    <Button size="sm" variant="outline" onClick={() => void openDetails(order)}><Eye size={13} className="mr-1"/>Detail</Button>
                    {canReview && <Button size="sm" disabled={Boolean(busyOrderId)} loading={busyOrderId === id} onClick={() => void review(order, 'APPROVE')}><CheckCircle2 size={13} className="mr-1"/>Setujui</Button>}
                    {canAdminConfirm(order) && <Button size="sm" variant="outline" disabled={Boolean(busyOrderId) || overrideBusy} onClick={() => startAdminConfirm(order)}><ShieldCheck size={13} className="mr-1"/>Selesaikan</Button>}
                  </div></td>
                </tr>;
              })}
            </tbody>
          </table>
        </div>

        <div className="space-y-3 md:hidden">
          {orders.map((order) => {
            const item = firstItem(order);
            const id = String(order.id);
            const gateway = isGlobalGateway(order);
            const canReview = isPending(order) && String(order.payment_proof_status ?? '').toUpperCase() === 'SUBMITTED' && !gateway;
            return <Card key={id} className="p-4">
              <div className="flex items-start gap-3"><div className="min-w-0 flex-1"><p className="break-words text-sm font-semibold text-fg">{item?.name || ('Pesanan #' + id.slice(0, 8))}</p><p className="mt-1 text-xs text-fg-muted">#{id.slice(0, 8)} · {formatShortDate(order.created_at)}</p><p className="mt-2 break-words text-xs text-fg">{order.contact_name || 'Nama tidak dicatat'}{order.contact_email ? ' · ' + order.contact_email : ''}</p></div><p className="whitespace-nowrap text-sm font-bold tabular-nums text-fg">{paymentAmount(order)}</p></div>
              <div className="mt-3 flex flex-wrap items-center gap-2"><StatusBadge order={order}/>{gateway && <Badge color="info">{String(order.payment_provider || 'Gateway')}</Badge>}</div>
              <p className="mt-2 text-xs text-fg-muted">{String(order.payment_method ?? 'Metode belum ditentukan')} · {gateway ? intentLabel(order.payment_intent) : 'Bukti: ' + String(order.payment_proof_status ?? 'NOT_SUBMITTED')}</p>
              <div className="mt-3 flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => void openDetails(order)}><Eye size={13} className="mr-1"/>Detail</Button>{canReview && <Button size="sm" disabled={Boolean(busyOrderId)} loading={busyOrderId === id} onClick={() => void review(order, 'APPROVE')}><CheckCircle2 size={13} className="mr-1"/>Setujui</Button>}{canAdminConfirm(order) && <Button size="sm" variant="outline" disabled={Boolean(busyOrderId) || overrideBusy} onClick={() => startAdminConfirm(order)}><ShieldCheck size={13} className="mr-1"/>Selesaikan oleh admin</Button>}</div>
            </Card>;
          })}
        </div>
      </>}

      <div className="mt-4 flex flex-col gap-3 border-t border-surface-border pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs leading-5 text-fg-muted">Riwayat keuangan tidak dihapus saat pengguna mengarsipkan pesanan. Gunakan konfirmasi admin hanya setelah nominal dan referensi diperiksa secara independen.</p>
        <div className="flex items-center justify-between gap-2 sm:justify-end"><Button size="sm" variant="outline" disabled={loading || page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Sebelumnya</Button><span className="whitespace-nowrap text-xs tabular-nums text-fg-muted">Halaman {page.toLocaleString('id-ID')} / {totalPages.toLocaleString('id-ID')}</span><Button size="sm" variant="outline" disabled={loading || page >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>Berikutnya</Button></div>
      </div>
    </div>

    {selected && <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-3 sm:p-5" onClick={(event) => { if (event.target === event.currentTarget) setSelected(null); }}>
      <Card className="max-h-[94vh] w-full max-w-3xl overflow-auto p-4 sm:p-6">
        <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-wider text-accent">Detail transaksi</p><h3 className="mt-1 break-words text-xl font-bold text-fg">{firstItem(selected)?.name || 'Detail pesanan'}</h3><p className="mt-1 break-all text-xs text-fg-muted">ID: {String(selected.id)}</p></div><button type="button" className="rounded-lg p-2 text-fg-muted hover:bg-surface-elevated" onClick={() => setSelected(null)} aria-label="Tutup detail"><X size={17}/></button></div>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-surface-border p-3"><p className="text-xs text-fg-muted">Total transaksi</p><p className="mt-1 text-lg font-bold text-fg">{paymentAmount(selected)}</p><p className="mt-1 text-xs text-fg-muted">{formatShortDate(selected.created_at)}</p></div>
          <div className="rounded-xl border border-surface-border p-3"><p className="text-xs text-fg-muted">Status pesanan</p><div className="mt-2"><StatusBadge order={selected}/></div><p className="mt-2 text-xs text-fg-muted">Bukti: {String(selected.payment_proof_status ?? 'NOT_SUBMITTED')}</p></div>
          <div className="rounded-xl border border-surface-border p-3"><p className="text-xs text-fg-muted">Pengguna</p><p className="mt-1 break-words text-sm font-semibold text-fg">{selected.contact_name || 'Nama tidak dicatat'}</p><p className="mt-1 break-all text-xs text-fg-muted">User ID: {String(selected.user_id)}</p>{selected.contact_email && <p className="mt-1 break-all text-xs text-fg-muted">{String(selected.contact_email)}</p>}{selected.contact_whatsapp && <p className="mt-1 text-xs text-fg-muted">WhatsApp: {String(selected.contact_whatsapp)}</p>}</div>
          <div className="rounded-xl border border-surface-border p-3"><p className="text-xs text-fg-muted">Metode pembayaran</p><p className="mt-1 break-words text-sm font-semibold text-fg">{String(selected.payment_method ?? 'Belum ditentukan')}</p><p className="mt-1 text-xs text-fg-muted">Provider: {String(selected.payment_provider ?? 'Tidak tercatat')}</p></div>
        </div>
        <div className="mt-4 rounded-xl border border-surface-border p-3"><p className="text-sm font-semibold text-fg">Rincian pesanan</p>{(Array.isArray(selected.order_items) ? selected.order_items : [selected.order_items]).filter(Boolean).map((item: any) => <div key={String(item.id ?? item.product_ref)} className="mt-2 flex items-start justify-between gap-3 border-t border-surface-border pt-2"><div className="min-w-0"><p className="text-sm text-fg">{String(item.name ?? 'Item')}</p><p className="text-xs text-fg-muted">{Number(item.quantity ?? 1)} × {paymentAmount({ total: item.unit_price, currency: selected.currency })}</p></div><p className="whitespace-nowrap text-sm font-semibold text-fg">{paymentAmount({ total: item.line_total, currency: selected.currency })}</p></div>)}</div>
        {selected.payment_proof_url && <div className="mt-4 rounded-xl border border-surface-border p-3"><p className="text-sm font-semibold text-fg">Bukti pembayaran manual</p><a href={String(selected.payment_proof_url)} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm font-semibold text-accent underline">Buka gambar bukti pembayaran</a><img src={String(selected.payment_proof_url)} alt="Bukti pembayaran" className="mt-3 max-h-72 w-full rounded-xl object-contain"/></div>}
        {selected.payment_intent && <div className="mt-4 rounded-xl border border-accent/20 bg-accent/5 p-3">
          <div className="flex flex-wrap items-center gap-2"><ShieldCheck size={15} className="text-accent"/><p className="text-sm font-semibold text-fg">Status sesi gateway</p>{isAdminConfirmed(selected.payment_intent) && <Badge color="info">Konfirmasi admin</Badge>}</div>
          <p className="mt-2 text-sm text-fg">{String(selected.payment_intent.provider ?? 'Provider')} · {intentLabel(selected.payment_intent)}</p><p className="mt-1 break-all text-xs text-fg-muted">Referensi: {String(selected.payment_intent.provider_reference ?? 'Belum tercatat')}</p>
          {selected.payment_intent.provider_reference && <button type="button" className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-accent" onClick={() => { void navigator.clipboard?.writeText(String(selected.payment_intent.provider_reference)); toast('Referensi pembayaran disalin.', 'success'); }}><Copy size={12}/> Salin referensi</button>}
          {isAdminConfirmed(selected.payment_intent) && <div className="mt-3 rounded-lg border border-surface-border p-3 text-xs leading-5 text-fg-muted"><p>Pesanan diselesaikan melalui konfirmasi manual admin, bukan callback sukses provider.</p><p className="mt-1">Alasan: {String(selected.payment_intent.raw_meta?.admin_override?.reason ?? selected.admin_review_note ?? 'Tidak tersedia')}</p><p className="mt-1">Waktu konfirmasi: {selected.payment_intent.raw_meta?.admin_override?.confirmed_at ? formatShortDate(String(selected.payment_intent.raw_meta.admin_override.confirmed_at)) : 'Tidak tersedia'}</p></div>}
        </div>}
        {selected.admin_review_note && <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3"><p className="text-xs font-semibold text-fg">Catatan admin</p><p className="mt-1 whitespace-pre-line text-sm text-fg-muted">{String(selected.admin_review_note)}</p></div>}
        <div className="mt-5 rounded-2xl border border-surface-border p-4">
          <div className="flex items-center gap-2"><History size={16} className="text-accent"/><h4 className="text-sm font-semibold text-fg">Log & riwayat pembayaran</h4></div><p className="mt-1 text-xs text-fg-muted">Event provider dan tindakan admin diurutkan dari yang terbaru.</p>
          {historyLoading && <p className="mt-3 flex items-center gap-2 text-xs text-fg-muted"><RefreshCw size={14} className="animate-spin"/> Memuat riwayat…</p>}
          {!historyLoading && !historyRows.length && <p className="mt-3 rounded-xl bg-surface-elevated/30 p-3 text-xs text-fg-muted">Belum ada event gateway atau tindakan audit yang tercatat.</p>}
          {!historyLoading && historyRows.length > 0 && <div className="mt-4 space-y-3">{historyRows.map((entry) => <div key={entry.id} className="flex gap-3"><div className={'mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ' + (entry.kind === 'admin' ? 'bg-blue-500/10 text-blue-300' : 'bg-accent/10 text-accent')}>{entry.kind === 'admin' ? <ShieldCheck size={14}/> : <FileClock size={14}/>}</div><div className="min-w-0 flex-1 border-b border-surface-border pb-3 last:border-0"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-semibold text-fg">{entry.title}</p><Badge>{entry.kind === 'admin' ? 'Admin / audit' : (String(entry.provider ?? 'Gateway') + ' · ' + entry.status)}</Badge></div><p className="mt-1 text-xs text-fg-muted">{formatShortDate(entry.created_at)}{entry.actor ? ' · Actor ' + entry.actor.slice(0, 8) : ''}</p>{entry.reason && <p className="mt-1 whitespace-pre-line break-words text-xs leading-5 text-fg-muted">{entry.reason}</p>}{entry.reference && <p className="mt-1 break-all font-mono text-[10px] text-fg-muted">Event: {entry.reference}</p>}</div></div>)}</div>}
        </div>
        {isPending(selected) && String(selected.payment_proof_status ?? '').toUpperCase() === 'SUBMITTED' && !isGlobalGateway(selected) && <div className="mt-5 flex flex-wrap justify-end gap-2"><Button variant="outline" onClick={() => void review(selected, 'REJECT')} disabled={Boolean(busyOrderId)}><XCircle size={13} className="mr-1"/>Tolak bukti</Button><Button onClick={() => void review(selected, 'APPROVE')} disabled={Boolean(busyOrderId)} loading={busyOrderId === String(selected.id)}><CheckCircle2 size={13} className="mr-1"/>Setujui pembayaran</Button></div>}
        {canAdminConfirm(selected) && <div className="mt-5 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4"><p className="flex items-center gap-2 text-sm font-semibold text-fg"><AlertTriangle size={15} className="text-amber-300"/> Pembayaran gateway masih pending</p><p className="mt-1 text-xs leading-5 text-fg-muted">Jangan gunakan tindakan ini hanya karena pengguna melihat layar sukses. Cocokkan transaksi, nominal, dan referensi di dashboard gateway atau bukti penerimaan dana lebih dahulu.</p><div className="mt-3 flex justify-end"><Button size="sm" onClick={() => startAdminConfirm(selected)} disabled={overrideBusy}><ShieldCheck size={14} className="mr-1"/>Selesaikan oleh admin</Button></div></div>}
      </Card>
    </div>}

    {overrideOrder && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-3 sm:p-5" onClick={(event) => { if (event.target === event.currentTarget && !overrideBusy) setOverrideOrder(null); }}>
      <Card className="max-h-[92vh] w-full max-w-xl overflow-auto p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-wider text-fg-muted">Tindakan khusus admin</p><h3 className="mt-1 text-xl font-bold text-fg">Selesaikan pembayaran pending</h3><p className="mt-1 text-xs text-fg-muted">Pesanan #{String(overrideOrder.id).slice(0, 8)} · {paymentAmount(overrideOrder)}</p></div><button type="button" disabled={overrideBusy} className="rounded-lg p-2 text-fg-muted hover:bg-surface-elevated" onClick={() => setOverrideOrder(null)} aria-label="Tutup konfirmasi"><X size={17}/></button></div>
        <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3"><p className="flex items-center gap-2 text-sm font-semibold text-fg"><AlertTriangle size={16} className="text-amber-300"/> Verifikasi transaksi secara independen</p><p className="mt-2 text-xs leading-5 text-fg-muted">Tindakan ini menandai pesanan lunas, memproses manfaat produk/paket melalui backend, serta menyimpan alasan dan identitas admin pada log audit. Ini tidak membuktikan status pembayaran dari gateway. Jangan gunakan jika transaksi belum dipastikan.</p><div className="mt-3 space-y-1 text-xs text-fg-muted"><p>Metode: {String(overrideOrder.payment_method ?? overrideOrder.payment_provider ?? 'Gateway')}</p><p>Referensi provider: {String(overrideOrder.payment_intent?.provider_reference ?? 'Belum tercatat')}</p></div></div>
        <label className="mt-4 block text-sm font-semibold text-fg">Alasan konfirmasi <span className="text-amber-300">*</span><textarea className="input mt-2 min-h-28 w-full resize-y font-normal" value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)} maxLength={1000} placeholder="Contoh: transaksi sukses sudah diverifikasi di dashboard XenithPay; ID transaksi dan nominal Rp10.000 sesuai."/><span className="mt-1 block text-xs font-normal text-fg-muted">Minimal 8 karakter. Catatan disimpan dalam riwayat transaksi.</span></label>
        <label className="mt-4 flex items-start gap-3 rounded-xl border border-surface-border p-3 text-sm text-fg"><input type="checkbox" className="mt-0.5" checked={verifiedExternally} onChange={(event) => setVerifiedExternally(event.target.checked)}/><span>Saya sudah mencocokkan nominal, referensi, dan penerimaan dana secara independen. Saya memahami tindakan ini merupakan konfirmasi admin dan akan tercatat di audit.</span></label>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button variant="outline" disabled={overrideBusy} onClick={() => setOverrideOrder(null)}>Batal</Button><Button disabled={overrideBusy || !verifiedExternally || overrideReason.trim().length < 8} loading={overrideBusy} onClick={() => void confirmByAdmin()}><ShieldCheck size={14} className="mr-1"/>Konfirmasi & selesaikan</Button></div>
      </Card>
    </div>}
  </section>;
}
