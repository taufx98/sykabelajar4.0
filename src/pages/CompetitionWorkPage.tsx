import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AlertTriangle, Loader2, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useApp } from '@/store/AppContext';
import { getCompetitionBySlug } from '@/services/competition.service';
import { startLinearExamAttempt, type LinearExamState } from '@/services/linearExam.service';
import { LinearExamRoom } from '@/components/exam/LinearExamRoom';

export function CompetitionWorkPage() {
  const { slug } = useParams();
  const { isAuthenticated } = useApp();
  const [competition, setCompetition] = useState<any>(null);
  const [initialState, setInitialState] = useState<LinearExamState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    async function load() {
      if (!slug || !isAuthenticated) { setLoading(false); return; }
      try {
        setLoading(true);
        setError('');
        const found = await getCompetitionBySlug(slug);
        if (!found) throw new Error('Lomba tidak ditemukan.');
        const exam = await startLinearExamAttempt(found.id);
        if (!active) return;
        setCompetition(found);
        setInitialState(exam);
      } catch (cause: unknown) {
        if (active) setError(cause instanceof Error ? cause.message : 'Gagal membuka ruang ujian.');
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [slug, isAuthenticated]);

  if (!isAuthenticated) return <div className="p-8 text-center text-fg-muted">Silakan login terlebih dahulu untuk mengerjakan lomba.</div>;
  if (loading) return <div className="min-h-[60vh] flex items-center justify-center text-fg-muted"><Loader2 className="mr-2 animate-spin" size={20} /> Memuat ruang ujian aman…</div>;
  if (error) return <div className="min-h-[65vh] surface-bg px-4 py-10"><Card className="mx-auto max-w-xl p-6 text-center"><AlertTriangle className="mx-auto text-amber-500" size={28}/><h1 className="mt-3 text-lg font-bold text-fg">Ujian belum dapat dibuka</h1><p className="mt-2 whitespace-pre-wrap text-sm text-fg-muted">{error}</p><p className="mt-3 text-xs text-fg-muted">Jika kamu sedang memiliki attempt lama yang belum selesai, jangan membuat attempt baru. Hubungi penyelenggara agar statusnya diperiksa.</p><Link to={slug ? `/lomba/${slug}` : '/home'}><Button className="mt-5">Kembali ke detail lomba</Button></Link></Card></div>;
  if (!competition || !initialState) return <div className="p-8 text-center text-fg-muted">Data ujian tidak tersedia.</div>;

  return <LinearExamRoom
    mode="INDIVIDUAL"
    title={competition.title}
    initialState={initialState}
    finishHref={`/lomba/${competition.slug}`}
  />;
}
