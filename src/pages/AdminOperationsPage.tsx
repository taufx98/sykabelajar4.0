import { toast } from "@/lib/toast";
import { useEffect, useState } from 'react';
import { Activity, Award, ShieldAlert, Settings2, Check, X, RefreshCw, Truck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';

export function AdminOperationsPage() {
  const [tab, setTab] = useState<'certificates'|'moderation'|'audit'|'flags'>('certificates');
  const [certificates, setCertificates] = useState<any[]>([]);
  const [reports, setReports] = useState<any[]>([]);
  const [audit, setAudit] = useState<any[]>([]);
  const [flags, setFlags] = useState<any[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    setRefreshing(true);
    const [c, r, a, f] = await Promise.all([
      supabase.from('certificate_verifications').select('*').order('created_at', { ascending: false }).limit(100),
      supabase.from('comment_reports').select('*').order('created_at', { ascending: false }).limit(100),
      supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(100),
      supabase.from('feature_flags').select('*').order('key'),
    ]);
    setCertificates(c.data ?? []); setReports(r.data ?? []); setAudit(a.data ?? []); setFlags(f.data ?? []); setRefreshing(false);
  };
  useEffect(() => { void load(); }, []);

  const updateCertificate = async (id: string, status: string) => {
    setBusy(id);
    const { error } = await supabase.rpc('admin_set_certificate_status', { p_certificate_verification_id: id, p_to_status: status, p_reason: 'Admin operations' });
    setBusy(null);
    if (error) toast.error(error.message); else await load();
  };
  const resolveReport = async (id: string, status: 'RESOLVED'|'REJECTED') => {
    setBusy(id);
    const { error } = await supabase.from('comment_reports').update({ status, resolved_at: new Date().toISOString() }).eq('id', id);
    setBusy(null);
    if (error) toast.error(error.message); else await load();
  };
  const toggleFlag = async (flag: any) => {
    setBusy(flag.key);
    const { error } = await supabase.from('feature_flags').update({ enabled: !flag.enabled, updated_at: new Date().toISOString() }).eq('key', flag.key);
    setBusy(null);
    if (error) toast.error(error.message); else await load();
  };
  const tabs = [
    { key: 'certificates' as const, label: 'Sertifikat', icon: Award },
    { key: 'moderation' as const, label: 'Moderasi UGC', icon: ShieldAlert },
    { key: 'audit' as const, label: 'Audit Log', icon: Activity },
    { key: 'flags' as const, label: 'Feature Flags', icon: Settings2 },
  ];
  return <div className="min-h-screen surface-bg text-fg-secondary flex">
    <aside className="w-60 shrink-0 border-r surface-border p-3 sticky top-0 h-screen">
      <div className="px-3 py-3 mb-3"><p className="text-xs text-moss-400">SYKABELAJAR</p><h1 className="font-display font-bold text-xl text-fg">Admin Operations</h1></div>
      {tabs.map(({ key, label, icon: Icon }) => <button key={key} onClick={() => setTab(key)} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm ${tab === key ? 'bg-moss-500/10 text-moss-300' : 'text-slate-400 hover:bg-surface-elevated/50'}`}><Icon size={18}/>{label}</button>)}
      <Link to="/admin/fulfillment" className="w-full flex items-center gap-3 px-3 py-2.5 mt-1 rounded-xl text-sm text-slate-400 hover:bg-surface-elevated/50"><Truck size={18}/>Fulfillment</Link>
      <Link to="/admin" className="block mt-6 px-3 text-xs text-slate-500 hover:text-fg">← Panel Admin</Link>
    </aside>
    <main className="flex-1 min-w-0 p-5 md:p-7 overflow-auto">
      <div className="flex justify-between items-center mb-6"><div><h2 className="font-display text-2xl font-bold text-fg">{tabs.find(t=>t.key===tab)?.label}</h2><p className="text-xs text-slate-500 mt-1">Privileged operations · live Supabase</p></div><Button size="sm" variant="outline" loading={refreshing} onClick={()=>void load()} icon={<RefreshCw size={14}/>}>Refresh</Button></div>
      {tab === 'certificates' && <div className="space-y-2">{certificates.map(c => <Card key={c.id} className="p-4 flex items-center gap-3"><Award size={19} className="text-moss-400"/><div className="flex-1"><p className="text-sm text-fg">{c.public_name || '—'}</p><p className="text-xs text-slate-500">{c.competition_title || '—'} · {c.verification_code}</p></div><Badge>{c.status}</Badge>{String(c.status).toUpperCase() !== 'REVOKED' && <button className="p-2 text-red-400" disabled={busy===c.id} onClick={()=>void updateCertificate(c.id,'REVOKED')} title="Cabut sertifikat"><X size={16}/></button>}</Card>)}{!certificates.length&&<Card className="p-8 text-center text-slate-500">Belum ada sertifikat terbit.</Card>}</div>}
      {tab === 'moderation' && <div className="space-y-2">{reports.map(r => <Card key={r.id} className="p-4 flex items-center gap-3"><ShieldAlert size={18} className="text-amber-300"/><div className="flex-1"><p className="text-sm text-fg">Report {r.id.slice(0,8)}</p><p className="text-xs text-slate-500">Comment {r.comment_id.slice(0,8)} · {r.reason}</p></div><Badge>{r.status}</Badge>{!['RESOLVED','REJECTED'].includes(String(r.status).toUpperCase())&&<div className="flex gap-2"><button className="p-2 text-moss-300" disabled={busy===r.id} onClick={()=>void resolveReport(r.id,'RESOLVED')}><Check size={16}/></button><button className="p-2 text-red-400" disabled={busy===r.id} onClick={()=>void resolveReport(r.id,'REJECTED')}><X size={16}/></button></div>}</Card>)}{!reports.length&&<Card className="p-8 text-center text-slate-500">Tidak ada laporan komentar.</Card>}</div>}
      {tab === 'audit' && <div className="space-y-2">{audit.map(a => <Card key={a.id} className="p-4"><div className="flex items-center gap-3"><Activity size={17} className="text-slate-500"/><div className="flex-1"><p className="text-sm text-fg">{a.action} · {a.entity_type}</p><p className="text-xs text-slate-500">{a.entity_id || '—'} · {a.reason || '—'}</p></div><span className="text-[11px] text-slate-600">{new Date(a.created_at).toLocaleString('id-ID')}</span></div></Card>)}{!audit.length&&<Card className="p-8 text-center text-slate-500">Belum ada audit log.</Card>}</div>}
      {tab === 'flags' && <div className="space-y-2">{flags.map(f => <Card key={f.key} className="p-4 flex items-center gap-3"><Settings2 size={17} className="text-slate-500"/><div className="flex-1"><p className="text-sm text-fg">{f.key}</p><p className="text-xs text-slate-500">Updated {new Date(f.updated_at).toLocaleString('id-ID')}</p></div><button disabled={busy===f.key} onClick={()=>void toggleFlag(f)} className={`w-12 h-6 rounded-full relative ${f.enabled?'bg-moss-500':'bg-slate-700'}`}><span className={`absolute top-1 w-4 h-4 rounded-full bg-white transition ${f.enabled?'right-1':'left-1'}`}/></button></Card>)}{!flags.length&&<Card className="p-8 text-center text-slate-500">Belum ada feature flag.</Card>}</div>}
    </main>
  </div>;
}
