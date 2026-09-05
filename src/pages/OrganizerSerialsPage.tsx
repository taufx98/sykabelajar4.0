import { useEffect, useMemo, useState, type ElementType } from 'react';
import { ArrowLeft, Download, KeyRound, Printer, QrCode, RefreshCw, ShieldCheck, Ban } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { toast } from '@/lib/toast';
import { resolveCurrentUserOrganizer, type CurrentOrganizer } from '@/services/organizerAuth.service';
import { getActiveOrganizerEntitlements } from '@/services/organizerEntitlement.service';
import { assignOrganizerSerial, generateOrganizerSerials, listOrganizerSerials, revokeOrganizerSerial, type OrganizerSerial } from '@/services/organizerSerial.service';
import { supabase } from '@/lib/supabase';

type CertificateOption = { id: string; competition_id: string; status: string; serial_number: string | null; created_at: string };

const QR_ENDPOINT = 'https://quickchart.io/qr';

function verificationUrl(payload: string) {
  if (payload.startsWith('http://') || payload.startsWith('https://')) return payload;
  if (payload.startsWith('/')) return new URL(payload, window.location.origin).toString();
  return new URL(`/verify/${encodeURIComponent(payload)}`, window.location.origin).toString();
}

function qrUrl(payload: string) {
  return `${QR_ENDPOINT}?text=${encodeURIComponent(verificationUrl(payload))}&size=180&margin=1`;
}

function statusColor(status: string) {
  return status === 'AVAILABLE' ? 'moss' : 'default';
}

