import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { toast } from '@/lib/toast';
import { collectiveAccessToken } from '@/services/collectiveParticipant.service';
import { startCollectiveLinearExamAttempt, type LinearExamState } from '@/services/linearExam.service';
import { LinearExamRoom } from '@/components/exam/LinearExamRoom';

const readParticipant = () => {
  try { return JSON.parse(sessionStorage.getItem('syka_collective_participant') || 'null') as Record<string, unknown> | null; }
  catch { return null; }
};

export function CollectiveParticipantWorkPage() {
  const navigate = useNavigate();
  const participant = useMemo(readParticipant, []);
  const competitionId = String(participant?.competition_id || '');
  const accessToken = collectiveAccessToken();
  const [initialState, setInitialState] = useState<LinearExamState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!participant || !accessToken || !competitionId) {
      navigate('/peserta-kolektif/login', { replace: true });
      return;
    }
    let active = true;
    (async () => {
      try {
        const exam = await startCollectiveLinearExamAttempt(competitionId, accessToken);
        if (active) setInitialState(exam);
      } catch (cause: unknown) {
        const message = cause instanceof Error ? cause.message : 'Gagal membuka ruang ujian.';
        if (active) setError(message);
        toast.error(message);
        if (message.includes('COLLECTIVE_SESSION_INVALID')) {
          sessionStorage.removeItem('syka_collective_access_token');
          sessionStorage.removeItem('syka_collective_participant');
          navigate('/peserta-kolektif/login', { replace: true });
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [accessToken, competitionId, navigate, participant]);

  if (loading) return <div className="min-h-screen surface-bg flex items-center justify-center text-fg-muted"><Loader2 className="mr-2 animate-spin" size={20}/> Membuka ruang ujian…</div>;
  if (error || !initialState || !participant) return <div className="min-h-screen surface-bg p-5"><Card className="mx-auto max-w-xl p-8 text-center"><AlertTriangle className="mx-auto text-amber-500" size={28}/><p className="mt-3 font-semibold text-fg">Ruang ujian belum tersedia</p><p className="mt-2 whitespace-pre-wrap text-sm text-fg-muted">{error || 'Sesi peserta tidak ditemukan.'}</p><Button className="mt-4" onClick={() => navigate('/peserta-kolektif')}>Kembali ke portal</Button></Card></div>;

  return <LinearExamRoom
    mode="COLLECTIVE"
    title={String(participant.competition_title || 'Kompetisi')}
    participantName={String(participant.full_name || 'Peserta')}
    accessToken={accessToken}
    initialState={initialState}
    finishHref="/peserta-kolektif"
  />;
}
