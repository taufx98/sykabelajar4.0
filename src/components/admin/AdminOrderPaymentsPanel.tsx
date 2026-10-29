import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Clock3, Copy, CreditCard, Eye, RefreshCw, Search, ShieldCheck, X, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { formatRupiah, formatShortDate } from '@/lib/utils';
import { adminReviewManualOrder } from '@/services/commerce.service';
import { supabase } from '@/lib/supabase';
import { useApp } from '@/store/AppContext';

type AdminPaymentOrder = Record<string, any>;

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
  return ['GLOBAL', 'MIDTRANS', 'XENITHPAY'].includes(String(order.payment_provider ?? '').toUpperCase());
}

export function AdminOrderPaymentsPanel() {
  const { toast } = useApp();
  const [orders, setOrders] = useState<AdminPaymentOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('ALL');
  const [selected, setSelected] = useState<AdminPaymentOrder | null>(null);
  const [busyOrderId, setBusyOrderId] = useState('');

  async function load() {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('orders')
        .select('id,user_id,status,total,currency,created_at,updated_at,payment_method,payment_provider,payment_proof_url,payment_proof_status,admin_review_note,reviewed_at,contact_name,contact_email,contact_whatsapp,contact_note,contact_fields,order_items(id,name,product_type,product_ref,quantity,unit_price,line_total,metadata)')
        .order('created_at', { ascending: false })
        .limit(250);
      if (error) throw error;

      const rows = data ?? [];
      const ids = rows.map((row: any) => String(row.id));
      let intentRows: any[] = [];
      if (ids.length) {
        const { data: intents, error: intentError } = await supabase
          .from('payment_intents')
          .select('order_id,provider,provider_reference,amount,status,created_at,updated_at')
          .in('order_id', ids)
          .order('updated_at', { ascending: false });
        if (intentError) {
          toast('Daftar pesanan tampil, tetapi detail sesi gateway gagal dimuat: ' + intentError.message, 'error');
        } else {
          intentRows = intents ?? [];
        }
      }

      const intentByOrder = new Map<string, any>();
      for (const intent of intentRows) {
        const id = String(intent.order_id);
        if (!intentByOrder.has(id)) intentByOrder.set(id, intent);
      }
      setOrders(rows.map((row: any) => ({
        ...row,
        payment_intent: intentByOrder.get(String(row.id)) ?? null,
      })));
    } catch (error: any) {
      toast(error?.message || 'Gagal memuat daftar pesanan dan pembayaran.', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const filteredOrders = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return orders.filter((order) => {
      const status = String(order.status ?? '').toUpperCase();
      const proofStatus = String(order.payment_proof_status ?? '').toUpperCase();
      const passesFilter = filter === 'ALL'
        || (filter === 'PENDING' && ['PENDING_PAYMENT', 'PENDING'].includes(status))
        || (filter === 'MANUAL_REVIEW' && ['PENDING_PAYMENT', 'PENDING'].includes(status) && proofStatus === 'SUBMITTED' && !isGlobalGateway(order))
        || (filter === 'PAID' && ['PAID', 'COMPLETED', 'PROCESSING', 'SHIPPED'].includes(status))
        || (filter === 'CANCELLED' && ['CANCELLED', 'CANCELED', 'REFUNDED'].includes(status));
      if (!passesFilter) return false;
      if (!normalized) return true;
      const item = firstItem(order);
      const haystack = [
        order.id, order.user_id, order.contact_name, order.contact_email, order.contact_whatsapp,
        order.payment_method, order.payment_provider, order.payment_intent?.provider_reference, item?.name,
      ].map((value) => String(value ?? '').toLowerCase()).join(' ');
      return haystack.includes(normalized);
    });
  }, [orders, query, filter]);

  const review = async (order: AdminPaymentOrder, decision: 'APPROVE' | 'REJECT') => {
    const id = String(order.id);
    if (!id || busyOrderId) return;
    if (isGlobalGateway(order)) {
      toast('Pembayaran gateway hanya dapat disahkan oleh webhook provider yang tervalidasi.', 'error');
      return;
    }
    if (decision === 'APPROVE' && !window.confirm('Setujui bukti pembayaran pesanan #' + id.slice(0, 8) + '? Manfaat produk akan diproses oleh backend.')) return;
    const reason = decision === 'REJECT' ? window.prompt('Tuliskan alasan penolakan bukti pembayaran:') : '';
    if (decision === 'REJECT' && !String(reason ?? '').trim()) return;

    setBusyOrderId(id);
    try {
      await adminReviewManualOrder(id, decision, String(reason ?? ''));
      toast(decision === 'APPROVE' ? 'Pembayaran manual disetujui.' : 'Pembayaran manual ditolak.', 'success');
      setSelected(null);
      await load();
    } catch (error: any) {
      toast(error?.message || 'Keputusan pembayaran gagal disimpan.', 'error');
    } finally {
      setBusyOrderId('');
    }
  };

  const pendingCount = orders.filter((order) => ['PENDING_PAYMENT', 'PENDING'].includes(String(order.status ?? '').toUpperCase())).length;
  const manualReviewCount = orders.filter((order) => ['PENDING_PAYMENT', 'PENDING'].includes(String(order.status ?? '').toUpperCase()) && String(order.payment_proof_status ?? '').toUpperCase() === 'SUBMITTED' && !isGlobalGateway(order)).length;
  const paidCount = orders.filter((order) => ['PAID', 'COMPLETED', 'PROCESSING', 'SHIPPED'].includes(String(order.status ?? '').toUpperCase())).length;

  return <section className="rounded-3xl border border-surface-border bg-surface-elevated/10 p-5 md:p-7">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-accent">Admin Commerce</p>
        <h2 className="mt-1 text-2xl font-bold text-fg">Pesanan & pembayaran</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-fg-muted">Pantau transaksi dari semua user, cek bukti transfer manual, dan lihat status sesi XenithPay/Midtrans. Pembayaran gateway tidak dapat disetujui manual—status lunas hanya berasal dari callback tervalidasi.</p>
      </div>
      <Button size="sm" variant="outline" disabled={loading} onClick={() => void load()}><RefreshCw size={14} className={loading ? 'mr-1 animate-spin' : 'mr-1'}/> Segarkan</Button>
    </div>

    <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
      <div className="rounded-2xl border border-surface-border p-4"><p className="text-xs text-fg-muted">Menunggu proses</p><p className="mt-1 text-2xl font-bold text-fg">{pendingCount}</p></div>
      <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4"><p className="text-xs text-fg-muted">Perlu verifikasi manual</p><p className="mt-1 text-2xl font-bold text-fg">{manualReviewCount}</p></div>
      <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4"><p className="text-xs text-fg-muted">Lunas / diproses</p><p className="mt-1 text-2xl font-bold text-fg">{paidCount}</p></div>
    </div>

    <div className="mt-5 flex flex-col gap-3 md:flex-row">
      <label className="relative block flex-1"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted"/><input className="input w-full pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cari nomor pesanan, user, produk, metode, atau referensi"/></label>
      <select className="input md:w-60" value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="Filter status pembayaran">
        <option value="ALL">Semua transaksi</option>
        <option value="PENDING">Menunggu pembayaran</option>
        <option value="MANUAL_REVIEW">Perlu verifikasi manual</option>
        <option value="PAID">Lunas / diproses</option>
        <option value="CANCELLED">Dibatalkan / refund</option>
      </select>
    </div>

    <div className="mt-4 space-y-3">
      {filteredOrders.map((order) => {
        const item = firstItem(order);
        const status = String(order.status ?? '').toUpperCase();
        const proofStatus = String(order.payment_proof_status ?? '').toUpperCase();
        const gateway = isGlobalGateway(order);
        const canReview = ['PENDING_PAYMENT', 'PENDING'].includes(status) && proofStatus === 'SUBMITTED' && !gateway;
        return <Card key={order.id} className="p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold text-fg">{item?.name || ('Pesanan #' + String(order.id).slice(0, 8))}</p>
                <Badge>{orderStatusLabel(status)}</Badge>
                {gateway && <Badge color="moss">Gateway</Badge>}
              </div>
              <p className="mt-1 text-xs text-fg-muted">#{String(order.id).slice(0, 8)} · {formatShortDate(order.created_at)} · User {String(order.user_id ?? '').slice(0, 8)}</p>
              <p className="mt-2 text-sm text-fg">{order.contact_name || 'Nama pemesan tidak dicatat'}{order.contact_email ? ' · ' + order.contact_email : ''}</p>
              <p className="mt-1 text-xs text-fg-muted">{String(order.payment_method ?? 'Metode belum ditentukan')} · {String(order.payment_provider ?? 'Provider belum dicatat')}</p>
              {gateway && <p className="mt-1 text-xs text-fg-muted">Sesi: {String(order.payment_intent?.status ?? 'Belum tercatat')}{order.payment_intent?.provider_reference ? ' · Ref ' + String(order.payment_intent.provider_reference) : ''}</p>}
              {!gateway && <p className="mt-1 text-xs text-fg-muted">Bukti: {proofStatus || 'NOT_SUBMITTED'}{order.reviewed_at ? ' · Ditinjau ' + formatShortDate(order.reviewed_at) : ''}</p>}
            </div>
            <div className="flex flex-col gap-2 lg:min-w-[180px] lg:items-end">
              <p className="text-lg font-bold text-fg">{paymentAmount(order)}</p>
              <div className="flex flex-wrap gap-2 lg:justify-end">
                <Button size="sm" variant="outline" onClick={() => setSelected(order)}><Eye size={13} className="mr-1"/>Detail</Button>
                {canReview && <Button size="sm" disabled={Boolean(busyOrderId)} loading={busyOrderId === String(order.id)} onClick={() => void review(order, 'APPROVE')}><CheckCircle2 size={13} className="mr-1"/>Setujui</Button>}
                {canReview && <Button size="sm" variant="outline" disabled={Boolean(busyOrderId)} loading={busyOrderId === String(order.id)} onClick={() => void review(order, 'REJECT')}><XCircle size={13} className="mr-1"/>Tolak</Button>}
              </div>
            </div>
          </div>
        </Card>;
      })}
      {!loading && !filteredOrders.length && <Card className="p-8 text-center"><CreditCard size={22} className="mx-auto text-fg-muted"/><p className="mt-2 text-sm font-semibold text-fg">Tidak ada transaksi yang cocok</p><p className="mt-1 text-xs text-fg-muted">Ubah filter atau kata pencarian. Pastikan halaman disegarkan untuk mengambil status terbaru.</p></Card>}
      {loading && <Card className="p-6 text-center text-sm text-fg-muted"><RefreshCw size={15} className="mr-2 inline animate-spin"/>Memuat riwayat transaksi...</Card>}
      <p className="text-xs leading-5 text-fg-muted">Daftar ini menampilkan hingga 250 pesanan terbaru. Riwayat keuangan tetap tersimpan meskipun user mengarsipkan pesanan dari halaman mereka.</p>
    </div>

    {selected && <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4" onClick={(event) => { if (event.target === event.currentTarget) setSelected(null); }}>
      <Card className="max-h-[92vh] w-full max-w-2xl overflow-auto p-5">
        <div className="flex items-start justify-between gap-3">
          <div><p className="text-[10px] font-bold uppercase tracking-wider text-accent">Admin · Detail pembayaran</p><h3 className="mt-1 text-xl font-bold text-fg">{firstItem(selected)?.name || 'Detail pesanan'}</h3><p className="mt-1 text-xs text-fg-muted">ID penuh: {String(selected.id)}</p></div>
          <button type="button" className="rounded-lg p-2 text-fg-muted hover:bg-surface-elevated" onClick={() => setSelected(null)} aria-label="Tutup detail"><X size={17}/></button>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-xl border surface-border p-3"><p className="text-xs text-fg-muted">Total</p><p className="mt-1 text-lg font-bold text-fg">{paymentAmount(selected)}</p><p className="mt-1 text-xs text-fg-muted">{formatShortDate(selected.created_at)}</p></div>
          <div className="rounded-xl border surface-border p-3"><p className="text-xs text-fg-muted">Status</p><p className="mt-1 font-semibold text-fg">{orderStatusLabel(selected.status)}</p><p className="mt-1 text-xs text-fg-muted">Bukti: {String(selected.payment_proof_status ?? 'NOT_SUBMITTED')}</p></div>
          <div className="rounded-xl border surface-border p-3"><p className="text-xs text-fg-muted">Pemesan</p><p className="mt-1 text-sm font-semibold text-fg">{selected.contact_name || 'Nama tidak dicatat'}</p><p className="mt-1 break-all text-xs text-fg-muted">User ID: {String(selected.user_id)}</p>{selected.contact_email && <p className="mt-1 break-all text-xs text-fg-muted">{String(selected.contact_email)}</p>}{selected.contact_whatsapp && <p className="mt-1 text-xs text-fg-muted">WhatsApp: {String(selected.contact_whatsapp)}</p>}</div>
          <div className="rounded-xl border surface-border p-3"><p className="text-xs text-fg-muted">Metode pembayaran</p><p className="mt-1 text-sm font-semibold text-fg">{String(selected.payment_method ?? 'Belum ditentukan')}</p><p className="mt-1 text-xs text-fg-muted">{String(selected.payment_provider ?? 'Provider tidak tercatat')}</p></div>
        </div>
        <div className="mt-4 rounded-xl border surface-border p-3">
          <p className="text-sm font-semibold text-fg">Rincian pesanan</p>
          {(Array.isArray(selected.order_items) ? selected.order_items : [selected.order_items]).filter(Boolean).map((item: any) => <div key={String(item.id ?? item.product_ref)} className="mt-2 flex items-start justify-between gap-3 border-t surface-border pt-2"><div><p className="text-sm text-fg">{String(item.name ?? 'Item')}</p><p className="text-xs text-fg-muted">{Number(item.quantity ?? 1)} × {paymentAmount({ total: item.unit_price, currency: selected.currency })}</p></div><p className="text-sm font-semibold text-fg">{paymentAmount({ total: item.line_total, currency: selected.currency })}</p></div>)}
        </div>
        {selected.payment_proof_url && <div className="mt-4 rounded-xl border surface-border p-3"><p className="text-sm font-semibold text-fg">Bukti pembayaran manual</p><a href={String(selected.payment_proof_url)} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm font-semibold text-accent underline">Buka gambar bukti pembayaran</a><img src={String(selected.payment_proof_url)} alt="Bukti pembayaran" className="mt-3 max-h-72 w-full rounded-xl object-contain"/></div>}
        {selected.payment_intent && <div className="mt-4 rounded-xl border border-accent/20 bg-accent/5 p-3"><div className="flex items-center gap-2"><ShieldCheck size={15} className="text-accent"/><p className="text-sm font-semibold text-fg">Sesi gateway</p></div><p className="mt-2 text-sm text-fg">{String(selected.payment_intent.provider ?? 'Provider')} · {String(selected.payment_intent.status ?? 'Status tidak tersedia')}</p><p className="mt-1 break-all text-xs text-fg-muted">Referensi: {String(selected.payment_intent.provider_reference ?? 'Belum dikembalikan provider')}</p>{selected.payment_intent.provider_reference && <button type="button" className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-accent" onClick={() => { void navigator.clipboard?.writeText(String(selected.payment_intent.provider_reference)); toast('Referensi pembayaran disalin.', 'success'); }}><Copy size={12}/> Salin referensi</button>}<p className="mt-2 text-xs leading-5 text-fg-muted">Jangan mengubah status gateway secara manual. Callback provider dan validasi nominallah yang menentukan transaksi lunas.</p></div>}
        {selected.admin_review_note && <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3"><p className="text-xs font-semibold text-fg">Catatan admin</p><p className="mt-1 whitespace-pre-line text-sm text-fg-muted">{String(selected.admin_review_note)}</p></div>}
        {['PENDING_PAYMENT', 'PENDING'].includes(String(selected.status ?? '').toUpperCase()) && String(selected.payment_proof_status ?? '').toUpperCase() === 'SUBMITTED' && !isGlobalGateway(selected) && <div className="mt-5 flex flex-wrap justify-end gap-2"><Button variant="outline" onClick={() => void review(selected, 'REJECT')} disabled={Boolean(busyOrderId)}><XCircle size={13} className="mr-1"/>Tolak bukti</Button><Button onClick={() => void review(selected, 'APPROVE')} disabled={Boolean(busyOrderId)} loading={busyOrderId === String(selected.id)}><CheckCircle2 size={13} className="mr-1"/>Setujui pembayaran</Button></div>}
        {isGlobalGateway(selected) && <p className="mt-5 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs leading-5 text-fg-muted"><Clock3 size={13} className="mr-1 inline"/> Pembayaran otomatis diperbarui saat callback XenithPay/Midtrans terverifikasi. Jika pengguna mengaku sudah membayar tetapi status belum berubah, cocokkan referensi dan periksa log webhook; jangan tandai lunas secara manual.</p>}
      </Card>
    </div>}
  </section>;
}
