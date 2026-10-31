import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ClipboardCheck, Loader2, Save, Sparkles } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { listOrganizerCompetitions, gradeEssaySimilarity } from '@/services/organizer.service';
import { resolveCurrentUserOrganizer } from '@/services/organizerAuth.service';
import { getAttemptForGrading, listGradableAttempts, saveManualGrade, finalizeManualAttempt } from '@/services/manualGrading.service';

type GradingItem = {
  id: string;
  score: number;
  automatic_score: number | null;
  feedback: string | null;
  grader_id: string | null;
  question?: {
    id: string;
    prompt: string;
    type: string;
    points: number;
    config?: Record<string, any>;
  };
  answer?: any;
};

type GradingDetail = {
  attempt: {
    id: string;
    score: number;
    status: string;
  };
  items: GradingItem[];
};

export function OrganizerGradingPage() {
  const [attempts, setAttempts] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState<GradingDetail | null>(null);
  const [scores, setScores] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [autoGrading, setAutoGrading] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setMessage('');
    try {
      const org = await resolveCurrentUserOrganizer();
      if (!org) throw new Error('Organisasi tidak ditemukan.');
      const competitions = await listOrganizerCompetitions(org.id);
      const rows = await listGradableAttempts(competitions.map((competition: any) => competition.id));
      setAttempts(rows);
      setSelectedId((current) => (
        current && rows.some((row: any) => String(row.id) === current)
          ? current
          : rows[0]?.id ? String(rows[0].id) : ''
      ));
    } catch (cause: any) {
      setMessage(cause?.message ?? 'Gagal memuat attempt.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const hydrate = useCallback((value: GradingDetail) => {
    setDetail(value);
    const nextScores: Record<string, string> = {};
    const nextFeedback: Record<string, string> = {};
    value.items.forEach((item) => {
      nextScores[item.id] = item.score == null ? '' : String(item.score);
      nextFeedback[item.id] = item.feedback ?? '';
    });
    setScores(nextScores);
    setFeedback(nextFeedback);
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let active = true;
    void getAttemptForGrading(selectedId)
      .then((value) => { if (active) hydrate(value as GradingDetail); })
      .catch((cause: any) => { if (active) setMessage(cause?.message ?? 'Gagal memuat grading.'); });
    return () => { active = false; };
  }, [selectedId, hydrate]);

  const reloadDetail = useCallback(async () => {
    if (!selectedId) return;
    hydrate(await getAttemptForGrading(selectedId) as GradingDetail);
  }, [selectedId, hydrate]);

  const total = useMemo(() => {
    const baseScore = Number(detail?.attempt?.score ?? 0);
    return (detail?.items ?? []).reduce((sum, item) => {
      const currentScore = Number(scores[item.id] ?? item.score ?? 0);
      if (item.automatic_score != null) {
        return sum + currentScore - Number(item.automatic_score);
      }
      return sum + currentScore;
    }, baseScore);
  }, [detail, scores]);

  const canFinalize = useMemo(() => {
    if (!detail) return false;
    if (detail.items.length === 0) return ['SUBMITTED', 'GRADING'].includes(detail.attempt.status);
    return detail.items.every((item) => {
      const scoreIsSaved = String(scores[item.id] ?? '') === String(item.score ?? 0);
      const feedbackIsSaved = (feedback[item.id] ?? '') === (item.feedback ?? '');
      const manualItemIsGraded = item.automatic_score != null || Boolean(item.grader_id);
      return scoreIsSaved && feedbackIsSaved && manualItemIsGraded;
    });
  }, [detail, scores, feedback]);

  const saveItem = async (item: GradingItem) => {
    const maximum = Number(item.question?.points ?? 0);
    const score = Number(scores[item.id]);
    if (!Number.isFinite(score) || score < 0 || score > maximum) {
      setMessage('Nilai untuk soal ini harus 0 sampai ' + maximum + '.');
      return;
    }
    setSaving(item.id);
    try {
      await saveManualGrade(item.id, score, feedback[item.id]);
      setMessage('Nilai dan feedback tersimpan.');
      await reloadDetail();
    } catch (cause: any) {
      setMessage(cause?.message ?? 'Gagal menyimpan nilai.');
    } finally {
      setSaving(null);
    }
  };

  const autoGradeEssay = async (item: GradingItem) => {
    if (!selectedId || !item.question?.id) return;
    setAutoGrading(item.id);
    setMessage('Menghitung AI Similarity Grade…');
    try {
      const score = await gradeEssaySimilarity(selectedId, item.question.id);
      setMessage('AI Similarity Grade: ' + score.toFixed(2) + '%.');
      await reloadDetail();
    } catch (cause: any) {
      const errorMessage = String(cause?.message ?? '');
      setMessage(errorMessage.includes('PREMIUM_REQUIRED')
        ? 'AI Similarity Grade hanya tersedia untuk Paket Premium.'
        : errorMessage || 'Auto grade gagal.');
    } finally {
      setAutoGrading(null);
    }
  };

  const finalize = async () => {
    if (!detail || !canFinalize || busy) {
      setMessage('Simpan seluruh nilai manual sebelum finalisasi.');
      return;
    }
    setBusy(true);
    try {
      await finalizeManualAttempt(detail.attempt.id);
      setMessage('Attempt berhasil difinalisasi.');
      await load();
    } catch (cause: any) {
      setMessage(cause?.message ?? 'Gagal finalisasi.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen surface-bg p-5 text-fg-secondary md:p-8">
      <div className="mx-auto max-w-6xl space-y-5">
        <div>
          <p className="text-xs font-semibold text-accent">PENYELENGGARA · GRADING</p>
          <h1 className="font-display text-2xl font-bold text-fg md:text-3xl">Penilaian</h1>
          <p className="mt-1 text-sm text-fg-muted">Nilai manual dan AI Similarity mengikuti entitlement paket penyelenggara.</p>
        </div>

        {message && <Card className="border border-amber-500/20 p-3 text-sm text-fg-secondary">{message}</Card>}

        <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
          <Card className="p-4">
            <div className="mb-3 flex items-center gap-2">
              <ClipboardCheck size={17} className="text-accent"/>
              <h2 className="font-semibold text-fg">Attempt</h2>
            </div>
            {loading ? (
              <div className="py-8 text-center text-fg-muted"><Loader2 className="mx-auto mb-2 animate-spin"/>Memuat…</div>
            ) : attempts.length === 0 ? (
              <p className="text-sm text-fg-muted">Belum ada attempt yang menunggu penilaian.</p>
            ) : (
              <div className="space-y-2">
                {attempts.map((attempt) => (
                  <button
                    key={attempt.id}
                    onClick={() => setSelectedId(attempt.id)}
                    className={'w-full rounded-xl border p-3 text-left ' + (selectedId === attempt.id ? 'border-accent/40 bg-accent/10' : 'border-border bg-surface-elevated/20')}
                  >
                    <p className="truncate text-sm font-medium text-fg">{String(attempt.id).slice(0, 12)}</p>
                    <p className="text-xs text-fg-muted">{attempt.status} · {attempt.attempt_number ? 'Attempt ' + attempt.attempt_number : ''}</p>
                  </button>
                ))}
              </div>
            )}
          </Card>

          <Card className="p-5">
            {!detail ? (
              <div className="py-16 text-center text-fg-muted">Pilih attempt untuk mulai menilai.</div>
            ) : (
              <>
                <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-fg">Attempt {detail.attempt.id.slice(0, 12)}</p>
                    <p className="mt-1 text-xs text-fg-muted">{detail.items.length} item · perkiraan skor akhir {total.toLocaleString('id-ID')}</p>
                    <p className="mt-1 text-[10px] text-fg-muted">Skor otomatis tetap dihitung; finalisasi akan menggabungkan nilai manual di server.</p>
                  </div>
                  <Button loading={busy} disabled={!canFinalize} onClick={() => void finalize()} icon={<CheckCircle2 size={15}/>}>Finalisasi</Button>
                </div>

                <div className="space-y-4">
                  {detail.items.map((item, index) => (
                    <Card key={item.id} className="bg-surface-elevated/20 p-4">
                      <div className="flex items-start gap-3">
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-xs font-bold text-accent">{index + 1}</div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="whitespace-pre-wrap text-sm font-medium text-fg">{item.question?.prompt || 'Soal'}</p>
                            {['essay', 'long_answer'].includes(String(item.question?.type ?? '').toLowerCase().replace('-', '_')) && item.question?.config?.ai_assessment?.enabled && <Badge color="moss"><Sparkles size={10}/> AI</Badge>}
                            {item.automatic_score != null && <Badge color="default">Skor otomatis</Badge>}
                          </div>
                          <p className="mt-1 text-xs text-fg-muted">{item.question?.type} · maksimal {item.question?.points ?? 0} poin</p>
                          <div className="mt-3 break-words whitespace-pre-wrap rounded-xl border border-border bg-surface-card p-3 text-sm text-fg-secondary">
                            {item.answer?.value ?? (item.answer ? JSON.stringify(item.answer) : 'Belum ada jawaban')}
                          </div>

                          {['essay', 'long_answer'].includes(String(item.question?.type ?? '').toLowerCase().replace('-', '_')) && item.question?.config?.ai_assessment?.enabled && (
                            <div className="mt-3 flex flex-wrap items-center gap-2">
                              <Button size="sm" variant="outline" loading={autoGrading === item.id} disabled={autoGrading !== null} onClick={() => void autoGradeEssay(item)} icon={<Sparkles size={14}/>}>Cek Otomatis</Button>
                              <span className="text-[11px] text-fg-muted">Similarity dibulatkan 2 desimal.</span>
                            </div>
                          )}

                          <div className="mt-3 grid gap-2 md:grid-cols-[160px_1fr_auto]">
                            <input
                              className="input"
                              type="number"
                              min="0"
                              max={Number(item.question?.points ?? 0)}
                              step="0.01"
                              placeholder="Nilai"
                              value={scores[item.id] ?? ''}
                              onChange={(event) => setScores((current) => ({ ...current, [item.id]: event.target.value }))}
                            />
                            <input
                              className="input"
                              placeholder="Feedback untuk peserta"
                              value={feedback[item.id] ?? ''}
                              onChange={(event) => setFeedback((current) => ({ ...current, [item.id]: event.target.value }))}
                            />
                            <Button size="sm" loading={saving === item.id} onClick={() => void saveItem(item)} icon={<Save size={14}/>}>Simpan</Button>
                          </div>
                          {item.automatic_score == null && !item.grader_id && (
                            <p className="mt-2 text-[10px] text-amber-500">Nilai manual ini belum disimpan oleh penilai.</p>
                          )}
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              </>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