export function OrganizerSerialsPage() {
  const [org, setOrg] = useState<CurrentOrganizer | null>(null);
  const [plan, setPlan] = useState<string | null>(null);
  const [serialLimit, setSerialLimit] = useState(0);
  const [serials, setSerials] = useState<OrganizerSerial[]>([]);
  const [certificates, setCertificates] = useState<CertificateOption[]>([]);
  const [selectedSerial, setSelectedSerial] = useState<OrganizerSerial | null>(null);
  const [certificateId, setCertificateId] = useState('');
  const [quantity, setQuantity] = useState(10);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const counts = useMemo(() => ({
    total: serials.length,
    available: serials.filter((s) => s.status === 'AVAILABLE').length,
    assigned: serials.filter((s) => s.status === 'ASSIGNED').length,
    revoked: serials.filter((s) => s.status === 'REVOKED').length,
  }), [serials]);

  const serialRemaining = Math.max(0, serialLimit - counts.total);

  const load = async () => {
    const current = await resolveCurrentUserOrganizer();
    if (!current) throw new Error('Organisasi tidak ditemukan.');
    setOrg(current);
    const [entitlements, rows] = await Promise.all([
      getActiveOrganizerEntitlements(current.id),
      listOrganizerSerials(current.id),
    ]);
    setPlan(entitlements.planCode);
    setSerialLimit(Number(entitlements.entitlements.find((item) => item.capability === 'certificate_serials')?.limit_value ?? 0));
    setSerials(rows);

    const { data: competitions, error: competitionsError } = await supabase
      .from('competitions')
      .select('id')
      .eq('organizer_id', current.id);
    if (competitionsError) throw competitionsError;
    const competitionIds = (competitions ?? []).map((x) => x.id).filter(Boolean);
    if (!competitionIds.length) {
      setCertificates([]);
      return;
    }
    const { data: certs, error: certificateError } = await supabase
      .from('certificates')
      .select('id,competition_id,status,serial_number,created_at')
      .in('competition_id', competitionIds)
      .order('created_at', { ascending: false })
      .limit(300);
    if (certificateError) throw certificateError;
    setCertificates((certs ?? []) as CertificateOption[]);
  };

  useEffect(() => {
    void load().catch((e: unknown) => toast.error(e instanceof Error ? e.message : 'Gagal memuat QR / Serial.')).finally(() => setLoading(false));
  }, []);

  const generate = async () => {
    if (!org) return;
    if (serialLimit <= 0) {
      toast.error('Paket aktif Anda belum memiliki kuota QR / Serial sertifikat.');
      return;
    }
    if (serialRemaining <= 0) {
      toast.error(`Kuota QR / Serial ${serialLimit.toLocaleString('id-ID')} sudah habis.`);
      return;
    }
    const requested = Math.min(Math.max(quantity, 1), 100, serialRemaining);
    setBusy(true);
    try {
      await generateOrganizerSerials(org.id, requested);
      toast.success(`${requested} serial berhasil dibuat.`);
      await load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Gagal membuat serial.');
    } finally {
      setBusy(false);
    }
  };

  const assign = async () => {
    if (!selectedSerial || !certificateId) return;
    setBusy(true);
    try {
      await assignOrganizerSerial(selectedSerial.id, certificateId);
      toast.success('Serial berhasil dipasangkan ke sertifikat.');
      setSelectedSerial(null);
      setCertificateId('');
      await load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Gagal memasangkan serial.');
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (serial: OrganizerSerial) => {
    if (!confirm(`Revoke serial ${serial.serial_code}? Serial yang direvoke tidak dapat dipakai lagi.`)) return;
    setBusy(true);
    try {
      await revokeOrganizerSerial(serial.id);
      toast.success('Serial berhasil direvoke.');
      if (selectedSerial?.id === serial.id) setSelectedSerial(null);
      await load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Gagal merevoke serial.');
    } finally {
      setBusy(false);
    }
  };

  const print = () => window.print();

  if (loading) return <div className="p-6"><Card className="p-8 text-center text-fg-muted">Memuat QR / Serial…</Card></div>;
  if (!org) return <div className="p-6"><Card className="p-8 text-center text-fg-muted">Organisasi belum ditemukan.</Card></div>;

  const stats: Array<[string, string | number, ElementType]> = [
    ['Plan', plan ?? '—', ShieldCheck],
    ['Kuota Plan', serialLimit, QrCode],
    ['Terpakai', counts.total, KeyRound],
    ['Sisa Kuota', serialRemaining, ShieldCheck],
  ];

  return (
    <div className="min-h-screen surface-bg text-fg-secondary p-5 md:p-8 print:p-0">
      <div className="max-w-7xl mx-auto print:max-w-none">
        <div className="no-print flex items-center justify-between gap-3 mb-5">
          <Link to="/organizer/plan" className="inline-flex items-center gap-2 text-xs text-fg-muted hover:text-fg"><ArrowLeft size={14}/> Kembali ke Plan</Link>
          <Button onClick={print} icon={<Printer size={15}/>}>Cetak QR</Button>
        </div>
        <div className="mb-6">
          <p className="text-xs text-accent font-semibold">PENYELENGGARA · QR / SERIAL</p>
          <h1 className="text-2xl font-bold text-fg">QR & Serial Sertifikat</h1>
          <p className="text-sm text-fg-muted mt-1">Generate serial resmi, pasangkan ke sertifikat, dan revoke serial yang tidak boleh dipakai lagi.</p>
        </div>
        <div className="grid sm:grid-cols-4 gap-3 mb-5">
          {stats.map(([label, value, Icon]) => <Card key={label} className="p-4"><div className="flex items-center gap-3"><Icon size={18} className="text-accent"/><div><p className="text-xs text-fg-muted">{label}</p><p className="text-lg font-bold text-fg">{typeof value === 'number' ? value.toLocaleString('id-ID') : value}</p></div></div></Card>)}
        </div>
        <Card className="p-5 mb-5 no-print">
          <div className="flex items-start gap-3 mb-4"><QrCode className="text-accent mt-0.5" size={20}/><div><h2 className="font-bold text-fg">Generate serial</h2><p className="text-sm text-fg-muted mt-1">Kuota plan aktif: <span className="font-semibold text-fg">{serialLimit.toLocaleString('id-ID')}</span> · terpakai: <span className="font-semibold text-fg">{counts.total.toLocaleString('id-ID')}</span> · sisa: <span className="font-semibold text-fg">{serialRemaining.toLocaleString('id-ID')}</span>.</p></div></div>
          <div className="flex flex-col md:flex-row gap-3">
            <input className="input md:w-40" type="number" min={1} max={Math.min(100, Math.max(serialRemaining, 1))} value={quantity} onChange={(e) => setQuantity(Number(e.target.value) || 1)} disabled={serialRemaining <= 0} />
            <Button loading={busy} disabled={serialRemaining <= 0} onClick={() => void generate()} icon={<RefreshCw size={15}/>}>Generate Serial</Button>
            <div className="text-xs text-fg-muted flex items-center">Stok dibuat: {counts.available.toLocaleString('id-ID')} · Terpakai di sertifikat: {counts.assigned.toLocaleString('id-ID')} · Direvoke: {counts.revoked.toLocaleString('id-ID')}</div>
          </div>
        </Card>
        {selectedSerial && <Card className="p-5 mb-5 no-print border-accent/20">
          <div className="flex items-start justify-between gap-3 mb-4"><div><p className="text-xs text-accent font-semibold">ASSIGN SERIAL</p><h2 className="font-bold text-fg">{selectedSerial.serial_code}</h2><p className="text-xs text-fg-muted mt-1">Pilih sertifikat organizer yang belum memiliki serial.</p></div><button className="text-xs text-fg-muted" onClick={() => setSelectedSerial(null)}>Tutup</button></div>
          <div className="flex flex-col md:flex-row gap-3">
            <select className="input flex-1" value={certificateId} onChange={(e) => setCertificateId(e.target.value)}>
              <option value="">Pilih sertifikat</option>
              {certificates.filter((c) => !c.serial_number).map((c) => <option key={c.id} value={c.id}>{c.id.slice(0, 8)} · {c.status} · {new Date(c.created_at).toLocaleDateString('id-ID')}</option>)}
            </select>
            <Button loading={busy} disabled={!certificateId} onClick={() => void assign()}>Pasangkan</Button>
          </div>
        </Card>}
        <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {serials.map((serial) => (
            <Card key={serial.id} className="p-4 serial-card break-inside-avoid">
              <div className="flex items-center justify-between gap-2 mb-3">
                <Badge color={statusColor(serial.status)}>{serial.status}</Badge>
                <span className="text-[11px] text-fg-muted">{new Date(serial.created_at).toLocaleDateString('id-ID')}</span>
              </div>
              <div className="bg-white rounded-xl p-3 flex justify-center mb-3">
                <img src={qrUrl(serial.qr_payload)} width={180} height={180} alt={`QR ${serial.serial_code}`} loading="lazy" />
              </div>
              <p className="font-mono text-sm font-bold text-fg break-all">{serial.serial_code}</p>
              <p className="text-[11px] text-fg-muted mt-1 truncate">{serial.certificate_id ? `Certificate: ${serial.certificate_id}` : 'Belum dipasangkan ke sertifikat'}</p>
              <div className="flex gap-2 mt-3 no-print">
                {serial.status === 'AVAILABLE' && <Button className="flex-1" disabled={busy} onClick={() => setSelectedSerial(serial)}>Pasangkan</Button>}
                <a className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-xs border border-surface-border hover:bg-surface-elevated/50" href={qrUrl(serial.qr_payload)} target="_blank" rel="noreferrer"><Download size={14}/> QR</a>
                {serial.status !== 'REVOKED' && <button className="inline-flex items-center justify-center px-3 py-2 rounded-xl text-red-400 border border-red-500/20 hover:bg-red-500/10" disabled={busy} onClick={() => void revoke(serial)} title="Revoke"><Ban size={14}/></button>}
              </div>
            </Card>
          ))}
        </div>
        {!serials.length && <Card className="p-10 text-center text-fg-muted">Belum ada serial yang dibuat. Kuota plan aktif Anda adalah <span className="font-semibold text-fg">{serialLimit.toLocaleString('id-ID')}</span> dan sisa kuota saat ini <span className="font-semibold text-fg">{serialRemaining.toLocaleString('id-ID')}</span>.</Card>}
      </div>
      <style>{`@media print { .no-print { display:none !important; } body { background:#fff !important; } .serial-card { break-inside: avoid; } }`}</style>
    </div>
  );
}
