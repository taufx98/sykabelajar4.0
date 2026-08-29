import { toast } from "@/lib/toast";
import { useEffect, useState } from 'react';
import { PackageCheck, RefreshCw, Truck } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';

const statuses = ['PAID','PROCESSING','SHIPPED','COMPLETED','REFUNDED','CANCELLED'];

export function AdminFulfillmentPage() {
  const [orders, setOrders] = useState<any[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [tracking, setTracking] = useState<Record<string,string>>({});
  const [provider, setProvider] = useState<Record<string,string>>({});

  const load = async () => {
    const { data, error } = await supabase
      .from('orders')
      .select('id,user_id,status,total,payment_method,created_at,shipments(*)')
      .in('status', statuses)
      .order('created_at', { ascending: false });
    if (error) throw error;
    setOrders(data ?? []);
  };
  useEffect(() => { void load().catch((e) => toast.error(e.message)); }, []);

  const transition = async (orderId: string, status: string) => {
    setBusy(orderId);
    try {
      const { error } = await supabase.rpc('admin_transition_order', {
        p_order_id: orderId,
        p_to_status: status,
        p_reason: 'Admin fulfillment panel',
        p_tracking_number: tracking[orderId] || null,
        p_provider: provider[orderId] || null,
      });
      if (error) throw error;
      await load();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(null); }
  };

  return <div className="p-5 md:p-7">
    <div className="flex items-center justify-between mb-6">
      <div><p className="text-xs text-moss-400 font-semibold">ADMIN · FULFILLMENT</p><h1 className="font-display text-2xl font-bold text-white">Order & Pengiriman</h1><p className="text-sm text-slate-500 mt-1">State order dikontrol melalui RPC backend Supabase.</p></div>
      <Button size="sm" variant="outline" icon={<RefreshCw size={14}/>} onClick={() => void load()}>Refresh</Button>
    </div>
    <div className="space-y-3">{orders.map((o) => {
      const shipment = o.shipments?.[0];
      return <Card key={o.id} className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <PackageCheck size={19} className="text-moss-400" />
          <div className="flex-1 min-w-[220px]"><p className="text-sm font-semibold text-white">Order {String(o.id).slice(0,8)}</p><p className="text-xs text-slate-500">User {String(o.user_id).slice(0,8)} · {o.payment_method || '—'}</p></div>
          <b className="text-white">Rp {Number(o.total || 0).toLocaleString('id-ID')}</b><Badge>{o.status}</Badge>
        </div>
        <div className="mt-4 grid md:grid-cols-3 gap-3">
          <select className="input" value={o.status} disabled={busy===o.id} onChange={(e) => void transition(o.id, e.target.value)}>{statuses.map(s => <option key={s}>{s}</option>)}</select>
          <input className="input" placeholder="Kurir / provider" value={provider[o.id] ?? shipment?.provider ?? ''} onChange={e => setProvider(x => ({...x,[o.id]:e.target.value}))}/>
          <div className="flex gap-2"><input className="input" placeholder="Nomor resi" value={tracking[o.id] ?? shipment?.tracking_number ?? ''} onChange={e => setTracking(x => ({...x,[o.id]:e.target.value}))}/><Button size="sm" loading={busy===o.id} icon={<Truck size={14}/>} onClick={() => void transition(o.id, 'SHIPPED')}>Kirim</Button></div>
        </div>
      </Card>;
    })}{!orders.length && <Card className="p-10 text-center text-slate-500">Belum ada order pada workflow fulfillment.</Card>}</div>
  </div>;
}
