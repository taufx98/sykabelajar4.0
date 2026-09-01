import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, BarChart3, BookOpen, Building2, ClipboardList, FileQuestion, Gauge, Megaphone, Plus, Sparkles, Trophy, Users } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { useApp } from '@/store/AppContext';
import { listCurrentUserOrganizers, resolveCurrentUserOrganizer, setSelectedOrganizerId, type CurrentOrganizer } from '@/services/organizerAuth.service';
import { getActiveOrganizerEntitlements } from '@/services/organizerEntitlement.service';
import { supabase } from '@/lib/supabase';

const TABS = [
  ['overview', 'Ringkasan', Building2],
  ['competitions', 'Lomba', Trophy],
  ['question-bank', 'Bank Soal', FileQuestion],
] as const;
type TabKey = (typeof TABS)[number][0];

const actions = [
  { to: '/organizer/competition/new', label: 'Buat Lomba', description: 'Wizard 5 langkah untuk identitas, timeline, target peserta, poster, dan Twibbon.', icon: Trophy },
  { to: '/organizer/registrations', label: 'Pendaftar', description: 'Review peserta dengan nama lengkap, username, status, dan waktu pendaftaran.', icon: ClipboardList },
  { to: '/organizer/members', label: 'Kelola Member', description: 'Atur anggota workspace dan hak akses berdasarkan role.', icon: Users },
  { to: '/organizer/grading', label: 'Penilaian', description: 'Kelola penilaian dan AI assessment untuk soal esai premium.', icon: Gauge },
  { to: '/organizer/plan', label: 'Plan & Usage', description: 'Lihat paket aktif, entitlement, dan batas penggunaan organisasi.', icon: BarChart3 },
  { to: '/organizer/ads', label: 'Pasang Iklan', description: 'Ajukan banner promosi untuk halaman beranda.', icon: Megaphone },
];

function humanStatus(value: string) {
  return value.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase());
}

