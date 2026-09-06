import { useEffect, useState } from 'react';
import { ArrowLeft, BadgeCheck, Printer, ShieldCheck } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { supabase } from '@/lib/supabase';

export function CollectiveCertificatePage(){
  const {code=''}=useParams();
  const [certificate,setCertificate]=useState<Record<string,unknown>|null>(null);
  const [loading,setLoading]=useState(true);
  useEffect(()=>{let active=true;(async()=>{try{const{data,error}=await supabase.rpc('get_public_collective_certificate',{p_verification_code:code});if(error)throw error;if(active)setCertificate(data as Record<string,unknown>);}catch{if(active)setCertificate(null)}finally{if(active)setLoading(false)}})();return()=>{active=false}},[code]);
  if(loading)return <div className="min-h-screen surface-bg flex items-center justify-center text-fg-muted">Memuat sertifikat…</div>;
  if(!certificate||certificate.status!=='PUBLISHED')return <div className="min-h-screen surface-bg p-5"><div className="max-w-xl mx-auto"><Card className="p-8 text-center"><ShieldCheck className="mx-auto text-fg-muted" size={32}/><h1 className="text-xl font-bold text-fg mt-3">Sertifikat tidak ditemukan</h1><p className="text-sm text-fg-muted mt-2">Kode verifikasi tidak valid atau sertifikat belum diterbitkan.</p><Link className="inline-block mt-5 text-sm text-accent hover:underline" to="/">Kembali ke SYKABELAJAR</Link></Card></div></div>;
  const print=()=>window.print();
  return <div className="min-h-screen surface-bg p-5 md:p-10"><div className="max-w-5xl mx-auto space-y-4 print:max-w-none print:p-0">
    <div className="flex items-center justify-between print:hidden"><Link to={`/verify/${String(certificate.verification_code||code)}`} className="inline-flex items-center gap-2 text-xs text-fg-muted hover:text-fg"><ArrowLeft size={14}/> Verifikasi</Link><Button size="sm" onClick={print} icon={<Printer size={14}/>}>Cetak / Simpan PDF</Button></div>
    <div className="bg-white text-slate-900 min-h-[680px] rounded-3xl border p-10 md:p-16 shadow-xl print:shadow-none print:rounded-none print:min-h-screen">
      <div className="h-full border-4 border-slate-800 rounded-2xl p-8 md:p-14 flex flex-col items-center justify-center text-center">
        <BadgeCheck size={54} className="text-slate-800"/>
        <p className="mt-6 text-xs tracking-[0.35em] font-semibold">SYKABELAJAR</p>
        <h1 className="mt-5 text-4xl md:text-6xl font-serif font-bold">Sertifikat Penghargaan</h1>
        <p className="mt-6 text-lg">Diberikan kepada</p>
        <p className="mt-3 text-3xl md:text-5xl font-bold">{String(certificate.public_name||'Peserta')}</p>
        <p className="mt-6 max-w-2xl text-base md:text-lg leading-relaxed">Atas partisipasi dan pencapaian dalam kompetisi <strong>{String(certificate.competition_title||'Kompetisi')}</strong>.</p>
        <div className="mt-10 grid md:grid-cols-2 gap-4 w-full max-w-2xl text-left"><div><p className="text-xs uppercase tracking-wider text-slate-500">Nomor Serial</p><p className="font-mono mt-1">{String(certificate.serial_number||'—')}</p></div><div><p className="text-xs uppercase tracking-wider text-slate-500">Kode Verifikasi</p><p className="font-mono mt-1">{String(certificate.verification_code||code)}</p></div></div>
        <p className="mt-10 text-sm text-slate-500">Diterbitkan {certificate.issued_at?new Date(String(certificate.issued_at)).toLocaleDateString('id-ID'):''}</p>
      </div>
    </div>
  </div></div>;
}
