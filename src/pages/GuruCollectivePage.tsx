import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, KeyRound, Plus, RefreshCw, ShieldCheck, Users, UserPlus, Copy } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useApp } from '@/store/AppContext';
import { toast } from '@/lib/toast';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import {
  addRosterStudent,
  createCollectiveParticipants,
  createTeacherRoster,
  listCollectiveCompetitions,
  listRosterStudents,
  listTeacherCollectiveParticipants,
  listTeacherRosters,
  regenerateCollectiveParticipantPassword,
  type CollectiveParticipant,
  type RosterStudent,
  type TeacherRoster,
} from '@/services/collectiveParticipant.service';

export function GuruCollectivePage() {
  const { user } = useApp();
  const [tab, setTab] = useState<'roster' | 'register' | 'access'>('roster');
  const [rosters, setRosters] = useState<TeacherRoster[]>([]);
  const [students, setStudents] = useState<RosterStudent[]>([]);
  const [competitions, setCompetitions] = useState<any[]>([]);
  const [participants, setParticipants] = useState<CollectiveParticipant[]>([]);
  const [selectedRoster, setSelectedRoster] = useState('');
  const [selectedStudents, setSelectedStudents] = useState<string[]>([]);
  const [competitionId, setCompetitionId] = useState('');
  const [busy, setBusy] = useState(false);
  const [newRoster, setNewRoster] = useState({ name: '', description: '' });
  const [newStudent, setNewStudent] = useState({ fullName: '', className: '', grade: '' });
  const [issuedCredentials, setIssuedCredentials] = useState<any[]>([]);

  const load = async () => {
    setBusy(true);
    try {
      const [r, c, p] = await Promise.all([listTeacherRosters(), listCollectiveCompetitions(), listTeacherCollectiveParticipants()]);
      setRosters(r); setCompetitions(c); setParticipants(p);
      const active = r.find((item) => item.id === selectedRoster)?.id ?? r[0]?.id ?? '';
      setSelectedRoster(active);
      if (active) setStudents(await listRosterStudents(active)); else setStudents([]);
    } catch (e: any) {
      toast.error(e?.message || 'Gagal memuat workspace guru.');
    } finally { setBusy(false); }
  };

  useEffect(() => { void load(); }, []);

  useEffect(() => {
    if (!selectedRoster) { setStudents([]); return; }
    void listRosterStudents(selectedRoster).then(setStudents).catch((e) => toast.error(e?.message || 'Gagal memuat siswa.'));
  }, [selectedRoster]);

  const selectedCompetition = useMemo(() => competitions.find((c) => c.id === competitionId), [competitions, competitionId]);

  const createRoster = async () => {
    if (!newRoster.name.trim()) return toast.error('Nama kelas/roster wajib diisi.');
    setBusy(true);
    try {
      const r = await createTeacherRoster(newRoster.name, newRoster.description);
      setRosters((items) => [r, ...items]); setSelectedRoster(r.id); setNewRoster({ name: '', description: '' });
      toast.success('Roster siswa dibuat.');
    } catch (e: any) { toast.error(e?.message || 'Gagal membuat roster.'); } finally { setBusy(false); }
  };

  const addStudent = async () => {
    if (!selectedRoster) return toast.error('Buat/pilih roster terlebih dahulu.');
    if (!newStudent.fullName.trim()) return toast.error('Nama siswa wajib diisi.');
    setBusy(true);
    try {
      const s = await addRosterStudent({ rosterId: selectedRoster, fullName: newStudent.fullName, className: newStudent.className, grade: newStudent.grade });
      setStudents((items) => [...items, s].sort((a, b) => a.full_name.localeCompare(b.full_name)));
      setNewStudent({ fullName: '', className: '', grade: '' }); toast.success('Siswa ditambahkan ke roster.');
    } catch (e: any) { toast.error(e?.message || 'Gagal menambah siswa.'); } finally { setBusy(false); }
  };

  const registerSelected = async () => {
    if (!competitionId) return toast.error('Pilih lomba kolektif.');
    if (!selectedStudents.length) return toast.error('Pilih minimal satu siswa.');
    setBusy(true);
    try {
      const rows = await createCollectiveParticipants(competitionId, selectedStudents);
      setIssuedCredentials(rows); setSelectedStudents([]); await load();
      toast.success(`${rows.length} peserta kolektif berhasil dibuat.`);
    } catch (e: any) { toast.error(e?.message || 'Gagal mendaftarkan peserta kolektif.'); } finally { setBusy(false); }
  };

  const regenerate = async (id: string) => {
    setBusy(true);
    try {
      const row = await regenerateCollectiveParticipantPassword(id);
      setIssuedCredentials([row]); await load(); toast.success('Password peserta berhasil dibuat ulang.');
    } catch (e: any) { toast.error(e?.message || 'Gagal membuat ulang password.'); } finally { setBusy(false); }
  };

  const copy = async (text: string) => { await navigator.clipboard.writeText(text); toast.success('Disalin.'); };

  return <div className="min-h-screen surface-bg text-fg-secondary p-5 md:p-8">
    <div className="max-w-6xl mx-auto space-y-5">
      <Link to="/home" className="inline-flex items-center gap-2 text-xs text-fg-muted hover:text-fg"><ArrowLeft size={14}/> Kembali</Link>
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div><p className="text-xs text-accent font-semibold tracking-wider">GURU WORKSPACE</p><h1 className="text-2xl md:text-3xl font-bold text-fg">Kelas & Peserta Kolektif</h1><p className="text-sm text-fg-muted mt-1">Kelola roster siswa dan akses lomba tanpa memaksa siswa membuat akun penuh.</p></div>
        <Badge color="moss"><ShieldCheck size={14}/> {user?.displayName || 'Guru'}</Badge>
      </div>
      <div className="flex gap-2 overflow-x-auto border-b border-border pb-2">
        {([['roster','Roster Siswa'],['register','Daftar Lomba'],['access','Akses Peserta']] as const).map(([key,label]) => <button key={key} onClick={()=>setTab(key)} className={`px-3 py-2 text-sm font-medium rounded-lg ${tab===key?'bg-accent/10 text-accent':'text-fg-muted hover:text-fg'}`}>{label}</button>)}
        <Button size="sm" variant="outline" onClick={()=>void load()} loading={busy} icon={<RefreshCw size={14}/>}>Refresh</Button>
      </div>

      {tab === 'roster' && <div className="grid lg:grid-cols-[320px_1fr] gap-5">
        <Card className="p-4 space-y-4"><div className="flex items-center gap-2"><Users size={18} className="text-accent"/><div><p className="font-semibold text-fg">Roster Saya</p><p className="text-xs text-fg-muted">Dapat dipakai ulang antar lomba.</p></div></div>
          <div className="space-y-2">{rosters.map((r)=><button key={r.id} onClick={()=>setSelectedRoster(r.id)} className={`w-full text-left rounded-xl border px-3 py-3 ${selectedRoster===r.id?'border-accent bg-accent/5':'border-border hover:border-accent/40'}`}><p className="font-medium text-fg">{r.name}</p><p className="text-xs text-fg-muted">{r.description || 'Tanpa deskripsi'}</p></button>)}</div>
          {!rosters.length && <p className="text-xs text-fg-muted">Belum ada roster.</p>}
          <div className="border-t border-border pt-4 space-y-2"><input value={newRoster.name} onChange={e=>setNewRoster({...newRoster,name:e.target.value})} placeholder="Nama roster / kelas" className="w-full rounded-xl border border-border bg-transparent px-3 py-2 text-sm"/><input value={newRoster.description} onChange={e=>setNewRoster({...newRoster,description:e.target.value})} placeholder="Keterangan (opsional)" className="w-full rounded-xl border border-border bg-transparent px-3 py-2 text-sm"/><Button onClick={()=>void createRoster()} loading={busy} icon={<Plus size={14}/>}>Buat roster</Button></div>
        </Card>
        <Card className="p-4"><div className="flex items-center justify-between gap-3 mb-4"><div><p className="font-semibold text-fg">{rosters.find(r=>r.id===selectedRoster)?.name || 'Pilih roster'}</p><p className="text-xs text-fg-muted">{students.length} siswa aktif</p></div></div>
          {selectedRoster && <div className="grid sm:grid-cols-3 gap-2 mb-4"><input value={newStudent.fullName} onChange={e=>setNewStudent({...newStudent,fullName:e.target.value})} placeholder="Nama siswa" className="rounded-xl border border-border bg-transparent px-3 py-2 text-sm"/><input value={newStudent.className} onChange={e=>setNewStudent({...newStudent,className:e.target.value})} placeholder="Kelas" className="rounded-xl border border-border bg-transparent px-3 py-2 text-sm"/><div className="flex gap-2"><input value={newStudent.grade} onChange={e=>setNewStudent({...newStudent,grade:e.target.value})} placeholder="Jenjang" className="min-w-0 flex-1 rounded-xl border border-border bg-transparent px-3 py-2 text-sm"/><Button onClick={()=>void addStudent()} loading={busy} icon={<UserPlus size={14}/>}>Tambah</Button></div></div>}
          <div className="space-y-2">{students.map(s=><div key={s.id} className="flex items-center gap-3 rounded-xl border border-border px-3 py-3"><div className="w-9 h-9 rounded-full bg-accent/10 flex items-center justify-center text-accent font-bold">{s.full_name.slice(0,1).toUpperCase()}</div><div className="min-w-0 flex-1"><p className="font-medium text-fg truncate">{s.full_name}</p><p className="text-xs text-fg-muted">{s.class_name || '—'} · {s.grade || 'Jenjang belum diisi'}</p></div></div>)}</div>
        </Card>
      </div>}

      {tab === 'register' && <div className="grid lg:grid-cols-[1fr_320px] gap-5"><Card className="p-4"><p className="font-semibold text-fg">Daftar siswa ke lomba kolektif</p><p className="text-xs text-fg-muted mt-1">Siswa yang dipilih akan mendapat participant code + password terpisah.</p><select value={competitionId} onChange={e=>setCompetitionId(e.target.value)} className="mt-4 w-full rounded-xl border border-border bg-transparent px-3 py-2 text-sm"><option value="">Pilih lomba</option>{competitions.map(c=><option key={c.id} value={c.id}>{c.title} — {c.participant_mode}</option>)}</select><div className="mt-4 space-y-2">{students.map(s=><label key={s.id} className="flex items-center gap-3 rounded-xl border border-border px-3 py-3 cursor-pointer"><input type="checkbox" checked={selectedStudents.includes(s.id)} onChange={e=>setSelectedStudents(v=>e.target.checked?[...v,s.id]:v.filter(id=>id!==s.id))}/><div className="flex-1"><p className="font-medium text-fg">{s.full_name}</p><p className="text-xs text-fg-muted">{s.class_name || '—'} · {s.grade || '—'}</p></div></label>)}</div><Button className="mt-4" onClick={()=>void registerSelected()} loading={busy} icon={<KeyRound size={14}/>}>Buat akses peserta</Button></Card><Card className="p-4"><p className="text-sm font-semibold text-fg">Ringkasan</p><div className="mt-3 space-y-3 text-sm"><div className="flex justify-between gap-3"><span className="text-fg-muted">Lomba</span><span className="text-fg text-right">{selectedCompetition?.title || '—'}</span></div><div className="flex justify-between"><span className="text-fg-muted">Dipilih</span><span className="text-fg font-semibold">{selectedStudents.length} siswa</span></div></div></Card></div>}

      {tab === 'access' && <div className="space-y-4"><Card className="p-4"><div className="flex items-center justify-between"><div><p className="font-semibold text-fg">Akses peserta kolektif</p><p className="text-xs text-fg-muted">Password asli hanya ditampilkan saat dibuat/regenerasi.</p></div><Badge color="moss">{participants.length} peserta</Badge></div><div className="mt-4 overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-xs text-fg-muted border-b border-border"><th className="pb-2 pr-4">Peserta</th><th className="pb-2 pr-4">Lomba</th><th className="pb-2 pr-4">Kode</th><th className="pb-2">Akses</th></tr></thead><tbody>{participants.map(p=><tr key={p.participant_id} className="border-b border-border/60"><td className="py-3 pr-4"><p className="font-medium text-fg">{p.full_name}</p><p className="text-xs text-fg-muted">{p.class_name || '—'} · {p.grade || '—'}</p></td><td className="py-3 pr-4 text-xs">{p.competition_title}</td><td className="py-3 pr-4 font-mono text-xs">{p.participant_code}</td><td className="py-3"><Button size="sm" variant="outline" onClick={()=>void regenerate(p.participant_id)} loading={busy} icon={<RefreshCw size={13}/>}>Regenerasi password</Button></td></tr>)}</tbody></table></div></Card>
        {issuedCredentials.length>0 && <Card className="p-4 border-accent/40"><div className="flex items-center gap-2 text-accent"><KeyRound size={16}/><p className="font-semibold">Kredensial baru — simpan sekarang</p></div><div className="mt-3 grid md:grid-cols-2 gap-3">{issuedCredentials.map((r:any,i:number)=><div key={r.participant_id||r.participant_code||i} className="rounded-xl border border-border p-3"><p className="font-medium text-fg">{r.full_name || r.participant_code}</p><div className="text-xs mt-2 space-y-1"><p>Code: <span className="font-mono text-fg">{r.participant_code}</span></p><p>Password: <span className="font-mono text-fg">{r.temporary_password}</span></p></div><div className="flex gap-2 mt-3"><Button size="sm" variant="outline" onClick={()=>void copy(`${r.participant_code}\n${r.temporary_password}`)} icon={<Copy size={13}/>}>Salin</Button></div></div>)}</div></Card>}
      </div>}
    </div>
  </div>;
}
