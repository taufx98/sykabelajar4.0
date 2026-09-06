import { useEffect, useState } from 'react';
import { ArrowLeft, Archive, Edit3, UserRound } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { toast } from '@/lib/toast';
import { archiveRosterStudent, getRosterStudent, updateRosterStudent, type GuruRosterStudent } from '@/services/guruRoster.service';

export function GuruStudentDetailPage() {
  const { studentId } = useParams();
  const navigate = useNavigate();
  const [student, setStudent] = useState<GuruRosterStudent | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!studentId) return;
    void getRosterStudent(studentId).then(setStudent).catch((e) => toast.error(e?.message || 'Siswa tidak ditemukan.'));
  }, [studentId]);

  if (!student) return <div className="min-h-screen surface-bg p-8 text-center text-sm text-fg-muted">Memuat data siswa…</div>;

  const save = async () => {
    setBusy(true);
    try {
      const updated = await updateRosterStudent({ id: student.id, fullName: student.full_name, className: student.class_name ?? '', grade: student.grade ?? '', externalStudentRef: student.external_student_ref ?? '', photoUrl: student.photo_url });
      setStudent(updated);
      setEditing(false);
      toast.success('Data siswa diperbarui.');
    } catch (e: any) { toast.error(e?.message || 'Gagal memperbarui siswa.'); }
    finally { setBusy(false); }
  };

  const archive = async () => {
    if (!window.confirm(`Arsipkan ${student.full_name}? Histori lomba tidak dihapus.`)) return;
    setBusy(true);
    try { await archiveRosterStudent(student.id); toast.success('Siswa diarsipkan.'); navigate('/guru/siswa'); }
    catch (e: any) { toast.error(e?.message || 'Gagal mengarsipkan siswa.'); }
    finally { setBusy(false); }
  };

  return <div className="min-h-screen surface-bg p-5 md:p-8">
    <div className="max-w-3xl mx-auto space-y-5">
      <div className="flex items-center justify-between"><Link to="/guru/siswa" className="inline-flex items-center gap-2 text-xs text-fg-muted hover:text-fg"><ArrowLeft size={14}/> Kembali ke roster</Link><div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => setEditing(v => !v)} icon={<Edit3 size={14}/>}>Edit</Button><Button size="sm" variant="outline" onClick={() => void archive()} loading={busy} icon={<Archive size={14}/>}>Arsip</Button></div></div>
      <Card className="p-6">
        <div className="flex items-center gap-4"><div className="w-20 h-20 rounded-2xl overflow-hidden bg-accent/10 text-accent flex items-center justify-center">{student.photo_url ? <img src={student.photo_url} alt="" className="w-full h-full object-cover"/> : <UserRound size={28}/>}</div><div><p className="text-xs text-accent font-semibold tracking-wider">STUDENT DETAIL</p><h1 className="text-2xl font-bold text-fg mt-1">{student.full_name}</h1><p className="text-sm text-fg-muted mt-1">{student.class_name || 'Kelas —'} · {student.grade || 'Jenjang —'}</p></div></div>
        <div className="grid sm:grid-cols-2 gap-4 mt-6"><div><p className="text-xs text-fg-muted">Roster</p><p className="text-sm text-fg mt-1 font-mono break-all">{student.roster_id}</p></div><div><p className="text-xs text-fg-muted">ID eksternal</p><p className="text-sm text-fg mt-1">{student.external_student_ref || '—'}</p></div><div><p className="text-xs text-fg-muted">Status</p><p className="text-sm text-fg mt-1">{student.is_active ? 'ACTIVE' : 'ARCHIVED'}</p></div><div><p className="text-xs text-fg-muted">Dibuat</p><p className="text-sm text-fg mt-1">{new Date(student.created_at).toLocaleString('id-ID')}</p></div></div>
      </Card>
      {editing && <Card className="p-5 space-y-3"><p className="font-semibold text-fg">Edit data</p><input value={student.full_name} onChange={e => setStudent({ ...student, full_name: e.target.value })} className="input w-full" placeholder="Nama siswa"/><div className="grid grid-cols-2 gap-3"><input value={student.class_name ?? ''} onChange={e => setStudent({ ...student, class_name: e.target.value })} className="input" placeholder="Kelas"/><input value={student.grade ?? ''} onChange={e => setStudent({ ...student, grade: e.target.value })} className="input" placeholder="Jenjang"/></div><input value={student.external_student_ref ?? ''} onChange={e => setStudent({ ...student, external_student_ref: e.target.value })} className="input w-full" placeholder="ID eksternal"/><div className="flex justify-end"><Button onClick={() => void save()} loading={busy}>Simpan</Button></div></Card>}
    </div>
  </div>;
}
