import { useMemo, useState } from 'react';
import { Calendar, Eye, Filter, Printer, Share2, ShieldCheck, Download, CloudUpload, Loader2, QrCode, Search, Award as AwardIcon, Medal, BadgeCheck } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { useApp } from '@/store/AppContext';
import { formatShortDate } from '@/lib/utils';
import { persistCertificateAssetByCode } from '@/services/certificate.service';
import type { Award, AwardType } from '@/types';

function esc(value: string) { return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]!)); }
function certificateSvg(award: Award, userName: string) {
  const title = esc(award.title), name = esc(userName || 'Pengguna'), subtitle = esc(award.subtitle), date = esc(formatShortDate(award.date)), code = esc(award.certificateId || 'Belum tersedia');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1100" viewBox="0 0 1600 1100"><defs><linearGradient id="bg" x1="0" x2="1"><stop offset="0"/><stop offset="1" stop-color="#0b1220"/></linearGradient></defs><rect width="1600" height="1100" fill="url(#bg)"/><rect x="35" y="35" width="1530" height="1030" rx="28" fill="none" stroke="#34d399" stroke-width="5"/><text x="800" y="180" text-anchor="middle" fill="#34d399" font-family="Arial,sans-serif" font-size="32" letter-spacing="8">SYKABELAJAR.ID</text><text x="800" y="320" text-anchor="middle" fill="#ffffff" font-family="Arial,sans-serif" font-size="68" font-weight="700">SERTIFIKAT PENGHARGAAN</text><text x="800" y="420" text-anchor="middle" fill="#94a3b8" font-family="Arial,sans-serif" font-size="26">Diberikan kepada</text><text x="800" y="520" text-anchor="middle" fill="#ffffff" font-family="Arial,sans-serif" font-size="58" font-weight="700">${name}</text><text x="800" y="600" text-anchor="middle" fill="#cbd5e1" font-family="Arial,sans-serif" font-size="30">${title}</text><text x="800" y="655" text-anchor="middle" fill="#34d399" font-family="Arial,sans-serif" font-size="34" font-weight="700">${subtitle}</text><text x="580" y="820" text-anchor="middle" fill="#64748b" font-family="Arial,sans-serif" font-size="20">Tanggal</text><text x="580" y="860" text-anchor="middle" fill="#ffffff" font-family="Arial,sans-serif" font-size="25">${date}</text><text x="1020" y="820" text-anchor="middle" fill="#64748b" font-family="Arial,sans-serif" font-size="20">Kode Verifikasi</text><text x="1020" y="860" text-anchor="middle" fill="#34d399" font-family="monospace" font-size="25">${code}</text></svg>`;
}
function downloadSvg(award: Award, userName: string) { const blob = new Blob([certificateSvg(award, userName)], { type: 'image/svg+xml;charset=utf-8' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `certificate-${award.id}.svg`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
function printCertificate(award: Award, userName: string) { const svg = certificateSvg(award, userName); const w = window.open('', '_blank', 'noopener,noreferrer'); if (!w) return; w.document.write(`<html><head><title>${esc(award.title)}</title><style>html,body{margin:0;background:#fff}body{display:flex;align-items:center;justify-content:center;min-height:100vh}svg{width:100%;height:auto}</style></head><body>${svg}</body></html>`); w.document.close(); w.onload = () => { w.focus(); w.print(); }; }

export function AwardsPage() {
  const { user, isGuest, awards, toast } = useApp();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<'all' | AwardType>('all');
  const [sort, setSort] = useState<'date' | 'type'>('date');
  const [viewAward, setViewAward] = useState<Award | null>(null);
  const [shareLink, setShareLink] = useState('');
  const [persisting, setPersisting] = useState(false);
  const [verifyCode, setVerifyCode] = useState('');
  const [verifyResult, setVerifyResult] = useState<any>(null);
  const [verifying, setVerifying] = useState(false);
  const [showVerify, setShowVerify] = useState(false);

  const visibleAwards = useMemo(() => {
    const rows = filter === 'all' ? [...awards] : awards.filter(a => a.type === filter);
    return rows.sort((a, b) => sort === 'type' ? a.type.localeCompare(b.type) : new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [awards, filter, sort]);

  const share = (award: Award) => {
    if (!award.certificateId) { toast('Award ini belum memiliki kode sertifikat/verifikasi.', 'info'); return; }
    setShareLink(`${window.location.origin}/#/verify/${encodeURIComponent(award.certificateId)}`);
  };

  const persist = async (award: Award) => {
    if (!award.certificateId) { toast('Kode sertifikat belum tersedia.', 'error'); return; }
    setPersisting(true);
    try {
      const blob = new Blob([certificateSvg(award, user?.displayName || 'Pengguna')], { type: 'image/svg+xml' });
      const file = new File([blob], `certificate-${award.id}.svg`, { type: 'image/svg+xml' });
      await persistCertificateAssetByCode(award.certificateId, file, 1);
      toast('Sertifikat disimpan sebagai asset permanen.', 'success');
    } catch (e: any) { toast(e?.message ?? 'Asset sertifikat gagal disimpan.', 'error'); }
    finally { setPersisting(false); }
  };

  const doVerify = async () => {
    if (!verifyCode.trim()) return;
    setVerifying(true);
    setVerifyResult(null);
    try {
      const { getPublicCertificate } = await import('@/services/certificate.service');
      const result = await getPublicCertificate(verifyCode.trim());
      setVerifyResult(result);
      if (!result) toast('Sertifikat tidak ditemukan.', 'error');
    } catch { setVerifyResult(null); toast('Gagal memverifikasi.', 'error'); }
    finally { setVerifying(false); }
  };

  // Guest: show verification only
  if (isGuest) {
    return (
      <div>
        <div className="sticky top-0 z-20 glass border-b surface-border px-4 py-3">
          <div className="flex items-center gap-2">
            <ShieldCheck size={16} className="text-accent" />
            <h2 className="font-display font-bold text-lg text-fg">Cek Sertifikat</h2>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">Verifikasi keaslian sertifikat sykabelajar.id</p>
        </div>
        <div className="p-4 space-y-4 max-w-lg mx-auto min-h-[calc(100vh-8rem)] flex flex-col justify-center">
          <Card className="p-6 text-center">
            <div className="w-16 h-16 rounded-full bg-moss-500/10 flex items-center justify-center mx-auto mb-4">
              <QrCode size={32} className="text-accent" />
            </div>
            <h3 className="font-display font-bold text-fg text-lg mb-2">Verifikasi Sertifikat</h3>
            <p className="text-sm text-slate-400 mb-6">
              Masukkan kode serial number atau nomor sertifikat untuk memeriksa keaslian.
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={verifyCode}
                onChange={(e) => setVerifyCode(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void doVerify()}
                placeholder="Masukkan kode serial number..."
                className="input flex-1 text-sm"
              />
              <Button onClick={() => void doVerify()} loading={verifying} icon={<Search size={15} />}>
                Cek
              </Button>
            </div>
          </Card>

          {verifyResult && (
            <Card className={`p-5 ${verifyResult.status === 'APPROVED' ? 'border-moss-500/20' : 'border-red-500/20'}`}>
              <div className="flex items-center gap-3 mb-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${verifyResult.status === 'APPROVED' ? 'bg-moss-500/10' : 'bg-red-500/10'}`}>
                  <ShieldCheck size={20} className={verifyResult.status === 'APPROVED' ? 'text-accent' : 'text-red-400'} />
                </div>
                <div>
                  <p className="font-semibold text-fg">{verifyResult.status === 'APPROVED' ? 'Terverifikasi ASLI' : 'Tidak Valid'}</p>
                  <p className="text-xs text-slate-500">{verifyResult.achievement_title}</p>
                </div>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-slate-500">Nama</span><span className="text-fg">{verifyResult.public_name}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Kompetisi</span><span className="text-fg">{verifyResult.competition_title}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Kode</span><span className="text-accent font-mono text-xs">{verifyResult.verification_code}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Tanggal</span><span className="text-fg">{verifyResult.issued_at ? formatShortDate(verifyResult.issued_at) : '—'}</span></div>
              </div>
            </Card>
          )}

          <Link to="/login">
            <Button fullWidth variant="outline" icon={<ShieldCheck size={15} />}>
              Masuk untuk melihat piagam saya
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  // Logged-in user: awards + verification tab
  return (
    <div>
      <div className="sticky top-0 z-20 glass border-b surface-border px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck size={16} className="text-accent" />
            <h2 className="font-display font-bold text-lg text-fg">Piagam Saya</h2>
          </div>
          <Button size="sm" variant="outline" icon={<QrCode size={14} />} onClick={() => setShowVerify(!showVerify)}>
            Cek Sertifikat
          </Button>
        </div>
        <p className="text-xs text-slate-500 mt-0.5">Data pribadi dari backend.</p>
      </div>

      <div className="p-4 space-y-4">
        {/* Inline verification panel */}
        {showVerify && (
          <Card className="p-4">
            <p className="text-xs text-slate-400 mb-2">Masukkan kode serial number untuk cek keaslian sertifikat.</p>
            <div className="flex gap-2">
              <input type="text" value={verifyCode} onChange={(e) => setVerifyCode(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void doVerify()}
                placeholder="Kode serial number..." className="input flex-1 text-sm" />
              <Button size="sm" onClick={() => void doVerify()} loading={verifying} icon={<Search size={14} />}>Cek</Button>
            </div>
            {verifyResult && (
              <div className={`mt-3 p-3 rounded-lg ${verifyResult.status === 'APPROVED' ? 'bg-moss-500/5 border border-moss-500/10' : 'bg-red-500/5 border border-red-500/10'}`}>
                <p className={`text-sm font-semibold ${verifyResult.status === 'APPROVED' ? 'text-accent' : 'text-red-300'}`}>
                  {verifyResult.status === 'APPROVED' ? '✓ Terverifikasi ASLI' : '✗ Tidak Valid'}
                </p>
                <p className="text-xs text-slate-400 mt-1">{verifyResult.public_name} — {verifyResult.achievement_title}</p>
              </div>
            )}
          </Card>
        )}

        {/* Filter tabs */}
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
          {(['all', 'certificate', 'medal', 'badge'] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap ${filter === f ? 'bg-moss-500/15 text-accent' : 'surface-elevated text-slate-400'}`}>
              {f === 'all' ? 'Semua' : f === 'certificate' ? 'Sertifikat' : f === 'medal' ? 'Medali' : 'Badge'}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-1">
            <Filter size={14} className="text-slate-500" />
            <select value={sort} onChange={(e) => setSort(e.target.value as 'date' | 'type')}
              className="surface-elevated text-xs text-fg-secondary rounded-lg px-2 py-1.5">
              <option value="date">Terbaru</option>
              <option value="type">Tipe</option>
            </select>
          </div>
        </div>

        {/* Awards grid */}
        <div className="grid sm:grid-cols-2 gap-3">
          {visibleAwards.map((award) => (
            <Card key={award.id} className="overflow-hidden">
              <div className="h-28 bg-gradient-to-br from-surface-card to-surface flex items-center justify-center">
                {award.type === 'certificate' ? <ShieldCheck size={28} className="text-accent" /> :
                 award.type === 'medal' ? <Medal size={28} className="text-amber-400" /> :
                 <BadgeCheck size={28} className="text-sky-400" />}
              </div>
              <div className="p-3">
                <p className="text-sm font-semibold text-fg truncate">{award.title}</p>
                <p className="text-xs text-slate-500 truncate">{award.subtitle}</p>
                <p className="text-[10px] text-slate-600 mt-2 flex items-center gap-1"><Calendar size={10} />{formatShortDate(award.date)}</p>
                <div className="flex gap-1.5 mt-3">
                  <Button size="sm" variant="outline" className="flex-1" onClick={() => setViewAward(award)} icon={<Eye size={12} />}>Lihat</Button>
                  <Button size="sm" variant="ghost" onClick={() => share(award)} icon={<Share2 size={12} />}>Bagikan</Button>
                  {(award.type === 'medal' || award.type === 'certificate') && (
                    <Button size="sm" variant="ghost" onClick={() => navigate('/orders', { state: { prefill: { category: award.type === 'medal' ? 'medali' : 'sertifikat', itemName: award.title } } })} icon={<Printer size={12} />}>Cetak</Button>
                  )}
                </div>
              </div>
            </Card>
          ))}
          {!visibleAwards.length && <Card className="p-8 text-center text-sm text-slate-500 col-span-full">Belum ada piagam pada akun ini.</Card>}
        </div>
      </div>

      {/* View modal */}
      {viewAward && (
        <Modal open onClose={() => setViewAward(null)} title={viewAward.title} size="xl">
          <div className="space-y-4">
            <div className="rounded-xl overflow-hidden border border-moss-500/20 surface-card-bg">
              <div dangerouslySetInnerHTML={{ __html: certificateSvg(viewAward, user?.displayName || 'Pengguna') }} />
            </div>
            <div className="grid sm:grid-cols-4 gap-2">
              <Button variant="outline" onClick={() => downloadSvg(viewAward, user?.displayName || 'Pengguna')} icon={<Download size={14} />}>Download SVG</Button>
              <Button variant="outline" onClick={() => printCertificate(viewAward, user?.displayName || 'Pengguna')} icon={<Printer size={14} />}>Print / PDF</Button>
              <Button variant="outline" loading={persisting} onClick={() => void persist(viewAward)} icon={persisting ? <Loader2 size={14} /> : <CloudUpload size={14} />}>Simpan Asset</Button>
              <Button onClick={() => share(viewAward)} icon={<Share2 size={14} />}>Bagikan</Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Share modal */}
      {shareLink && (
        <Modal open onClose={() => setShareLink('')} title="Link Verifikasi">
          <div className="space-y-4">
            <div className="p-3 rounded-xl surface-elevated text-xs text-accent font-mono break-all">{shareLink}</div>
            <Button fullWidth onClick={() => { void navigator.clipboard?.writeText(shareLink); toast('Link verifikasi disalin.', 'success'); setShareLink(''); }}>Salin Link</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
