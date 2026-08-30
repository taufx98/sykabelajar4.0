import { toast } from "@/lib/toast";
import { useEffect, useState } from 'react';
import { Building2, Trophy, Users, FileQuestion, Image, Settings, Plus, Trash2, X, Megaphone, LogIn, ArrowLeft, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { uploadImage } from '@/services/cloudinary.service';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { resolveCurrentUserOrganizer, setSelectedOrganizerId } from '@/services/organizerAuth.service';

type Tab = { key: string; label: string; Icon: typeof Trophy };
const statusOptions = ['DRAFT','PUBLISHED','REGISTRATION_OPEN','REGISTRATION_CLOSED','LIVE','SUBMISSION_CLOSED','GRADING','RESULT_PUBLISHED','SUSPENDED','CANCELLED','ARCHIVED'];

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
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showLoginForm, setShowLoginForm] = useState(false);
  const [competitionEditor, setCompetitionEditor] = useState<any | null>(null);
  const [questionEditor, setQuestionEditor] = useState<any | null>(null);
  const [twibbonEditor, setTwibbonEditor] = useState<any | null>(null);
  const [orgName, setOrgName] = useState('');
  const [creatingOrg, setCreatingOrg] = useState(false);
  const [loginOrgName, setLoginOrgName] = useState('');
  const [loginOrgPass, setLoginOrgPass] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);

  const tabs: Tab[] = [
    {key:'overview',label:'Ringkasan',Icon:Building2},
    {key:'competitions',label:'Lomba',Icon:Trophy},
    {key:'registrations',label:'Pendaftar',Icon:Users},
    {key:'questions',label:'Bank Soal',Icon:FileQuestion},
    {key:'twibbon',label:'Twibbon',Icon:Image},
    {key:'plans',label:'Plan & Usage',Icon:Settings},
    {key:'ads',label:'Pasang Iklan',Icon:Megaphone},
  ];

  const load = async () => {
    const org = await resolveCurrentUserOrganizer();
    if (!org) { setOrganizer(null); return; }
    setOrganizer(org);
    const [c,m,p,b,t] = await Promise.all([
      supabase.from('competitions').select('*').eq('organizer_id', org.id).order('created_at',{ascending:false}),
      supabase.from('organizer_members').select('*').eq('organizer_id', org.id),
      supabase.from('organizer_plans').select('*').eq('organizer_id', org.id).order('created_at',{ascending:false}),
      supabase.from('question_banks').select('*').eq('organizer_id', org.id).order('created_at',{ascending:false}),
      supabase.from('twibbon_templates').select('*').eq('organizer_id', org.id).order('created_at',{ascending:false}),
    ]);
    if (c.error) throw c.error;
    if (m.error) throw m.error;
    if (p.error) throw p.error;
    if (b.error) throw b.error;
    if (t.error) throw t.error;
    const ids = (c.data || []).map((x) => x.id);
    const { data: regs, error: regError } = ids.length
      ? await supabase.from('registrations').select('*').in('competition_id', ids).order('created_at',{ascending:false})
      : { data: [] as any[], error: null };
    if (regError) throw regError;
    setCompetitions(c.data || []);
    setMembers(m.data || []);
    setPlans(p.data || []);
    setBanks(b.data || []);
    setTwibbons(t.data || []);
    setRegistrations(regs || []);
  };

  useEffect(() => { void load().catch((error) => toast.error(error?.message ?? 'Gagal memuat panel penyelenggara.')); }, []);

  const transition = async (id: string, status: string) => {
    setBusy(true);
    try {
      const { error } = await supabase.rpc('transition_competition', { p_competition_id: id, p_to_status: status, p_reason: 'Organizer dashboard' });
      if (error) throw error;
      await load();
    } catch (e: any) { toast.error(e?.message ?? 'Perubahan status ditolak.'); }
    finally { setBusy(false); }
  };

  const saveCompetition = async () => {
    if (!competitionEditor?.title || !competitionEditor?.slug) return;
    setBusy(true);
    try {
      const payload = { title: competitionEditor.title, slug: competitionEditor.slug, category: competitionEditor.category || 'Kompetisi', short_description: competitionEditor.short_description || null, description: competitionEditor.description || null, poster_url: competitionEditor.poster_url || null, juknis_url: competitionEditor.juknis_url || null, visibility: competitionEditor.visibility || 'PUBLIC', organizer_id: organizer.id };
      const result = competitionEditor.id ? await supabase.from('competitions').update(payload).eq('id', competitionEditor.id) : await supabase.from('competitions').insert(payload);
      if (result.error) throw result.error;
      setCompetitionEditor(null); await load();
    } catch (e:any) { toast.error(e?.message ?? 'Gagal menyimpan lomba.'); }
    finally { setBusy(false); }
  };

  const saveQuestionBank = async () => {
    if (!questionEditor?.name) return;
    setBusy(true);
    try {
      const payload = { organizer_id: organizer.id, owner_user_id: (await supabase.auth.getUser()).data.user?.id, name: questionEditor.name, description: questionEditor.description || null, grade_code: questionEditor.grade_code || null, status: questionEditor.status || 'DRAFT' };
      const result = questionEditor.id ? await supabase.from('question_banks').update(payload).eq('id', questionEditor.id) : await supabase.from('question_banks').insert(payload);
      if (result.error) throw result.error;
      setQuestionEditor(null); await load();
    } catch (e:any) { toast.error(e?.message ?? 'Gagal menyimpan bank soal.'); }
    finally { setBusy(false); }
  };

  const saveTwibbon = async () => {
    if (!twibbonEditor?.name) return;
    setBusy(true);
    try {
      const payload = { organizer_id: organizer.id, competition_id: twibbonEditor.competition_id || null, name: twibbonEditor.name, image_url: twibbonEditor.image_url || null, is_required: !!twibbonEditor.is_required, is_active: !!twibbonEditor.is_active, config: twibbonEditor.config || {} };
      const result = twibbonEditor.id ? await supabase.from('twibbon_templates').update(payload).eq('id', twibbonEditor.id) : await supabase.from('twibbon_templates').insert(payload);
      if (result.error) throw result.error;
      setTwibbonEditor(null); await load();
    } catch (e:any) { toast.error(e?.message ?? 'Gagal menyimpan twibbon.'); }
    finally { setBusy(false); }
  };

  const remove = async (table: string, id: string) => {
    if (!confirm('Hapus data ini?')) return;
    setBusy(true);
    try { const { error } = await supabase.from(table as any).delete().eq('id', id); if (error) throw error; await load(); }
    catch (e:any) { toast.error(e?.message ?? 'Gagal menghapus data.'); }
    finally { setBusy(false); }
  };

  const createOrg = async () => {
    if (!orgName.trim()) return;
    setCreatingOrg(true);
    try {
      const slugified = orgName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'org-' + Date.now();
      const { data, error } = await supabase.rpc('create_organizer', { p_name: orgName.trim(), p_slug: slugified });
      if (error) throw error;
      const created = Array.isArray(data) ? data[0] : data;
      const code = created?.access_code ? String(created.access_code) : '';
      if (created?.id) setSelectedOrganizerId(String(created.id));
      setOrgName(''); setShowCreateForm(false);
      if (code) { try { await navigator.clipboard.writeText(code); } catch {} toast.success(`Organisasi dibuat. Kode akses ${code} sudah disalin ke clipboard.`); }
      else toast.success('Organisasi berhasil dibuat.');
      await load();
    } catch (e:any) { toast.error(e?.message ?? 'Gagal membuat organisasi.'); }
    finally { setCreatingOrg(false); }
  };

  const loginToOrg = async () => {
    if (!loginOrgName.trim() || !loginOrgPass.trim()) return;
    setLoggingIn(true);
    try {
      const { data, error } = await supabase.rpc('join_organizer', { p_slug: loginOrgName.trim(), p_access_code: loginOrgPass.trim() });
      if (error) throw error;
      const joined = Array.isArray(data) ? data[0] : data;
      if (!joined?.organizer_id) throw new Error('Organisasi tidak ditemukan atau kode akses salah.');
      setSelectedOrganizerId(String(joined.organizer_id));
      toast.success(`Berhasil masuk ke ${joined.name}.`);
      setLoginOrgName(''); setLoginOrgPass(''); setShowLoginForm(false); await load();
    } catch (e:any) { toast.error(e?.message ?? 'Gagal masuk ke organisasi.'); }
    finally { setLoggingIn(false); }
  };

  if (!organizer) {
    return <div className="min-h-screen surface-bg flex items-center justify-center p-6"><div className="w-full max-w-md"><div className="text-center mb-8"><div className="w-16 h-16 rounded-2xl bg-moss-500/10 flex items-center justify-center mx-auto mb-4"><Building2 size={28} className="text-accent" /></div><h1 className="text-2xl font-bold text-fg mb-2">Panel Penyelenggara</h1><p className="text-sm text-slate-400">Buat atau masuk ke organisasi untuk mulai mengelola lomba</p></div>{!showCreateForm && !showLoginForm && <div className="space-y-3"><button onClick={() => setShowCreateForm(true)} className="w-full p-4 rounded-xl surface-card-bg border surface-border hover:border-moss-500/30 hover:surface-elevated transition-all duration-200 text-left group"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-xl bg-moss-500/10 flex items-center justify-center"><Plus size={18} className="text-accent" /></div><div className="flex-1"><p className="text-sm font-semibold text-fg">Buat Organisasi Baru</p><p className="text-[11px] text-slate-500">Daftarkan organisasi kamu</p></div><ChevronRight size={16} className="text-slate-600" /></div></button><button onClick={() => setShowLoginForm(true)} className="w-full p-4 rounded-xl surface-card-bg border surface-border hover:border-sky-500/30 hover:surface-elevated transition-all duration-200 text-left group"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-xl bg-sky-500/10 flex items-center justify-center"><LogIn size={18} className="text-sky-400" /></div><div className="flex-1"><p className="text-sm font-semibold text-fg">Masuk ke Organisasi</p><p className="text-[11px] text-slate-500">Gabung dengan organisasi yang sudah ada</p></div><ChevronRight size={16} className="text-slate-600" /></div></button></div>}{showCreateForm && <div className="surface-card-bg border border-moss-500/20 rounded-xl p-5 animate-slide-up"><div className="flex items-center justify-between mb-4"><h3 className="text-sm font-semibold text-fg">Buat Organisasi</h3><button onClick={() => setShowCreateForm(false)} className="text-slate-500 hover:text-fg"><X size={16}/></button></div><div className="space-y-3"><div><label className="text-xs text-slate-400 font-medium mb-1.5 block">Nama Organisasi</label><input className="input w-full" value={orgName} onChange={e=>setOrgName(e.target.value)} placeholder="Contoh: OSIS SMK Negeri 1" onKeyDown={e=>{if(e.key==='Enter')void createOrg();}}/></div><Button fullWidth loading={creatingOrg} disabled={!orgName.trim()} onClick={()=>void createOrg()} icon={<Plus size={16}/>}>Buat Organisasi</Button></div></div>}{showLoginForm && <div className="surface-card-bg border border-sky-500/20 rounded-xl p-5 animate-slide-up"><div className="flex items-center justify-between mb-4"><h3 className="text-sm font-semibold text-fg">Masuk ke Organisasi</h3><button onClick={()=>setShowLoginForm(false)} className="text-slate-500 hover:text-fg"><X size={16}/></button></div><div className="space-y-3"><div><label className="text-xs text-slate-400 font-medium mb-1.5 block">Slug Organisasi</label><input className="input w-full" value={loginOrgName} onChange={e=>setLoginOrgName(e.target.value)} placeholder="contoh: osis-smk-negeri-1"/></div><div><label className="text-xs text-slate-400 font-medium mb-1.5 block">Kode Akses</label><input className="input w-full" type="password" value={loginOrgPass} onChange={e=>setLoginOrgPass(e.target.value)} placeholder="Kode akses organisasi" onKeyDown={e=>{if(e.key==='Enter')void loginToOrg();}}/></div><Button fullWidth loading={loggingIn} disabled={!loginOrgName.trim()||!loginOrgPass.trim()} onClick={()=>void loginToOrg()} icon={<LogIn size={16}/>}>Masuk</Button></div></div>}<Link to="/home" className="block mt-6 text-center text-xs text-slate-500 hover:text-fg transition">← Kembali ke Beranda</Link></div></div>;
  }

  return <div className="min-h-screen flex surface-bg"><aside className="w-56 shrink-0 border-r surface-border p-3 sticky top-0 h-screen hidden md:block"><div className="px-3 py-3 mb-4"><p className="text-[10px] text-accent font-semibold uppercase">Penyelenggara</p><h1 className="text-lg font-bold text-fg truncate">{organizer.name}</h1></div><nav className="space-y-1">{tabs.map(({key,label,Icon})=><button key={key} onClick={()=>setTab(key)} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition ${tab===key?'bg-moss-500/10 text-accent':'text-slate-400 hover:bg-surface-elevated/50 hover:text-fg-secondary'}`}><Icon size={17}/>{label}</button>)}</nav><Link to="/home" className="block px-3 mt-6 text-xs text-slate-500 hover:text-fg transition">← Kembali</Link></aside><section className="flex-1 p-5 md:p-7 overflow-auto"><div className="md:hidden flex items-center gap-3 mb-4"><Link to="/home" className="p-2 rounded-lg hover:bg-surface-elevated/50 text-slate-400"><ArrowLeft size={18}/></Link><h1 className="font-bold text-fg truncate">{organizer.name}</h1></div><div className="md:hidden flex gap-1 overflow-x-auto no-scrollbar mb-4 pb-2">{tabs.map(({key,label,Icon})=><button key={key} onClick={()=>setTab(key)} className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition ${tab===key?'bg-moss-500/15 text-accent':'text-slate-500'}`}><Icon size={14}/>{label}</button>)}</div><div className="flex items-center justify-between mb-6"><div><h2 className="font-display text-xl font-bold text-fg hidden md:block">{tabs.find(t=>t.key===tab)?.label}</h2><p className="text-[11px] text-slate-500 mt-0.5">{organizer.name} · live Supabase</p></div><Badge color="moss">{organizer.status}</Badge></div>
  {tab==='overview' && <div className="grid grid-cols-2 lg:grid-cols-4 gap-3"><Metric label="Lomba" value={competitions.length}/><Metric label="Pendaftar" value={registrations.length}/><Metric label="Member" value={members.length}/><Metric label="Bank Soal" value={banks.length}/></div>}
  {tab==='competitions' && <><div className="flex justify-end mb-3"><Button size="sm" icon={<Plus size={15}/>} onClick={()=>setCompetitionEditor({status:'DRAFT',visibility:'PUBLIC'})}>Tambah Lomba</Button></div><div className="space-y-2">{competitions.map(c=><div key={c.id} className="group flex items-center gap-3 p-4 rounded-xl surface-card-bg border surface-border hover:border-moss-500/20 transition-all cursor-pointer" onClick={()=>setCompetitionEditor(c)}><div className="w-11 h-11 rounded-xl bg-moss-500/10 flex items-center justify-center"><Trophy size={18} className="text-accent"/></div><div className="flex-1 min-w-0"><p className="text-sm font-semibold text-fg group-hover:text-accent transition truncate">{c.title}</p><p className="text-[11px] text-slate-500">{c.slug}</p></div><select className="input w-40 text-xs" value={c.status} onClick={e=>e.stopPropagation()} onChange={e=>{e.stopPropagation();void transition(c.id,e.target.value)}} disabled={busy}>{statusOptions.map(s=><option key={s}>{s}</option>)}</select></div>)}{!competitions.length&&<Card className="p-8 text-center text-sm text-slate-500">Belum ada lomba.</Card>}</div></>}
  {tab==='registrations' && <div className="space-y-2">{registrations.map(r=><div key={r.id} className="flex items-center gap-3 p-4 rounded-xl surface-card-bg border surface-border"><Users size={17} className="text-slate-500"/><div className="flex-1"><p className="text-sm text-fg">User {r.user_id.slice(0,8)}</p><p className="text-[11px] text-slate-500">{new Date(r.submitted_at||r.created_at).toLocaleString('id-ID')}</p></div><Badge>{r.status}</Badge></div>)}{!registrations.length&&<Card className="p-8 text-center text-sm text-slate-500">Belum ada pendaftar.</Card>}</div>}
  {tab==='questions' && <><div className="flex justify-end mb-3"><Button size="sm" icon={<Plus size={15}/>} onClick={()=>setQuestionEditor({status:'DRAFT'})}>Tambah Bank Soal</Button></div><div className="space-y-2">{banks.map(b=><div key={b.id} className="group flex items-center gap-3 p-4 rounded-xl surface-card-bg border surface-border cursor-pointer" onClick={()=>setQuestionEditor(b)}><FileQuestion size={18} className="text-accent"/><div className="flex-1"><p className="text-fg font-semibold text-sm">{b.name}</p><p className="text-[11px] text-slate-500">{b.grade_code||'Semua jenjang'} · {b.status}</p></div><button className="opacity-0 group-hover:opacity-100 p-2 rounded-lg text-red-400 transition" onClick={e=>{e.stopPropagation();void remove('question_banks',b.id)}}><Trash2 size={14}/></button></div>)}</div></>}
  {tab==='twibbon' && <><div className="flex justify-end mb-3"><Button size="sm" icon={<Plus size={15}/>} onClick={()=>setTwibbonEditor({is_active:true,is_required:false})}>Tambah Twibbon</Button></div><div className="grid md:grid-cols-2 gap-3">{twibbons.map(t=><div key={t.id} className="group p-4 rounded-xl surface-card-bg border surface-border cursor-pointer" onClick={()=>setTwibbonEditor(t)}><div className="flex gap-3"><div className="w-20 h-14 rounded-lg surface-elevated overflow-hidden shrink-0">{t.image_url&&<img src={t.image_url} className="w-full h-full object-cover" alt=""/>}</div><div className="flex-1"><p className="text-fg font-semibold text-sm">{t.name}</p><p className="text-[11px] text-slate-500">{t.is_required?'Wajib':'Opsional'} · {t.is_active?'Aktif':'Nonaktif'}</p></div></div></div>)}</div></>}
  {tab==='ads' && <Card className="p-5"><h3 className="font-semibold text-fg mb-2">Pasang Iklan Banner</h3><p className="text-sm text-slate-400">Ajukan iklan banner untuk ditampilkan di halaman beranda.</p><Link to="/organizer/ads" className="inline-block mt-3"><Button icon={<Megaphone size={15}/>}>Buka Form Request</Button></Link></Card>}
  {tab==='plans' && <div className="space-y-2">{plans.map(p=><div key={p.id} className="flex items-center justify-between p-4 rounded-xl surface-card-bg border surface-border"><div><p className="text-fg font-semibold text-sm">{p.plan_code}</p><p className="text-[11px] text-slate-500">{new Date(p.starts_at).toLocaleDateString('id-ID')} — {p.ends_at?new Date(p.ends_at).toLocaleDateString('id-ID'):'aktif'}</p></div><Badge color={p.is_active&&(!p.ends_at||new Date(p.ends_at)>new Date())?'moss':'default'}>{p.is_active&&(!p.ends_at||new Date(p.ends_at)>new Date())?'Digunakan':'Kedaluwarsa / Tidak aktif'}</Badge></div>)}</div>}
  </section>

  {competitionEditor&&<Editor title={competitionEditor.id?'Edit Lomba':'Tambah Lomba'} onClose={()=>setCompetitionEditor(null)} onSave={()=>void saveCompetition()} busy={busy}><Field label="Judul" value={competitionEditor.title||''} onChange={v=>setCompetitionEditor((x:any)=>({...x,title:v}))}/><Field label="Slug" value={competitionEditor.slug||''} onChange={v=>setCompetitionEditor((x:any)=>({...x,slug:v}))}/><Field label="Kategori" value={competitionEditor.category||''} onChange={v=>setCompetitionEditor((x:any)=>({...x,category:v}))}/><Field label="Deskripsi singkat" value={competitionEditor.short_description||''} onChange={v=>setCompetitionEditor((x:any)=>({...x,short_description:v}))}/></Editor>}
  {questionEditor&&<Editor title={questionEditor.id?'Edit Bank Soal':'Tambah Bank Soal'} onClose={()=>setQuestionEditor(null)} onSave={()=>void saveQuestionBank()} busy={busy}><Field label="Nama" value={questionEditor.name||''} onChange={v=>setQuestionEditor((x:any)=>({...x,name:v}))}/><Field label="Deskripsi" value={questionEditor.description||''} onChange={v=>setQuestionEditor((x:any)=>({...x,description:v}))}/><Field label="Jenjang" value={questionEditor.grade_code||''} onChange={v=>setQuestionEditor((x:any)=>({...x,grade_code:v}))}/></Editor>}
  {twibbonEditor&&<Editor title={twibbonEditor.id?'Edit Twibbon':'Tambah Twibbon'} onClose={()=>setTwibbonEditor(null)} onSave={()=>void saveTwibbon()} busy={busy}><Field label="Nama" value={twibbonEditor.name||''} onChange={v=>setTwibbonEditor((x:any)=>({...x,name:v}))}/><Field label="Image URL" value={twibbonEditor.image_url||''} onChange={v=>setTwibbonEditor((x:any)=>({...x,image_url:v}))}/><div className="flex gap-4 text-xs"><label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={!!twibbonEditor.is_required} onChange={e=>setTwibbonEditor((x:any)=>({...x,is_required:e.target.checked}))}/> Wajib</label><label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={!!twibbonEditor.is_active} onChange={e=>setTwibbonEditor((x:any)=>({...x,is_active:e.target.checked}))}/> Aktif</label></div></Editor>}
  </div>;
}

function Editor({title,children,onClose,onSave,busy}:{title:string;children:any;onClose:()=>void;onSave:()=>void;busy:boolean}){return <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"><div className="w-full max-w-xl surface-card-bg border surface-border rounded-2xl shadow-2xl p-5"><div className="flex justify-between items-center mb-4"><h3 className="font-bold text-fg">{title}</h3><button onClick={onClose} className="text-slate-400 hover:text-fg"><X size={18}/></button></div><div className="space-y-3">{children}</div><div className="flex justify-end gap-2 mt-5 pt-4 border-t surface-border"><Button variant="outline" onClick={onClose}>Batal</Button><Button onClick={onSave} loading={busy}>Simpan</Button></div></div></div>}
function Field({label,value,onChange}:{label:string;value:string;onChange:(value:string)=>void}){return <div><label className="text-xs text-slate-400 font-medium mb-1.5 block">{label}</label><input className="input focus:border-moss-500/50" value={value} onChange={e=>onChange(e.target.value)}/></div>}
function Metric({label,value}:{label:string;value:any}){return <Card className="p-4"><p className="text-xs text-slate-500">{label}</p><p className="text-2xl font-bold text-fg mt-1">{Number(value||0).toLocaleString('id-ID')}</p></Card>}
