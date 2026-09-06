import { useEffect, useState } from 'react';
import { ArrowLeft, BadgeCheck, Save } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { supabase } from '@/lib/supabase';
import { toast } from '@/lib/toast';

export function AdminCollectiveCertificateSettingsPage(){
 const [price,setPrice]=useState(''); const [loading,setLoading]=useState(true); const [saving,setSaving]=useState(false);
 useEffect(()=>{(async()=>{try{const{data,error}=await supabase.rpc('get_collective_certificate_price');if(error)throw error;setPrice(String(Number(data??0)))}catch(e){toast.error(e instanceof Error?e.message:'Gagal memuat harga sertifikat.')}finally{setLoading(false)}})()},[]);
 const save=async()=>{const amount=Number(price);if(!Number.isFinite(amount)||amount<0)return toast.error('Harga tidak valid.');setSaving(true);try{const{error}=await supabase.rpc('admin_set_collective_certificate_price',{p_amount:amount});if(error)throw error;toast.success('Harga sertifikat kolektif disimpan.')}catch(e){toast.error(e instanceof Error?e.message:'Gagal menyimpan harga.')}finally{setSaving(false)}};
 return <div className="min-h-screen surface-bg text-fg-secondary p-5 md:p-8"><div className="max-w-xl mx-auto space-y-5"><Link to="/admin" className="inline-flex items-center gap-2 text-xs text-fg-muted hover:text-fg"><ArrowLeft size={14}/> Kembali ke admin</Link><Card className="p-6"><div className="flex items-center gap-3"><BadgeCheck className="text-accent" size={22}/><div><p className="text-xs text-accent font-semibold tracking-wider">SERTIFIKAT KOLEKTIF</p><h1 className="text-2xl font-bold text-fg">Harga penerbitan</h1></div></div><p className="text-sm text-fg-muted mt-3">Harga ini dipakai saat Guru/akun yang ditunjuk membuat pesanan sertifikat peserta kolektif.</p><label className="block mt-5 text-sm"><span className="text-fg-muted">Harga (IDR)</span><input disabled={loading} inputMode="numeric" value={price} onChange={e=>setPrice(e.target.value.replace(/[^0-9.]/g,''))} className="mt-1 w-full rounded-xl border border-border bg-transparent px-3 py-3" /></label><Button className="mt-4" onClick={()=>void save()} loading={saving} icon={<Save size={15}/>}>Simpan harga</Button></Card></div></div>;
}
