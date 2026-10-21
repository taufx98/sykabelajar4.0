import { toast } from "@/lib/toast";
import { FormEvent, useEffect, useState } from 'react';
import { ArrowLeft, Save, Trophy, Users, CalendarDays, Award, UserRound, Activity, Clock3, Shuffle, FlaskConical, Rocket, BookOpen } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { supabase } from '@/lib/supabase';
import { getCompetitionConfig, saveCompetitionConfig, CompetitionConfigInput } from '@/services/organizerCompetition.service';

const grades = ['sd', 'smp', 'sma'];
const participantModes = [
  { value: 'INDIVIDUAL', label: 'Individu', description: 'Peserta mendaftar dengan akun SykaBelajar sendiri.' },
  { value: 'COLLECTIVE_TEACHER', label: 'Kolektif oleh Guru', description: 'Guru memilih siswa dari roster dan membagikan akses peserta.' },
  { value: 'COLLECTIVE_ORGANIZATION', label: 'Kolektif oleh Organisasi', description: 'Organisasi/sekolah mengelola peserta kolektif. Fondasi backend sudah disiapkan.' },
] as const;

export function OrganizerCompetitionConfigPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [competition, setCompetition] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [workingAction, setWorkingAction] = useState<'save' | 'preview' | 'release' | null>(null);
  const saving = workingAction !== null;
  const [participantMode, setParticipantMode] = useState('INDIVIDUAL');
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
      setParticipantMode(String(data.participant_mode || 'INDIVIDUAL'));
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

  async function saveConfiguration(action: 'save' | 'preview' | 'release') {
    if (!id || workingAction) return;
    if (questionCountLoading && action !== 'save') {
      toast.error('Sedang memeriksa jumlah soal. Coba lagi sesaat.');
      return;
    }
    if (action === 'release' && !window.confirm('Terbitkan lomba ini sekarang? Setelah diterbitkan, peserta dapat melihatnya sesuai jadwal dan aturan pendaftaran.')) return;
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
        level: { ...form.level, allowed_grades: form.level.allowed_grades },
        registration_rule: { ...form.registration_rule, allowed_grades: form.registration_rule.allowed_grades },
      });
      const currentConfig = competition?.config && typeof competition.config === 'object'
        ? competition.config as Record<string, unknown>
        : {};
      const { error } = await supabase.from('competitions').update({
        participant_mode: participantMode,
        question_bank_id: questionBankId || null,
        config: {
          ...currentConfig,
          duration_minutes: duration,
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
        <Card className="p-5">
          <div className="mb-2 flex items-center gap-2 text-fg font-semibold"><Clock3 size={18} className="text-accent"/> Durasi & Pengacakan Ujian</div>
          <p className="mb-4 text-xs text-fg-muted">Waktu total dibagi ke soal yang dipublikasikan. Sisa waktu ketika peserta menjawab lebih cepat otomatis menjadi tambahan waktu untuk soal berikutnya. Timer diputuskan server, bukan jam browser.</p>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="label" htmlFor="linear-exam-duration">Durasi total (menit)</label>
              <input id="linear-exam-duration" className="input" type="number" min="1" max="1440" step="1" inputMode="numeric" value={durationMinutes} onChange={(event) => setDurationMinutes(event.target.value)} />
              <p className="mt-1 text-xs text-fg-muted">{publishedQuestionCount} soal berstatus dipublikasikan. Minimal {Math.max(1, Math.ceil(publishedQuestionCount / 60))} menit untuk pembagian sekurangnya 1 detik per soal.</p>
            </div>
            <div className="space-y-3">
              <Toggle label="Acak urutan soal untuk tiap attempt" checked={randomizeQuestions} onChange={setRandomizeQuestions}/>
              <Toggle label="Acak urutan opsi jawaban" checked={randomizeOptions} onChange={setRandomizeOptions}/>
            </div>
          </div>
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-accent/20 bg-accent/5 p-3 text-xs text-fg-secondary">
            <Shuffle size={16} className="mt-0.5 shrink-0 text-accent"/>
            <span>Setiap attempt menyimpan snapshot soal dan kunci penilaian di backend. Peserta hanya menerima soal aktif. Waktu memilih perpanjangan dan waktu tambahan masing-masing 30 detik.</span>
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
        <Card className="p-5"><div className="flex items-center gap-2 mb-2 text-fg font-semibold"><UserRound size={18} className="text-accent"/> Mode Peserta</div><p className="text-xs text-fg-muted mb-4">Tentukan apakah lomba ini menerima akun peserta individual atau peserta kolektif.</p><div className="grid gap-3">{participantModes.map((mode)=><button key={mode.value} type="button" onClick={()=>setParticipantMode(mode.value)} className={`w-full text-left rounded-xl border p-4 transition ${participantMode===mode.value?'border-accent bg-accent/5':'border-border hover:border-accent/40'}`}><div className="flex items-center gap-3"><div className={`w-4 h-4 rounded-full border-2 ${participantMode===mode.value?'border-accent bg-accent':'border-fg-muted'}`} /><div><p className="font-semibold text-fg">{mode.label}</p><p className="text-xs text-fg-muted mt-1">{mode.description}</p></div></div></button>)}</div></Card>
        <Card className="p-5"><div className="flex items-center gap-2 mb-4 text-fg font-semibold"><Trophy size={18} className="text-accent"/> Level & Eligibility</div><div className="grid md:grid-cols-2 gap-4"><Input label="Kode level" value={form.level.code} onChange={(v)=>updateLevel('code',v)}/><Input label="Label level" value={form.level.label} onChange={(v)=>updateLevel('label',v)}/><Input label="Points dasar" type="number" value={String(form.level.points)} onChange={(v)=>updateLevel('points',Number(v||0))}/></div><div className="mt-4"><label className="label">Jenjang yang diizinkan</label><div className="flex flex-wrap gap-2">{grades.map(g=><button type="button" key={g} onClick={()=>updateLevel('allowed_grades',toggleGrade(form.level.allowed_grades,g))} className={`px-3 py-2 rounded-lg border text-sm ${form.level.allowed_grades.includes(g)?'border-moss-500 bg-moss-500/10 text-accent':'surface-border text-slate-500'}`}>{g.toUpperCase()}</button>)}</div></div></Card>
        <Card className="p-5"><div className="flex items-center gap-2 mb-4 text-fg font-semibold"><CalendarDays size={18} className="text-accent"/> Timeline</div><div className="grid md:grid-cols-2 gap-4"><Input label="Pendaftaran mulai" type="datetime-local" value={(form.level.registration_starts_at||'').slice(0,16)} onChange={(v)=>updateLevel('registration_starts_at',v)}/><Input label="Pendaftaran berakhir" type="datetime-local" value={(form.level.registration_ends_at||'').slice(0,16)} onChange={(v)=>updateLevel('registration_ends_at',v)}/><Input label="Kompetisi mulai" type="datetime-local" value={(form.level.starts_at||'').slice(0,16)} onChange={(v)=>updateLevel('starts_at',v)}/><Input label="Kompetisi berakhir" type="datetime-local" value={(form.level.ends_at||'').slice(0,16)} onChange={(v)=>updateLevel('ends_at',v)}/><Input label="Pengumuman" type="datetime-local" value={(form.level.announcement_at||'').slice(0,16)} onChange={(v)=>updateLevel('announcement_at',v)}/></div></Card>
        <Card className="p-5"><div className="flex items-center gap-2 mb-4 text-fg font-semibold"><Users size={18} className="text-accent"/> Registration Rules</div><div className="grid md:grid-cols-2 gap-4"><Input label="Maksimal peserta" type="number" value={form.registration_rule.max_participants == null ? '' : String(form.registration_rule.max_participants)} onChange={(v)=>updateRule('max_participants',v === '' ? null : Number(v))}/><Input label="Biaya Express" type="number" value={String(form.registration_rule.express_cost)} onChange={(v)=>updateRule('express_cost',Number(v||0))}/></div><div className="mt-4 flex flex-wrap gap-2">{grades.map(g=><button type="button" key={g} onClick={()=>updateRule('allowed_grades',toggleGrade(form.registration_rule.allowed_grades,g))} className={`px-3 py-2 rounded-lg border text-sm ${form.registration_rule.allowed_grades.includes(g)?'border-moss-500 bg-moss-500/10 text-accent':'surface-border text-slate-500'}`}>{g.toUpperCase()}</button>)}</div><div className="grid md:grid-cols-2 gap-3 mt-4"><Toggle label="Twibbon wajib" checked={form.registration_rule.require_twibbon} onChange={(v)=>updateRule('require_twibbon',v)}/><Toggle label="Social proof wajib" checked={form.registration_rule.require_social_proof} onChange={(v)=>updateRule('require_social_proof',v)}/><Toggle label="Express registration" checked={form.registration_rule.express_enabled} onChange={(v)=>updateRule('express_enabled',v)}/><div><label className="label">Mode approval</label><select className="input" value={form.registration_rule.approval_mode} onChange={e=>updateRule('approval_mode',e.target.value)}><option value="MANUAL">Manual</option><option value="AUTO">Otomatis</option></select></div></div></Card>
        <Card className="p-5"><div className="flex items-center gap-2 mb-4 text-fg font-semibold"><Award size={18} className="text-accent"/> Rewards</div><div className="space-y-3">{form.rewards.map((r,i)=><div key={r.rank_code} className="grid md:grid-cols-4 gap-3 p-3 rounded-xl bg-white/[.03] border surface-border"><Input label={r.rank_code} value={r.title} onChange={(v)=>updateReward(i,'title',v)}/><Input label="Points" type="number" value={String(r.points)} onChange={(v)=>updateReward(i,'points',Number(v||0))}/><Input label="Emblem" value={r.emblem_name||''} onChange={(v)=>updateReward(i,'emblem_name',v)}/><Toggle label="Sertifikat" checked={r.certificate_enabled} onChange={(v)=>updateReward(i,'certificate_enabled',v)}/></div>)}</div></Card>
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
