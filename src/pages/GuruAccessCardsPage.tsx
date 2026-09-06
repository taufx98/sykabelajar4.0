import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Printer, ShieldCheck, UserRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { toast } from '@/lib/toast';
import { listTeacherCollectiveParticipants, type CollectiveParticipant } from '@/services/collectiveParticipant.service';

function loginUrl(participantCode: string) {
  const base = `${window.location.origin}/peserta-kolektif/login`;
  return `${base}?code=${encodeURIComponent(participantCode)}`;
}

function qrUrl(value: string) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=180x180&margin=8&data=${encodeURIComponent(value)}`;
}

export function GuruAccessCardsPage() {
  const [rows, setRows] = useState<CollectiveParticipant[]>([]);
  const [loading, setLoading] = useState(true);
  const origin = useMemo(() => window.location.origin, []);

  useEffect(() => {
    void listTeacherCollectiveParticipants()
      .then(setRows)
      .catch((e: any) => toast.error(e?.message || 'Gagal memuat kartu akses.'))
      .finally(() => setLoading(false));
  }, []);

  return <div className="min-h-screen surface-bg p-5 md:p-8"><div className="max-w-6xl mx-auto">
    <div className="no-print flex items-center justify-between gap-3 mb-6">
      <Link to="/guru" className="inline-flex items-center gap-2 text-xs text-fg-muted hover:text-fg"><ArrowLeft size={14}/> Kembali ke Guru</Link>
      <Button size="sm" onClick={() => window.print()} icon={<Printer size={14}/>}>Cetak kartu</Button>
    </div>
    <div className="no-print mb-6"><p className="text-xs text-accent font-semibold tracking-wider">KARTU AKSES</p><h1 className="text-2xl font-bold text-fg">Kartu Peserta Kolektif</h1><p className="text-sm text-fg-muted mt-1">QR membuka halaman login dengan kode peserta otomatis. Password tidak dicetak.</p></div>
    {loading ? <Card className="p-8 text-center text-fg-muted no-print">Memuat kartu…</Card> : !rows.length ? <Card className="p-8 text-center text-fg-muted no-print">Belum ada peserta kolektif.</Card> : <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {rows.map(p => {
        const url = loginUrl(p.participant_code);
        return <div key={p.participant_id} className="access-card rounded-2xl border border-border bg-surface p-5 break-inside-avoid">
          <div className="flex items-start justify-between gap-3">
            <div className="w-12 h-12 rounded-xl overflow-hidden bg-accent/10 flex items-center justify-center text-accent">{p.photo_url ? <img src={p.photo_url} alt="" className="w-full h-full object-cover"/> : <UserRound size={22}/>}</div>
            <div className="text-center"><img src={qrUrl(url)} alt="QR login peserta" className="w-20 h-20 object-contain border border-border rounded-lg bg-white p-1"/><p className="text-[8px] text-fg-muted mt-1">Scan untuk login</p></div>
          </div>
          <p className="font-bold text-fg mt-4">{p.full_name}</p>
          <p className="text-xs text-fg-muted mt-1">{p.class_name || 'Kelas —'} · {p.grade || 'Jenjang —'}</p>
          <p className="text-xs text-fg-muted mt-3">{p.competition_title}</p>
          <div className="mt-4 rounded-xl border border-border p-3"><p className="text-[10px] text-fg-muted uppercase tracking-wider">Kode Peserta</p><p className="font-mono font-bold text-lg text-accent mt-1">{p.participant_code}</p></div>
          <p className="text-[10px] text-fg-muted mt-4 break-all">Login: {origin}/peserta-kolektif/login</p>
        </div>;
      })}
    </div>}
    <style>{`@media print{body{background:white!important}.no-print{display:none!important}.access-card{background:white!important;color:#111!important;border:1px solid #aaa!important;page-break-inside:avoid}.access-card *{color:#111!important}}`}</style>
  </div></div>;
}
