import { useEffect, useMemo, useState } from 'react';
import { Award, BookOpen, LogOut, MessageCircle, PlayCircle, Trophy, UserRound } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { toast } from '@/lib/toast';
import { collectiveAccessToken, getCollectiveParticipantResult, type CollectiveResult } from '@/services/collectiveParticipant.service';

export function CollectiveParticipantPortalPage() {
  const navigate = useNavigate();
  const participant = useMemo(() => { try { return JSON.parse(sessionStorage.getItem('syka_collective_participant') || 'null') as Record<string, unknown> | null; } catch { return null; } }, []);
  const [result, setResult] = useState<CollectiveResult | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!participant || !collectiveAccessToken()) { navigate('/peserta-kolektif/login', { replace: true }); return; }
    let active = true;
    void getCollectiveParticipantResult().then((data) => { if (active) setResult(data); }).catch((e: any) => { if (active) { toast.error(e?.message || 'Sesi peserta tidak valid.'); sessionStorage.removeItem('syka_collective_access_token'); sessionStorage.removeItem('syka_collective_participant'); navigate('/peserta-kolektif/login', { replace: true }); } }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [navigate, participant]);
  if (!participant) return null;
  const logout = () => { sessionStorage.removeItem('syka_collective_access_token'); sessionStorage.removeItem('syka_collective_participant'); navigate('/peserta-kolektif/login', { replace: true }); };
  const competitionTitle = String(result?.competition_title || participant.competition_title || 'Kompetisi');
  const competitionStatus = String(participant.status || 'ACTIVE');
  return <div className="min-h-screen surface-bg text-fg-secondary p-5 md:p-8"><div className="max-w-5xl mx-auto space-y-5">
    <div className="flex items-center justify-between gap-4"><div><p className="text-xs text-accent font-semibold tracking-wider">PORTAL PESERTA KOLEKTIF</p><h1 className="text-2xl md:text-3xl font-bold text-fg">Halo, {String(participant.full_name || 'Peserta')}</h1><p className="text-sm text-fg-muted mt-1">Kode <span className="font-mono text-fg">{String(participant.participant_code || '')}</span></p></div><Button variant="outline" size="sm" onClick={logout} icon={<LogOut size={14}/>}>Keluar</Button></div>
    <Card className="p-5"><div className="flex flex-col md:flex-row md:items-center gap-4"><div className="w-16 h-16 rounded-2xl overflow-hidden bg-accent/10 flex items-center justify-center text-accent">{participant.photo_url ? <img src={String(participant.photo_url)} alt="" className="w-full h-full object-cover"/> : <UserRound size={28}/>}</div><div className="flex-1"><p className="text-lg font-semibold text-fg">{String(participant.full_name || 'Peserta')}</p><p className="text-sm text-fg-muted">{String(participant.class_name || 'Kelas —')} · {String(participant.grade || 'Jenjang —')}</p></div><Badge color="moss">{competitionStatus}</Badge></div></Card>
    {loading ? <Card className="p-8 text-center text-fg-muted">Memuat status lomba…</Card> : <Card className="p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-xs text-accent font-semibold">LOMBA TERDAFTAR</p><h2 className="text-lg font-semibold text-fg mt-1">{competitionTitle}</h2><p className="text-sm text-fg-muted mt-1">{result?.published ? 'Hasil sudah dipublikasikan.' : result?.has_result ? `Status attempt: ${result.status || 'diproses'}.` : 'Belum ada attempt. Ikuti lomba saat sesi dibuka.'}</p></div>{result?.has_result && result?.published ? <Badge color="moss">HASIL TERBIT</Badge> : null}</div>{String(participant.status) === 'ACTIVE' && !result?.has_result && <Button className="mt-4" onClick={()=>navigate('/peserta-kolektif/kerja')} icon={<PlayCircle size={15}/>}>Kerjakan Lomba</Button>}{result?.published && <div className="grid sm:grid-cols-2 gap-3 mt-4"><div className="rounded-xl border border-border p-4"><span className="text-xs text-fg-muted">Skor</span><p className="text-2xl font-bold text-fg mt-1">{Number(result.score ?? 0)}</p></div><div className="rounded-xl border border-border p-4"><span className="text-xs text-fg-muted">Peringkat</span><p className="text-2xl font-bold text-fg mt-1">#{Number(result.rank ?? 0)}</p></div></div>}</Card>}
    <div className="grid md:grid-cols-3 gap-4"><Card className="p-5"><Trophy size={19} className="text-accent"/><p className="font-semibold text-fg mt-4">Peringkat</p><p className="text-sm text-fg-muted mt-1">{result?.published ? `Peringkat kamu #${Number(result.rank ?? 0)}.` : 'Peringkat tampil setelah hasil dipublikasikan.'}</p></Card><Card className="p-5"><Award size={19} className="text-accent"/><p className="font-semibold text-fg mt-4">Piagam</p><p className="text-sm text-fg-muted mt-1">Piagam tersedia setelah proses penerbitan selesai.</p></Card><Card className="p-5"><MessageCircle size={19} className="text-accent"/><p className="font-semibold text-fg mt-4">Chat Group</p><p className="text-sm text-fg-muted mt-1">Ruang chat event akan tersedia sesuai konfigurasi penyelenggara.</p></Card></div>
    <Card className="p-5"><div className="flex items-center gap-2 text-accent"><BookOpen size={17}/><p className="font-semibold text-fg">Profil & akses</p></div><div className="grid sm:grid-cols-2 gap-4 mt-4 text-sm"><div><span className="text-fg-muted">Kode peserta</span><p className="font-mono text-fg mt-1">{String(participant.participant_code || '—')}</p></div><div><span className="text-fg-muted">Akses sesi</span><p className="text-fg mt-1">Aktif selama sesi keamanan masih berlaku.</p></div></div></Card>
  </div></div>;
}
