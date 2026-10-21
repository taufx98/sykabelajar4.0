import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useApp } from '@/store/AppContext';
import { getCompetitionBySlug } from '@/services/competition.service';
import { SequentialExamRunner } from '@/components/exam/SequentialExamRunner';

export function CompetitionWorkPage() {
  const { slug = '' } = useParams();
  const { isAuthenticated } = useApp();
  const [competition, setCompetition] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    if (!slug || !isAuthenticated) {
      setLoading(false);
      return () => { active = false; };
    }
    (async () => {
      try {
        setLoading(true);
        setError('');
        const row = await getCompetitionBySlug(slug);
        if (!row) throw new Error('Lomba tidak ditemukan.');
        if (active) setCompetition(row);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'Gagal memuat lomba.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [slug, isAuthenticated]);

  if (!isAuthenticated) {
    return <div className="max-w-xl mx-auto p-6"><Card className="p-6 text-center"><p className="text-fg">Silakan masuk untuk mengikuti ujian.</p><Link to="/login"><Button className="mt-4">Masuk</Button></Link></Card></div>;
  }
  if (loading) return <div className="min-h-[60vh] flex items-center justify-center text-fg-muted"><Loader2 className="animate-spin mr-2" size={20}/>Memuat ruang ujian…</div>;
  if (error || !competition) return <div className="max-w-xl mx-auto p-5"><Card className="p-6"><div className="flex items-start gap-3"><AlertCircle className="text-red-400 mt-1" size={20}/><div><p className="font-semibold text-fg">Ruang ujian belum tersedia</p><p className="text-sm text-fg-muted mt-2">{error || 'Data lomba tidak ditemukan.'}</p><Link to="/home"><Button variant="outline" className="mt-4">Ke beranda</Button></Link></div></div></Card></div>;

  return <SequentialExamRunner mode="individual" competitionId={competition.id} competitionTitle={competition.title}/>;
}
