import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, BarChart3, BookOpen, Building2, ClipboardList, FileQuestion, Gauge, Image, Megaphone, Plus, Sparkles, Trophy, Users } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { useApp } from '@/store/AppContext';
import { listCurrentUserOrganizers, resolveCurrentUserOrganizer, setSelectedOrganizerId, type CurrentOrganizer } from '@/services/organizerAuth.service';
import { getActiveOrganizerEntitlements } from '@/services/organizerEntitlement.service';
import { supabase } from '@/lib/supabase';

const actions = [
  { to: '/organizer/competition/new', label: 'Buat Lomba', description: 'Gunakan wizard 5 langkah dengan timeline, target peserta, poster, dan Twibbon.', icon: Trophy },
  { to: '/organizer/registrations', label: 'Pendaftar', description: 'Lihat peserta, status pendaftaran, dan identitas lengkap mereka.', icon: ClipboardList },
  { to: '/organizer/members', label: 'Kelola Member', description: 'Atur anggota workspace dan hak akses mereka.', icon: Users },
  { to: '/organizer/grading', label: 'Penilaian', description: 'Kelola penilaian dan auto-assessment untuk soal esai.', icon: Gauge },
  { to: '/organizer/plan', label: 'Plan & Usage', description: 'Lihat plan aktif dan batas fitur organisasi.', icon: BarChart3 },
  { to: '/organizer/ads', label: 'Pasang Iklan', description: 'Ajukan banner promosi untuk halaman beranda.', icon: Megaphone },
];

