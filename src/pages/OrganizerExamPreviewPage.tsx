import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { supabase } from '@/lib/supabase';
import { getLinearExamState, type LinearExamState } from '@/services/linearExam.service';
import { LinearExamRoom } from '@/components/exam/LinearExamRoom';

export function OrganizerExamPreviewPage() {
  const { id = '', attemptId = '' } = useParams();
  const [title, setTitle] = useState('');
  const [state, setState] = useState<LinearExamState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        if (!id || !attemptId) throw new Error('ID simulasi tidak lengkap.');
        const [{ data: competition, error: competitionError }, exam] = await Promise.all([
          supabase.from('competitions').select('id,title,status').eq('id', id).maybeSingle(),
          getLinearExamState(attemptId),
        ]);
        if (competitionError) throw competitionError;
        if (!competition || String(competition.status) !== 'DRAFT') {
          throw new Error('Simulasi hanya dapat dibuka saat lomba masih Draft.');
        }
        if (!active) return;
        setTitle(String(competition.title ?? 'Simulasi Ujian'));
        setState(exam);
      } catch (cause: unknown) {
        if (active) setError(cause instanceof Error ? cause.message : 'Gagal membuka simulasi.');
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [id, attemptId]);

  if (loading) return <div className="min-h-screen flex items-center justify-center text-fg-muted"><Loader2 className="mr-2 animate-spin" size={20}/> Membuka ruang ujian…</div>;
  if (error || !state) return <div className="min-h-[65vh] surface-bg px-4 py-10"><Card className="mx-auto max-w-xl p-6 text-center"><AlertTriangle className="mx-auto text-amber-500" size={28}/><h1 className="mt-3 text-lg font-bold text-fg">Simulasi belum dapat dibuka</h1><p className="mt-2 whitespace-pre-wrap text-sm text-fg-muted">{error || 'Data simulasi tidak ditemukan.'}</p><Link to={`/organizer/competition/${id}/config`}><Button className="mt-5">Kembali ke konfigurasi</Button></Link></Card></div>;

  return <LinearExamRoom
    mode="PREVIEW"
    title={title}
    initialState={state}
    finishHref={`/organizer/competition/${id}/simulation/${attemptId}/report`}
  />;
}
