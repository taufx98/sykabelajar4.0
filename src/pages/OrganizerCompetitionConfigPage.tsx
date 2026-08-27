import { FormEvent, useEffect, useState } from 'react';
import { ArrowLeft, Save, Trophy, Users, CalendarDays, Award } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { supabase } from '@/lib/supabase';
import { getCompetitionConfig, saveCompetitionConfig, CompetitionConfigInput } from '@/services/organizerCompetition.service';

const grades = ['sd', 'smp', 'sma'];

export function OrganizerCompetitionConfigPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [competition, setCompetition] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
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
      const existing = await getCompetitionConfig(id);
      if (!active) return;
      setCompetition(data);
      setForm((current) => ({
        ...current,
        level: existing.level ? {
          code: existing.level.code ?? current.level.code,
          label: existing.level.label ?? current.level.label,
          allowed_grades: existing.level.allowed_grades ?? current.level.allowed_grades,
          points: Number(existing.level.points ?? 0),
          registration_starts_at: data.registration_starts_at ?? '',
          registration_ends_at: data.registration_ends_at ?? '',
          starts_at: data.starts_at ?? '',
          ends_at: data.ends_at ?? '',
          announcement_at: data.announcement_at ?? '',
          config: existing.level.config ?? {},
        } : { ...current.level, registration_starts_at: data.registration_starts_at ?? '', registration_ends_at: data.registration_ends_at ?? '', starts_at: data.starts_at ?? '', ends_at: data.ends_at ?? '', announcement_at: data.announcement_at ?? '' },
        registration_rule: existing.registrationRule ? { ...current.registration_rule, ...existing.registrationRule, allowed_grades: existing.registrationRule.allowed_grades ?? current.registration_rule.allowed_grades } : current.registration_rule,
        rewards: existing.rewards.length ? existing.rewards.map((r: any) => ({ rank_code: r.rank_code, title: r.title, points: Number(r.points ?? 0), emblem_name: r.emblem_name ?? '', certificate_enabled: Boolean(r.certificate_enabled), config: r.config ?? {} })) : current.rewards,
      }));
      setLoading(false);
    })();
    return () => { active = false; };
  }, [id]);

  const updateLevel = (key: string, value: any) => setForm((x) => ({ ...x, level: { ...x.level, [key]: value } }));
  const updateRule = (key: string, value: any) => setForm((x) => ({ ...x, registration_rule: { ...x.registration_rule, [key]: value } }));
  const updateReward = (index: number, key: string, value: any) => setForm((x) => ({ ...x, rewards: x.rewards.map((r, i) => i === index ? { ...r, [key]: value } : r) }));
  const toggleGrade = (list: string[], grade: string) => list.includes(grade) ? list.filter((x) => x !== grade) : [...list, grade];

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!id) return;
    setSaving(true);
    try {
      await saveCompetitionConfig(id, {
        ...form,
        level: { ...form.level, allowed_grades: form.level.allowed_grades },
        registration_rule: { ...form.registration_rule, allowed_grades: form.registration_rule.allowed_grades },
      });
      navigate('/organizer');
    } catch (error: any) {
      alert(error?.message ?? 'Gagal menyimpan konfigurasi lomba.');
    } finally { setSaving(false); }
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center text-slate-500">Memuat konfigurasi…</div>;
  if (!competition) return <div className="p-6"><Card className="p-8 text-center text-slate-500">Kompetisi tidak ditemukan.</Card></div>;

  return <div className="min-h-screen bg-ink-950 p-5 md:p-8">
    <div className="max-w-5xl mx-auto">
      <Link to="/organizer" className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white mb-5"><ArrowLeft size={16}/> Kembali ke Organizer</Link>
      <div className="flex items-start justify-between gap-4 mb-6"><div><p className="text-xs text-moss-400 uppercase tracking-wider">Competition Builder</p><h1 className="font-display text-2xl md:text-3xl font-bold text-white">{competition.title}</h1><p className="text-sm text-slate-500 mt-1">Konfigurasi live ke Supabase</p></div><Badge color="moss">{competition.status}</Badge></div>
      <form onSubmit={submit} className="space-y-5">
        <Card className="p-5"><div className="flex items-center gap-2 mb-4 text-white font-semibold"><Trophy size={18} className="text-moss-400"/> Level & Eligibility</div><div className="grid md:grid-cols-2 gap-4"><Input label="Kode level" value={form.level.code} onChange={(v)=>updateLevel('code',v)}/><Input label="Label level" value={form.level.label} onChange={(v)=>updateLevel('label',v)}/><Input label="Points dasar" type="number" value={String(form.level.points)} onChange={(v)=>updateLevel('points',Number(v||0))}/></div><div className="mt-4"><label className="label">Jenjang yang diizinkan</label><div className="flex flex-wrap gap-2">{grades.map(g=><button type="button" key={g} onClick={()=>updateLevel('allowed_grades',toggleGrade(form.level.allowed_grades,g))} className={`px-3 py-2 rounded-lg border text-sm ${form.level.allowed_grades.includes(g)?'border-moss-500 bg-moss-500/10 text-moss-300':'border-white/10 text-slate-500'}`}>{g.toUpperCase()}</button>)}</div></div></Card>
        <Card className="p-5"><div className="flex items-center gap-2 mb-4 text-white font-semibold"><CalendarDays size={18} className="text-moss-400"/> Timeline</div><div className="grid md:grid-cols-2 gap-4"><Input label="Pendaftaran mulai" type="datetime-local" value={(form.level.registration_starts_at||'').slice(0,16)} onChange={(v)=>updateLevel('registration_starts_at',v)}/><Input label="Pendaftaran berakhir" type="datetime-local" value={(form.level.registration_ends_at||'').slice(0,16)} onChange={(v)=>updateLevel('registration_ends_at',v)}/><Input label="Kompetisi mulai" type="datetime-local" value={(form.level.starts_at||'').slice(0,16)} onChange={(v)=>updateLevel('starts_at',v)}/><Input label="Kompetisi berakhir" type="datetime-local" value={(form.level.ends_at||'').slice(0,16)} onChange={(v)=>updateLevel('ends_at',v)}/><Input label="Pengumuman" type="datetime-local" value={(form.level.announcement_at||'').slice(0,16)} onChange={(v)=>updateLevel('announcement_at',v)}/></div></Card>
        <Card className="p-5"><div className="flex items-center gap-2 mb-4 text-white font-semibold"><Users size={18} className="text-moss-400"/> Registration Rules</div><div className="grid md:grid-cols-2 gap-4"><Input label="Maksimal peserta" type="number" value={form.registration_rule.max_participants == null ? '' : String(form.registration_rule.max_participants)} onChange={(v)=>updateRule('max_participants',v === '' ? null : Number(v))}/><Input label="Biaya Express" type="number" value={String(form.registration_rule.express_cost)} onChange={(v)=>updateRule('express_cost',Number(v||0))}/></div><div className="mt-4 flex flex-wrap gap-2">{grades.map(g=><button type="button" key={g} onClick={()=>updateRule('allowed_grades',toggleGrade(form.registration_rule.allowed_grades,g))} className={`px-3 py-2 rounded-lg border text-sm ${form.registration_rule.allowed_grades.includes(g)?'border-moss-500 bg-moss-500/10 text-moss-300':'border-white/10 text-slate-500'}`}>{g.toUpperCase()}</button>)}</div><div className="grid md:grid-cols-2 gap-3 mt-4"><Toggle label="Twibbon wajib" checked={form.registration_rule.require_twibbon} onChange={(v)=>updateRule('require_twibbon',v)}/><Toggle label="Social proof wajib" checked={form.registration_rule.require_social_proof} onChange={(v)=>updateRule('require_social_proof',v)}/><Toggle label="Express registration" checked={form.registration_rule.express_enabled} onChange={(v)=>updateRule('express_enabled',v)}/><div><label className="label">Mode approval</label><select className="input" value={form.registration_rule.approval_mode} onChange={e=>updateRule('approval_mode',e.target.value)}><option value="MANUAL">Manual</option><option value="AUTO">Otomatis</option></select></div></div></Card>
        <Card className="p-5"><div className="flex items-center gap-2 mb-4 text-white font-semibold"><Award size={18} className="text-moss-400"/> Rewards</div><div className="space-y-3">{form.rewards.map((r,i)=><div key={r.rank_code} className="grid md:grid-cols-4 gap-3 p-3 rounded-xl bg-white/[.03] border border-white/5"><Input label={r.rank_code} value={r.title} onChange={(v)=>updateReward(i,'title',v)}/><Input label="Points" type="number" value={String(r.points)} onChange={(v)=>updateReward(i,'points',Number(v||0))}/><Input label="Emblem" value={r.emblem_name||''} onChange={(v)=>updateReward(i,'emblem_name',v)}/><Toggle label="Sertifikat" checked={r.certificate_enabled} onChange={(v)=>updateReward(i,'certificate_enabled',v)}/></div>)}</div></Card>
        <div className="flex justify-end"><Button type="submit" loading={saving} icon={<Save size={17}/>}>Simpan konfigurasi</Button></div>
      </form>
    </div>
  </div>;
}
function Input({label,value,onChange,type='text'}:{label:string;value:string;onChange:(v:string)=>void;type?:string}){return <div><label className="label">{label}</label><input className="input" type={type} value={value} onChange={e=>onChange(e.target.value)}/></div>}
function Toggle({label,checked,onChange}:{label:string;checked:boolean;onChange:(v:boolean)=>void}){return <label className="flex items-center gap-3 rounded-xl border border-white/10 px-3 py-3 text-sm text-slate-300"><input type="checkbox" checked={checked} onChange={e=>onChange(e.target.checked)}/>{label}</label>}