export function OrganizerControlCenterPage() {
  const { toast } = useApp();
  const navigate = useNavigate();
  const [org, setOrg] = useState<CurrentOrganizer | null>(null);
  const [workspaces, setWorkspaces] = useState<CurrentOrganizer[]>([]);
  const [stats, setStats] = useState({ competitions: 0, registrations: 0, members: 0, banks: 0 });
  const [plan, setPlan] = useState<string | null>(null);
  const [banks, setBanks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [bankOpen, setBankOpen] = useState(false);
  const [bankName, setBankName] = useState('');
  const [bankDescription, setBankDescription] = useState('');
  const [bankGrade, setBankGrade] = useState('');
  const [savingBank, setSavingBank] = useState(false);

  const canEdit = org?._memberRole === 'owner' || org?._memberRole === 'editor';

  const load = async () => {
    setLoading(true);
    try {
      const [all, current] = await Promise.all([listCurrentUserOrganizers(), resolveCurrentUserOrganizer()]);
      setWorkspaces(all);
      setOrg(current);
      if (!current) return;
      const [c, r, m, b, ent] = await Promise.all([
        supabase.from('competitions').select('id', { count: 'exact', head: true }).eq('organizer_id', current.id),
        supabase.rpc('list_organizer_registrations', { p_organizer_id: current.id }),
        supabase.from('organizer_members').select('user_id', { count: 'exact', head: true }).eq('organizer_id', current.id),
        supabase.from('question_banks').select('id,name,description,grade_code,status').eq('organizer_id', current.id).order('created_at', { ascending: false }),
        getActiveOrganizerEntitlements(current.id),
      ]);
      if (c.error) throw c.error;
      if (r.error) throw r.error;
      if (m.error) throw m.error;
      if (b.error) throw b.error;
      setStats({ competitions: c.count ?? 0, registrations: (r.data ?? []).length, members: m.count ?? 0, banks: (b.data ?? []).length });
      setBanks(b.data ?? []);
      setPlan(ent.planCode);
    } catch (e: any) {
      toast.error(e?.message ?? 'Gagal memuat Control Center penyelenggara.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const switchWorkspace = (id: string) => {
    if (!workspaces.some(x => x.id === id)) return;
    setSelectedOrganizerId(id);
    void load();
  };

  const createBank = async () => {
    if (!org || !canEdit || !bankName.trim()) return;
    setSavingBank(true);
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
      setBankName(''); setBankDescription(''); setBankGrade('');
      toast.success('Bank soal berhasil dibuat.');
      navigate(`/organizer/question-bank/${data.id}`);
    } catch (e: any) {
      toast.error(e?.message ?? 'Gagal membuat bank soal.');
    } finally { setSavingBank(false); }
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
      <div className="relative flex flex-col lg:flex-row lg:items-center gap-5">
        <div className="flex items-center gap-4 min-w-0 flex-1">
          <div className="w-14 h-14 rounded-2xl bg-moss-500/10 flex items-center justify-center shrink-0"><Building2 size={25} className="text-accent" /></div>
          <div className="min-w-0"><p className="text-[10px] uppercase tracking-widest text-accent font-semibold">Organizer Control Center</p><h1 className="text-2xl md:text-3xl font-bold text-fg truncate">{org.name}</h1><div className="flex flex-wrap items-center gap-2 mt-2"><Badge color="moss">{org._memberRole || 'member'}</Badge><Badge>{org.status}</Badge>{plan && <Badge color="moss">Plan {plan}</Badge>}</div></div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {workspaces.length > 1 && <select aria-label="Pilih organisasi" className="input text-sm min-w-[190px]" value={org.id} onChange={e=>switchWorkspace(e.target.value)}>{workspaces.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select>}
          {canEdit && <Link to="/organizer/competition/new"><Button icon={<Plus size={16}/>}>Buat Lomba</Button></Link>}
        </div>
      </div>
    </section>

    <section className="grid grid-cols-2 xl:grid-cols-4 gap-3">
      {summary.map(({label,value,icon:Icon})=><Card key={label} className="p-4 md:p-5"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center"><Icon size={18} className="text-accent"/></div><div><p className="text-xs text-fg-muted">{label}</p><p className="text-xl md:text-2xl font-bold text-fg mt-0.5">{value.toLocaleString('id-ID')}</p></div></div></Card>)}
    </section>

    <section><div className="flex items-end justify-between mb-3"><div><p className="text-[10px] uppercase tracking-widest text-accent font-semibold">Workflow</p><h2 className="text-lg font-bold text-fg">Kelola organisasi</h2><p className="text-xs text-fg-muted mt-1">Akses modul utama tanpa harus mencari menu satu per satu.</p></div></div><div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">{actions.map(({to,label,description,icon:Icon})=><Link key={to} to={to} className="group"><Card className="h-full p-4 hover:border-accent/30 transition-all"><div className="flex items-start gap-3"><div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center shrink-0"><Icon size={18} className="text-accent"/></div><div className="min-w-0 flex-1"><p className="font-semibold text-fg group-hover:text-accent transition">{label}</p><p className="text-xs text-fg-muted mt-1 leading-5">{description}</p></div><ArrowRight size={15} className="text-fg-muted group-hover:text-accent transition mt-1"/></div></Card></Link>)}</div></section>

    <section><div className="flex items-end justify-between mb-3"><div><p className="text-[10px] uppercase tracking-widest text-accent font-semibold">Bank Soal</p><h2 className="text-lg font-bold text-fg">Bank Soal Modern</h2><p className="text-xs text-fg-muted mt-1">Buat bank lalu masuk ke editor type-specific untuk menyusun setiap soal.</p></div>{canEdit&&<Button size="sm" variant="outline" icon={<Plus size={15}/>} onClick={()=>setBankOpen(true)}>Tambah Bank</Button>}</div><div className="grid md:grid-cols-2 gap-3">{banks.slice(0,6).map(b=><Card key={b.id} className="p-4"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-xl bg-moss-500/10 flex items-center justify-center"><BookOpen size={17} className="text-accent"/></div><div className="flex-1 min-w-0"><p className="font-semibold text-fg truncate">{b.name}</p><p className="text-[11px] text-fg-muted mt-0.5">{b.grade_code || 'Semua jenjang'} · {b.status}</p></div><Link to={`/organizer/question-bank/${b.id}`}><Button size="sm" variant="outline">Kelola Soal</Button></Link></div></Card>)}{banks.length===0&&<Card className="p-7 md:col-span-2 text-center"><FileQuestion size={25} className="mx-auto text-fg-muted mb-2"/><p className="text-sm font-semibold text-fg">Belum ada bank soal</p><p className="text-xs text-fg-muted mt-1">Buat bank soal pertama untuk mulai menambahkan Pilihan Ganda, Benar/Salah, atau Essay.</p></Card>}</div></section>

    {bankOpen&&<div className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"><Card className="w-full max-w-lg p-5 md:p-6"><div className="flex items-center gap-3 mb-5"><div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center"><Sparkles size={18} className="text-accent"/></div><div><h3 className="font-bold text-fg">Buat Bank Soal</h3><p className="text-xs text-fg-muted mt-0.5">Setelah dibuat, kamu langsung masuk ke editor soal.</p></div></div><div className="space-y-3"><label className="text-xs text-fg-muted block">Nama Bank Soal<input className="input mt-1 w-full" value={bankName} onChange={e=>setBankName(e.target.value)} placeholder="Contoh: Bank Soal NSSC 2026" /></label><label className="text-xs text-fg-muted block">Deskripsi<textarea className="input mt-1 w-full min-h-24" value={bankDescription} onChange={e=>setBankDescription(e.target.value)} placeholder="Jelaskan isi atau tujuan bank soal…" /></label><label className="text-xs text-fg-muted block">Jenjang<select className="input mt-1 w-full" value={bankGrade} onChange={e=>setBankGrade(e.target.value)}><option value="">Semua jenjang</option><option value="SD">SD</option><option value="SMP">SMP</option><option value="SMA">SMA</option><option value="Mahasiswa">Mahasiswa</option><option value="Profesional">Profesional</option></select></label></div><div className="flex justify-end gap-2 mt-6"><Button variant="outline" onClick={()=>setBankOpen(false)}>Batal</Button><Button loading={savingBank} disabled={!bankName.trim()} onClick={()=>void createBank()}>Buat & Kelola Soal</Button></div></Card></div>}
  </div>;
}
