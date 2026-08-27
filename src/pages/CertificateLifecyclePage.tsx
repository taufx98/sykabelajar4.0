import { useEffect, useState } from 'react';
import { Award, RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';

const statuses = ['DRAFT','GENERATED','REVIEW','APPROVED','PUBLISHED','REVOKED'] as const;
type CertificateStatus = typeof statuses[number];

export function CertificateLifecyclePage() {
  const [rows,setRows]=useState<any[]>([]); const [loading,setLoading]=useState(false); const [busy,setBusy]=useState<string|null>(null);
  const load=async()=>{setLoading(true);const {data,error}=await supabase.from('certificates').select('id,user_id,competition_id,status,current_revision,created_at,updated_at').order('updated_at',{ascending:false}).limit(100);if(error) alert(error.message);setRows(data??[]);setLoading(false)};
  useEffect(()=>{void load()},[]);
  const transition=async(id:string,status:CertificateStatus)=>{setBusy(id+status);const {error}=await supabase.rpc('admin_transition_certificate',{p_certificate_id:id,p_to_status:status,p_reason:'Admin certificate lifecycle'});if(error) alert(error.message); else await load();setBusy(null)};
  return <div className="min-h-screen bg-ink-950 text-slate-200 p-5 md:p-7"><div className="max-w-6xl mx-auto"><div className="flex items-center justify-between mb-6"><div><p className="text-xs text-moss-400">SYKABELAJAR ADMIN</p><h1 className="font-display text-2xl font-bold text-white">Certificate Lifecycle</h1><p className="text-xs text-slate-500 mt-1">Dikelola langsung melalui Supabase.</p></div><Button size="sm" variant="outline" loading={loading} onClick={()=>void load()} icon={<RefreshCw size={14}/>}>Refresh</Button></div><div className="space-y-2">{rows.map(c=><Card key={c.id} className="p-4"><div className="flex items-start gap-3"><Award size={20} className="text-moss-400 mt-1"/><div className="flex-1 min-w-0"><div className="flex items-center gap-2 flex-wrap"><p className="text-sm font-semibold text-white">{c.id}</p><Badge>{c.status}</Badge><span className="text-[10px] text-slate-600">rev {c.current_revision??0}</span></div><p className="text-xs text-slate-500 mt-1">user {c.user_id} · competition {c.competition_id}</p><div className="flex gap-1.5 flex-wrap mt-3">{statuses.map(s=><button key={s} disabled={busy===c.id+s || c.status===s} onClick={()=>void transition(c.id,s)} className={`px-2 py-1 rounded-lg text-[10px] border ${c.status===s?'border-moss-500/40 text-moss-300 bg-moss-500/10':'border-white/10 text-slate-400 hover:text-white'}`}>{s}</button>)}</div></div></div></Card>)}{!rows.length&&<Card className="p-8 text-center text-slate-500">Belum ada certificate record.</Card>}</div></div></div>;
}