export function OrganizerControlCenterPage() {
  const { toast } = useApp();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const activeTab: TabKey = (TABS.some(([key]) => key === params.get('tab')) ? params.get('tab') : 'overview') as TabKey;
  const [org, setOrg] = useState<CurrentOrganizer | null>(null);
  const [workspaces, setWorkspaces] = useState<CurrentOrganizer[]>([]);
  const [competitions, setCompetitions] = useState<any[]>([]);
  const [banks, setBanks] = useState<any[]>([]);
  const [stats, setStats] = useState({ competitions: 0, registrations: 0, members: 0, banks: 0 });
  const [plan, setPlan] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [bankOpen, setBankOpen] = useState(false);
  const [bankName, setBankName] = useState('');
  const [bankDescription, setBankDescription] = useState('');
  const [bankGrade, setBankGrade] = useState('');

  const canEdit = org?._memberRole === 'owner' || org?._memberRole === 'editor';

  const load = async () => {
    setLoading(true);
    try {
      const [all, current] = await Promise.all([listCurrentUserOrganizers(), resolveCurrentUserOrganizer()]);
      setWorkspaces(all);
      setOrg(current);
      if (!current) return;

      const [c, r, m, b, ent] = await Promise.all([
        supabase.from('competitions').select('id,title,slug,status,created_at,registration_starts_at,registration_ends_at,starts_at,ends_at').eq('organizer_id', current.id).order('created_at', { ascending: false }),
        supabase.rpc('list_organizer_registrations', { p_organizer_id: current.id }),
        supabase.from('organizer_members').select('user_id', { count: 'exact', head: true }).eq('organizer_id', current.id),
        supabase.from('question_banks').select('id,name,description,grade_code,status,created_at').eq('organizer_id', current.id).order('created_at', { ascending: false }),
        getActiveOrganizerEntitlements(current.id),
      ]);
      if (c.error) throw c.error;
      if (r.error) throw r.error;
      if (m.error) throw m.error;
      if (b.error) throw b.error;
      setCompetitions(c.data ?? []);
      setBanks(b.data ?? []);
      setStats({ competitions: c.data?.length ?? 0, registrations: r.data?.length ?? 0, members: m.count ?? 0, banks: b.data?.length ?? 0 });
      setPlan(ent.planCode);
    } catch (e: any) {
      toast(e?.message ?? 'Gagal memuat Control Center penyelenggara.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const switchTab = (tab: TabKey) => {
    const next = new URLSearchParams(params);
    if (tab === 'overview') next.delete('tab'); else next.set('tab', tab);
    setParams(next, { replace: true });
  };

  const switchWorkspace = (id: string) => {
    if (!workspaces.some((x) => x.id === id)) return;
    setSelectedOrganizerId(id);
    void load();
  };

  const createBank = async () => {
    if (!org || !canEdit || !bankName.trim()) return;
    setBusy(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error('Sesi login tidak ditemukan.');
      const { data, error } = await supabase.from('question_banks').insert({
        organizer_id: org.id,
        owner_user_id: auth.user.id,
        name: bankName.trim(),
        description: bankDescription.trim() || null,
        grade_code: bankGrade || null,
        status: 'DRAFT',
      }).select('id').single();
      if (error) throw error;
      setBankOpen(false);
      setBankName('');
      setBankDescription('');
      setBankGrade('');
      toast('Bank soal berhasil dibuat.', 'success');
      navigate(`/organizer/question-bank/${data.id}`);
    } catch (e: any) {
      toast(e?.message ?? 'Gagal membuat bank soal.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const summary = useMemo(() => [
    { label: 'Lomba', value: stats.competitions, icon: Trophy },
    { label: 'Pendaftar', value: stats.registrations, icon: ClipboardList },
    { label: 'Member', value: stats.members, icon: Users },
    { label: 'Bank Soal', value: stats.banks, icon: FileQuestion },
  ], [stats]);

  if (loading && !org) return <div className="p-6 md:p-8"><Card className="p-10 text-center"><p className="text-sm text-fg-muted">Memuat workspace penyelenggara…</p></Card></div>;

  if (!org) return <div className="p-6 md:p-10"><Card className="max-w-xl mx-auto p-8 text-center"><Building2 size={36} className="mx-auto text-accent mb-3"/><h1 className="text-xl font-bold text-fg">Belum ada workspace</h1><p className="text-sm text-fg-muted mt-2">Buat atau bergabung ke organisasi untuk mengelola lomba dan bank soal.</p><Link to="/organizer" className="inline-flex mt-5"><Button>Buka Pengaturan Organisasi</Button></Link></Card></div>;

  return <div className="p-4 md:p-7 space-y-6">
    <section className="rounded-3xl surface-card-bg border surface-border p-5 md:p-7 overflow-hidden relative">
      <div className="absolute -right-20 -top-24 w-64 h-64 rounded-full bg-moss-500/10 blur-3xl pointer-events-none" />
      <div className="relative flex flex-col xl:flex-row xl:items-center gap-5">
        <div className="flex items-center gap-4 min-w-0 flex-1">
          <div className="w-14 h-14 rounded-2xl bg-moss-500/10 flex items-center justify-center shrink-0"><Building2 size={25} className="text-accent" /></div>
          <div className="min-w-0"><p className="text-[10px] uppercase tracking-widest text-accent font-semibold">Organizer Control Center</p><h1 className="text-2xl md:text-3xl font-bold text-fg truncate">{org.name}</h1><div className="flex flex-wrap items-center gap-2 mt-2"><Badge color="moss">{org._memberRole || 'member'}</Badge><Badge>{humanStatus(org.status)}</Badge>{plan && <Badge color="moss">Plan {plan}</Badge>}</div></div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {workspaces.length > 1 && <select aria-label="Pilih organisasi" className="input text-sm min-w-[190px]" value={org.id} onChange={e=>switchWorkspace(e.target.value)}>{workspaces.map(w=><option key={w.id} value={w.id}>{w.name} · {w._memberRole}</option>)}</select>}
          {canEdit && <Link to="/organizer/competition/new"><Button icon={<Plus size={16}/>}>Buat Lomba</Button></Link>}
        </div>
      </div>
    </section>

    <div className="flex items-center gap-1 rounded-2xl surface-card-bg border surface-border p-1 overflow-x-auto">
      {TABS.map(([key, label, Icon]) => <button key={key} onClick={() => switchTab(key)} className={`shrink-0 inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition ${activeTab===key?'bg-accent-muted-strong text-accent':'text-fg-muted hover:text-fg hover:bg-surface-elevated/50'}`}><Icon size={16}/>{label}</button>)}
    </div>

    {activeTab==='overview' && <>
      <section className="grid grid-cols-2 xl:grid-cols-4 gap-3">{summary.map(({label,value,icon:Icon})=><Card key={label} className="p-4 md:p-5"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center"><Icon size={18} className="text-accent"/></div><div><p className="text-xs text-fg-muted">{label}</p><p className="text-xl md:text-2xl font-bold text-fg mt-0.5">{value.toLocaleString('id-ID')}</p></div></div></Card>)}</section>
      <section><div className="flex items-end justify-between mb-3"><div><p className="text-[10px] uppercase tracking-widest text-accent font-semibold">Workflow</p><h2 className="text-lg font-bold text-fg">Kelola organisasi</h2><p className="text-xs text-fg-muted mt-1">Alur utama pengelolaan lomba tetap memakai komponen dan tema SykaBelajar.</p></div></div><div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">{actions.map(({to,label,description,icon:Icon})=><Link key={to} to={to} className="group"><Card className="h-full p-4 hover:border-accent/30 transition-all"><div className="flex items-start gap-3"><div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center shrink-0"><Icon size={18} className="text-accent"/></div><div className="min-w-0 flex-1"><p className="font-semibold text-fg group-hover:text-accent transition">{label}</p><p className="text-xs text-fg-muted mt-1 leading-5">{description}</p></div><ArrowRight size={15} className="text-fg-muted group-hover:text-accent mt-1"/></div></Card></Link>)}</div></section>
    </>}

    {activeTab==='competitions' && <section><div className="flex flex-col md:flex-row md:items-end justify-between gap-3 mb-4"><div><p className="text-[10px] uppercase tracking-widest text-accent font-semibold">Manajemen Lomba</p><h2 className="text-xl font-bold text-fg">Semua Lomba</h2><p className="text-xs text-fg-muted mt-1">Kelola draft, status, dan masuk ke konfigurasi lomba.</p></div>{canEdit&&<Link to="/organizer/competition/new"><Button icon={<Plus size={16}/>}>Buat Lomba</Button></Link>}</div><div className="space-y-2">{competitions.map(c=><Card key={c.id} className="p-4"><div className="flex flex-col md:flex-row md:items-center gap-3"><div className="w-11 h-11 rounded-xl bg-accent/10 flex items-center justify-center shrink-0"><Trophy size={18} className="text-accent"/></div><div className="flex-1 min-w-0"><p className="font-semibold text-fg truncate">{c.title}</p><p className="text-[11px] text-fg-muted truncate">/{c.slug}</p><p className="text-[11px] text-fg-muted mt-1">Pendaftaran: {c.registration_starts_at?new Date(c.registration_starts_at).toLocaleString('id-ID'):'—'} → {c.registration_ends_at?new Date(c.registration_ends_at).toLocaleString('id-ID'):'—'}</p></div><Badge color={c.status==='DRAFT'?'default':'moss'}>{humanStatus(c.status)}</Badge><div className="flex gap-2"><Link to={`/organizer/competition/${c.id}/config`}><Button size="sm" variant="outline">Konfigurasi</Button></Link><Link to={`/lomba/${c.slug}`}><Button size="sm" variant="ghost">Lihat</Button></Link></div></div></Card>)}{!competitions.length&&<Card className="p-10 text-center"><Trophy size={28} className="mx-auto text-fg-muted mb-2"/><p className="font-semibold text-fg">Belum ada lomba</p><p className="text-xs text-fg-muted mt-1">Mulai dengan wizard Buat Lomba untuk membuat draft pertama.</p></Card>}</div></section>}

    {activeTab==='question-bank' && <section><div className="flex flex-col md:flex-row md:items-end justify-between gap-3 mb-4"><div><p className="text-[10px] uppercase tracking-widest text-accent font-semibold">Question Engine</p><h2 className="text-xl font-bold text-fg">Bank Soal</h2><p className="text-xs text-fg-muted mt-1">Buat bank lalu susun Pilihan Ganda, Benar/Salah, atau Essay.</p></div>{canEdit&&<Button icon={<Plus size={16}/>} onClick={()=>setBankOpen(true)}>Tambah Bank Soal</Button>}</div><div className="grid md:grid-cols-2 gap-3">{banks.map(b=><Card key={b.id} className="p-4"><div className="flex items-start gap-3"><div className="w-11 h-11 rounded-xl bg-moss-500/10 flex items-center justify-center shrink-0"><BookOpen size={18} className="text-accent"/></div><div className="flex-1 min-w-0"><p className="font-semibold text-fg truncate">{b.name}</p><p className="text-xs text-fg-muted mt-1">{b.grade_code || 'Semua jenjang'} · {humanStatus(b.status)}</p>{b.description&&<p className="text-xs text-fg-muted mt-2 line-clamp-2">{b.description}</p>}</div><Link to={`/organizer/question-bank/${b.id}`}><Button size="sm" variant="outline">Kelola Soal</Button></Link></div></Card>)}{!banks.length&&<Card className="p-10 text-center md:col-span-2"><FileQuestion size={28} className="mx-auto text-fg-muted mb-2"/><p className="font-semibold text-fg">Belum ada bank soal</p><p className="text-xs text-fg-muted mt-1">Buat bank soal pertama dan langsung lanjut ke editor soal.</p></Card>}</div></section>}

    {bankOpen&&<div className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onKeyDown={e=>{if(e.key==='Escape')setBankOpen(false)}}><Card className="w-full max-w-lg p-5 md:p-6"><div className="flex items-center gap-3 mb-5"><div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center"><Sparkles size={18} className="text-accent"/></div><div><h3 className="font-bold text-fg">Buat Bank Soal</h3><p className="text-xs text-fg-muted mt-0.5">Setelah dibuat, kamu langsung masuk ke editor type-specific.</p></div></div><div className="space-y-3"><label className="text-xs text-fg-muted block">Nama Bank Soal<input autoFocus className="input mt-1 w-full" value={bankName} onChange={e=>setBankName(e.target.value)} placeholder="Contoh: Bank Soal NSSC 2026" /></label><label className="text-xs text-fg-muted block">Deskripsi<textarea className="input mt-1 w-full min-h-24" value={bankDescription} onChange={e=>setBankDescription(e.target.value)} placeholder="Jelaskan isi atau tujuan bank soal…" /></label><label className="text-xs text-fg-muted block">Jenjang<select className="input mt-1 w-full" value={bankGrade} onChange={e=>setBankGrade(e.target.value)}><option value="">Semua jenjang</option><option value="SD">SD</option><option value="SMP">SMP</option><option value="SMA">SMA</option><option value="Mahasiswa">Mahasiswa</option><option value="Profesional">Profesional</option></select></label></div><div className="flex justify-end gap-2 mt-6"><Button variant="outline" onClick={()=>setBankOpen(false)}>Batal</Button><Button loading={busy} disabled={!bankName.trim()} onClick={()=>void createBank()}>Buat & Kelola Soal</Button></div></Card></div>}
  </div>;
}
