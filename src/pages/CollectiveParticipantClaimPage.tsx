import { useState } from 'react';
import { ArrowLeft, Link2, ShieldCheck } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp } from '@/store/AppContext';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { toast } from '@/lib/toast';
import { claimCollectiveParticipant } from '@/services/collectiveParticipant.service';

export function CollectiveParticipantClaimPage(){
  const navigate=useNavigate();
  const {isAuthenticated}=useApp();
  const [code,setCode]=useState('');
  const [password,setPassword]=useState('');
  const [busy,setBusy]=useState(false);
  const submit=async()=>{
    if(!isAuthenticated)return toast.error('Silakan login ke akun SYKABELAJAR terlebih dahulu.');
    if(!code.trim()||!password)return toast.error('Kode peserta dan password wajib diisi.');
    setBusy(true);
    try{
      const result=await claimCollectiveParticipant(code,password);
      if(!result.ok) throw new Error(result.reason==='ALREADY_CLAIMED'?'Peserta ini sudah terhubung ke akun lain.':'Kode peserta atau password salah.');
      toast.success('Riwayat peserta berhasil ditautkan ke akun kamu.');
      navigate('/profile', {replace:true});
    }catch(error:unknown){toast.error(error instanceof Error?error.message:'Gagal menautkan peserta.');}
    finally{setBusy(false)}
  };
  return <div className="min-h-screen surface-bg text-fg-secondary p-5 md:p-8"><div className="max-w-xl mx-auto space-y-5">
    <Link to="/home" className="inline-flex items-center gap-2 text-xs text-fg-muted hover:text-fg"><ArrowLeft size={14}/> Kembali</Link>
    <Card className="p-6 md:p-8"><div className="flex items-center gap-3"><div className="w-11 h-11 rounded-2xl bg-accent/10 flex items-center justify-center text-accent"><Link2 size={20}/></div><div><p className="text-xs text-accent font-semibold tracking-wider">CLAIM PESERTA</p><h1 className="text-2xl font-bold text-fg">Tautkan riwayat lomba</h1></div></div>
      <p className="text-sm text-fg-muted mt-4">Hubungkan peserta kolektif ke akun SYKABELAJAR agar riwayat lombanya tetap tersimpan saat siswa sudah memiliki akun penuh.</p>
      <div className="mt-5 space-y-3"><label className="block text-sm"><span className="text-fg-muted">Kode peserta</span><input value={code} onChange={e=>setCode(e.target.value.toUpperCase())} placeholder="CP-XXXXXXXXXX" className="mt-1 w-full rounded-xl border border-border bg-transparent px-3 py-3 font-mono" /></label><label className="block text-sm"><span className="text-fg-muted">Password peserta</span><input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Masukkan password peserta" className="mt-1 w-full rounded-xl border border-border bg-transparent px-3 py-3" /></label></div>
      <Button className="mt-5 w-full" onClick={()=>void submit()} loading={busy} icon={<ShieldCheck size={15}/>}>Tautkan peserta</Button>
      <p className="text-xs text-fg-muted mt-4">Kode adalah identifier. Password tetap rahasia dan tidak disimpan oleh halaman ini.</p>
    </Card>
  </div></div>;
}
