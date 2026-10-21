import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { SequentialExamRunner } from '@/components/exam/SequentialExamRunner';
import { collectiveAccessToken } from '@/services/collectiveParticipant.service';

function readParticipant() {
  try {
    return JSON.parse(sessionStorage.getItem('syka_collective_participant') || 'null') as Record<string, unknown> | null;
  } catch {
    return null;
  }
}

export function CollectiveParticipantWorkPage() {
  const navigate = useNavigate();
  const participant = useMemo(readParticipant, []);
  const accessToken = collectiveAccessToken();
  const competitionId = String(participant?.competition_id || '');
  const title = String(participant?.competition_title || 'Kompetisi');
  const name = String(participant?.full_name || 'Peserta');

  if (!participant || !accessToken || !competitionId) {
    return <div className="min-h-screen surface-bg p-5"><Card className="max-w-xl mx-auto p-8 text-center"><p className="font-semibold text-fg">Sesi peserta tidak tersedia.</p><p className="text-sm text-fg-muted mt-2">Masuk kembali ke portal peserta untuk memulai sesi yang sah.</p><Button className="mt-4" onClick={() => navigate('/peserta-kolektif/login', { replace: true })}>Masuk peserta</Button></Card></div>;
  }

  return <SequentialExamRunner mode="collective" competitionId={competitionId} competitionTitle={title} participantLabel={name} onFinished={() => navigate('/peserta-kolektif', { replace: true })}/>;
}
