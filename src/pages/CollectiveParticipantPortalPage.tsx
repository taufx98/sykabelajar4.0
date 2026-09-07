import { useCallback, useEffect, useState } from 'react';
import { Award, BookOpen, CheckCircle2, KeyRound, LogOut, MessageCircle, PlayCircle, ShieldCheck, Trophy, UserRound } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { toast } from '@/lib/toast';
import { collectiveAccessToken, collectivePortalToken, getCollectiveParticipantCertificate, getCollectiveParticipantResult, listCollectivePortalCompetitions, openCollectiveCompetitionSession, revokeCollectiveAccessSession, revokeCollectivePortalSession, type CollectiveCertificate, type CollectivePortalCompetition, type CollectiveResult } from '@/services/collectiveParticipant.service';

function readParticipant(): Record<string, unknown> | null {
  try {
    return JSON.parse(sessionStorage.getItem('syka_collective_participant') || 'null') as Record<string, unknown> | null;
  } catch {
    return null;
  }
}

export function CollectiveParticipantPortalPage() {
  const navigate = useNavigate();
  const [portalToken] = useState(collectivePortalToken());
  const [participant, setParticipant] = useState<Record<string, unknown> | null>(readParticipant());
  const [events, setEvents] = useState<CollectivePortalCompetition[]>([]);
  const [selected, setSelected] = useState<CollectivePortalCompetition | null>(null);
  const [result, setResult] = useState<CollectiveResult | null>(null);
  const [certificate, setCertificate] = useState<CollectiveCertificate | null>(null);
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);

  const logout = useCallback(async () => {
    try {
      const token = collectiveAccessToken();
      if (token) await revokeCollectiveAccessSession(token);
      if (portalToken) await revokeCollectivePortalSession(portalToken);
    } catch {
      // Session cleanup below remains authoritative for this browser.
    }
    sessionStorage.removeItem('syka_collective_access_token');
    sessionStorage.removeItem('syka_collective_participant');
    sessionStorage.removeItem('syka_collective_portal_token');
    sessionStorage.removeItem('syka_collective_pending_code');
    navigate('/peserta-kolektif/login', { replace: true });
  }, [navigate, portalToken]);

  const loadEvents = useCallback(async () => {
    if (!portalToken) {
      navigate('/peserta-kolektif/login', { replace: true });
      return;
    }
    try {
      const rows = await listCollectivePortalCompetitions(portalToken);
      setEvents(rows);
      const pending = sessionStorage.getItem('syka_collective_pending_code') || '';
      if (pending) {
        const hit = rows.find((row) => row.participant_code.toUpperCase() === pending.toUpperCase());
        if (hit) {
          setSelected(hit);
          setCode(hit.participant_code);
        }
        sessionStorage.removeItem('syka_collective_pending_code');
      }
      if (!rows.length) toast.error('Belum ada lomba yang terhubung ke portal ini.');
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Sesi portal tidak valid.');
      await logout();
    } finally {
      setLoading(false);
    }
  }, [logout, navigate, portalToken]);

  const loadEventData = useCallback(async () => {
    if (!collectiveAccessToken()) return;
    try {
      const [res, cert] = await Promise.all([
        getCollectiveParticipantResult(),
        getCollectiveParticipantCertificate().catch(() => null),
      ]);
      setResult(res);
      setCertificate(cert);
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Gagal memuat data lomba.');
    }
  }, []);

  useEffect(() => {
    if (!portalToken) {
      navigate('/peserta-kolektif/login', { replace: true });
      return;
    }
    void loadEvents();
  }, [loadEvents, navigate, portalToken]);

  const openEvent = async () => {
    if (!selected) return toast.error('Pilih lomba terlebih dahulu.');
    if (!code.trim()) return toast.error('Kode peserta untuk lomba ini wajib diisi.');
    setOpening(true);
    try {
      const old = collectiveAccessToken();
      if (old) await revokeCollectiveAccessSession(old);
      const next = await openCollectiveCompetitionSession(selected.competition_id, code, portalToken);
      if (next?.ok !== true) {
        toast.error(next?.reason === 'INVALID_PARTICIPANT_CODE' ? 'Kode peserta tidak sesuai dengan lomba yang dipilih.' : String(next?.reason || 'Gagal membuka lomba.'));
        return;
      }
      sessionStorage.setItem('syka_collective_access_token', String(next.access_token || ''));
      sessionStorage.setItem('syka_collective_participant', JSON.stringify(next));
      setParticipant(next);
      setResult(null);
      setCertificate(null);
      await loadEventData();
      setCode('');
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Gagal membuka lomba.');
    } finally {
      setOpening(false);
    }
  };

  if (!portalToken) return null;
  const selectedTitle = selected?.competition_title || String(participant?.competition_title || '');
  const canWork = !!participant && String(participant.status || 'ACTIVE') === 'ACTIVE' && !result?.has_result;

  return <div className="min-h-screen surface-bg text-fg-secondary p-5 md:p-8"><div className="max-w-6xl mx-auto space-y-5">
    <div className="flex items-center justify-between gap-4"><div><p className="text-xs text-accent font-semibold tracking-wider">PORTAL PESERTA KOLEKTIF</p><h1 className="text-2xl md:text-3xl font-bold text-fg">Portal Saya</h1><p className="text-sm text-fg-muted mt-1">Satu portal untuk seluruh lomba yang terhubung ke peserta.</p></div><Button variant="outline" size="sm" onClick={() => void logout()} icon={<LogOut size={14} />}>Keluar</Button></div>
    <Card className="p-5"><div className="flex items-center gap-3"><div className="w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center text-accent"><ShieldCheck size={22} /></div><div><p className="font-semibold text-fg">Akses portal aktif</p><p className="text-xs text-fg-muted">Pilih lomba lalu masukkan participant code khusus event tersebut.</p></div></div></Card>
    <div className="grid lg:grid-cols-[1.05fr_.95fr] gap-5"><Card className="p-5"><div className="flex items-center justify-between gap-3"><div><p className="text-xs text-accent font-semibold">LOMBA TERDAFTAR</p><h2 className="text-lg font-semibold text-fg mt-1">{events.length} event</h2></div><BookOpen size={20} className="text-accent" /></div>{loading ? <p className="text-sm text-fg-muted mt-5">Memuat daftar lomba…</p> : events.length ? <div className="mt-4 space-y-2">{events.map((event) => <button key={event.participant_id} type="button" onClick={() => { setSelected(event); setCode(event.participant_code); }} className={`w-full text-left rounded-xl border p-4 transition ${selected?.participant_id === event.participant_id ? 'border-accent bg-accent/10' : 'border-border hover:bg-white/[.03]'}`}><div className="flex items-start justify-between gap-3"><div><p className="font-semibold text-fg">{event.competition_title}</p><p className="text-xs text-fg-muted mt-1">{event.starts_at ? new Date(event.starts_at).toLocaleDateString('id-ID') : 'Jadwal belum ditentukan'}</p></div>{selected?.participant_id === event.participant_id ? <CheckCircle2 size={18} className="text-accent" /> : <Badge color="moss">TERDAFTAR</Badge>}</div></button>)}</div> : <div className="mt-5 rounded-xl border border-dashed border-border p-5 text-center"><p className="text-sm text-fg-muted">Belum ada lomba aktif pada portal ini.</p></div>}</Card>
    <Card className="p-5"><div className="flex items-center gap-2"><KeyRound size={18} className="text-accent" /><p className="font-semibold text-fg">Buka akses lomba</p></div>{selected ? <><div className="mt-4 rounded-xl border border-border p-4"><p className="text-xs text-fg-muted">Event dipilih</p><p className="font-semibold text-fg mt-1">{selectedTitle}</p><p className="text-xs text-fg-muted mt-2">Masukkan participant code dari kartu akses event ini.</p></div><label className="block mt-4"><span className="text-xs text-fg-muted">Participant code</span><input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="CP-XXXXXXXXXX" className="mt-1 w-full rounded-xl border border-border bg-transparent px-3 py-3 text-sm font-mono" onKeyDown={(event) => { if (event.key === 'Enter') void openEvent(); }} /></label><Button className="w-full mt-4" loading={opening} onClick={() => void openEvent()}>Masuk ke lomba</Button></> : <div className="mt-5 rounded-xl border border-dashed border-border p-6 text-center"><p className="text-sm text-fg-muted">Pilih salah satu lomba untuk membuka sesi kompetisi.</p></div>}</Card></div>
    {participant ? <><Card className="p-5"><div className="flex flex-col md:flex-row md:items-center gap-4"><div className="w-16 h-16 rounded-2xl overflow-hidden bg-accent/10 flex items-center justify-center text-accent">{participant.photo_url ? <img src={String(participant.photo_url)} alt="" className="w-full h-full object-cover" /> : <UserRound size={28} />}</div><div className="flex-1"><p className="text-lg font-semibold text-fg">{String(participant.full_name || 'Peserta')}</p><p className="text-sm text-fg-muted">{String(participant.class_name || 'Kelas —')} · {String(participant.grade || 'Jenjang —')}</p><p className="text-xs text-fg-muted mt-1">Event aktif: {String(participant.competition_title || selectedTitle || 'Kompetisi')}</p></div><Badge color="moss">AKSES KOMPETISI AKTIF</Badge></div></Card>
    <Card className="p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-xs text-accent font-semibold">CHECKPOINT LOMBA</p><h2 className="text-lg font-semibold text-fg mt-1">{String(participant.competition_title || selectedTitle || 'Kompetisi')}</h2><p className="text-sm text-fg-muted mt-1">{result?.published ? 'Hasil sudah dipublikasikan.' : result?.has_result ? `Status attempt: ${result.status || 'diproses'}.` : 'Belum ada attempt. Ikuti lomba saat sesi dibuka.'}</p></div>{result?.published ? <Badge color="moss">HASIL TERBIT</Badge> : null}</div>{canWork ? <Button className="mt-4" onClick={() => navigate('/peserta-kolektif/kerja')} icon={<PlayCircle size={15} />}>Kerjakan Lomba</Button> : null}{result?.published ? <div className="grid sm:grid-cols-2 gap-3 mt-4"><div className="rounded-xl border border-border p-4"><span className="text-xs text-fg-muted">Skor</span><p className="text-2xl font-bold text-fg mt-1">{Number(result.score ?? 0)}</p></div><div className="rounded-xl border border-border p-4"><span className="text-xs text-fg-muted">Peringkat</span><p className="text-2xl font-bold text-fg mt-1">#{Number(result.rank ?? 0)}</p></div></div> : null}</Card>
    <div className="grid md:grid-cols-2 gap-4"><Card className="p-5"><div className="flex items-center gap-2"><Trophy size={18} className="text-accent" /><p className="font-semibold text-fg">Peringkat</p></div><p className="text-sm text-fg-muted mt-2">{result?.published ? `Peringkat kamu #${Number(result.rank ?? 0)}.` : 'Peringkat tampil setelah hasil dipublikasikan.'}</p></Card><Card className="p-5"><div className="flex items-center gap-2"><Award size={18} className="text-accent" /><p className="font-semibold text-fg">Piagam</p></div>{certificate?.has_certificate ? <div className="mt-2"><p className="text-sm text-fg">{certificate.status}</p><p className="font-mono text-xs text-fg-muted mt-1">{certificate.serial_number}</p>{certificate.verification_code ? <a className="text-xs text-accent hover:underline" href={`/verify/${certificate.verification_code}`}>Verifikasi sertifikat</a> : null}</div> : <p className="text-sm text-fg-muted mt-2">Piagam tersedia setelah proses penerbitan selesai.</p>}</Card></div>
    <Card className="p-5"><div className="flex items-center gap-2"><MessageCircle size={18} className="text-accent" /><p className="font-semibold text-fg">Pesan</p></div><p className="text-sm text-fg-muted mt-2">Semua Group Chat tersedia di halaman Pesan. Peserta kolektif hanya dapat menggunakan group yang memang menjadi aksesnya.</p><Link to="/pesan"><Button className="mt-4" icon={<MessageCircle size={15} />}>Buka Pesan</Button></Link></Card>
    </> : null}
  </div></div>;
}
