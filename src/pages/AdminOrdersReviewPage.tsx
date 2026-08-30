import { toast } from "@/lib/toast";
import { useEffect, useState } from 'react';
import { Check, ExternalLink, X } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { supabase } from '@/lib/supabase';
import { adminReviewManualOrder } from '@/services/commerce.service';

export function AdminOrdersReviewPage() {
  const [orders, setOrders] = useState<any[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    const { data, error } = await supabase
      .from('orders')
      .select('id,user_id,status,total,payment_method,payment_proof_url,payment_proof_public_id,payment_proof_status,created_at')
      .not('payment_proof_url', 'is', null)
      .order('created_at', { ascending: false });
    if (error) throw error;
    setOrders(data ?? []);
  };

  useEffect(() => { void load().catch((e) => toast.error(e.message)); }, []);

  const review = async (id: string, decision: 'APPROVE' | 'REJECT') => {
    setBusy(id);
    try {
      await adminReviewManualOrder(id, decision, decision === 'APPROVE' ? 'Bukti pembayaran disetujui admin' : 'Bukti pembayaran ditolak admin');
      await load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="p-5 md:p-7">
      <div className="mb-6">
        <p className="text-xs text-moss-400 font-semibold">ADMIN · PAYMENT REVIEW</p>
        <h1 className="font-display text-2xl font-bold text-fg">Review Bukti Pembayaran</h1>
        <p className="text-sm text-slate-500 mt-1">Semua perubahan diproses melalui RPC backend Supabase.</p>
      </div>
      <div className="space-y-3">
        {orders.map((order) => (
          <Card key={order.id} className="p-4">
            <div className="flex gap-4 items-start">
              {order.payment_proof_url ? <a href={order.payment_proof_url} target="_blank" rel="noreferrer" className="w-28 h-20 rounded-xl overflow-hidden surface-elevated shrink-0"><img src={order.payment_proof_url} alt="Bukti pembayaran" className="w-full h-full object-cover" /></a> : null}
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap gap-2 items-center"><p className="text-fg font-semibold">Order {String(order.id).slice(0, 8)}</p><Badge>{order.payment_proof_status || order.status}</Badge></div>
                <p className="text-xs text-slate-500 mt-1">User {String(order.user_id).slice(0, 8)} · {order.payment_method || 'metode belum dicatat'}</p>
                <p className="text-moss-300 font-bold mt-2">Rp {Number(order.total || 0).toLocaleString('id-ID')}</p>
              </div>
              <div className="flex items-center gap-2">
                {order.payment_proof_url && <a href={order.payment_proof_url} target="_blank" rel="noreferrer" className="p-2 rounded-lg hover:bg-white/5 text-fg-muted"><ExternalLink size={16} /></a>}
                <Button size="sm" icon={<Check size={14}/>} loading={busy === order.id} onClick={() => void review(order.id, 'APPROVE')}>Setujui</Button>
                <Button size="sm" variant="outline" icon={<X size={14}/>} loading={busy === order.id} onClick={() => void review(order.id, 'REJECT')}>Tolak</Button>
              </div>
            </div>
          </Card>
        ))}
        {!orders.length && <Card className="p-10 text-center text-slate-500">Belum ada bukti pembayaran yang perlu direview.</Card>}
      </div>
    </div>
  );
}
