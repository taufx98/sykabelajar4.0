import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Archive, Edit3, Search, UserRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { toast } from '@/lib/toast';
import { listRosterStudents, listTeacherRosters, type RosterStudent, type TeacherRoster } from '@/services/collectiveParticipant.service';
import { archiveRosterStudent, updateRosterStudent } from '@/services/guruRoster.service';

export function GuruRosterPage() {
  const [rosters, setRosters] = useState<TeacherRoster[]>([]);
  const [students, setStudents] = useState<RosterStudent[]>([]);
  const [rosterId, setRosterId] = useState('');
  const [query, setQuery] = useState('');
  const [classFilter, setClassFilter] = useState('ALL');
  const [gradeFilter, setGradeFilter] = useState('ALL');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<RosterStudent | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const rs = await listTeacherRosters();
      setRosters(rs);
      const activeRoster = rs.find(r => r.id === rosterId)?.id ?? rs[0]?.id ?? '';
      setRosterId(activeRoster);
      setStudents(activeRoster ? await listRosterStudents(activeRoster) : []);
    } catch (e: any) {
      toast.error(e?.message || 'Gagal memuat roster siswa.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (!rosterId) { setStudents([]); return; }
    void listRosterStudents(rosterId).then(setStudents).catch((e) => toast.error(e?.message || 'Gagal memuat siswa.'));
  }, [rosterId]);

  const classes = useMemo(() => Array.from(new Set(students.map(s => s.class_name).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b)), [students]);
  const grades = useMemo(() => Array.from(new Set(students.map(s => s.grade).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b)), [students]);
  const visibleStudents = useMemo(() => {
    const q = query.trim().toLowerCase();
    return students.filter((s) => {
      const matchesQuery = !q || [s.full_name, s.class_name, s.grade, s.external_student_ref].some(v => String(v ?? '').toLowerCase().includes(q));
      const matchesClass = classFilter === 'ALL' || s.class_name === classFilter;
      const matchesGrade = gradeFilter === 'ALL' || s.grade === gradeFilter;
      return matchesQuery && matchesClass && matchesGrade;
    });
  }, [students, query, classFilter, gradeFilter]);

  const saveEdit = async () => {
    if (!editing?.full_name.trim()) return toast.error('Nama siswa wajib diisi.');
    setBusy(true);
    try {
      const updated = await updateRosterStudent({
        id: editing.id,
        fullName: editing.full_name,
        className: editing.class_name ?? '',
        grade: editing.grade ?? '',
        externalStudentRef: editing.external_student_ref ?? '',
        photoUrl: editing.photo_url,
      });
      setStudents(items => items.map(s => s.id === updated.id ? { ...s, ...updated } : s));
      setEditing(null);
      toast.success('Data siswa diperbarui.');
    } catch (e: any) {
      toast.error(e?.message || 'Gagal memperbarui siswa.');
    } finally {
      setBusy(false);
    }
  };

  const archive = async (student: RosterStudent) => {
    if (!window.confirm(`Arsipkan ${student.full_name}? Histori lomba tidak dihapus.`)) return;
    setBusy(true);
    try {
      await archiveRosterStudent(student.id);
      setStudents(items => items.filter(s => s.id !== student.id));
      toast.success('Siswa diarsipkan. Histori lomba tetap aman.');
    } catch (e: any) {
      toast.error(e?.message || 'Gagal mengarsipkan siswa.');
    } finally {
      setBusy(false);
    }
  };

  return <div className="min-h-screen surface-bg p-5 md:p-8">
    <div className="max-w-6xl mx-auto space-y-5">
      <div className="flex items-center justify-between gap-3">
        <Link to="/guru" className="inline-flex items-center gap-2 text-xs text-fg-muted hover:text-fg"><ArrowLeft size={14}/> Kembali ke Guru</Link>
        <Button size="sm" variant="outline" onClick={() => void load()} loading={loading}>Refresh</Button>
      </div>
      <div>
        <p className="text-xs text-accent font-semibold tracking-wider">GURU · STUDENT ROSTER</p>
        <h1 className="text-2xl md:text-3xl font-bold text-fg">Siswa & Roster</h1>
        <p className="text-sm text-fg-muted mt-1">Kelola daftar siswa yang bisa dipakai ulang untuk pendaftaran kolektif.</p>
      </div>

      <Card className="p-4">
        <div className="grid md:grid-cols-4 gap-3">
          <select value={rosterId} onChange={e => setRosterId(e.target.value)} className="input md:col-span-1">
            <option value="">Pilih roster</option>
            {rosters.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <label className="relative md:col-span-2"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted"/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Cari nama, kelas, jenjang, ID siswa…" className="input pl-9 w-full"/></label>
          <div className="grid grid-cols-2 gap-2">
            <select value={classFilter} onChange={e => setClassFilter(e.target.value)} className="input"><option value="ALL">Semua kelas</option>{classes.map(c => <option key={c} value={c}>{c}</option>)}</select>
            <select value={gradeFilter} onChange={e => setGradeFilter(e.target.value)} className="input"><option value="ALL">Semua jenjang</option>{grades.map(g => <option key={g} value={g}>{g}</option>)}</select>
          </div>
        </div>
      </Card>

      <div className="flex items-center justify-between text-xs text-fg-muted"><span>{visibleStudents.length} dari {students.length} siswa aktif</span><span>Arsip tidak menghapus histori kompetisi.</span></div>
      {!visibleStudents.length && !loading ? <Card className="p-8 text-center text-sm text-fg-muted">Tidak ada siswa yang cocok dengan filter saat ini.</Card> : <div className="grid md:grid-cols-2 gap-3">
        {visibleStudents.map(student => <Card key={student.id} className="p-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl overflow-hidden bg-accent/10 flex items-center justify-center text-accent">{student.photo_url ? <img src={student.photo_url} alt="" className="w-full h-full object-cover"/> : <UserRound size={20}/>}</div>
            <div className="min-w-0 flex-1"><Link to={`/guru/siswa/${student.id}`} className="font-semibold text-fg hover:text-accent truncate block">{student.full_name}</Link><p className="text-xs text-fg-muted">{student.class_name || 'Kelas —'} · {student.grade || 'Jenjang —'}</p></div>
            <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => setEditing(student)} icon={<Edit3 size={14}/>}>Edit</Button><Button size="sm" variant="outline" onClick={() => void archive(student)} loading={busy} icon={<Archive size={14}/>}>Arsip</Button></div>
          </div>
          {student.external_student_ref && <p className="text-[11px] text-fg-muted mt-3">ID eksternal: <span className="font-mono">{student.external_student_ref}</span></p>}
        </Card>)}
      </div>}

      {editing && <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
        <Card className="w-full max-w-lg p-5 space-y-4">
          <div><p className="font-semibold text-fg">Edit data siswa</p><p className="text-xs text-fg-muted mt-1">Perubahan hanya berlaku pada roster ini.</p></div>
          <input value={editing.full_name} onChange={e => setEditing({ ...editing, full_name: e.target.value })} className="input w-full" placeholder="Nama siswa"/>
          <div className="grid grid-cols-2 gap-3"><input value={editing.class_name ?? ''} onChange={e => setEditing({ ...editing, class_name: e.target.value })} className="input" placeholder="Kelas"/><input value={editing.grade ?? ''} onChange={e => setEditing({ ...editing, grade: e.target.value })} className="input" placeholder="Jenjang"/></div>
          <input value={editing.external_student_ref ?? ''} onChange={e => setEditing({ ...editing, external_student_ref: e.target.value })} className="input w-full" placeholder="ID siswa eksternal (opsional)"/>
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setEditing(null)}>Batal</Button><Button onClick={() => void saveEdit()} loading={busy}>Simpan</Button></div>
        </Card>
      </div>}
    </div>
  </div>;
}
