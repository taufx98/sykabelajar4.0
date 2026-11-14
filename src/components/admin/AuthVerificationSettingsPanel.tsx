import { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, AlertTriangle, RefreshCw } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { getStagingBetterAuthClient } from '@/services/betterAuthApi.client';
import { isBetterAuthEnabled } from '@/services/auth.service';

type Policy={emailVerificationRequired:boolean;updatedAt:string|null;updatedBy:string|null};
export function AuthVerificationSettingsPanel(){
 const previewEnabled = isBetterAuthEnabled();
 const [policy,setPolicy]=useState<Policy|null>(null),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const load=useCallback(async()=>{if(!previewEnabled)return;setLoading(true);setError('');try{const value=await getStagingBetterAuthClient().getAuthRuntimeSettings();setPolicy(value);}catch(e){setError(e instanceof Error?e.message:'AUTH_RUNTIME_SETTINGS_UNAVAILABLE')}finally{setLoading(false)}},[previewEnabled]);
 useEffect(()=>{void load()},[load]);
 const save=async(required:boolean)=>{if(!window.confirm(required?'Aktifkan kembali verifikasi email? Pengguna baru perlu email terverifikasi sebelum login.':'Nonaktifkan sementara verifikasi email? Akun baru dapat login tanpa membuktikan kepemilikan alamat email.'))return;setSaving(true);setError('');setMessage('');try{const next=await getStagingBetterAuthClient().setEmailVerificationRequired(required);setPolicy(next);setMessage(required?'Verifikasi email diwajibkan kembali.':'Bypass verifikasi email aktif.')}catch(e){setError(e instanceof Error?e.message:'AUTH_RUNTIME_SETTINGS_SAVE_FAILED')}finally{setSaving(false)}};
 if (!previewEnabled) return null;
 return <Card className="p-5 space-y-4">
  <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><ShieldCheck size={18} className="text-accent"/><h3 className="font-semibold text-fg">Verifikasi Email Better Auth</h3></div><p className="mt-1 text-sm text-fg-muted">Kontrol verifikasi email untuk registrasi dan pembuatan session. Disimpan di D1 dan berlaku tanpa redeploy.</p></div><Button size="sm" variant="outline" onClick={()=>void load()} disabled={loading}><RefreshCw size={14}/> Muat ulang</Button></div>
  {loading?<p className="text-sm text-fg-muted">Memuat policy…</p>:policy&&<div className="rounded-xl border surface-border p-4 space-y-3"><div className="flex items-center justify-between"><span className="text-sm font-medium">Status sekarang</span><Badge color={policy.emailVerificationRequired?'moss':'warn'}>{policy.emailVerificationRequired?'Wajib verifikasi':'Bypass aktif'}</Badge></div><p className="text-xs text-fg-muted">{policy.emailVerificationRequired?'Email harus diverifikasi sebelum session login diterbitkan.':'Pendaftaran dan login email/password tidak membutuhkan verifikasi email. Gunakan hanya selama pengujian staging.'}</p><div className="flex flex-wrap gap-2"><Button size="sm" disabled={saving||policy.emailVerificationRequired} onClick={()=>void save(false)}>{saving?'Menyimpan…':'Nonaktifkan sementara'}</Button><Button size="sm" variant="outline" disabled={saving||!policy.emailVerificationRequired} onClick={()=>void save(true)}>Aktifkan verifikasi</Button></div><p className="text-[11px] text-fg-muted">Terakhir diubah: {policy.updatedAt?new Date(policy.updatedAt).toLocaleString('id-ID'):'—'} · Admin ID: {policy.updatedBy??'—'}</p></div>}
  <div className="flex gap-2 rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 text-xs text-amber-200"><AlertTriangle size={16} className="shrink-0"/><p>Bypass berarti alamat email belum terbukti milik pengguna. Jangan aktifkan di Production; email palsu/impersonasi dapat masuk. Verifikasi nomor telepon dan role admin tetap terpisah.</p></div>
  {error&&<p role="alert" className="text-xs text-red-400">{error}</p>}{message&&<p role="status" className="text-xs text-emerald-400">{message}</p>}
 </Card>
}
