import { useCallback, useEffect, useMemo, useState } from 'react';
import { Award, BookOpen, LogOut, MessageCircle, PlayCircle, Send, Trophy, UserRound } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { toast } from '@/lib/toast';
import {
  collectiveAccessToken,
  getCollectiveChatMessages,
  getCollectiveParticipantCertificate,
  getCollectiveParticipantResult,
  revokeCollectiveAccessSession,
  sendCollectiveParticipantChatMessage,
  type CollectiveCertificate,
  type CollectiveChatMessage,
  type CollectiveResult,
} from '@/services/collectiveParticipant.service';

function readParticipant(): Record<string, unknown> | null {
  try {
    return JSON.parse(sessionStorage.getItem('syka_collective_participant') || 'null') as Record<string, unknown> | null;
  } catch {
    return null;
  }
}

export function CollectiveParticipantPortalPage() {
  const navigate = useNavigate();
  const participant = useMemo(() => readParticipant(), []);
  const competitionId = String(participant?.competition_id || '');
  const [result, setResult] = useState<CollectiveResult | null>(null);
  const [certificate, setCertificate] = useState<CollectiveCertificate | null>(null);
  const [chat, setChat] = useState<CollectiveChatMessage[]>([]);
  const [chatBody, setChatBody] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  const clearSessionAndRedirect = useCallback(async () => {
    const token = collectiveAccessToken();
    if (token) {
      try {
        await revokeCollectiveAccessSession(token);
      } catch {
        // Local cleanup still prevents further browser use of the token.
      }
    }
    sessionStorage.removeItem('syka_collective_access_token');
    sessionStorage.removeItem('syka_collective_participant');
    navigate('/peserta-kolektif/login', { replace: true });
  }, [navigate]);

  const loadChat = useCallback(async () => {
    if (!competitionId || !collectiveAccessToken()) return;
    try {
      const messages = await getCollectiveChatMessages(competitionId);
      setChat(messages);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Gagal memuat chat event.';
      toast.error(message);
    }
  }, [competitionId]);

  useEffect(() => {
    if (!participant || !collectiveAccessToken() || !competitionId) {
      void clearSessionAndRedirect();
      return;
    }

    let active = true;
    const load = async () => {
      try {
        const [participantResult, participantCertificate] = await Promise.all([
          getCollectiveParticipantResult(),
          getCollectiveParticipantCertificate().catch(() => null),
        ]);
        const messages = await getCollectiveChatMessages(competitionId);
        if (!active) return;
        setResult(participantResult);
        setCertificate(participantCertificate);
        setChat(messages);
      } catch (error: unknown) {
        if (!active) return;
        const message = error instanceof Error ? error.message : 'Sesi peserta tidak valid.';
        toast.error(message);
        void clearSessionAndRedirect();
      } finally {
        if (active) setLoading(false);
      }
    };

    void load();
    const timer = window.setInterval(() => void loadChat(), 15000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [clearSessionAndRedirect, competitionId, loadChat, participant]);

  if (!participant) return null;

  const logout = () => void clearSessionAndRedirect();
  const competitionTitle = String(result?.competition_title || participant.competition_title || 'Kompetisi');
  const send = async () => {
    const body = chatBody.trim();
    if (!body) return;
    setSending(true);
    try {
      await sendCollectiveParticipantChatMessage(body);
      setChatBody('');
      await loadChat();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Pesan gagal dikirim.';
      toast.error(message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="min-h-screen surface-bg text-fg-secondary p-5 md:p-8">
      <div className="max-w-5xl mx-auto space-y-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs text-accent font-semibold tracking-wider">PORTAL PESERTA KOLEKTIF</p>
            <h1 className="text-2xl md:text-3xl font-bold text-fg">Halo, {String(participant.full_name || 'Peserta')}</h1>
            <p className="text-sm text-fg-muted mt-1">Kode <span className="font-mono text-fg">{String(participant.participant_code || '')}</span></p>
          </div>
          <Button variant="outline" size="sm" onClick={logout} icon={<LogOut size={14} />}>Keluar</Button>
        </div>

        <Card className="p-5">
          <div className="flex flex-col md:flex-row md:items-center gap-4">
            <div className="w-16 h-16 rounded-2xl overflow-hidden bg-accent/10 flex items-center justify-center text-accent">
              {participant.photo_url ? <img src={String(participant.photo_url)} alt="" className="w-full h-full object-cover" /> : <UserRound size={28} />}
            </div>
            <div className="flex-1">
              <p className="text-lg font-semibold text-fg">{String(participant.full_name || 'Peserta')}</p>
              <p className="text-sm text-fg-muted">{String(participant.class_name || 'Kelas —')} · {String(participant.grade || 'Jenjang —')}</p>
            </div>
            <Badge color="moss">AKSES AKTIF</Badge>
          </div>
        </Card>

        {loading ? (
          <Card className="p-8 text-center text-fg-muted">Memuat status lomba…</Card>
        ) : (
          <Card className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs text-accent font-semibold">LOMBA TERDAFTAR</p>
                <h2 className="text-lg font-semibold text-fg mt-1">{competitionTitle}</h2>
                <p className="text-sm text-fg-muted mt-1">
                  {result?.published
                    ? 'Hasil sudah dipublikasikan.'
                    : result?.has_result
                      ? `Status attempt: ${result.status || 'diproses'}.`
                      : 'Belum ada attempt. Ikuti lomba saat sesi dibuka.'}
                </p>
              </div>
              {result?.has_result && result.published ? <Badge color="moss">HASIL TERBIT</Badge> : null}
            </div>

            {String(participant.status) === 'ACTIVE' && !result?.has_result ? (
              <Button className="mt-4" onClick={() => navigate('/peserta-kolektif/kerja')} icon={<PlayCircle size={15} />}>Kerjakan Lomba</Button>
            ) : null}

            {result?.published ? (
              <div className="grid sm:grid-cols-2 gap-3 mt-4">
                <div className="rounded-xl border border-border p-4"><span className="text-xs text-fg-muted">Skor</span><p className="text-2xl font-bold text-fg mt-1">{Number(result.score ?? 0)}</p></div>
                <div className="rounded-xl border border-border p-4"><span className="text-xs text-fg-muted">Peringkat</span><p className="text-2xl font-bold text-fg mt-1">#{Number(result.rank ?? 0)}</p></div>
              </div>
            ) : null}
          </Card>
        )}

        <div className="grid md:grid-cols-2 gap-4">
          <Card className="p-5">
            <div className="flex items-center gap-2"><Trophy size={18} className="text-accent" /><p className="font-semibold text-fg">Peringkat</p></div>
            <p className="text-sm text-fg-muted mt-2">{result?.published ? `Peringkat kamu #${Number(result.rank ?? 0)}.` : 'Peringkat tampil setelah hasil dipublikasikan.'}</p>
          </Card>
          <Card className="p-5">
            <div className="flex items-center gap-2"><Award size={18} className="text-accent" /><p className="font-semibold text-fg">Piagam</p></div>
            {certificate?.has_certificate ? (
              <div className="mt-2"><p className="text-sm text-fg">{certificate.status}</p><p className="font-mono text-xs text-fg-muted mt-1">{certificate.serial_number}</p>{certificate.verification_code ? <a className="text-xs text-accent hover:underline" href={`/verify/${certificate.verification_code}`}>Verifikasi sertifikat</a> : null}</div>
            ) : <p className="text-sm text-fg-muted mt-2">Piagam tersedia setelah proses penerbitan selesai.</p>}
          </Card>
        </div>

        <Card className="p-5">
          <div className="flex items-center gap-2"><MessageCircle size={18} className="text-accent" /><p className="font-semibold text-fg">Chat Group Event</p></div>
          <div className="mt-4 space-y-2 max-h-72 overflow-auto rounded-xl border border-border p-3">
            {chat.length ? chat.slice().reverse().map((message) => (
              <div key={message.id} className="rounded-lg bg-white/[.03] p-3">
                <div className="flex items-center justify-between gap-3"><p className="text-xs font-semibold text-fg">{message.sender_name}</p><span className="text-[10px] text-fg-muted">{new Date(message.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</span></div>
                <p className="text-sm text-fg-secondary mt-1 whitespace-pre-wrap">{message.body}</p>
              </div>
            )) : <p className="text-sm text-fg-muted">Belum ada pesan.</p>}
          </div>
          <div className="flex gap-2 mt-3">
            <input value={chatBody} onChange={(event) => setChatBody(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void send(); }} maxLength={2000} placeholder="Tulis pesan ke grup event…" className="flex-1 rounded-xl border border-border bg-transparent px-3 py-2 text-sm" />
            <Button onClick={() => void send()} loading={sending} icon={<Send size={15} />}>Kirim</Button>
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex items-center gap-2 text-accent"><BookOpen size={17} /><p className="font-semibold text-fg">Profil & akses</p></div>
          <div className="grid sm:grid-cols-2 gap-4 mt-4 text-sm">
            <div><span className="text-fg-muted">Kode peserta</span><p className="font-mono text-fg mt-1">{String(participant.participant_code || '—')}</p></div>
            <div><span className="text-fg-muted">Akses sesi</span><p className="text-fg mt-1">Aktif selama sesi keamanan masih berlaku.</p></div>
          </div>
        </Card>
      </div>
    </div>
  );
}
