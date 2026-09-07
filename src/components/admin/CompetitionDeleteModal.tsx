import { AlertTriangle, CheckCircle2, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

export type CompetitionDeleteBlockers = {
  registrations: number;
  collective_registrations: number;
  attempts: number;
  collective_certificates: number;
};

type Props = {
  title: string;
  blockers: CompetitionDeleteBlockers | null;
  loading: boolean;
  deleting: boolean;
  error?: string | null;
  onClose: () => void;
  onConfirm: () => void;
};

export function CompetitionDeleteModal({ title, blockers, loading, deleting, error, onClose, onConfirm }: Props) {
  const items = blockers ? [
    ['Registrasi peserta', blockers.registrations],
    ['Registrasi kolektif', blockers.collective_registrations],
    ['Percobaan pengerjaan', blockers.attempts],
    ['Sertifikat kolektif', blockers.collective_certificates],
  ].filter(([, count]) => Number(count) > 0) : [];
  const hasBlockers = items.length > 0;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="competition-delete-title">
      <Card className="w-full max-w-lg p-0 overflow-hidden shadow-2xl border surface-border">
        <div className="flex items-start justify-between gap-4 p-5 border-b surface-border">
          <div className="flex items-start gap-3 min-w-0">
            <div className={`w-11 h-11 shrink-0 rounded-xl flex items-center justify-center ${hasBlockers ? 'bg-amber-500/10 text-amber-400' : 'bg-red-500/10 text-red-400'}`}>
              <AlertTriangle size={20} />
            </div>
            <div className="min-w-0">
              <h3 id="competition-delete-title" className="font-semibold text-fg">{hasBlockers ? 'Lomba belum bisa dihapus' : 'Hapus lomba'}</h3>
              <p className="text-xs text-slate-500 mt-1 break-words">{title}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={deleting} className="p-2 rounded-lg text-slate-400 hover:text-fg hover:bg-white/5" aria-label="Tutup"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-slate-400"><Loader2 size={17} className="animate-spin" /> Memeriksa data yang masih terkait...</div>
          ) : error ? (
            <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-300">{error}</div>
          ) : hasBlockers ? (
            <>
              <p className="text-sm text-slate-300">Penghapusan normal ditolak karena lomba masih memiliki data yang bergantung padanya:</p>
              <div className="grid gap-2">{items.map(([label, count]) => <div key={label} className="flex items-center justify-between rounded-xl border surface-border surface-card-bg px-3 py-2.5"><span className="text-sm text-fg-secondary">{label}</span><span className="text-sm font-semibold text-fg">{count}</span></div>)}</div>
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-200"><p className="font-semibold mb-1">Hapus paksa?</p><p className="text-amber-100/80">Sistem akan mengarsipkan lomba, membersihkan data terkait yang menghalangi penghapusan, lalu menghapus lomba secara permanen. Tindakan ini tidak dapat dibatalkan.</p></div>
            </>
          ) : (
            <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-200">Tidak ada blocker. Lomba dapat dihapus secara normal.</div>
          )}
        </div>
        <div className="flex justify-end gap-2 p-5 border-t surface-border">
          <Button variant="ghost" onClick={onClose} disabled={deleting}>Batal</Button>
          {!loading && !error && <Button variant="danger" onClick={onConfirm} disabled={deleting} icon={deleting ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}>{deleting ? 'Menghapus...' : hasBlockers ? 'Ya, Hapus Paksa' : 'Ya, Hapus'}</Button>}
        </div>
      </Card>
    </div>
  );
}
