import { useEffect, useState } from 'react';
import { Building2, Trophy, Users, FileQuestion, Image, Settings, Plus, Edit3, Trash2, X, Megaphone } from 'lucide-react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';

type Tab = { key: string; label: string; Icon: typeof Trophy };
const statusOptions = ['DRAFT','PUBLISHED','REGISTRATION_OPEN','REGISTRATION_CLOSED','LIVE','SUBMISSION_CLOSED','GRADING','RESULT_PUBLISHED','ARCHIVED'];

export function OrganizerPage() {
  const [organizer, setOrganizer] = useState<any>(null);
  const [competitions, setCompetitions] = useState<any[]>([]);
  const [members, setMembers] = useState<any[]>([]);
  const [plans, setPlans] = useState<any[]>([]);
  const [registrations, setRegistrations] = useState<any[]>([]);
  const [banks, setBanks] = useState<any[]>([]);
  const [twibbons, setTwibbons] = useState<any[]>([]);
  const [tab, setTab] = useState('overview');
  const [busy, setBusy] = useState(false);
  const [competitionEditor, setCompetitionEditor] = useState<any | null>(null);
  const [questionEditor, setQuestionEditor] = useState<any | null>(null);
  const [twibbonEditor, setTwibbonEditor] = useState<any | null>(null);
  const tabs: Tab[] = [{key:'overview',label:'Ringkasan',Icon:Building2},{key:'competitions',label:'Lomba',Icon:Trophy},{key:'registrations',label:'Pendaftar',Icon:Users},{key:'questions',label:'Bank Soal',Icon:FileQuestion},{key:'twibbon',label:'Twibbon',Icon:Image},{key:'plans',label:'Plan {key:'plans',label:'Plan & Usage',Icon:Settings} Usage',Icon:Settings},{key:'ads',label:'Pasang Iklan',Icon:Megaphone}];

  const load = async () => {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return;
    const { data: org } = await supabase.from('organizers').select('*').eq('owner_user_id', auth.user.id).maybeSingle();
    if (!org) { setOrganizer(null); return; }
    setOrganizer(org);
    const [c,m,p,b,t] = await Promise.all([
      supabase.from('competitions').select('*').eq('organizer_id', org.id).order('created_at',{ascending:false}),
      supabase.from('organizer_members').select('*').eq('organizer_id', org.id),
      supabase.from('organizer_plans').select('*').eq('organizer_id', org.id).order('created_at',{ascending:false}),
      supabase.from('question_banks').select('*').eq('organizer_id', org.id).order('created_at',{ascending:false}),
      supabase.from('twibbon_templates').select('*').eq('organizer_id', org.id).order('created_at',{ascending:false}),
    ]);
    const ids = (c.data || []).map((x) => x.id);
    const { data: regs } = ids.length ? await supabase.from('registrations').select('*').in('competition_id', ids).order('created_at',{ascending:false}) : { data: [] as any[] };
    setCompetitions(c.data || []); setMembers(m.data || []); setPlans(p.data || []); setBanks(b.data || []); setTwibbons(t.data || []); setRegistrations(regs || []);
  };
  useEffect(() => { void load(); }, []);

  const transition = async (id: string, status: string) => { setBusy(true); const { error } = await supabase.rpc('transition_competition',{p_competition_id:id,p_to_status:status,p_reason:'Organizer dashboard'}); setBusy(false); if(error) alert(error.message); else await load(); };
  const saveCompetition = async () => {
    if (!competitionEditor?.title || !competitionEditor?.slug) return;
    setBusy(true);
    const payload = { title: competitionEditor.title, slug: competitionEditor.slug, category: competitionEditor.category || 'Kompetisi', short_description: competitionEditor.short_description || null, description: competitionEditor.description || null, poster_url: competitionEditor.poster_url || null, juknis_url: competitionEditor.juknis_url || null, visibility: competitionEditor.visibility || 'PUBLIC', status: competitionEditor.status || 'DRAFT', organizer_id: organizer.id };
    const result = competitionEditor.id ? await supabase.from('competitions').update(payload).eq('id',competitionEditor.id) : await supabase.from('competitions').insert(payload);
    setBusy(false); if(result.error) alert(result.error.message); else { setCompetitionEditor(null); await load(); }
  };
  const saveQuestionBank = async () => {
    if (!questionEditor?.name) return;
    setBusy(true);
    const payload = { organizer_id: organizer.id, owner_user_id: (await supabase.auth.getUser()).data.user?.id, name: questionEditor.name, description: questionEditor.description || null, grade_code: questionEditor.grade_code || null, status: questionEditor.status || 'DRAFT' };
    const result = questionEditor.id ? await supabase.from('question_banks').update(payload).eq('id',questionEditor.id) : await supabase.from('question_banks').insert(payload);
    setBusy(false); if(result.error) alert(result.error.message); else { setQuestionEditor(null); await load(); }
  };
  const saveTwibbon = async () => {
    if (!twibbonEditor?.name) return;
    setBusy(true);
    const payload = { organizer_id: organizer.id, competition_id: twibbonEditor.competition_id || null, name: twibbonEditor.name, image_url: twibbonEditor.image_url || null, is_required: !!twibbonEditor.is_required, is_active: !!twibbonEditor.is_active, config: twibbonEditor.config || {} };
    const result = twibbonEditor.id ? await supabase.from('twibbon_templates').update(payload).eq('id',twibbonEditor.id) : await supabase.from('twibbon_templates').insert(payload);
    setBusy(false); if(result.error) alert(result.error.message); else { setTwibbonEditor(null); await load(); }
  };
  const remove = async (table: string, id: string) => { if(!confirm('Hapus data ini?')) return; setBusy(true); const {error}=await supabase.from(table as any).delete().eq('id',id); setBusy(false); if(error) alert(error.message); else await load(); };

  if (!organizer) return <div className="p-6"><Card className="p-8 text-center"><Building2 size={30} className="mx-auto text-moss-400 mb-3"/><h2 className="text-white font-bold">Panel Penyelenggara</h2><p className="text-sm text-slate-500 mt-2">Akun ini belum memiliki organisasi yang terhubung di backend.</p></Card></div>;
  return <div className="min-h-screen flex bg-ink-950">
    <aside className="w-56 shrink-0 border-r border-white/5 p-3 sticky top-0 h-screen"><div className="px-3 py-3"><p className="text-xs text-moss-400">PENYELENGGARA</p><h1 className="text-lg font-bold text-white truncate">{organizer.name}</h1></div>{tabs.map(({key,label,Icon})=><button key={key} onClick={()=>setTab(key)} className={`w-full flex gap-3 items-center px-3 py-2.5 rounded-xl text-sm ${tab===key?'bg-moss-500/10 text-moss-300':'text-slate-400 hover:bg-white/5'}`}><Icon size={17}/>{label}</button>)}<Link to="/home" className="block px-3 mt-5 text-xs text-slate-500">← Kembali</Link></aside>
    <section className="flex-1 p-5 md:p-7 overflow-auto"><div className="flex justify-between mb-6"><div><h2 className="font-display text-2xl font-bold text-white">{tabs.find(t=>t.key===tab)?.label}</h2><p className="text-xs text-slate-500">{organizer.name} · live Supabase</p></div><Badge color="moss">{organizer.status}</Badge></div>
      {tab==='overview'&&<div className="grid grid-cols-2 lg:grid-cols-4 gap-3"><Metric label="Lomba" value={competitions.length}/><Metric label="Pendaftar" value={registrations.length}/><Metric label="Member" value={members.length}/><Metric label="Bank Soal" value={banks.length}/></div>}
      {tab==='competitions'&&<><div className="flex justify-end mb-3"><Button size="sm" icon={<Plus size={15}/>} onClick={()=>setCompetitionEditor({status:'DRAFT',visibility:'PUBLIC'})}>Tambah Lomba</Button></div><div className="space-y-3">{competitions.map(c=><Card key={c.id} className="p-4 flex gap-3 items-center"><div className="w-11 h-11 rounded-xl bg-moss-500/10 flex items-center justify-center"><Trophy size={19} className="text-moss-400"/></div><div className="flex-1"><p className="text-white font-semibold">{c.title}</p><p className="text-xs text-slate-500">{c.slug} · {c.visibility}</p></div><select className="input w-48" value={c.status} disabled={busy} onChange={e=>void transition(c.id,e.target.value)}>{statusOptions.map(s=><option key={s}>{s}</option>)}</select><button onClick={()=>setCompetitionEditor(c)}><Edit3 size={16}/></button><button onClick={()=>void remove('competitions',c.id)} className="text-red-400"><Trash2 size={16}/></button></Card>)}{!competitions.length&&<Card className="p-8 text-center text-slate-500">Belum ada lomba.</Card>}</div></>}
      {tab==='registrations'&&<div className="space-y-2">{registrations.map(r=><Card key={r.id} className="p-4 flex items-center gap-3"><Users size={17} className="text-slate-500"/><div className="flex-1"><p className="text-sm text-white">User {r.user_id.slice(0,8)}</p><p className="text-xs text-slate-500">Competition {r.competition_id.slice(0,8)} · {new Date(r.submitted_at || r.created_at).toLocaleString('id-ID')}</p></div><Badge>{r.status}</Badge></Card>)}{!registrations.length&&<Card className="p-8 text-center text-slate-500">Belum ada pendaftar.</Card>}</div>}
      {tab==='questions'&&<><div className="flex justify-end mb-3"><Button size="sm" icon={<Plus size={15}/>} onClick={()=>setQuestionEditor({status:'DRAFT'})}>Tambah Bank Soal</Button></div><div className="space-y-2">{banks.map(b=><Card key={b.id} className="p-4 flex items-center gap-3"><FileQuestion size={18} className="text-moss-400"/><div className="flex-1"><p className="text-white font-semibold">{b.name}</p><p className="text-xs text-slate-500">{b.grade_code||'Semua jenjang'} · {b.status}</p></div><button onClick={()=>setQuestionEditor(b)}><Edit3 size={16}/></button><button onClick={()=>void remove('question_banks',b.id)} className="text-red-400"><Trash2 size={16}/></button></Card>)}</div></>}
      {tab==='twibbon'&&<><div className="flex justify-end mb-3"><Button size="sm" icon={<Plus size={15}/>} onClick={()=>setTwibbonEditor({is_active:true,is_required:false})}>Tambah Twibbon</Button></div><div className="grid md:grid-cols-2 gap-3">{twibbons.map(t=><Card key={t.id} className="p-4"><div className="flex gap-3"><div className="w-20 h-14 rounded-lg bg-ink-800 overflow-hidden">{t.image_url&&<img src={t.image_url} className="w-full h-full object-cover"/>}</div><div className="flex-1"><p className="text-white font-semibold">{t.name}</p><p className="text-xs text-slate-500">{t.is_required?'Wajib':'Opsional'} · {t.is_active?'Aktif':'Nonaktif'}</p></div><button onClick={()=>setTwibbonEditor(t)}><Edit3 size={16}/></button><button onClick={()=>void remove('twibbon_templates',t.id)} className="text-red-400"><Trash2 size={16}/></button></div></Card>)}</div></>}
      {tab==='ads'&&<div className="space-y-4"><Card className="p-5"><h3 className="font-semibold text-white mb-2">Pasang Iklan Banner</h3><p className="text-sm text-slate-400">Ajukan iklan banner untuk ditampilkan di halaman beranda dan komunitas.</p><Link to="/organizer/ads" className="inline-block mt-3"><Button icon={<Megaphone size={15}/>}>Buka Form Request</Button></Link></Card><Card className="p-5"><h3 className="font-semibold text-white mb-2">Info Harga</h3><p className="text-xs text-slate-500">Harga iklan ditentukan oleh admin. Hubungi admin untuk informasi lebih lanjut.</p></Card></div>}
      {tab==='plans'&&<div className="space-y-3">{plans.map(p=><Card key={p.id} className="p-4 flex justify-between"><div><p className="text-white font-semibold">{p.plan_code}</p><p className="text-xs text-slate-500">{new Date(p.starts_at).toLocaleDateString('id-ID')} — {p.ends_at?new Date(p.ends_at).toLocaleDateString('id-ID'):'aktif'}</p></div><Badge color={p.is_active?'moss':'default'}>{p.is_active?'Digunakan':'Tidak aktif'}</Badge></Card>)}</div>}
    </section>
    {competitionEditor&&<Editor title={competitionEditor.id?'Edit Lomba':'Tambah Lomba'} onClose={()=>setCompetitionEditor(null)} onSave={()=>void saveCompetition()} busy={busy}><Field label="Judul" value={competitionEditor.title||''} onChange={v=>setCompetitionEditor((x:any)=>({...x,title:v}))}/><Field label="Slug" value={competitionEditor.slug||''} onChange={v=>setCompetitionEditor((x:any)=>({...x,slug:v}))}/><Field label="Kategori" value={competitionEditor.category||''} onChange={v=>setCompetitionEditor((x:any)=>({...x,category:v}))}/><Field label="Deskripsi singkat" value={competitionEditor.short_description||''} onChange={v=>setCompetitionEditor((x:any)=>({...x,short_description:v}))}/><Field label="Poster URL" value={competitionEditor.poster_url||''} onChange={v=>setCompetitionEditor((x:any)=>({...x,poster_url:v}))}/></Editor>}
    {questionEditor&&<Editor title={questionEditor.id?'Edit Bank Soal':'Tambah Bank Soal'} onClose={()=>setQuestionEditor(null)} onSave={()=>void saveQuestionBank()} busy={busy}><Field label="Nama" value={questionEditor.name||''} onChange={v=>setQuestionEditor((x:any)=>({...x,name:v}))}/><Field label="Deskripsi" value={questionEditor.description||''} onChange={v=>setQuestionEditor((x:any)=>({...x,description:v}))}/><Field label="Jenjang / Grade code" value={questionEditor.grade_code||''} onChange={v=>setQuestionEditor((x:any)=>({...x,grade_code:v}))}/></Editor>}
    {twibbonEditor&&<Editor title={twibbonEditor.id?'Edit Twibbon':'Tambah Twibbon'} onClose={()=>setTwibbonEditor(null)} onSave={()=>void saveTwibbon()} busy={busy}><Field label="Nama" value={twibbonEditor.name||''} onChange={v=>setTwibbonEditor((x:any)=>({...x,name:v}))}/><Field label="Image URL" value={twibbonEditor.image_url||''} onChange={v=>setTwibbonEditor((x:any)=>({...x,image_url:v}))}/><div><label className="label">Kompetisi</label><select className="input" value={twibbonEditor.competition_id||''} onChange={e=>setTwibbonEditor((x:any)=>({...x,competition_id:e.target.value||null}))}><option value="">Semua</option>{competitions.map(c=><option key={c.id} value={c.id}>{c.title}</option>)}</select></div><div className="flex gap-4 text-xs"><label className="flex items-center gap-2"><input type="checkbox" checked={!!twibbonEditor.is_required} onChange={e=>setTwibbonEditor((x:any)=>({...x,is_required:e.target.checked}))}/> Wajib</label><label className="flex items-center gap-2"><input type="checkbox" checked={!!twibbonEditor.is_active} onChange={e=>setTwibbonEditor((x:any)=>({...x,is_active:e.target.checked}))}/> Aktif</label></div></Editor>}
  </div>;
}
function Editor({title,children,onClose,onSave,busy}:{title:string;children:any;onClose:()=>void;onSave:()=>void;busy:boolean}){return <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"><div className="w-full max-w-xl card p-5"><div className="flex justify-between mb-4"><h3 className="font-bold text-white">{title}</h3><button onClick={onClose}><X size={18}/></button></div><div className="space-y-3">{children}</div><div className="flex justify-end gap-2 mt-5"><Button variant="outline" onClick={onClose}>Batal</Button><Button onClick={onSave} loading={busy}>Simpan</Button></div></div></div>}
function Field({label,value,onChange}:{label:string;value:string;onChange:(value:string)=>void}){return <div><label className="label">{label}</label><input className="input" value={value} onChange={e=>onChange(e.target.value)}/></div>}
function Metric({label,value}:{label:string;value:any}){return <Card className="p-4"><p className="text-xs text-slate-500">{label}</p><p className="text-2xl font-bold text-white mt-1">{String(value)}</p></Card>}
