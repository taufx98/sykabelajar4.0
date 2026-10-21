import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Activity, ArrowLeft, Clock3, RefreshCw, Save, ShieldCheck, Shuffle, Users } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import {
  getOrganizerExamConfig,
  getOrganizerExamMonitor,
  saveOrganizerExamConfig,
  type OrganizerExamConfig,
  type OrganizerExamMonitor,
} from '@/services/sequentialExam.service';

type EditableConfig = {
  duration_minutes: number;
  question_count: string;
  attempt_limit: number;
  randomize_questions: boolean;
  randomize_options: boolean;
  decision_window_seconds: number;
  borrow_seconds: number;
  overtime_grace_seconds: number;
  min_next_question_seconds: number;
};

const defaults: EditableConfig = {
  duration_minutes: 30,
  question_count: '',
  attempt_limit: 1,
  randomize_questions: true,
  randomize_options: true,
  decision_window_seconds: 30,
  borrow_seconds: 30,
  overtime_grace_seconds: 30,
  min_next_question_seconds: 30,
};

function formatDate(value?: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'medium' });
}

export function OrganizerExamPage() {
  const { id = '' } = useParams();
  const [config, setConfig] = useState<OrganizerExamConfig | null>(null);
  const [form, setForm] = useState<EditableConfig>(defaults);
  const [monitor, setMonitor] = useState<OrganizerExamMonitor>({ total: 0, active: 0, completed: 0, timed_out: 0, skipped: 0, sessions: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async (showSpinner = true) => {
    if (!id) return;
    if (showSpinner) setLoading(true);
    setError('');
    try {
      const [nextConfig, nextMonitor] = await Promise.all([getOrganizerExamConfig(id), getOrganizerExamMonitor(id)]);
      setConfig(nextConfig);
      setForm({
        duration_minutes: Math.max(1, Math.round(nextConfig.duration_seconds / 60)),
        question_count: nextConfig.question_count == null ? '' : String(nextConfig.question_count),
        attempt_limit: nextConfig.attempt_limit ?? 1,
        randomize_questions: nextConfig.randomize_questions,
        randomize_options: nextConfig.randomize_options,
        decision_window_seconds: nextConfig.decision_window_seconds,
        borrow_seconds: nextConfig.borrow_seconds,
        overtime_grace_seconds: nextConfig.overtime_grace_seconds,
        min_next_question_seconds: nextConfig.min_next_question_seconds,
      });
      setMonitor(nextMonitor);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memuat konfigurasi ujian.');
    } finally {
      if (showSpinner) setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const update = <K extends keyof EditableConfig,>(key: K, value: EditableConfig[K]) => setForm((current) => ({ ...current, [key]: value }));

  async function save() {
    if (!id || !config || config.frozen) return;
    setSaving(true); setError(''); setMessage('');
    try {
      const next = await saveOrganizerExamConfig(id, {
        duration_seconds: form.duration_minutes * 60,
        question_count: form.question_count.trim() ? Number(form.question_count) : null,
        attempt_limit: form.attempt_limit,
        randomize_questions: form.randomize_questions,
        randomize_options: form.randomize_options,
        decision_window_seconds: form.decision_window_seconds,
        borrow_seconds: form.borrow_seconds,
        overtime_grace_seconds: form.overtime_grace_seconds,
        min_next_question_seconds: form.min_next_question_seconds,
      });
      setConfig(next);
      setMessage('Konfigurasi ujian tersimpan. Konfigurasi akan terkunci saat peserta pertama memulai.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal menyimpan konfigurasi ujian.');
    } finally {
      setSaving(false);
    }
  }

  async function refreshMonitor() {
    setRefreshing(true);
    try {
      const next = await getOrganizerExamMonitor(id);
      setMonitor(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memperbarui panel monitoring.');
    } finally {
      setRefreshing(false);
    }
  }

  if (loading) return <div className="min-h-[50vh] flex items-center justify-center text-fg-muted">Memuat Exam Control Room…</div>;

  return <div className="min-h-screen surface-bg text-fg-secondary p-5 md:p-8">
    <div className="max-w-6xl mx-auto space-y-5">
      <Link to="/organizer" className="inline-flex items-center gap-2 text-sm text-fg-muted hover:text-fg"><ArrowLeft size={16}/> Organizer</Link>
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <div><p className="text-xs uppercase tracking-[0.18em] text-accent font-semibold">Exam Control Room</p><h1 className="text-2xl md:text-3xl font-bold text-fg mt-1">Sistem Ujian Lomba</h1><p className="text-sm text-fg-muted mt-2">Waktu, urutan soal, status timeout/skip, dan hasil dikendalikan backend.</p></div>
        <div className="flex items-center gap-2"><Badge color={config?.frozen ? 'warn' : 'moss'}>{config?.frozen ? 'Konfigurasi terkunci' : 'Draft konfigurasi'}</Badge><Button variant="outline" loading={refreshing} onClick={() => void refreshMonitor()} icon={<RefreshCw size={15}/>}>Perbarui monitoring</Button></div>
      </div>

      {error && <Card className="p-4 border border-red-500/30 bg-red-500/5"><p className="text-sm text-red-300">{error}</p></Card>}
      {message && <Card className="p-4 border border-emerald-500/20 bg-emerald-500/5"><p className="text-sm text-emerald-200">{message}</p></Card>}

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Metric icon={<Users size={17}/>} label="Attempt tercatat" value={monitor.total}/>
        <Metric icon={<Activity size={17}/>} label="Sedang aktif" value={monitor.active}/>
        <Metric icon={<ShieldCheck size={17}/>} label="Selesai" value={monitor.completed}/>
        <Metric icon={<Clock3 size={17}/>} label="Timeout" value={monitor.timed_out}/>
        <Metric icon={<AlertTriangleIcon/>} label="Skip" value={monitor.skipped}/>
      </div>

      <Card className="p-5 md:p-6">
        <div className="flex items-center gap-2 mb-1"><Clock3 size={18} className="text-accent"/><h2 className="font-semibold text-fg">Aturan dan Waktu Ujian</h2></div>
        <p className="text-xs text-fg-muted mb-5">Jumlah waktu dibagi rata sebagai waktu dasar tiap soal. Sisa waktu dari soal yang dijawab cepat dibawa ke soal selanjutnya.</p>
        <div className="grid md:grid-cols-3 gap-4">
          <Field label="Durasi total (menit)" value={String(form.duration_minutes)} type="number" min={1} max={360} disabled={!!config?.frozen} onChange={(v) => update('duration_minutes', Number(v))}/>
          <Field label="Jumlah soal (kosong = semua soal terbit)" value={form.question_count} type="number" min={1} max={1000} disabled={!!config?.frozen} onChange={(v) => update('question_count', v)}/>
          <Field label="Batas percobaan per peserta" value={String(form.attempt_limit)} type="number" min={1} max={10} disabled={!!config?.frozen} onChange={(v) => update('attempt_limit', Number(v))}/>
          <Field label="Jendela keputusan setelah timeout (detik)" value={String(form.decision_window_seconds)} type="number" min={0} max={120} disabled={!!config?.frozen} onChange={(v) => update('decision_window_seconds', Number(v))}/>
          <Field label="Pinjam dari soal berikutnya (detik)" value={String(form.borrow_seconds)} type="number" min={1} max={120} disabled={!!config?.frozen} onChange={(v) => update('borrow_seconds', Number(v))}/>
          <Field label="Tambahan jika tidak meminjam (detik)" value={String(form.overtime_grace_seconds)} type="number" min={0} max={120} disabled={!!config?.frozen} onChange={(v) => update('overtime_grace_seconds', Number(v))}/>
          <Field label="Waktu minimum soal selanjutnya (detik)" value={String(form.min_next_question_seconds)} type="number" min={5} max={300} disabled={!!config?.frozen} onChange={(v) => update('min_next_question_seconds', Number(v))}/>
        </div>
        <div className="grid md:grid-cols-2 gap-3 mt-5">
          <Toggle icon={<Shuffle size={17}/>} label="Acak urutan soal untuk tiap attempt" checked={form.randomize_questions} disabled={!!config?.frozen} onChange={(v) => update('randomize_questions', v)}/>
          <Toggle icon={<Shuffle size={17}/>} label="Acak urutan pilihan jawaban" checked={form.randomize_options} disabled={!!config?.frozen} onChange={(v) => update('randomize_options', v)}/>
        </div>
        <div className="mt-5 p-4 rounded-xl border border-sky-500/20 bg-sky-500/5 text-sm text-fg-muted">
          <p><strong className="text-fg">Soal terbit:</strong> {config?.published_question_count ?? 0}. {form.question_count.trim() ? `Target attempt: ${form.question_count} soal.` : 'Semua soal berstatus terbit dipakai.'}</p>
          <p className="mt-1">Grading, jawaban benar, penentuan soal aktif, timer, timeout, skip, dan batas attempt berada di backend. Nilai tidak ditampilkan sebelum hasil lomba diumumkan.</p>
        </div>
        {!config?.frozen && <div className="flex justify-end mt-5"><Button loading={saving} onClick={() => void save()} icon={<Save size={16}/>}>Simpan aturan ujian</Button></div>}
        {config?.frozen && <p className="text-xs text-amber-200 mt-5">Aturan sudah dibekukan karena attempt telah dimulai. Buat revisi/duplikasi lomba untuk mengubah pengaturan ujian berikutnya.</p>}
      </Card>

      <Card className="p-5 md:p-6">
        <div className="flex items-center justify-between gap-3"><div><h2 className="font-semibold text-fg">Live Attempt Monitor</h2><p className="text-xs text-fg-muted mt-1">Daftar dibatasi pada 200 attempt terbaru. Panel ini tidak menampilkan skor.</p></div><Button variant="ghost" loading={refreshing} onClick={() => void refreshMonitor()} icon={<RefreshCw size={14}/>}>Refresh</Button></div>
        {monitor.sessions.length === 0 ? <div className="py-10 text-center text-sm text-fg-muted">Belum ada attempt menggunakan Exam Engine.</div> : <div className="mt-4 space-y-3">
          {monitor.sessions.map((session) => <div key={session.attempt_id} className="rounded-xl border border-border p-4">
            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
              <div><p className="font-semibold text-fg">{session.participant_name}</p><p className="text-[11px] text-fg-muted mt-1">Mulai {formatDate(session.started_at)}{session.participant_code ? ` · ${session.participant_code}` : ''}</p></div>
              <div className="flex gap-2 flex-wrap"><Badge>{session.exam_state}</Badge><Badge color="warn">Timeout {session.timeout_count}</Badge><Badge color={session.skipped_count ? 'err' : 'moss'}>Skip {session.skipped_count}</Badge></div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4 text-xs">
              <MiniStat label="Progres soal" value={`${session.current_question_index ?? 0}/${session.question_count}`}/>
              <MiniStat label="Terjawab" value={session.answered_count}/>
              <MiniStat label="Status attempt" value={session.attempt_status}/>
              <MiniStat label="Update terakhir" value={formatDate(session.current_question_deadline)}/>
            </div>
            <div className="flex flex-wrap gap-1.5 mt-4">
              {session.questions.map((q) => <span key={q.question_index} title={`Soal ${q.question_index}: ${q.state}; dialokasikan ${q.allocated_seconds}s; terpakai ${q.elapsed_seconds}s; pinjam ${q.borrowed_seconds}s; grace ${q.grace_seconds_used}s`} className={`rounded-lg px-2 py-1 text-[10px] font-semibold border ${stateClass(q.state)}`}>Q{q.question_index} · {shortState(q.state)}</span>)}
            </div>
          </div>)}
        </div>}
      </Card>
    </div>
  </div>;
}

function stateClass(state: string) {
  if (state === 'ANSWERED') return 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300';
  if (state === 'OVERTIME_ANSWERED') return 'border-sky-400/20 bg-sky-400/10 text-sky-300';
  if (state === 'TIMEOUT') return 'border-amber-400/20 bg-amber-400/10 text-amber-300';
  if (state === 'SKIPPED') return 'border-red-400/20 bg-red-400/10 text-red-300';
  if (state === 'ACTIVE') return 'border-indigo-400/20 bg-indigo-400/10 text-indigo-300';
  return 'border-border bg-white/5 text-fg-muted';
}
function shortState(state: string) {
  if (state === 'OVERTIME_ANSWERED') return 'OT';
  if (state === 'ANSWERED') return 'OK';
  if (state === 'SKIPPED') return 'SKIP';
  if (state === 'TIMEOUT') return 'TO';
  if (state === 'ACTIVE') return 'LIVE';
  return state;
}
function Metric({icon,label,value}:{icon:ReactNode;label:string;value:string|number}) {
  return <Card className="p-4"><div className="text-accent">{icon}</div><p className="text-xl font-bold text-fg mt-2">{value}</p><p className="text-[11px] text-fg-muted mt-1">{label}</p></Card>;
}
function Field({label,value,onChange,type='text',min,max,disabled}:{label:string;value:string;onChange:(v:string)=>void;type?:string;min?:number;max?:number;disabled?:boolean}) {
  return <label className="block"><span className="block text-xs font-medium text-fg-secondary mb-1.5">{label}</span><input className="input w-full" type={type} min={min} max={max} value={value} disabled={disabled} onChange={(e)=>onChange(e.target.value)}/></label>;
}
function Toggle({icon,label,checked,disabled,onChange}:{icon:ReactNode;label:string;checked:boolean;disabled?:boolean;onChange:(v:boolean)=>void}) {
  return <label className={`flex items-center gap-3 rounded-xl border border-border px-4 py-3 ${disabled?'opacity-50':'cursor-pointer hover:border-emerald-400/40'}`}><input type="checkbox" checked={checked} disabled={disabled} onChange={(e)=>onChange(e.target.checked)} className="accent-emerald-400"/><span className="text-accent">{icon}</span><span className="text-sm text-fg-secondary">{label}</span></label>;
}
function MiniStat({label,value}:{label:string;value:string|number|null}) {
  return <div><p className="text-fg-muted">{label}</p><p className="text-fg font-semibold mt-1">{value ?? '—'}</p></div>;
}
function AlertTriangleIcon() {
  return <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.3 3.9 2.7 17a2 2 0 0 0 1.7 3h15.2a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4m0 4h.01"/></svg>;
}
