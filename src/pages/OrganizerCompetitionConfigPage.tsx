import { toast } from "@/lib/toast";
import { FormEvent, useEffect, useState } from 'react';
import { ArrowLeft, Save, Trophy, Users, CalendarDays, Award, UserRound, Activity, Clock3, Shuffle, FlaskConical, Rocket, BookOpen, Check, Medal } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { supabase } from '@/lib/supabase';
import { getCompetitionConfig, saveCompetitionConfig, CompetitionConfigInput } from '@/services/organizerCompetition.service';

const grades = ['sd', 'smp', 'sma'];
const gradeOptions = [
  { value: 'sd', label: 'SD', description: 'Sekolah Dasar' },
  { value: 'smp', label: 'SMP', description: 'Sekolah Menengah Pertama' },
  { value: 'sma', label: 'SMA / SMK', description: 'Sekolah Menengah Atas / Kejuruan' },
];
const rewardLabels: Record<string, { label: string; description: string }> = {
  FIRST: { label: 'Juara 1', description: 'Penghargaan untuk peraih peringkat pertama.' },
  SECOND: { label: 'Juara 2', description: 'Penghargaan untuk peraih peringkat kedua.' },
  THIRD: { label: 'Juara 3', description: 'Penghargaan untuk peraih peringkat ketiga.' },
  PARTICIPANT: { label: 'Peserta', description: 'Apresiasi untuk peserta yang memenuhi ketentuan lomba.' },
};
function toLocalDateTimeInput(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 16);
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toTimestampFromLocalInput(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

const participantModeOptions = [
  { value: 'INDIVIDUAL', label: 'Individu', description: 'Peserta mendaftar dengan akun SykaBelajar sendiri.' },
  { value: 'COLLECTIVE_TEACHER', label: 'Kolektif oleh Guru', description: 'Guru memilih siswa dari roster dan membagikan akses peserta.' },
  { value: 'COLLECTIVE_ORGANIZATION', label: 'Kolektif oleh Organisasi', description: 'Pendaftaran dikelola oleh sekolah atau organisasi untuk peserta yang diwakilinya.' },
] as const;

export function OrganizerCompetitionConfigPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [competition, setCompetition] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [workingAction, setWorkingAction] = useState<'save' | 'preview' | 'release' | null>(null);
  const saving = workingAction !== null;
  const [participantModes, setParticipantModes] = useState<string[]>(['INDIVIDUAL']);
  const [durationMinutes, setDurationMinutes] = useState('60');
  const [publishedQuestionCount, setPublishedQuestionCount] = useState(0);
  const [questionCountLoading, setQuestionCountLoading] = useState(true);
  const [questionBanks, setQuestionBanks] = useState<Array<{ id: string; name: string; status: string }>>([]);
  const [questionBankId, setQuestionBankId] = useState('');
  const [randomizeQuestions, setRandomizeQuestions] = useState(false);
  const [randomizeOptions, setRandomizeOptions] = useState(false);
  const [form, setForm] = useState<CompetitionConfigInput>({
    level: { code: 'general', label: 'Umum', allowed_grades: grades, points: 0 },
    registration_rule: { allowed_grades: grades, require_twibbon: false, require_social_proof: false, express_enabled: false, express_cost: 0, max_participants: null, approval_mode: 'MANUAL' },
    rewards: [
      { rank_code: 'FIRST', title: 'Juara 1', points: 0, emblem_name: '', certificate_enabled: true },
      { rank_code: 'SECOND', title: 'Juara 2', points: 0, emblem_name: '', certificate_enabled: true },
      { rank_code: 'THIRD', title: 'Juara 3', points: 0, emblem_name: '', certificate_enabled: true },
      { rank_code: 'PARTICIPANT', title: 'Peserta', points: 0, emblem_name: '', certificate_enabled: true },
    ],
  });

  useEffect(() => {
    let active = true;
    (async () => {
      if (!id) return;
      const { data, error } = await supabase.from('competitions').select('*').eq('id', id).maybeSingle();
      if (error || !data) { if (active) setLoading(false); return; }
      const [existing, { data: bankRows, error: bankError }] = await Promise.all([
        getCompetitionConfig(id),
        supabase.from('question_banks')
          .select('id,name,status')
          .eq('organizer_id', data.organizer_id)
          .order('created_at', { ascending: false }),
      ]);
      if (bankError) throw bankError;
      if (!active) return;
      const savedExamConfig = data.config && typeof data.config === 'object'
        ? data.config as Record<string, unknown>
        : {};
      setCompetition(data);
      const configuredModes = Array.isArray(savedExamConfig.participant_modes)
        ? savedExamConfig.participant_modes.map(String).filter((mode) => participantModeOptions.some((option) => option.value === mode))
        : [];
      setParticipantModes(configuredModes.length ? configuredModes : [String(data.participant_mode || 'INDIVIDUAL')]);
      setDurationMinutes(String(Math.max(1, Math.min(1440, Number(savedExamConfig.duration_minutes ?? 60) || 60))));
      setRandomizeQuestions(String(savedExamConfig.linear_exam_randomize_questions ?? 'false').toLowerCase() === 'true');
      setRandomizeOptions(String(savedExamConfig.linear_exam_randomize_options ?? 'false').toLowerCase() === 'true');
      const availableBanks = (bankRows ?? []).map((bank: any) => ({
        id: String(bank.id), name: String(bank.name), status: String(bank.status ?? 'DRAFT'),
      }));
      setQuestionBanks(availableBanks);
      const configuredBank = String(data.question_bank_id ?? '');
      setQuestionBankId(configuredBank || (availableBanks.length === 1 ? availableBanks[0].id : ''));
      setForm((current) => ({
        ...current,
        level: existing.level ? {
          code: existing.level.code ?? current.level.code,
          label: existing.level.label ?? current.level.label,
          allowed_grades: existing.level.allowed_grades ?? current.level.allowed_grades,
          points: Number(existing.level.points ?? 0),
          registration_starts_at: data.registration_starts_at ?? '', registration_ends_at: data.registration_ends_at ?? '',
          starts_at: data.starts_at ?? '', ends_at: data.ends_at ?? '', announcement_at: data.announcement_at ?? '', config: existing.level.config ?? {},
        } : { ...current.level, registration_starts_at: data.registration_starts_at ?? '', registration_ends_at: data.registration_ends_at ?? '', starts_at: data.starts_at ?? '', ends_at: data.ends_at ?? '', announcement_at: data.announcement_at ?? '' },
        registration_rule: existing.registrationRule ? { ...current.registration_rule, ...existing.registrationRule, allowed_grades: existing.registrationRule.allowed_grades ?? current.registration_rule.allowed_grades } : current.registration_rule,
        rewards: existing.rewards.length ? existing.rewards.map((r: any) => ({ rank_code: r.rank_code, title: r.title, points: Number(r.points ?? 0), emblem_name: r.emblem_name ?? '', certificate_enabled: Boolean(r.certificate_enabled), config: r.config ?? {} })) : current.rewards,
      }));
      setLoading(false);
    })();
    return () => { active = false; };
  }, [id]);

  useEffect(() => {
    let active = true;
    if (!id) {
      setQuestionCountLoading(false);
      return () => { active = false; };
    }
    setQuestionCountLoading(true);
    void (async () => {
      try {
        const { count: directCount, error: directError } = await supabase
          .from('questions')
          .select('id', { count: 'exact', head: true })
          .eq('competition_id', id)
          .eq('status', 'PUBLISHED');
        if (directError) throw directError;

        let bankCount = 0;
        if (questionBankId) {
          const { count, error } = await supabase
            .from('questions')
            .select('id', { count: 'exact', head: true })
            .eq('question_bank_id', questionBankId)
            .is('competition_id', null)
            .eq('status', 'PUBLISHED');
          if (error) throw error;
          bankCount = count ?? 0;
        }
        if (active) setPublishedQuestionCount((directCount ?? 0) + bankCount);
      } catch (error) {
        if (active) {
          setPublishedQuestionCount(0);
          toast.error(error instanceof Error ? error.message : 'Gagal memeriksa jumlah soal.');
        }
      } finally {
        if (active) setQuestionCountLoading(false);
      }
    })();
    return () => { active = false; };
  }, [id, questionBankId]);

  const updateLevel = (key: string, value: any) => setForm((x) => ({ ...x, level: { ...x.level, [key]: value } }));
  const updateRule = (key: string, value: any) => setForm((x) => ({ ...x, registration_rule: { ...x.registration_rule, [key]: value } }));
  const updateReward = (index: number, key: string, value: any) => setForm((x) => ({ ...x, rewards: x.rewards.map((r, i) => i === index ? { ...r, [key]: value } : r) }));
  const toggleGrade = (list: string[], grade: string) => list.includes(grade) ? list.filter((x) => x !== grade) : [...list, grade];
  const toggleParticipantMode = (value: string) => setParticipantModes((current) => current.includes(value) ? current.filter((mode) => mode !== value) : [...current, value]);

  async function saveConfiguration(action: 'save' | 'preview' | 'release') {
    if (!id || workingAction) return;
    if (questionCountLoading && action !== 'save') {
      toast.error('Sedang memeriksa jumlah soal. Coba lagi sesaat.');
      return;
    }
    if (action === 'release' && !window.confirm('Terbitkan lomba ini sekarang? Setelah diterbitkan, peserta dapat melihatnya sesuai jadwal dan aturan pendaftaran.')) return;
    if (participantModes.length === 0) { toast.error('Pilih minimal satu cara pendaftaran peserta.'); return; }
    const duration = Number(durationMinutes);
    if (!Number.isInteger(duration) || duration < 1 || duration > 1440) {
      toast.error('Durasi ujian harus 1 sampai 1.440 menit.');
      return;
    }
    if (publishedQuestionCount < 1 && action !== 'save') {
      toast.error('Tambahkan dan publikasikan minimal satu soal sebelum simulasi atau Release.');
      return;
    }
    if (duration * 60 < publishedQuestionCount) {
      toast.error(`Durasi terlalu singkat: ${publishedQuestionCount} soal membutuhkan minimal ${Math.ceil(publishedQuestionCount / 60)} menit.`);
      return;
    }
    setWorkingAction(action);
    try {
      await saveCompetitionConfig(id, {
        ...form,
        level: {
          ...form.level,
          allowed_grades: form.level.allowed_grades,
          // JSON strings without a timezone are interpreted as UTC by Postgres.
          // Normalize the user's local datetime inputs to explicit UTC instants first.
          registration_starts_at: toTimestampFromLocalInput(form.level.registration_starts_at),
          registration_ends_at: toTimestampFromLocalInput(form.level.registration_ends_at),
          starts_at: toTimestampFromLocalInput(form.level.starts_at),
          ends_at: toTimestampFromLocalInput(form.level.ends_at),
          announcement_at: toTimestampFromLocalInput(form.level.announcement_at),
        },
        registration_rule: { ...form.registration_rule, allowed_grades: form.registration_rule.allowed_grades },
      });
      const currentConfig = competition?.config && typeof competition.config === 'object'
        ? competition.config as Record<string, unknown>
        : {};
      const { error } = await supabase.from('competitions').update({
        participant_mode: participantModes.includes('INDIVIDUAL') ? 'INDIVIDUAL' : participantModes[0],
        question_bank_id: questionBankId || null,
        config: {
          ...currentConfig,
          duration_minutes: duration,
          participant_modes: participantModes,
          linear_exam_decision_seconds: 30,
          linear_exam_grace_seconds: 30,
          linear_exam_randomize_questions: randomizeQuestions,
          linear_exam_randomize_options: randomizeOptions,
        },
      }).eq('id', id);
      if (error) throw error;

      if (action === 'preview') {
        const { data, error: previewError } = await supabase.rpc('start_organizer_exam_preview', { p_competition_id: id });
        if (previewError) throw previewError;
        const attemptId = String((data as Record<string, unknown> | null)?.attempt_id ?? '');
        if (!attemptId) throw new Error('Sesi simulasi tidak berhasil dibuat.');
        toast.success('Konfigurasi tersimpan. Simulasi dimulai.');
        navigate(`/organizer/competition/${id}/simulation/${attemptId}`);
        return;
      }

      if (action === 'release') {
        const { error: releaseError } = await supabase.rpc('release_organizer_competition', { p_competition_id: id });
        if (releaseError) throw releaseError;
        toast.success('Lomba berhasil diterbitkan.');
        navigate('/organizer');
        return;
      }

      toast.success('Konfigurasi lomba berhasil disimpan.');
      navigate('/organizer');
    } catch (error: any) {
      const message = String(error?.message ?? '');
      if (message.includes('EXAM_HAS_NO_PUBLISHED_QUESTIONS')) {
        toast.error('Publikasikan minimal satu soal sebelum menjalankan simulasi atau Release.');
      } else if (message.includes('PREVIEW_REQUIRES_DRAFT_COMPETITION')) {
        toast.error('Simulasi hanya tersedia untuk lomba yang masih Draft.');
      } else if (message.includes('COMPETITION_TIMELINE_INCOMPLETE')) {
        toast.error('Lengkapi seluruh jadwal lomba sebelum Release.');
      } else if (message.includes('COMPETITION_TIMELINE_INVALID')) {
        toast.error('Periksa kembali urutan jadwal pendaftaran dan pelaksanaan lomba.');
      } else {
        toast.error(error?.message ?? 'Gagal menyimpan konfigurasi lomba.');
      }
    } finally {
      setWorkingAction(null);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    void saveConfiguration('save');
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center text-slate-500">Memuat konfigurasi…</div>;
  if (!competition) return <div className="p-6"><Card className="p-8 text-center text-slate-500">Kompetisi tidak ditemukan.</Card></div>;

  return <div className="min-h-screen surface-bg p-5 md:p-8">
    <div className="max-w-5xl mx-auto">
      <Link to="/organizer" className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-fg mb-5"><ArrowLeft size={16}/> Kembali ke Organizer</Link>
      <div className="flex items-start justify-between gap-4 mb-6"><div><p className="text-xs text-accent uppercase tracking-wider">Competition Builder</p><h1 className="font-display text-2xl md:text-3xl font-bold text-fg">{competition.title}</h1><p className="text-sm text-slate-500 mt-1">Konfigurasi live ke Supabase</p></div><div className="flex flex-wrap items-center gap-2"><Badge color="moss">{competition.status}</Badge><Link to={`/organizer/competition/${competition.id}/exam-monitor`}><Button type="button" variant="outline" icon={<Activity size={15}/>}>Pantau Ujian</Button></Link></div></div>
      <form onSubmit={submit} className="space-y-5">
        <Card className="p-5 md:p-6">
          <div className="mb-2 flex items-center gap-2 text-fg font-semibold"><Clock3 size={18} className="text-accent"/> Durasi & Pengacakan Ujian</div>
          <p className="mb-5 text-sm leading-relaxed text-fg-muted">Tentukan batas waktu untuk seluruh ujian. Sistem membagi waktu ini ke setiap soal secara otomatis; jumlah menit per soal menyesuaikan jumlah soal yang dipublikasikan. Jawaban cepat bisa mendapat bonus 60 detik pada soal selanjutnya, tetapi tidak menambah waktu total ujian.</p>
          <div className="grid gap-5 lg:grid-cols-[1.1fr_.9fr]">
            <div>
              <p className="label">Waktu total ujian</p>
              <p className="mb-3 text-xs text-fg-muted">Pilih durasi umum atau masukkan durasi sendiri.</p>
              <div className="grid grid-cols-4 gap-2" role="group" aria-label="Pilihan waktu total ujian">
                {['30','60','120'].map((minutes) => <button key={minutes} type="button" onClick={() => setDurationMinutes(minutes)} disabled={saving} className={`rounded-xl border px-3 py-3 text-sm font-semibold transition ${durationMinutes === minutes ? 'border-accent bg-accent/10 text-accent ring-1 ring-accent/20' : 'border-border text-fg-secondary hover:border-accent/50'}`}>
                  {minutes} menit
                </button>)}
                <button type="button" onClick={() => setDurationMinutes(['30','60','120'].includes(durationMinutes) ? '90' : durationMinutes)} disabled={saving} className={`rounded-xl border px-3 py-3 text-sm font-semibold transition ${!['30','60','120'].includes(durationMinutes) ? 'border-accent bg-accent/10 text-accent ring-1 ring-accent/20' : 'border-border text-fg-secondary hover:border-accent/50'}`}>
                  Custom
                </button>
              </div>
              {!['30','60','120'].includes(durationMinutes) && <div className="mt-3 max-w-xs">
                <label className="label" htmlFor="linear-exam-duration-custom">Durasi custom (menit)</label>
                <input id="linear-exam-duration-custom" className="input" type="number" min="1" max="1440" step="1" inputMode="numeric" value={durationMinutes} onChange={(event) => setDurationMinutes(event.target.value)} disabled={saving}/>
                <p className="mt-1 text-xs text-fg-muted">Masukkan 1–1.440 menit sesuai kebutuhan.</p>
              </div>}
              <div className="mt-4 rounded-xl border border-border bg-surface-elevated/20 p-3">
                <p className="text-xs font-semibold text-fg">{questionCountLoading ? 'Menghitung pembagian waktu…' : publishedQuestionCount + ' soal dipublikasikan'}</p>
                <p className="mt-1 text-xs leading-relaxed text-fg-muted">
                  {publishedQuestionCount > 0 && Number(durationMinutes) > 0
                    ? 'Waktu dasar per soal sekitar ' + Math.floor((Number(durationMinutes) * 60) / publishedQuestionCount / 60) + ' menit ' + String(Math.floor((Number(durationMinutes) * 60) / publishedQuestionCount) % 60).padStart(2, '0') + ' detik. Pembagian final ditetapkan server.'
                    : 'Pilih atau publikasikan soal untuk melihat perkiraan pembagian waktu.'}
                </p>
              </div>
            </div>
            <div className="space-y-3">
              <p className="label">Urutan soal</p>
              <Toggle label="Acak urutan soal untuk setiap ujian" checked={randomizeQuestions} onChange={setRandomizeQuestions}/>
              <Toggle label="Acak urutan pilihan jawaban" checked={randomizeOptions} onChange={setRandomizeOptions}/>
              <div className="rounded-xl border border-accent/20 bg-accent/5 p-3 text-xs leading-relaxed text-fg-secondary">
                <div className="mb-1 flex items-center gap-2 font-semibold text-fg"><Shuffle size={15} className="text-accent"/> Tetap adil untuk semua peserta</div>
                Urutan dapat diacak pada setiap percobaan. Timer dan penilaian tetap ditentukan server, bukan jam perangkat peserta.
              </div>
            </div>
          </div>
        </Card>
        <Card className="p-5">
          <div className="mb-2 flex items-center gap-2 text-fg font-semibold"><BookOpen size={18} className="text-accent"/> Sumber Soal</div>
          <p className="mb-4 text-xs text-fg-muted">Pilih bank soal penyelenggara yang akan digunakan lomba ini. Soal berstatus PUBLISHED yang masih berada di bank akan dipakai sebagai snapshot ujian; soal asli tetap tersimpan di bank.</p>
          <label className="label" htmlFor="competition-question-bank">Bank soal</label>
          <select id="competition-question-bank" className="input mt-1" value={questionBankId} onChange={(event) => setQuestionBankId(event.target.value)} disabled={saving}>
            <option value="">Hanya soal yang terhubung langsung ke lomba</option>
            {questionBanks.map((bank) => <option key={bank.id} value={bank.id}>{bank.name}{bank.status === 'DRAFT' ? ' · Draft bank' : ''}</option>)}
          </select>
          <p className="mt-2 text-xs text-fg-muted">{publishedQuestionCount} soal berstatus dipublikasikan dari sumber yang dipilih.</p>
          {!questionBanks.length && <p className="mt-2 text-xs text-amber-300">Belum ada bank soal untuk organisasi ini. Buat bank soal terlebih dahulu, atau hubungkan soal langsung ke lomba.</p>}
        </Card>
        <Card className="p-5 md:p-6">
          <div className="mb-2 flex items-center gap-2 text-fg font-semibold"><UserRound size={18} className="text-accent"/> Cara Pendaftaran Peserta</div>
          <p className="mb-4 text-sm leading-relaxed text-fg-muted">Centang semua cara pendaftaran yang ingin dibuka. Peserta individu dan peserta kolektif dapat sama-sama diterima pada lomba yang sama.</p>
          <div className="grid gap-3 md:grid-cols-3">
            {participantModeOptions.map((mode) => {
              const selected = participantModes.includes(mode.value);
              return <button key={mode.value} type="button" aria-pressed={selected} onClick={() => toggleParticipantMode(mode.value)} disabled={saving} className={`flex h-full items-start gap-3 rounded-xl border p-4 text-left transition ${selected ? 'border-accent bg-accent/5 ring-1 ring-accent/20' : 'border-border hover:border-accent/40'}`}>
                <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 ${selected ? 'border-accent bg-accent text-white' : 'border-fg-muted/50'}`}>{selected && <Check size={13}/>}</span>
                <span><span className="block font-semibold text-fg">{mode.label}</span><span className="mt-1 block text-xs leading-relaxed text-fg-muted">{mode.description}</span></span>
              </button>;
            })}
          </div>
          <p className="mt-3 text-xs text-fg-muted">{participantModes.length === 3 ? 'Semua cara pendaftaran dipilih.' : participantModes.length === 0 ? 'Pilih minimal satu cara pendaftaran.' : participantModes.length + ' cara pendaftaran dipilih.'}</p>
        </Card>
        <Card className="p-5 md:p-6">
          <div className="mb-2 flex items-center gap-2 text-fg font-semibold"><Trophy size={18} className="text-accent"/> Kategori & Jenjang Peserta</div>
          <p className="mb-5 text-sm leading-relaxed text-fg-muted">Gunakan kategori untuk menjelaskan tingkat lomba dan menentukan jenjang sekolah yang boleh mendaftar. Untuk lomba umum, nama “Umum” sudah cukup.</p>
          <div className="grid gap-4 md:grid-cols-2">
            <Input label="Nama kategori / tingkat" value={form.level.label} onChange={(value) => updateLevel('label', value)} />
            <div>
              <label className="label">Poin dasar kategori</label>
              <input className="input" type="number" min="0" step="1" value={String(form.level.points)} onChange={(event) => updateLevel('points', Number(event.target.value || 0))}/>
              <p className="mt-1 text-xs text-fg-muted">Isi 0 jika kategori ini tidak memberikan poin tambahan.</p>
            </div>
          </div>
          <div className="mt-5">
            <label className="label">Jenjang sekolah yang boleh mendaftar</label>
            <p className="mb-3 text-xs text-fg-muted">Centang satu atau beberapa jenjang sesuai sasaran lomba.</p>
            <div className="grid gap-2 sm:grid-cols-3">
              {gradeOptions.map((grade) => {
                const selected = form.level.allowed_grades.includes(grade.value);
                return <button type="button" key={grade.value} aria-pressed={selected} onClick={() => updateLevel('allowed_grades', toggleGrade(form.level.allowed_grades, grade.value))} className={`flex items-center gap-3 rounded-xl border p-3 text-left transition ${selected ? 'border-accent bg-accent/5' : 'border-border hover:border-accent/40'}`}>
                  <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 ${selected ? 'border-accent bg-accent text-white' : 'border-fg-muted/50'}`}>{selected && <Check size={13}/>}</span>
                  <span><span className="block text-sm font-semibold text-fg">{grade.label}</span><span className="block text-xs text-fg-muted">{grade.description}</span></span>
                </button>;
              })}
            </div>
          </div>
          <details className="mt-5 rounded-xl border border-border px-4 py-3">
            <summary className="cursor-pointer text-sm font-medium text-fg-secondary">Pengaturan lanjutan (biasanya tidak perlu diubah)</summary>
            <div className="mt-3 max-w-md">
              <Input label="Kode internal kategori" value={form.level.code} onChange={(value) => updateLevel('code', value)} />
              <p className="mt-1 text-xs text-fg-muted">Kode untuk identifikasi sistem. Nama kategori di atas adalah yang lebih mudah dikenali penyelenggara.</p>
            </div>
          </details>
        </Card>
        <Card className="p-5">
          <div className="flex items-center gap-2 mb-2 text-fg font-semibold"><CalendarDays size={18} className="text-accent"/> Jadwal Lomba</div>
          <p className="mb-4 text-xs leading-relaxed text-fg-muted">Tanggal dan jam ditampilkan mengikuti zona waktu perangkatmu (misalnya WIB di Indonesia). Sistem menyimpan waktu yang sama ke server tanpa menggeser jam 7 jam.</p>
          <div className="grid md:grid-cols-2 gap-4">
            <Input label="Pendaftaran mulai" type="datetime-local" value={toLocalDateTimeInput(form.level.registration_starts_at)} onChange={(v)=>updateLevel('registration_starts_at',v)}/>
            <Input label="Pendaftaran berakhir" type="datetime-local" value={toLocalDateTimeInput(form.level.registration_ends_at)} onChange={(v)=>updateLevel('registration_ends_at',v)}/>
            <Input label="Kompetisi mulai" type="datetime-local" value={toLocalDateTimeInput(form.level.starts_at)} onChange={(v)=>updateLevel('starts_at',v)}/>
            <Input label="Kompetisi berakhir" type="datetime-local" value={toLocalDateTimeInput(form.level.ends_at)} onChange={(v)=>updateLevel('ends_at',v)}/>
            <Input label="Pengumuman" type="datetime-local" value={toLocalDateTimeInput(form.level.announcement_at)} onChange={(v)=>updateLevel('announcement_at',v)}/>
          </div>
        </Card>
        <Card className="p-5"><div className="flex items-center gap-2 mb-4 text-fg font-semibold"><Users size={18} className="text-accent"/> Syarat Pendaftaran</div><div className="grid md:grid-cols-2 gap-4"><Input label="Maksimal peserta" type="number" value={form.registration_rule.max_participants == null ? '' : String(form.registration_rule.max_participants)} onChange={(v)=>updateRule('max_participants',v === '' ? null : Number(v))}/><Input label="Biaya pendaftaran prioritas" type="number" value={String(form.registration_rule.express_cost)} onChange={(v)=>updateRule('express_cost',Number(v||0))}/></div><div className="mt-4 flex flex-wrap gap-2">{grades.map(g=><button type="button" key={g} onClick={()=>updateRule('allowed_grades',toggleGrade(form.registration_rule.allowed_grades,g))} className={`px-3 py-2 rounded-lg border text-sm ${form.registration_rule.allowed_grades.includes(g)?'border-moss-500 bg-moss-500/10 text-accent':'surface-border text-slate-500'}`}>{g.toUpperCase()}</button>)}</div><div className="grid md:grid-cols-2 gap-3 mt-4"><Toggle label="Twibbon wajib" checked={form.registration_rule.require_twibbon} onChange={(v)=>updateRule('require_twibbon',v)}/><Toggle label="Bukti promosi di media sosial wajib" checked={form.registration_rule.require_social_proof} onChange={(v)=>updateRule('require_social_proof',v)}/><Toggle label="Sediakan pendaftaran prioritas" checked={form.registration_rule.express_enabled} onChange={(v)=>updateRule('express_enabled',v)}/><div><label className="label">Persetujuan pendaftaran</label><select className="input" value={form.registration_rule.approval_mode} onChange={e=>updateRule('approval_mode',e.target.value)}><option value="MANUAL">Manual</option><option value="AUTO">Otomatis</option></select></div></div></Card>
        <Card className="p-5 md:p-6">
          <div className="mb-2 flex items-center gap-2 text-fg font-semibold"><Award size={18} className="text-accent"/> Hadiah & Apresiasi</div>
          <p className="mb-5 text-sm leading-relaxed text-fg-muted">Atur apa yang diterima juara dan peserta. Nama penghargaan disimpan untuk ditampilkan di website; kode sistem dikelola otomatis.</p>
          <div className="space-y-3">
            {form.rewards.map((reward, index) => {
              const info = rewardLabels[reward.rank_code] ?? { label: reward.title || 'Penghargaan', description: 'Atur apresiasi untuk kategori penerima ini.' };
              return <div key={reward.rank_code} className="rounded-2xl border border-border p-4 md:p-5">
                <div className="mb-4 flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent"><Medal size={21}/></div>
                  <div><h3 className="font-semibold text-fg">{info.label}</h3><p className="mt-1 text-xs text-fg-muted">{info.description}</p></div>
                </div>
                <div className="grid gap-4 md:grid-cols-3">
                  <Input label="Nama penghargaan" value={reward.title} onChange={(value) => updateReward(index, 'title', value)} />
                  <div>
                    <label className="label">Poin yang diberikan</label>
                    <input className="input" type="number" min="0" step="1" value={String(reward.points)} onChange={(event) => updateReward(index, 'points', Number(event.target.value || 0))}/>
                    <p className="mt-1 text-xs text-fg-muted">Poin SykaBelajar untuk penerima penghargaan ini.</p>
                  </div>
                  <Input label="Nama lencana (opsional)" value={reward.emblem_name || ''} onChange={(value) => updateReward(index, 'emblem_name', value)} />
                </div>
                <div className="mt-4">
                  <Toggle label="Terbitkan sertifikat untuk penerima ini" checked={reward.certificate_enabled} onChange={(value) => updateReward(index, 'certificate_enabled', value)} />
                </div>
              </div>;
            })}
          </div>
        </Card>
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <Button type="submit" variant="outline" loading={workingAction === 'save'} disabled={saving} icon={<Save size={17}/>}>Simpan Konfigurasi</Button>
          {competition.status === 'DRAFT' && <>
            <Button type="button" variant="outline" loading={workingAction === 'preview'} disabled={saving || questionCountLoading} icon={<FlaskConical size={17}/>} onClick={() => void saveConfiguration('preview')}>Simulasi</Button>
            <Button type="button" loading={workingAction === 'release'} disabled={saving || questionCountLoading} icon={<Rocket size={17}/>} onClick={() => void saveConfiguration('release')}>Release · Terbitkan Lomba</Button>
          </>}
        </div>
      </form>
    </div>
  </div>;
}
function Input({label,value,onChange,type='text'}:{label:string;value:string;onChange:(v:string)=>void;type?:string}){return <div><label className="label">{label}</label><input className="input" type={type} value={value} onChange={e=>onChange(e.target.value)}/></div>}
function Toggle({label,checked,onChange}:{label:string;checked:boolean;onChange:(v:boolean)=>void}){return <label className="flex items-center gap-3 rounded-xl border surface-border px-3 py-3 text-sm text-fg-secondary"><input type="checkbox" checked={checked} onChange={e=>onChange(e.target.checked)}/>{label}</label>}
