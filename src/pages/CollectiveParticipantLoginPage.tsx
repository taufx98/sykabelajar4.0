import { useState } from 'react';
import { ArrowLeft, KeyRound, ShieldCheck } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { verifyCollectiveParticipantAccess } from '@/services/collectiveParticipant.service';
import { toast } from '@/lib/toast';

export function CollectiveParticipantLoginPage() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!code.trim() || !password) return toast.error('Kode peserta dan password wajib diisi.');
    setBusy(true);
    try {
      const result = await verifyCollectiveParticipantAccess(code, password);
      if (result?.ok !== true) {
        const reason = String(result?.reason || 'INVALID_CREDENTIALS');
        toast.error(reason === 'LOCKED' ? 'Akses terkunci sementara. Coba lagi nanti.' : reason === 'ACCESS_NOT_READY' ? 'Akses peserta belum siap.' : 'Kode peserta atau password salah.');
        return;
      }
      sessionStorage.setItem('syka_collective_code', String(result.participant_code || code).toUpperCase());
      sessionStorage.setItem('syka_collective_password', password);
      sessionStorage.setItem('syka_collective_participant', JSON.stringify(result));
      navigate('/peserta-kolektif', { replace: true });
    } catch (e: any) { toast.error(e?.message || 'Gagal masuk.'); } finally { setBusy(false); }
  };

  return <div className="min-h-screen surface-bg flex items-center justify-center p-5"><Card className="w-full max-w-md p-6"><Link to="/" className="inline-flex items-center gap-2 text-xs text-fg-muted hover:text-fg"><ArrowLeft size={14}/> Beranda</Link><div className="mt-6 text-center"><div className="mx-auto w-12 h-12 rounded-2xl bg-accent/10 flex items-center justify-center text-accent"><ShieldCheck size={24}/></div><h1 className="text-2xl font-bold text-fg mt-4">Portal Peserta</h1><p className="text-sm text-fg-muted mt-1">Gunakan kode peserta dan password yang diberikan guru.</p></div><div className="mt-6 space-y-3"><label className="block"><span className="text-xs text-fg-muted">Kode peserta</span><input value={code} onChange={e=>setCode(e.target.value.toUpperCase())} autoCapitalize="characters" placeholder="CP-XXXXXXXXXX" className="mt-1 w-full rounded-xl border border-border bg-transparent px-3 py-3 text-sm font-mono"/></label><label className="block"><span className="text-xs text-fg-muted">Password akses</span><input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Password" className="mt-1 w-full rounded-xl border border-border bg-transparent px-3 py-3 text-sm"/></label><Button className="w-full" onClick={()=>void submit()} loading={busy} icon={<KeyRound size={15}/>}>Masuk ke portal</Button></div><p className="text-[11px] text-fg-muted mt-5 text-center">Kode peserta bukan password. Jangan bagikan password kepada orang lain.</p></Card></div>;
}
